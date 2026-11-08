using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// What a renewal, an amendment (1-C) and the draft that replaces a withdrawn first version take from the
/// version they start from (2-N03): the service rates, the stations, the negotiated surcharges and
/// exemptions and the linked packages. A surcharge Finance only inherited from the base tariff at approval
/// is not copied, so the new version takes the base tariff of its own start when Finance approves it (and
/// stays inherited for the next copy), and a surcharge of a retired definition is not copied either. A
/// package that no longer fits the new dates is copied as it is: the draft readiness reports it
/// (package_not_eligible) until Contratos changes it.
/// </summary>
internal static class ContractVersionCopy
{
    public static async Task CopyAsync(ElevantDbContext context, ContractVersion source, ContractVersion target,
        bool ratesConfirmed, DateTimeOffset now, CancellationToken cancellationToken)
    {
        // 1-E: the copy keeps unit codes; a legacy unit name of the source becomes its code.
        var units = await BillingUnitCodes.LoadAsync(context, cancellationToken);
        foreach (var rate in await context.ContractServiceRates.AsNoTracking()
                     .Where(item => item.ContractVersionId == source.Id).ToArrayAsync(cancellationToken))
            context.ContractServiceRates.Add(new ContractServiceRate
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = target.Id, ServiceDefinitionId = rate.ServiceDefinitionId,
                BillingUnit = units.Normalize(rate.BillingUnit), UnitPrice = rate.UnitPrice, MinimumQuantity = rate.MinimumQuantity,
                IsConfirmed = ratesConfirmed, CreatedAt = now, UpdatedAt = now,
            });
        foreach (var station in await context.Set<ContractVersionStation>().AsNoTracking()
                     .Where(item => item.ContractVersionId == source.Id).Select(item => item.StationId)
                     .ToArrayAsync(cancellationToken))
            context.Set<ContractVersionStation>().Add(new ContractVersionStation { ContractVersionId = target.Id, StationId = station });
        var charges = await (from rate in context.ContractChargeRates.AsNoTracking()
                             join definition in context.ChargeDefinitions.AsNoTracking() on rate.ChargeDefinitionId equals definition.Id
                             where rate.ContractVersionId == source.Id && definition.IsActive
                             select rate).ToArrayAsync(cancellationToken);
        foreach (var rate in charges.Where(item => Negotiated(item, source)))
            context.ContractChargeRates.Add(new ContractChargeRate
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = target.Id, ChargeDefinitionId = rate.ChargeDefinitionId,
                IsExcluded = rate.IsExcluded, Value = rate.IsExcluded ? null : rate.Value,
                MinimumAmount = rate.IsExcluded ? null : rate.MinimumAmount, CreatedAt = now, UpdatedAt = now,
            });
        foreach (var package in await context.Set<ContractServicePackage>().AsNoTracking()
                     .Where(item => item.ContractVersionId == source.Id).Select(item => item.PackageVersionId)
                     .ToArrayAsync(cancellationToken))
            context.Set<ContractServicePackage>().Add(new ContractServicePackage
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = target.Id, PackageVersionId = package,
                CreatedAt = now, UpdatedAt = now,
            });
    }

    /// <summary>
    /// An exemption, or a value Contratos negotiated before Finance approved the source. The rows the approval
    /// itself created (same instant as <c>ApprovedAt</c>) only froze the base tariff of that day.
    /// </summary>
    public static bool Negotiated(ContractChargeRate rate, ContractVersion source) =>
        rate.IsExcluded || source.ApprovedAt is not { } approvedAt || rate.CreatedAt < approvedAt;
}
