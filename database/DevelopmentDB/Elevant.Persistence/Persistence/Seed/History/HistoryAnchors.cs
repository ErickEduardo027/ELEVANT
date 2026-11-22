using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// The base-seed rows the history hangs from, read by natural key or fixed public id (the ones
/// <c>verify-development.sql</c> certifies). Loading fails with the list of what is missing: the history only runs
/// after <see cref="DevelopmentDataSeeder"/>. Read-only; chunks never change these rows.
/// </summary>
internal sealed partial class HistoryAnchors
{
    public static readonly Guid OccAccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");
    public static readonly Guid HumanResourcesAccountId = Guid.Parse("40000000-0000-7000-8000-000000000004");
    public static readonly Guid ContractsAccountId = Guid.Parse("40000000-0000-7000-8000-000000000005");
    public static readonly Guid FinanceAccountId = Guid.Parse("40000000-0000-7000-8000-000000000006");
    public static readonly Guid SuperAdminAccountId = Guid.Parse("40000000-0000-7000-8000-000000000007");

    /// <summary>The date the base tariffs are read at (start of the history contracts).</summary>
    public static readonly DateOnly TariffDate = new(2026, 5, 15);

    public required StationAnchor Station { get; init; }
    public required IReadOnlyList<TerminalAnchor> Terminals { get; init; }

    /// <summary>Active stands of the station, by code.</summary>
    public required IReadOnlyList<StandAnchor> Stands { get; init; }

    public required long AviamOrganizationId { get; init; }
    public required AirportAnchor Puj { get; init; }
    public required AirportAnchor Mia { get; init; }

    /// <summary>OCC administrator (Alex Operations).</summary>
    public required AccountAnchor Occ { get; init; }
    public required AccountAnchor HumanResources { get; init; }

    /// <summary>Contratos administrator; also AVIAM's signer of the history contracts.</summary>
    public required AccountAnchor Contracts { get; init; }
    public required AccountAnchor Finance { get; init; }

    /// <summary>Superadministración, when the base seed created it (it always does in <c>seed-development</c>).</summary>
    public AccountAnchor? SuperAdmin { get; init; }

    /// <summary>The base ramp agent DEV-RA-001: the history never schedules or assigns it.</summary>
    public required long BaseRampAgentId { get; init; }

    /// <summary>Active services of the catalog, by code.</summary>
    public required IReadOnlyList<ServiceAnchor> Services { get; init; }

    /// <summary>Finance's USD base price of each active service (all stations) at <see cref="TariffDate"/>.</summary>
    public required IReadOnlyDictionary<long, FinanceTariffLookup.BaseServiceRate> UsdServiceRates { get; init; }

    /// <summary>Active charge definitions (NIGHT, HOLIDAY, OVERTIME, DELAY, ADMIN-FEE…).</summary>
    public required IReadOnlyList<ChargeAnchor> Charges { get; init; }

    /// <summary>Finance's USD base charge rate by charge definition id at <see cref="TariffDate"/>.</summary>
    public required IReadOnlyDictionary<long, FinanceTariffLookup.BaseChargeRate> UsdChargeRates { get; init; }

    /// <summary>Active billing units: code → id.</summary>
    public required IReadOnlyDictionary<string, long> BillingUnits { get; init; }

    public required long RampAgentPositionId { get; init; }

    /// <summary>Active equipment types: code → id (GPU, BOARDING-BRIDGE…).</summary>
    public required IReadOnlyDictionary<string, long> EquipmentTypes { get; init; }

    /// <summary>Active aircraft types (A320 narrow-body, A333 wide-body in the base seed).</summary>
    public required IReadOnlyList<AircraftTypeAnchor> AircraftTypes { get; init; }

    /// <summary>Minutes of ground time Finance allows per size before «package exceeded».</summary>
    public required IReadOnlyDictionary<AircraftSizeCategory, int> GroundTimeAllowances { get; init; }

    /// <summary>The published FLIGHT-REPORT checklist (operations without a bridge).</summary>
    public required ChecklistAnchor FlightReport { get; init; }

    /// <summary>The published TURNAROUND-BASE v2 bridge checklist, when present.</summary>
    public ChecklistAnchor? BridgeChecklist { get; init; }

    public ServiceAnchor Service(string code) => Services.SingleOrDefault(item => item.Code == code) ??
        throw new InvalidOperationException($"Development history needs the active service «{code}».");

