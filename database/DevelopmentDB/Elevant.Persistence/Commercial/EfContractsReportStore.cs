using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Common;
using Elevant.Application.Documents;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// The Contratos reports (ADR-0048, «Reportes nuevos») over every airline, for AVIAM's internal staff with
/// <c>contracts.reports.read</c>. Dates are AVIAM's business days (Santo Domingo) and the instants its local time.
/// </summary>
internal sealed class EfContractsReportStore(
    ElevantDbContext context,
    IActorContextResolver actors,
    TimeProvider timeProvider) : IContractsReportStore
{
    public IReadOnlyList<TabularReportDefinition> Catalog => ContractsReportCatalog.All;

    public async Task<TabularReportFailure?> AuthorizeExportAsync(Guid actorId, CancellationToken cancellationToken = default) =>
        await AllowedAsync(actorId, cancellationToken) ? null : TabularReportFailure.Forbidden;

    public async Task<TabularReportResult> ReadAsync(Guid actorId, TabularReportDefinition definition,
        TabularReportQuery query, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(definition);
        ArgumentNullException.ThrowIfNull(query);
        if (!await AllowedAsync(actorId, cancellationToken)) return TabularReportResult.Failed(TabularReportFailure.Forbidden);
        // A cut-off report reads at «to» (today without it): the validity and the days to expire.
        var today = query.To ?? BusinessCalendar.Today(timeProvider.GetUtcNow());
        var names = await NamesAsync(query, cancellationToken);
        var (rows, summary, notes) = definition.Key switch
        {
            "agreements" => await AgreementsAsync(query, today, cancellationToken),
            "rates" => await RatesAsync(query, cancellationToken),
            "requests" => await RequestsAsync(query, cancellationToken),
            "permits" => await PermitsAsync(query, today, cancellationToken),
            _ => throw new InvalidOperationException("The Contratos catalog and its builders diverged."),
        };
        var document = new ReportDocument(ContractsReportCatalog.Area, definition.Title, definition.Columns, rows)
        {
            Description = definition.Description,
            From = query.From,
            To = definition.Period == ReportPeriod.Range ? query.To : today,
            AsOfDate = definition.Period != ReportPeriod.Range,
            StationScope = query.Id("station") is { } stationId && names.TryGetValue(("station", stationId.ToString("D")), out var stationName)
                ? stationName : "Todas las estaciones",
            Filters = TabularReports.Applied(definition, query, (filter, value) => names.GetValueOrDefault((filter.Key, value))),
            Summary = summary,
            Notes = notes,
        };
        document.Validate();
        return TabularReportResult.Of(document);
    }

    private async Task<bool> AllowedAsync(Guid actorId, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor is not null && actor.HasPermission(ContractsReportCatalog.ReadPermission) &&
            actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator);
    }

    /// <summary>The readable names of the ids of the filters: airline, station «PUJ · Punta Cana» and service.</summary>
    private async Task<Dictionary<(string, string), string>> NamesAsync(TabularReportQuery query,
        CancellationToken cancellationToken)
    {
        var names = new Dictionary<(string, string), string>();
        if (query.Id("airline") is { } airlineId &&
            await context.Airlines.AsNoTracking().Where(item => item.PublicId == airlineId).Select(item => item.Name)
                .SingleOrDefaultAsync(cancellationToken) is { } airline)
            names[("airline", airlineId.ToString("D"))] = airline;
        if (query.Id("station") is { } stationId &&
            await context.Stations.AsNoTracking().Where(item => item.PublicId == stationId)
                .Select(item => new { item.Code, item.Name }).SingleOrDefaultAsync(cancellationToken) is { } station)
            names[("station", stationId.ToString("D"))] = StationLabel(station.Code, station.Name);
        if (query.Id("service") is { } serviceId &&
            await context.ServiceDefinitions.AsNoTracking().Where(item => item.PublicId == serviceId)
                .Select(item => new { item.Code, item.Name }).SingleOrDefaultAsync(cancellationToken) is { } service)
            names[("service", serviceId.ToString("D"))] = $"{service.Code} · {service.Name}";
        return names;
    }

    private static string StationLabel(string code, string name) =>
        string.IsNullOrWhiteSpace(name) || name == code ? code : $"{code} · {name}";

    /// <summary>The internal key of the airline filter; -1 when the id does not exist (no rows), null without it.</summary>
    private async Task<long?> AirlineKeyAsync(TabularReportQuery query, CancellationToken cancellationToken) =>
        query.Id("airline") is { } airlineId
            ? await context.Airlines.AsNoTracking().Where(item => item.PublicId == airlineId).Select(item => (long?)item.Id)
                .SingleOrDefaultAsync(cancellationToken) ?? -1
            : null;

    /// <summary>
    /// «Contratos y vigencias»: each contract with the version that governs it today (the approved one in force), or
    /// else its latest version that was not discarded. «Días para vencer» counts to its end; a version without an end
    /// has none.
    /// </summary>
    private async Task<(IReadOnlyList<IReadOnlyList<ReportCell>>, IReadOnlyList<ReportMetric>, IReadOnlyList<string>)>
        AgreementsAsync(TabularReportQuery query, DateOnly today, CancellationToken cancellationToken)
    {
        var airlineKey = await AirlineKeyAsync(query, cancellationToken);
        ContractStatus? status = query.Text("status") is { } code ? Enum.Parse<ContractStatus>(code) : null;
        var contracts = await (from contract in context.Contracts.AsNoTracking()
                               join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
                               where (airlineKey == null || contract.AirlineId == airlineKey) &&
                                     (status == null || contract.Status == status)
                               select new { contract.Id, contract.ContractCode, contract.Status, contract.CreatedAt, Airline = airline.Name })
            .ToArrayAsync(cancellationToken);
        var contractIds = contracts.Select(item => item.Id).ToArray();
        var versions = await context.ContractVersions.AsNoTracking()
            .Where(version => contractIds.Contains(version.ContractId) && version.Status != ContractVersionStatus.Rejected)
            .Select(version => new { version.Id, version.ContractId, version.VersionNumber, version.Status, version.ValidFrom,
                version.ValidTo, version.CurrencyCode })
            .ToArrayAsync(cancellationToken);
        var governing = versions.GroupBy(version => version.ContractId).ToDictionary(group => group.Key, group =>
            group.Where(version => version.Status == ContractVersionStatus.Approved && version.ValidFrom <= today &&
                    (version.ValidTo == null || version.ValidTo >= today))
                .OrderByDescending(version => version.VersionNumber).FirstOrDefault() ??
            group.OrderByDescending(version => version.VersionNumber).First());
        var versionIds = governing.Values.Select(version => version.Id).ToArray();
        var stations = (await (from link in context.Set<ContractVersionStation>().AsNoTracking()
                               join station in context.Stations.AsNoTracking() on link.StationId equals station.Id
                               where versionIds.Contains(link.ContractVersionId)
                               select new { link.ContractVersionId, station.PublicId, station.Code })
            .ToArrayAsync(cancellationToken)).ToLookup(item => item.ContractVersionId);
        var rates = await context.ContractServiceRates.AsNoTracking().Where(rate => versionIds.Contains(rate.ContractVersionId))
            .GroupBy(rate => rate.ContractVersionId).Select(group => new { group.Key, Count = group.Count() })
            .ToDictionaryAsync(item => item.Key, item => item.Count, cancellationToken);
        var stationFilter = query.Id("station");
        var within = query.Number("expiresWithinDays");
        var selected = contracts
            .Select(contract => (Contract: contract, Version: governing.GetValueOrDefault(contract.Id)))
            .Where(item => stationFilter is null ||
                item.Version is { } version && stations[version.Id].Any(station => station.PublicId == stationFilter))
            .Where(item => within is null || item.Version?.ValidTo is { } end && end >= today &&
                end.DayNumber - today.DayNumber <= within)
            .OrderBy(item => item.Contract.Airline, StringComparer.Ordinal)
            .ThenBy(item => item.Contract.ContractCode, StringComparer.Ordinal).ToArray();
        var rows = selected.Select(item =>
        {
            var version = item.Version;
            int? days = version?.ValidTo is { } end ? end.DayNumber - today.DayNumber : null;
            return (IReadOnlyList<ReportCell>)
            [
                ReportCell.Of(item.Contract.Airline), ReportCell.Of(ContractValidity.DisplayCode(item.Contract.ContractCode)),
                version is null ? ReportCell.Empty : ReportCell.Value(version.VersionNumber),
                ReportCell.Of(ContractsReportCatalog.Status(item.Contract.Status)),
                version is null ? ReportCell.Empty : ReportCell.Of(ContractsReportCatalog.VersionStatus(version.Status)),
                version is null ? ReportCell.Empty : ReportCell.Date(version.ValidFrom),
                ReportCell.Date(version?.ValidTo), days is { } value ? ReportCell.Value(value) : ReportCell.Of("Sin fecha de fin"),
                version is null ? ReportCell.Empty
                    : ReportCell.Of(string.Join(", ", stations[version.Id].Select(station => station.Code).Order(StringComparer.Ordinal))),
                ReportCell.Of(version?.CurrencyCode), ReportCell.Value(version is null ? 0 : rates.GetValueOrDefault(version.Id)),
                ReportCell.Date(BusinessCalendar.Today(item.Contract.CreatedAt)),
            ];
        }).ToArray();
        var total = selected.Length;
        var active = selected.Count(item => item.Contract.Status == ContractStatus.Active);
        var expiring = selected.Count(item => item.Contract.Status == ContractStatus.Active && item.Version?.ValidTo is { } end &&
            end >= today && end.DayNumber - today.DayNumber <= ContractsReportCatalog.ExpiringDays);
        var airlines = selected.Select(item => item.Contract.Airline).Distinct(StringComparer.Ordinal).Count();
        return (rows,
        [
            new ReportMetric("Contratos", ReportFormat.Integer(total), $"de {ReportFormat.Count(airlines, "aerolínea", "aerolíneas")}"),
            new ReportMetric("Activos", ReportFormat.Integer(active), ReportFormat.OfTotal(active, total, "contrato", "contratos")),
            new ReportMetric("Activos que vencen en 30 días", ReportFormat.Integer(expiring),
                ReportFormat.OfTotal(expiring, active, "activo", "activos")),
        ],
        ["La versión es la aprobada que rige hoy o, si no hay, la más reciente sin descartar. «Días para vencer» cuenta hasta el fin de su vigencia (negativo si ya venció)."]);
    }

    /// <summary>«Tarifas pactadas»: the rates of every approved version (in force or scheduled) of each contract.</summary>
    private async Task<(IReadOnlyList<IReadOnlyList<ReportCell>>, IReadOnlyList<ReportMetric>, IReadOnlyList<string>)>
        RatesAsync(TabularReportQuery query, CancellationToken cancellationToken)
    {
        var airlineKey = await AirlineKeyAsync(query, cancellationToken);
        var serviceId = query.Id("service");
        var stationId = query.Id("station");
        var rates = await (from rate in context.ContractServiceRates.AsNoTracking()
                           join version in context.ContractVersions.AsNoTracking() on rate.ContractVersionId equals version.Id
                           join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                           join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
                           join service in context.ServiceDefinitions.AsNoTracking() on rate.ServiceDefinitionId equals service.Id
                           where version.Status == ContractVersionStatus.Approved &&
                                 (airlineKey == null || contract.AirlineId == airlineKey) &&
                                 (serviceId == null || service.PublicId == serviceId) &&
                                 (stationId == null || (from link in context.Set<ContractVersionStation>()
                                     join station in context.Stations on link.StationId equals station.Id
                                     where link.ContractVersionId == version.Id && station.PublicId == stationId
                                     select link.StationId).Any())
                           orderby airline.Name, contract.ContractCode, version.VersionNumber, service.Code
                           select new { contract.ContractCode, Airline = airline.Name, version.VersionNumber, service.Code,
                               service.Name, rate.BillingUnit, version.CurrencyCode, rate.UnitPrice, rate.MinimumQuantity,
                               version.ValidFrom, version.ValidTo })
            .ToArrayAsync(cancellationToken);
        var rows = rates.Select(rate => (IReadOnlyList<ReportCell>)
        [
            ReportCell.Of(ContractValidity.DisplayCode(rate.ContractCode)), ReportCell.Of(rate.Airline), ReportCell.Value(rate.VersionNumber),
            ReportCell.Of($"{rate.Code} · {rate.Name}"), ReportCell.Of(Elevant.Application.Operations.OperationLabels.BillingUnit(rate.BillingUnit)),
            ReportCell.Of(rate.CurrencyCode), ReportCell.Value(rate.UnitPrice), ReportCell.Value(rate.MinimumQuantity),
            ReportCell.Date(rate.ValidFrom), ReportCell.Date(rate.ValidTo),
        ]).ToArray();
        var contracts = rates.Select(rate => rate.ContractCode).Distinct(StringComparer.Ordinal).Count();
        var services = rates.Select(rate => rate.Code).Distinct(StringComparer.Ordinal).Count();
        return (rows,
        [
            new ReportMetric("Tarifas", ReportFormat.Integer(rates.Length), $"en {ReportFormat.Count(contracts, "contrato", "contratos")}"),
            new ReportMetric("Servicios con tarifa", ReportFormat.Integer(services),
                $"de {ReportFormat.Count(await context.ServiceDefinitions.CountAsync(service => service.IsActive, cancellationToken), "servicio activo del catálogo", "servicios activos del catálogo")}"),
        ],
        ["Solo versiones aprobadas (vigentes o programadas). El precio va en la moneda del contrato y no se suma entre tarifas."]);
    }

    /// <summary>«Solicitudes comerciales» received in the period, with who decided them and the services asked for.</summary>
    private async Task<(IReadOnlyList<IReadOnlyList<ReportCell>>, IReadOnlyList<ReportMetric>, IReadOnlyList<string>)>
        RequestsAsync(TabularReportQuery query, CancellationToken cancellationToken)
    {
        var airlineKey = await AirlineKeyAsync(query, cancellationToken);
        CommercialRequestStatus? status = query.Text("status") is { } code ? Enum.Parse<CommercialRequestStatus>(code) : null;
        var stationId = query.Id("station");
        var start = BusinessCalendar.StartOfDay(query.From!.Value);
        var end = BusinessCalendar.StartOfDay(query.To!.Value.AddDays(1));
        var requests = await (from request in context.ServiceRequests.AsNoTracking()
                              join airline in context.Airlines.AsNoTracking() on request.AirlineId equals (long?)airline.Id into linked
                              from airline in linked.DefaultIfEmpty()
                              where request.SubmittedAt >= start && request.SubmittedAt < end &&
                                    (airlineKey == null || request.AirlineId == airlineKey) &&
                                    (status == null || request.Status == status) &&
                                    (stationId == null || (from link in context.Set<ServiceRequestStation>()
                                        join station in context.Stations on link.StationId equals station.Id
                                        where link.ServiceRequestId == request.Id && station.PublicId == stationId
                                        select link.StationId).Any())
                              orderby request.SubmittedAt, request.RequestCode
                              select new { request.Id, request.RequestCode, Airline = airline != null ? airline.Name : request.RequestedAirlineName,
                                  request.ContactName, request.SubmittedAt, request.Status, request.ReviewedAt,
                                  request.ReviewedByAccountId, request.CancelledAt })
            .ToArrayAsync(cancellationToken);
        var ids = requests.Select(request => request.Id).ToArray();
        var services = (await context.Set<ServiceRequestItem>().AsNoTracking().Where(item => ids.Contains(item.ServiceRequestId))
                .OrderBy(item => item.Id).Select(item => new { item.ServiceRequestId, item.RequestedServiceName })
                .ToArrayAsync(cancellationToken))
            .ToLookup(item => item.ServiceRequestId, item => item.RequestedServiceName);
        var reviewers = await PeopleAsync(requests.Where(request => request.ReviewedByAccountId != null)
            .Select(request => request.ReviewedByAccountId!.Value), cancellationToken);
        var rows = requests.Select(request =>
        {
            var decided = request.Status is CommercialRequestStatus.Approved or CommercialRequestStatus.Rejected;
            DateTimeOffset? decidedAt = request.Status == CommercialRequestStatus.Cancelled ? request.CancelledAt
                : decided ? request.ReviewedAt : null;
            return (IReadOnlyList<ReportCell>)
            [
                ReportCell.Of(request.RequestCode), ReportCell.Of(request.Airline), ReportCell.Of(request.ContactName),
                ReportCell.DateTime(Local(request.SubmittedAt)),
                ReportCell.Of(ContractsReportCatalog.RequestStatusLabel(request.Status)),
                decidedAt is { } at ? ReportCell.DateTime(Local(at)) : ReportCell.Empty,
                decided && request.ReviewedByAccountId is { } reviewer ? ReportCell.Of(reviewers.GetValueOrDefault(reviewer))
                    : ReportCell.Empty,
                ReportCell.Of(string.Join(", ", services[request.Id].Distinct(StringComparer.Ordinal))),
            ];
        }).ToArray();
        var total = requests.Length;
        int Count(CommercialRequestStatus value) => requests.Count(request => request.Status == value);
        var open = Count(CommercialRequestStatus.Pending) + Count(CommercialRequestStatus.InReview);
        return (rows,
        [
            new ReportMetric("Recibidas", ReportFormat.Integer(total), "en el período"),
            new ReportMetric("Aprobadas", ReportFormat.Integer(Count(CommercialRequestStatus.Approved)),
                ReportFormat.OfTotal(Count(CommercialRequestStatus.Approved), total, "recibida", "recibidas")),
            new ReportMetric("Rechazadas", ReportFormat.Integer(Count(CommercialRequestStatus.Rejected)),
                ReportFormat.OfTotal(Count(CommercialRequestStatus.Rejected), total, "recibida", "recibidas")),
            new ReportMetric("Sin decidir", ReportFormat.Integer(open), ReportFormat.OfTotal(open, total, "recibida", "recibidas")),
        ],
        ["Recibida, en hora de Santo Domingo. «Decidida el/por» es la aprobación o el rechazo de Contratos; una cancelada muestra cuándo se canceló."]);
    }

    /// <summary>«Permisos de aerolíneas»: every permit with its validity today and Contratos' review.</summary>
    private async Task<(IReadOnlyList<IReadOnlyList<ReportCell>>, IReadOnlyList<ReportMetric>, IReadOnlyList<string>)>
        PermitsAsync(TabularReportQuery query, DateOnly today, CancellationToken cancellationToken)
    {
        var airlineKey = await AirlineKeyAsync(query, cancellationToken);
        AirlinePermitReview? review = query.Text("review") is { } code ? Enum.Parse<AirlinePermitReview>(code) : null;
        var validity = query.Text("validity");
        var permits = (await (from permit in context.AirlinePermits.AsNoTracking()
                              join airline in context.Airlines.AsNoTracking() on permit.AirlineId equals airline.Id
                              where (airlineKey == null || permit.AirlineId == airlineKey) &&
                                    (review == null || permit.Review == review)
                              orderby airline.Name, permit.ExpiresOn, permit.Number
                              select new { Airline = airline.Name, permit.Kind, permit.Number, permit.Issuer, permit.IssuedOn,
                                  permit.ExpiresOn, permit.Review, permit.ReviewedAt, permit.ReviewedByAccountId, permit.CreatedAt })
                .ToArrayAsync(cancellationToken))
            .Where(permit => validity is null || ContractsReportCatalog.ValidityCode(permit.ExpiresOn, today) == validity)
            .ToArray();
        var reviewers = await PeopleAsync(permits.Where(permit => permit.ReviewedByAccountId != null)
            .Select(permit => permit.ReviewedByAccountId!.Value), cancellationToken);
        var rows = permits.Select(permit => (IReadOnlyList<ReportCell>)
        [
            ReportCell.Of(permit.Airline), ReportCell.Of(ContractsReportCatalog.PermitKind(permit.Kind)),
            ReportCell.Of(permit.Number), ReportCell.Of(permit.Issuer), ReportCell.Date(permit.IssuedOn),
            ReportCell.Date(permit.ExpiresOn), ReportCell.Of(ContractsReportCatalog.Validity(permit.ExpiresOn, today)),
            ReportCell.Of(ContractsReportCatalog.Review(permit.Review)),
            permit.ReviewedAt is { } at ? ReportCell.DateTime(Local(at)) : ReportCell.Empty,
            permit.ReviewedByAccountId is { } reviewer ? ReportCell.Of(reviewers.GetValueOrDefault(reviewer)) : ReportCell.Empty,
            ReportCell.DateTime(Local(permit.CreatedAt)),
        ]).ToArray();
        var total = permits.Length;
        var verified = permits.Count(permit => permit.Review == AirlinePermitReview.Verified);
        var expired = permits.Count(permit => permit.ExpiresOn < today);
        var expiring = permits.Count(permit => ContractsReportCatalog.ValidityCode(permit.ExpiresOn, today) == "expiring");
        var pending = permits.Count(permit => permit.Review == AirlinePermitReview.Submitted);
        return (rows,
        [
            new ReportMetric("Permisos", ReportFormat.Integer(total),
                $"de {ReportFormat.Count(permits.Select(permit => permit.Airline).Distinct(StringComparer.Ordinal).Count(), "aerolínea", "aerolíneas")}"),
            new ReportMetric("Verificados", ReportFormat.Integer(verified), ReportFormat.OfTotal(verified, total, "permiso", "permisos")),
            new ReportMetric("Pendientes de revisión", ReportFormat.Integer(pending), ReportFormat.OfTotal(pending, total, "permiso", "permisos")),
            new ReportMetric("Vencen en 30 días", ReportFormat.Integer(expiring), ReportFormat.OfTotal(expiring, total, "permiso", "permisos")),
            new ReportMetric("Vencidos", ReportFormat.Integer(expired), ReportFormat.OfTotal(expired, total, "permiso", "permisos")),
        ],
        [$"Vigencia calculada al {ReportFormat.Date(today)}: «Vence en 30 días» si vence en {ContractsReportCatalog.ExpiringDays} días o menos."]);
    }

    /// <summary>«Nombre Apellido» of each account, by its internal key.</summary>
    private async Task<Dictionary<long, string>> PeopleAsync(IEnumerable<long> accountKeys, CancellationToken cancellationToken)
    {
        var keys = accountKeys.Distinct().ToArray();
        if (keys.Length == 0) return [];
        return await (from user in context.Users.AsNoTracking()
                      join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                      where keys.Contains(user.Id)
                      select new { user.Id, Name = person.FirstName + " " + person.LastName })
            .ToDictionaryAsync(item => item.Id, item => item.Name, cancellationToken);
    }

    private static DateTime Local(DateTimeOffset instant) =>
        TimeZoneInfo.ConvertTime(instant, BusinessCalendar.Zone()).DateTime;
}
