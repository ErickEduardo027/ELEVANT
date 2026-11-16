using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// The charges each service's contract excludes (3-N29): the charge rates of the contract version the service was
/// priced from (its <c>ContractServiceRate</c>) marked <c>IsExcluded</c>. The tablet's charge options, the automatic
/// surcharges, OCC's review and Finance's valuation read the same answer, so a charge the contract excludes is never
/// offered, never marked automatically, refused when OCC adds it and blocks billing when an older mark carries it. A
/// charter has no contract and excludes nothing.
/// </summary>
internal static class ContractChargeExclusions
{
    /// <summary>The excluded charge definitions of the given services (by internal id).</summary>
    internal sealed class Excluded(ILookup<long, long> byService)
    {
        public static readonly Excluded None = new(Array.Empty<(long, long)>().ToLookup(pair => pair.Item1, pair => pair.Item2));

        /// <summary>Whether the contract of <paramref name="serviceId"/> excludes <paramref name="chargeDefinitionId"/>.</summary>
        public bool Contains(long serviceId, long chargeDefinitionId) => byService[serviceId].Contains(chargeDefinitionId);

        /// <summary>The charge definitions the contract of the service excludes.</summary>
        public IReadOnlyCollection<long> Of(long serviceId) => byService[serviceId].ToArray();
    }

    public static async Task<Excluded> ForServicesAsync(ElevantDbContext context, IReadOnlyCollection<long> serviceIds,
        CancellationToken cancellationToken)
    {
        if (serviceIds.Count == 0) return Excluded.None;
        var ids = serviceIds.Distinct().ToArray();
        var rows = await (from service in context.OperationServices.AsNoTracking()
                          join rate in context.ContractServiceRates.AsNoTracking()
                              on service.ContractServiceRateId equals (long?)rate.Id
                          join exclusion in context.ContractChargeRates.AsNoTracking()
                              on rate.ContractVersionId equals exclusion.ContractVersionId
                          where ids.Contains(service.Id) && exclusion.IsExcluded
                          select new { ServiceId = service.Id, exclusion.ChargeDefinitionId })
            .ToArrayAsync(cancellationToken);
        return new Excluded(rows.ToLookup(row => row.ServiceId, row => row.ChargeDefinitionId));
    }

    /// <summary>
    /// The services, among the given marks (service internal id, charge public id), that carry a charge their contract
    /// excludes: Finance blocks them with <c>charge_excluded_by_contract</c> instead of valuing the charge at zero.
    /// </summary>
    public static async Task<IReadOnlySet<long>> ServicesCarryingExcludedAsync(ElevantDbContext context,
        IReadOnlyCollection<(long ServiceId, Guid ChargeId)> marks, CancellationToken cancellationToken)
    {
        if (marks.Count == 0) return new HashSet<long>();
        var excluded = await ForServicesAsync(context, marks.Select(mark => mark.ServiceId).Distinct().ToArray(),
            cancellationToken);
        var chargeIds = marks.Select(mark => mark.ChargeId).Distinct().ToArray();
        var internalIds = await context.ChargeDefinitions.AsNoTracking()
            .Where(charge => chargeIds.Contains(charge.PublicId))
            .Select(charge => new { charge.PublicId, charge.Id })
            .ToDictionaryAsync(charge => charge.PublicId, charge => charge.Id, cancellationToken);
        return marks.Where(mark => internalIds.TryGetValue(mark.ChargeId, out var id) && excluded.Contains(mark.ServiceId, id))
            .Select(mark => mark.ServiceId).ToHashSet();
    }
}
