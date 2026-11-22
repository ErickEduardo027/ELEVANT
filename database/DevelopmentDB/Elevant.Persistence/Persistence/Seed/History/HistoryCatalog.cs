using Elevant.Domain.Entities;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// What earlier chunks (and the base seed) left that later chunks build on, rebuilt from the database at the start
/// of every chunk run, never carried in memory between chunks: a resumed run sees exactly what committed. The
/// airlines are the history ones (organization <c>AIR-HIST-*</c>) plus Demo Airlines (ZZ) with their contracts,
/// governing versions and rates; the USD→DOP rates of the window; and generic lookups by deterministic public id.
/// Other parts extend it in their own partial files (for example <c>HistoryCatalog.Workforce.cs</c>).
/// </summary>
internal sealed partial class HistoryCatalog
{
    public const string HistoryOrganizationPrefix = "AIR-HIST-";
    public const string DemoAirlineIata = "ZZ";

    private readonly ElevantDbContext _context;

    private HistoryCatalog(ElevantDbContext context, IReadOnlyList<HistoryAirline> airlines,
        IReadOnlyDictionary<DateOnly, decimal> usdToDop)
    {
        _context = context;
        Airlines = airlines;
        UsdToDop = usdToDop;
    }

    /// <summary>History airlines (ordered by IATA code) and Demo Airlines last.</summary>
    public IReadOnlyList<HistoryAirline> Airlines { get; }

    /// <summary>Only the airlines the commercial chunk created.</summary>
    public IEnumerable<HistoryAirline> HistoryAirlines => Airlines.Where(airline => airline.IsHistory);

    /// <summary>Demo Airlines (ZZ) of the base seed, the portal's <c>airline.client</c> tenant.</summary>
    public HistoryAirline? Demo => Airlines.SingleOrDefault(airline => !airline.IsHistory);

    /// <summary>Current USD→DOP rate of each date that has one (base seed and the fx chunk).</summary>
    public IReadOnlyDictionary<DateOnly, decimal> UsdToDop { get; }

    /// <summary>The USD→DOP rate in force on a date: that day's, or the latest earlier one.</summary>
    public decimal? UsdToDopOn(DateOnly date)
    {
        if (UsdToDop.TryGetValue(date, out var rate)) return rate;
        var earlier = UsdToDop.Keys.Where(day => day < date).DefaultIfEmpty().Max();
        return earlier == default ? null : UsdToDop[earlier];
    }

    /// <summary>
    /// The contract version that governs an airline at PUJ on a local date (2-C): a superseded version for the dates
    /// it kept, or an approved one signed by both parties (or the legacy first version of a contract that left
    /// Draft), of a contract that is active, or terminated after that date. Null when the airline had no coverage.
    /// </summary>
    public HistoryContractVersion? GoverningVersion(long airlineId, DateOnly date)
    {
        var airline = Airlines.SingleOrDefault(item => item.Id == airlineId);
        if (airline is null) return null;
        return airline.Contracts
            .Where(contract => contract.Covers(date))
            .SelectMany(contract => contract.Versions)
            .Where(version => version.Governs && version.CoversPuj && version.ValidFrom <= date &&
                (version.ValidTo is null || version.ValidTo >= date))
            .OrderByDescending(version => version.ValidFrom).ThenByDescending(version => version.Number)
            .FirstOrDefault();
    }

    /// <summary>Internal keys of rows found by their deterministic public ids (missing ones are absent).</summary>
    public async Task<IReadOnlyDictionary<Guid, long>> IdsAsync<TEntity>(IEnumerable<Guid> publicIds,
        CancellationToken cancellationToken) where TEntity : AuditableEntity
    {
        ArgumentNullException.ThrowIfNull(publicIds);
        var keys = publicIds.Distinct().ToArray();
        var found = new Dictionary<Guid, long>(keys.Length);
        // Bounded IN lists: SQL Server takes at most 2100 parameters per command.
        foreach (var page in keys.Chunk(1000))
            foreach (var row in await _context.Set<TEntity>().AsNoTracking().Where(item => page.Contains(item.PublicId))
                         .Select(item => new { item.PublicId, item.Id }).ToArrayAsync(cancellationToken))
                found[row.PublicId] = row.Id;
        return found;
    }

    /// <summary>The internal key of the row with this deterministic key suffix, or null.</summary>
    public async Task<long?> IdOfAsync<TEntity>(string keySuffix, CancellationToken cancellationToken)
        where TEntity : AuditableEntity
    {
        var key = HistoryKeys.Key(keySuffix);
        return await _context.Set<TEntity>().AsNoTracking().Where(item => item.PublicId == key)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
    }

