using System.Text.Json;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// 4-N01: a draft that holds approved services, or package consumption, without an invoice and without a no-charge
/// closure is a leftover nothing in the product can move any more: an issuance that failed before its single
/// transaction, or a preinvoice of the retired module (Draft, Submitted, Disputed or Accepted). The issuance and the
/// no-charge closure release the ones in their way inside their own serializable transaction: the draft is voided,
/// every line is released (the package consumption it recorded with them) and each release is audited. A refusal
/// rolls the release back with everything else, and a draft an invoice issued is never touched.
/// </summary>
internal static class StaleInternalDrafts
{
    public const string ReleasedAction = "finance.invoicing.stale_draft_released";

    /// <summary>The leftover drafts that hold one of <paramref name="serviceIds"/> through an unreleased line.</summary>
    public static Task<long[]> HoldingAsync(ElevantDbContext context, IReadOnlyCollection<long> serviceIds,
        CancellationToken cancellationToken) =>
        (from line in context.PreinvoiceLines.AsNoTracking()
         join draft in context.Preinvoices.AsNoTracking() on line.PreinvoiceId equals draft.Id
         where line.Kind == PreinvoiceLineKind.Service && line.OperationServiceId != null &&
               serviceIds.Contains(line.OperationServiceId.Value) && line.ReleasedAt == null &&
               draft.Status != PreinvoiceStatus.Invoiced && draft.Status != PreinvoiceStatus.NoCharge &&
               !context.NonFiscalInvoices.Any(invoice => invoice.PreinvoiceId == draft.Id)
         select draft.Id).Distinct().ToArrayAsync(cancellationToken);

    /// <summary>
    /// The leftover drafts whose unreleased package consumption at the station counts against a package of the contract
    /// versions of <paramref name="rateIds"/>: the valuation would refuse every service of that package scope with
    /// <c>package_scope_has_unissued_preinvoice</c> while they stand. A contract without packages reads nothing more.
    /// </summary>
    public static async Task<long[]> ConsumingAsync(ElevantDbContext context, long stationId,
        IReadOnlyCollection<long> rateIds, CancellationToken cancellationToken)
    {
        var versionIds = await context.ContractServiceRates.AsNoTracking().Where(rate => rateIds.Contains(rate.Id))
            .Select(rate => rate.ContractVersionId).Distinct().ToArrayAsync(cancellationToken);
        // One query on the server: a package scoped by turnaround keeps a consumption per turnaround, so their ids are
        // never brought here; only the unreleased entries of drafts without invoice come back.
        return await (from link in context.Set<ContractServicePackage>().AsNoTracking()
                      join consumption in context.Set<PackageConsumption>().AsNoTracking()
                          on link.Id equals consumption.ContractPackageId
                      join entry in context.Set<PackageConsumptionEntry>().AsNoTracking()
                          on consumption.Id equals entry.ConsumptionId
                      join line in context.PreinvoiceLines.AsNoTracking() on entry.PreinvoiceLineId equals line.Id
                      join draft in context.Preinvoices.AsNoTracking() on line.PreinvoiceId equals draft.Id
                      where versionIds.Contains(link.ContractVersionId) && consumption.StationId == stationId &&
                            line.ReleasedAt == null &&
                            draft.Status != PreinvoiceStatus.Invoiced && draft.Status != PreinvoiceStatus.NoCharge &&
                            !context.NonFiscalInvoices.Any(invoice => invoice.PreinvoiceId == draft.Id)
                      select draft.Id).Distinct().ToArrayAsync(cancellationToken);
    }

    /// <summary>
    /// Voids <paramref name="draftIds"/>, releases every line they still hold and audits each release with the status
    /// it had and the operations it held, under the request that released it. Runs inside the caller's transaction.
    /// </summary>
    public static async Task ReleaseAsync(ElevantDbContext context, IReadOnlyCollection<long> draftIds,
        Guid actorAccountId, string actorDisplay, Guid requestId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        if (draftIds.Count == 0) return;
        var accountId = await context.Users.AsNoTracking().Where(item => item.PublicId == actorAccountId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var drafts = await context.Preinvoices.Where(item => draftIds.Contains(item.Id)).OrderBy(item => item.Id)
            .ToArrayAsync(cancellationToken);
        var lines = await context.PreinvoiceLines
            .Where(line => draftIds.Contains(line.PreinvoiceId) && line.ReleasedAt == null).ToArrayAsync(cancellationToken);
        var held = (await (from line in context.PreinvoiceLines.AsNoTracking()
                           join service in context.OperationServices.AsNoTracking()
                               on line.OperationServiceId equals (long?)service.Id
                           join operation in context.GroundOperations.AsNoTracking()
                               on service.GroundOperationId equals operation.Id
                           where draftIds.Contains(line.PreinvoiceId) && line.Kind == PreinvoiceLineKind.Service
                           select new { line.PreinvoiceId, operation.PublicId }).Distinct().ToArrayAsync(cancellationToken))
            .ToLookup(item => item.PreinvoiceId, item => item.PublicId);
        var airlineIds = drafts.Select(item => item.AirlineId).Distinct().ToArray();
        var organizations = await context.Airlines.AsNoTracking().Where(item => airlineIds.Contains(item.Id))
            .ToDictionaryAsync(item => item.Id, item => (long?)item.OrganizationId, cancellationToken);

        foreach (var line in lines)
        {
            line.ReleasedAt = now;
            line.UpdatedAt = now;
        }
        foreach (var draft in drafts)
        {
            var previous = draft.Status;
            draft.Status = PreinvoiceStatus.Voided;
            draft.UpdatedAt = now;
            context.AuditEntries.Add(new AuditEntry
            {
                PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account,
                ActorAccountId = accountId, ActorDisplay = actorDisplay, Action = ReleasedAction,
                EntityType = nameof(Preinvoice), EntityPublicId = draft.PublicId,
                OrganizationId = organizations.GetValueOrDefault(draft.AirlineId), StationId = draft.StationId,
                Source = AuditSource.Api, CorrelationId = requestId, RequestId = requestId.ToString("D"),
                Reason = "Finanzas liberó un borrador anterior sin factura que retenía lo que se factura o se cierra sin cargo.",
                MetadataJson = JsonSerializer.Serialize(new
                {
                    previousStatus = previous.ToString(), total = draft.Total, currency = draft.CurrencyCode,
                    operations = held[draft.Id].Order().ToArray(),
                }),
            });
        }
        await context.SaveChangesAsync(cancellationToken);
    }
}
