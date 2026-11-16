using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed class EfFinanceReportExportAudit(ElevantDbContext context) : IFinanceReportExportAudit
{
    public async Task RecordAsync(Guid actorId, string reportKey, string format, FinanceReportFilter filter,
        CancellationToken cancellationToken = default)
    {
        var accountId = await context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);
        CommercialAuditWriter.Add(context, accountId, "finance.report.exported", "finance.reports", Guid.CreateVersion7(), null,
            new AuditFieldChangeData("report", null, reportKey), new AuditFieldChangeData("format", null, format),
            new AuditFieldChangeData("period", null, $"{filter.From:yyyy-MM-dd}/{filter.To:yyyy-MM-dd}"),
            new AuditFieldChangeData("currency", null, filter.CurrencyCode));
        await context.SaveChangesAsync(cancellationToken);
    }
}