    public static async Task<HistoryCatalog> LoadAsync(ElevantDbContext context, HistoryAnchors anchors,
        CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        ArgumentNullException.ThrowIfNull(anchors);
        var airlineRows = await (from airline in context.Airlines.AsNoTracking()
                                 join organization in context.Organizations.AsNoTracking()
                                     on airline.OrganizationId equals organization.Id
                                 where organization.Code.StartsWith(HistoryOrganizationPrefix) ||
                                       airline.IataCode == DemoAirlineIata
                                 select new
                                 {
                                     airline.Id, airline.PublicId, airline.IataCode, airline.IcaoCode, airline.Name,
                                     airline.OrganizationId, OrganizationCode = organization.Code,
                                 }).ToArrayAsync(cancellationToken);
        var airlineIds = airlineRows.Select(item => item.Id).ToArray();
        var terms = await context.AirlineBillingProfiles.AsNoTracking().Where(item => airlineIds.Contains(item.AirlineId))
            .ToDictionaryAsync(item => item.AirlineId, item => item.PaymentTermDays, cancellationToken);
        var organizationIds = airlineRows.Select(item => item.OrganizationId).ToArray();
        var signers = (await context.OrganizationMemberships.AsNoTracking()
                .Where(item => organizationIds.Contains(item.OrganizationId) && item.Kind == MembershipKind.AirlineClient)
                .OrderBy(item => item.Id).Select(item => new { item.OrganizationId, item.AccountId })
                .ToArrayAsync(cancellationToken))
            .GroupBy(item => item.OrganizationId).ToDictionary(group => group.Key, group => group.First().AccountId);

        var contracts = await context.Contracts.AsNoTracking().Where(item => airlineIds.Contains(item.AirlineId))
            .OrderBy(item => item.Id).ToArrayAsync(cancellationToken);
        var contractIds = contracts.Select(item => item.Id).ToArray();
        var versions = await context.ContractVersions.AsNoTracking().Where(item => contractIds.Contains(item.ContractId))
            .OrderBy(item => item.ContractId).ThenBy(item => item.VersionNumber).ToArrayAsync(cancellationToken);
        var versionIds = versions.Select(item => item.Id).ToArray();
        var pujVersions = (await context.Set<ContractVersionStation>().AsNoTracking()
                .Where(item => versionIds.Contains(item.ContractVersionId) && item.StationId == anchors.Station.Id)
                .Select(item => item.ContractVersionId).ToArrayAsync(cancellationToken))
            .ToHashSet();
        var signatures = (await context.ContractSignatures.AsNoTracking()
                .Where(item => versionIds.Contains(item.ContractVersionId))
                .Select(item => new { item.ContractVersionId, item.Party, item.DocumentSha256 })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.ContractVersionId);
        var serviceCodes = anchors.Services.ToDictionary(item => item.Id, item => item.Code);
        var rates = (await context.ContractServiceRates.AsNoTracking().Where(item => versionIds.Contains(item.ContractVersionId))
                .OrderBy(item => item.Id).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.ContractVersionId);
        var chargeCodes = anchors.Charges.ToDictionary(item => item.Id, item => item.Code);
        var charges = (await context.ContractChargeRates.AsNoTracking().Where(item => versionIds.Contains(item.ContractVersionId))
                .OrderBy(item => item.Id).ToArrayAsync(cancellationToken))
            .ToLookup(item => item.ContractVersionId);

        var byContract = versions.ToLookup(item => item.ContractId);
        var catalogContracts = contracts.Select(contract =>
        {
            var own = byContract[contract.Id].ToArray();
            var list = own.Select(version =>
            {
                var signed = signatures[version.Id].ToArray();
                var signedByBoth = signed.Any(airline => airline.Party == ContractSignatureParty.Airline &&
                    signed.Any(aviam => aviam.Party == ContractSignatureParty.Aviam &&
                        aviam.DocumentSha256 == airline.DocumentSha256));
                var firstApproved = !own.Any(earlier => earlier.VersionNumber < version.VersionNumber &&
                    earlier.Status is ContractVersionStatus.Approved or ContractVersionStatus.Superseded);
                var governs = version.Status == ContractVersionStatus.Superseded ||
                    version.Status == ContractVersionStatus.Approved &&
                    (signedByBoth || contract.Status != ContractStatus.Draft && firstApproved);
                return new HistoryContractVersion(version.Id, version.PublicId, contract.Id, version.VersionNumber,
                    version.Status, version.ValidFrom, version.ValidTo, version.CurrencyCode, governs,
                    pujVersions.Contains(version.Id),
                    rates[version.Id].Select(rate => new HistoryRate(rate.Id, rate.ServiceDefinitionId,
                        serviceCodes.GetValueOrDefault(rate.ServiceDefinitionId, string.Empty), rate.BillingUnit,
                        rate.UnitPrice, rate.MinimumQuantity)).ToArray(),
                    charges[version.Id].Select(rate => new HistoryChargeRate(rate.Id, rate.ChargeDefinitionId,
                        chargeCodes.GetValueOrDefault(rate.ChargeDefinitionId, string.Empty), rate.IsExcluded, rate.Value,
                        rate.MinimumAmount)).ToArray());
            }).ToArray();
            return new HistoryContract(contract.Id, contract.PublicId, contract.AirlineId, contract.ContractCode,
                contract.Status, contract.SignedOn, contract.TerminatedOn, list);
        }).ToLookup(item => item.AirlineId);

        var airlines = airlineRows
            .Select(row => new HistoryAirline(row.Id, row.PublicId, row.IataCode?.Trim(), row.IcaoCode.Trim(), row.Name,
                row.OrganizationId, row.OrganizationCode.StartsWith(HistoryOrganizationPrefix, StringComparison.Ordinal),
                signers.TryGetValue(row.OrganizationId, out var signer) ? signer : null,
                terms.TryGetValue(row.Id, out var days) ? days : 30, catalogContracts[row.Id].ToArray()))
            .OrderBy(item => item.IsHistory ? 0 : 1).ThenBy(item => item.IataCode ?? item.IcaoCode, StringComparer.Ordinal)
            .ToArray();

        var usdToDop = await context.ExchangeRates.AsNoTracking()
            .Where(item => item.IsCurrent && item.FromCurrency == "USD" && item.ToCurrency == "DOP")
            .ToDictionaryAsync(item => item.RateDate, item => item.Rate, cancellationToken);
        return new HistoryCatalog(context, airlines, usdToDop);
    }
}