    public static async Task<HistoryAnchors> LoadAsync(ElevantDbContext context, CancellationToken cancellationToken)
    {
        ArgumentNullException.ThrowIfNull(context);
        var missing = new List<string>();
        T? Require<T>(T? value, string what) where T : class
        {
            if (value is null) missing.Add(what);
            return value;
        }

        var station = Require(await context.Stations.AsNoTracking().Where(item => item.Code == "PUJ" && item.IsActive)
            .Select(item => new StationAnchor(item.Id, item.PublicId, item.Code, item.Name, item.IanaTimeZone))
            .SingleOrDefaultAsync(cancellationToken), "station PUJ");
        var terminals = station is null ? [] : await context.Terminals.AsNoTracking()
            .Where(item => item.StationId == station.Id && item.IsActive).OrderBy(item => item.Code)
            .Select(item => new TerminalAnchor(item.Id, item.PublicId, item.Code, item.MaxStandsPerAgent,
                item.RequiresBridgeQualification))
            .ToArrayAsync(cancellationToken);
        if (terminals.Length == 0) missing.Add("active PUJ terminals");
        var stands = station is null ? [] : await context.Stands.AsNoTracking()
            .Where(item => item.StationId == station.Id && item.IsActive).OrderBy(item => item.Code)
            .Select(item => new StandAnchor(item.Id, item.PublicId, item.Code, item.TerminalId, item.HasBoardingBridge,
                item.IsRemote, item.MaxAircraftSize))
            .ToArrayAsync(cancellationToken);
        if (stands.Length == 0) missing.Add("active PUJ stands");
        var aviam = await context.Organizations.AsNoTracking().Where(item => item.Code == "AVIAM")
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        if (aviam is null) missing.Add("organization AVIAM");
        var airports = await context.Airports.AsNoTracking().Where(item => item.IataCode == "PUJ" || item.IataCode == "MIA")
            .Select(item => new AirportAnchor(item.Id, item.IataCode)).ToArrayAsync(cancellationToken);
        var puj = Require(airports.SingleOrDefault(item => item.IataCode == "PUJ"), "airport PUJ");
        var mia = Require(airports.SingleOrDefault(item => item.IataCode == "MIA"), "airport MIA");

        var accountIds = new[] { OccAccountId, HumanResourcesAccountId, ContractsAccountId, FinanceAccountId, SuperAdminAccountId };
        var accounts = await (from user in context.Users.AsNoTracking()
                              join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                              where accountIds.Contains(user.PublicId)
                              select new AccountAnchor(user.Id, user.PublicId, person.FirstName + " " + person.LastName))
            .ToArrayAsync(cancellationToken);
        AccountAnchor? Account(Guid id, string what, bool required = true)
        {
            var account = accounts.SingleOrDefault(item => item.PublicId == id);
            if (account is null && required) missing.Add(what);
            return account;
        }
        var occ = Account(OccAccountId, "OCC account");
        var humanResources = Account(HumanResourcesAccountId, "Gestión Humana account");
        var contracts = Account(ContractsAccountId, "Contratos account");
        var finance = Account(FinanceAccountId, "Finanzas account");
        var superAdmin = Account(SuperAdminAccountId, "Superadministración account", required: false);

        var baseAgent = await context.RampAgents.AsNoTracking().Where(item => item.EmployeeNumber == "DEV-RA-001")
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        if (baseAgent is null) missing.Add("ramp agent DEV-RA-001");

        var services = await context.ServiceDefinitions.AsNoTracking().Where(item => item.IsActive).OrderBy(item => item.Code)
            .Select(item => new ServiceAnchor(item.Id, item.PublicId, item.Code, item.Name, item.DefaultBillingUnit,
                item.IsPublic))
            .ToArrayAsync(cancellationToken);
        if (services.Length == 0) missing.Add("active services");
        var usdServiceRates = await FinanceTariffLookup.ServiceRatesAsync(context, "USD", TariffDate, null,
            services.Select(item => item.Id).ToArray(), cancellationToken);
        if (usdServiceRates.Count == 0) missing.Add("published USD service tariff");
        var charges = await context.ChargeDefinitions.AsNoTracking().Where(item => item.IsActive).OrderBy(item => item.Code)
            .Select(item => new ChargeAnchor(item.Id, item.Code, item.Name, item.BillingUnit, item.Method,
                item.QuantityRule, item.GraceMinutes, item.RoundingIncrement))
            .ToArrayAsync(cancellationToken);
        var usdChargeRates = await FinanceTariffLookup.ChargeRatesAsync(context, "USD", TariffDate, cancellationToken);
        var billingUnits = await context.BillingUnits.AsNoTracking().Where(item => item.IsActive)
            .ToDictionaryAsync(item => item.Code, item => item.Id, StringComparer.Ordinal, cancellationToken);
        if (!billingUnits.ContainsKey("operation")) missing.Add("billing unit «operation»");

        var rampPosition = await context.OperationalPositions.AsNoTracking()
            .Where(item => item.Code == "RAMP-AGENT" && item.IsActive).Select(item => (long?)item.Id)
            .SingleOrDefaultAsync(cancellationToken);
        if (rampPosition is null) missing.Add("position RAMP-AGENT");
        var equipment = await context.EquipmentTypes.AsNoTracking().Where(item => item.IsActive)
            .ToDictionaryAsync(item => item.Code, item => item.Id, StringComparer.Ordinal, cancellationToken);
        if (!equipment.ContainsKey("GPU")) missing.Add("equipment type GPU");
        var aircraft = await context.AircraftTypes.AsNoTracking().Where(item => item.IsActive).OrderBy(item => item.IcaoCode)
            .Select(item => new AircraftTypeAnchor(item.Id, item.IcaoCode, item.IataCode, item.SizeCategory))
            .ToArrayAsync(cancellationToken);
        if (!aircraft.Any(item => item.SizeCategory == AircraftSizeCategory.Narrowbody)) missing.Add("narrow-body aircraft type");
        var allowances = await context.GroundTimeAllowances.AsNoTracking()
            .ToDictionaryAsync(item => item.SizeCategory, item => item.AllowedMinutes, cancellationToken);
        if (allowances.Count == 0) missing.Add("ground-time allowances");

        var flightReport = await ChecklistAsync(context, "FLIGHT-REPORT", 1, cancellationToken);
        if (flightReport is null) missing.Add("FLIGHT-REPORT checklist v1");
        var bridge = await ChecklistAsync(context, "TURNAROUND-BASE", 2, cancellationToken);

        if (missing.Count > 0)
            throw new InvalidOperationException(
                "The Development history needs the base seed first (seed-development); missing: " +
                string.Join(", ", missing) + ". No history row was written.");

        return new HistoryAnchors
        {
            Station = station!, Terminals = terminals, Stands = stands, AviamOrganizationId = aviam!.Value,
            Puj = puj!, Mia = mia!, Occ = occ!, HumanResources = humanResources!, Contracts = contracts!,
            Finance = finance!, SuperAdmin = superAdmin, BaseRampAgentId = baseAgent!.Value, Services = services,
            UsdServiceRates = usdServiceRates, Charges = charges, UsdChargeRates = usdChargeRates,
            BillingUnits = billingUnits, RampAgentPositionId = rampPosition!.Value, EquipmentTypes = equipment,
            AircraftTypes = aircraft, GroundTimeAllowances = allowances, FlightReport = flightReport!,
            BridgeChecklist = bridge,
        };
    }

