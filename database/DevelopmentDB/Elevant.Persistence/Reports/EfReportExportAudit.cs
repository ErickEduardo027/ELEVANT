using System.Text.Json;
using Elevant.Application.Abstractions.Documents;
using Elevant.Application.Documents;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Reports;

/// <summary>
/// The audit entry of an export of a tabular report (ADR-0048, «Reportes nuevos»): <c>{area}.report.exported</c> on
/// <c>{area}.reports</c>, with the report, the format, the period, the filters as asked and the rows, like OCC's.
/// </summary>
internal sealed class EfReportExportAudit(ElevantDbContext context, TimeProvider timeProvider) : IReportExportAudit
{
    public async Task RecordAsync(Guid actorId, string area, string reportKey, string format, TabularReportQuery query,
        int rows, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (area is not ("contracts" or "human-resources" or "airline-portal" or "finance") ||
            string.IsNullOrWhiteSpace(reportKey) || format is not ("csv" or "xlsx" or "pdf") || rows < 0)
            throw new ArgumentException("The export audit is invalid.");
        var accountKey = await context.Users.AsNoTracking().Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = timeProvider.GetUtcNow(),
            ActorType = AuditActorType.Account, ActorAccountId = accountKey,
            Department = area switch
            {
                "contracts" => Department.Contracts,
                "human-resources" => Department.HumanResources,
                "finance" => Department.Finance,
                _ => null,
            },
            Action = $"{area}.report.exported", EntityType = $"{area}.reports", EntityPublicId = Guid.CreateVersion7(),
            Source = AuditSource.Api, CorrelationId = Guid.CreateVersion7(),
            MetadataJson = JsonSerializer.Serialize(new
            {
                Report = reportKey, query.From, query.To, Format = format, RowCount = rows,
                Filters = query.Values.OrderBy(item => item.Key, StringComparer.Ordinal)
                    .ToDictionary(item => item.Key, item => item.Value),
            }),
        });
        await context.SaveChangesAsync(cancellationToken);
    }
}