/// <summary>
/// An airline of the catalog. <c>IsHistory</c>: created by the commercial chunk (organization <c>AIR-HIST-*</c>),
/// false for Demo Airlines. <c>SignerAccountId</c>: its portal account that signed the contracts (disabled, no
/// password; null for Demo Airlines, whose portal account is the base seed's).
/// </summary>
internal sealed record HistoryAirline(long Id, Guid PublicId, string? IataCode, string IcaoCode, string Name,
    long OrganizationId, bool IsHistory, long? SignerAccountId, int PaymentTermDays,
    IReadOnlyList<HistoryContract> Contracts)
{
    /// <summary>The airline designator used in flight numbers: IATA, or ICAO without one.</summary>
    public string Designator => IataCode ?? IcaoCode;
}

internal sealed record HistoryContract(long Id, Guid PublicId, long AirlineId, string Code, ContractStatus Status,
    DateOnly? SignedOn, DateOnly? TerminatedOn, IReadOnlyList<HistoryContractVersion> Versions)
{
    /// <summary>Whether the contract gives coverage on the date: in force, and before its scheduled termination.</summary>
    public bool Covers(DateOnly date) =>
        Status is ContractStatus.Active or ContractStatus.Terminated or ContractStatus.Suspended or ContractStatus.Expired &&
        (TerminatedOn is null || date < TerminatedOn) && (SignedOn is null || SignedOn <= date);
}

/// <summary>
/// A contract version. <c>Governs</c>: it governs prices (2-C) for the dates it covers. <c>CoversPuj</c>: PUJ is one
/// of its stations.
/// </summary>
internal sealed record HistoryContractVersion(long Id, Guid PublicId, long ContractId, int Number,
    ContractVersionStatus Status, DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode, bool Governs,
    bool CoversPuj, IReadOnlyList<HistoryRate> Rates, IReadOnlyList<HistoryChargeRate> Charges)
{
    public HistoryRate? Rate(string serviceCode) =>
        Rates.FirstOrDefault(rate => string.Equals(rate.ServiceCode, serviceCode, StringComparison.Ordinal));
}

internal sealed record HistoryRate(long Id, long ServiceDefinitionId, string ServiceCode, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity);

internal sealed record HistoryChargeRate(long Id, long ChargeDefinitionId, string ChargeCode, bool IsExcluded,
    decimal? Value, decimal? MinimumAmount);