    private static async Task<ChecklistAnchor?> ChecklistAsync(ElevantDbContext context, string code, int versionNumber,
        CancellationToken cancellationToken)
    {
        var version = await (from template in context.Set<ChecklistTemplate>().AsNoTracking()
                             join item in context.Set<ChecklistTemplateVersion>().AsNoTracking()
                                 on template.Id equals item.ChecklistTemplateId
                             where template.Code == code && item.VersionNumber == versionNumber &&
                                   item.Status == ChecklistVersionStatus.Published
                             select new { item.Id, item.PublicId }).SingleOrDefaultAsync(cancellationToken);
        if (version is null) return null;
        var items = await context.Set<ChecklistTemplateItem>().AsNoTracking()
            .Where(item => item.ChecklistTemplateVersionId == version.Id).OrderBy(item => item.SortOrder)
            .Select(item => new ChecklistItemAnchor(item.Id, item.ItemCode, item.SectionName, item.IsRequired))
            .ToArrayAsync(cancellationToken);
        return new ChecklistAnchor(version.Id, version.PublicId, code, items);
    }
}

internal sealed record StationAnchor(long Id, Guid PublicId, string Code, string Name, string IanaTimeZone);

internal sealed record TerminalAnchor(long Id, Guid PublicId, string Code, int? MaxStandsPerAgent,
    bool RequiresBridgeQualification);

internal sealed record StandAnchor(long Id, Guid PublicId, string Code, long? TerminalId, bool HasBoardingBridge,
    bool IsRemote, AircraftSizeCategory? MaxAircraftSize);

internal sealed record AirportAnchor(long Id, string IataCode);

/// <summary>An internal account of the base seed with its person's «Nombre Apellido».</summary>
internal sealed record AccountAnchor(long Id, Guid PublicId, string Name);

internal sealed record ServiceAnchor(long Id, Guid PublicId, string Code, string Name, string DefaultBillingUnit,
    bool IsPublic);

internal sealed record ChargeAnchor(long Id, string Code, string Name, string? BillingUnit,
    ChargeCalculationMethod Method, ChargeQuantityRule QuantityRule, int GraceMinutes, decimal RoundingIncrement);

internal sealed record AircraftTypeAnchor(long Id, string IcaoCode, string? IataCode, AircraftSizeCategory? SizeCategory);

internal sealed record ChecklistAnchor(long VersionId, Guid VersionPublicId, string TemplateCode,
    IReadOnlyList<ChecklistItemAnchor> Items);

internal sealed record ChecklistItemAnchor(long Id, string Code, string Section, bool IsRequired);
