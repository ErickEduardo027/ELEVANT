using System.Globalization;
using System.Text.Json;
using Elevant.Application.Commercial;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Identity;
using Elevant.Persistence.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Chunk <c>commercial</c>: real airlines of AVIAM's catalog that are not in <c>ref.airlines</c> yet, each as the
/// approval of Contratos would have left it in April–May 2026 (organization <c>AIR-HIST-{IATA}</c>, airline, one
/// disabled signer account without password, approved affiliation request, active contract <c>CTR-2026-####</c>
/// approved by Finance and signed by both parties over the real document hash, operating permit and billing
/// profile), plus 12 more requests in every state. Two contracts get a v2 from 2026-09-01 (+4 %) that supersedes
/// v1 (which ends 2026-08-31); one is terminated on 2026-10-01. Nothing is ever updated: every row is inserted in
/// the state the API's own commands end with.
/// </summary>
internal static class CommercialHistory
{
    public const string ChunkName = "commercial";
    public static readonly DateOnly ContractStart = new(2026, 5, 15);
    public static readonly DateOnly ContractEnd = new(2027, 5, 14);
    public static readonly DateOnly AmendmentStart = new(2026, 9, 1);
    public static readonly DateOnly TerminationDate = new(2026, 10, 1);
    public const decimal AmendmentIncrease = 1.04m;

    /// <summary>Indexes (in selection order) of the airlines whose contract gets the amended v2.</summary>
    public static readonly IReadOnlySet<int> AmendedIndexes = new HashSet<int> { 1, 3 };

    /// <summary>Index of the airline whose contract is terminated on <see cref="TerminationDate"/>.</summary>
    public const int TerminatedIndex = 2;

    /// <summary>Catalog names in order of preference; the last two are the spares.</summary>
    private static readonly string[] Candidates =
    [
        "AMERICAN AIRLINES", "DELTA AIRLINES", "JETBLUE", "UNITED AIRLINES", "AIR CANADA", "AIR TRANSAT",
        "SUNWING AIRLINES", "WEST JET AIRLINES", "AIR EUROPA", "AIR FRANCE", "CONDOR", "EDELWEISS AIR",
    ];

    /// <summary>Catalog airlines that only file requests (never contracted in the history).</summary>
    private static readonly string[] ApplicantProfiles =
    [
        "FRONTIER AIRLINES", "ALLEGIANT AIR", "SUNCOUNTRY", "AIR CARAIBES", "EUROWINGS", "WINGO", "AVIANCA",
        "LEVEL-IBERIA", "NORWEGIAN AIR", "AEROLINEAS ARGENTINAS", "BRITISH AIRWAYS", "TUIFLY BELGIUM", "CONDOR",
        "EDELWEISS AIR",
    ];

    private static readonly (string First, string Last)[] People =
    [
        ("Laura", "Méndez"), ("Michael", "Carter"), ("Sophie", "Tremblay"), ("Javier", "Ortega"), ("Emily", "Brooks"),
        ("Pierre", "Lefèvre"), ("Daniel", "Hughes"), ("Camille", "Roy"), ("Lucía", "Navarro"), ("Thomas", "Bauer"),
        ("Hannah", "Keller"), ("Andrés", "Salcedo"), ("Rachel", "Nguyen"), ("Marco", "Bianchi"), ("Olivia", "Grant"),
        ("Diego", "Fuentes"), ("Isabelle", "Morin"), ("Kevin", "Walsh"), ("Natalia", "Rivas"), ("Jonas", "Weber"),
        ("Ana", "Ferreira"), ("Brian", "Foster"), ("Claire", "Dubois"), ("Ricardo", "Peña"),
    ];

    private static readonly string[] RejectionReasons =
    [
        "La aerolínea no presentó un permiso de operación vigente para la República Dominicana.",
        "No fue posible confirmar con la aerolínea que el solicitante la representa.",
        "Los servicios pedidos no se prestan en PUJ en la franja horaria solicitada.",
    ];

    private static readonly string[] CancellationReasons =
    [
        "El solicitante retiró la solicitud: la operación estacional no se concretó.",
        "Solicitud duplicada: el representante envió una nueva con los datos corregidos.",
    ];

    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        yield return HistoryChunk.Create(ChunkName, RunAsync);
    }

    private sealed record Selected(int Index, CommercialAirlineProfile Profile, string Iata, string Icao,
        string LegalName, string? TaxRegistration)
    {
        public string Slug => Iata.ToLowerInvariant();
        public bool Amended => AmendedIndexes.Contains(Index);
        public bool Terminated => Index == TerminatedIndex;
    }

    private sealed class AirlineRows
    {
        public required Selected Source { get; init; }
        public required Person Person { get; init; }
        public required Organization Organization { get; init; }
        public Airline Airline { get; set; } = null!;
        public ApplicationUser Account { get; set; } = null!;
        public ServiceRequest Request { get; set; } = null!;
        public Contract Contract { get; set; } = null!;
        public List<VersionRows> Versions { get; } = [];
        public DateTimeOffset Submitted { get; init; }
        public DateTimeOffset InReview { get; init; }
        public DateTimeOffset RepresentativeConfirmed { get; init; }
        public DateTimeOffset Approved { get; init; }
        public DateTimeOffset PermitSubmitted { get; init; }
        public DateTimeOffset PermitVerified { get; init; }
        public DateTimeOffset LastChange { get; set; }
    }

    private sealed class VersionRows
    {
        public required int Number { get; init; }
        public required DateTimeOffset Created { get; init; }
        public required DateTimeOffset FinanceApproved { get; init; }
        public required DateTimeOffset ValidityConfirmed { get; init; }
        public required DateTimeOffset AirlineSigned { get; init; }
        public required DateTimeOffset AviamSigned { get; init; }
        public required DateOnly SignedValidTo { get; init; }
        public ContractVersion Version { get; set; } = null!;
        public List<(ServiceAnchor Service, decimal Base, decimal Price, string Unit)> Rates { get; } = [];
    }

    private static async Task RunAsync(HistoryChunkContext chunk, CancellationToken cancellationToken)
    {
        var db = chunk.Db;
        var anchors = chunk.Anchors;
        var clock = chunk.Clock;
        var existingCodes = (await db.Airlines.AsNoTracking().Select(item => new { item.IataCode, item.IcaoCode })
                .ToArrayAsync(cancellationToken))
            .SelectMany(item => new[] { item.IataCode?.Trim(), item.IcaoCode.Trim() })
            .Where(code => !string.IsNullOrEmpty(code)).Select(code => code!).ToHashSet(StringComparer.Ordinal);
        var names = Candidates.Concat(ApplicantProfiles).Distinct(StringComparer.Ordinal).ToArray();
        var profiles = await db.CommercialAirlineProfiles.AsNoTracking().Where(item => names.Contains(item.SourceName))
            .ToDictionaryAsync(item => item.SourceName, StringComparer.Ordinal, cancellationToken);

        var selected = new List<Selected>();
        foreach (var name in Candidates)
        {
            if (selected.Count == chunk.Options.AirlineCount) break;
            if (!profiles.TryGetValue(name, out var profile) || !AviamAirlineReference.Verified.TryGetValue(name, out var identity) ||
                identity.Iata is not { } iata || existingCodes.Contains(iata) || existingCodes.Contains(identity.Icao))
                continue;
            selected.Add(new Selected(selected.Count, profile, iata, identity.Icao, identity.Legal,
                AviamAirlineReference.DevelopmentTaxRegistrations.GetValueOrDefault(name)));
        }

        // The services every history contract prices: the active ones Finance has a USD base price for.
        var services = anchors.Services.Where(service => anchors.UsdServiceRates.ContainsKey(service.Id)).ToArray();
        if (services.Length == 0)
            throw new InvalidOperationException("The Development history needs Finance's USD base tariff for the services.");

        var airlines = selected.Select(source => Plan(source, clock)).ToList();

        // Layer 1: signer persons and airline organizations.
        await chunk.InsertAsync(airlines.SelectMany(item => new object[] { item.Person, item.Organization }), cancellationToken);
        // Layer 2: airlines and the disabled signer accounts.
        foreach (var item in airlines)
        {
            item.Airline = HistoryChunkContext.Stamp(new Airline
            {
                OrganizationId = item.Organization.Id, IataCode = item.Source.Iata, IcaoCode = item.Source.Icao,
                Name = item.Source.Profile.DisplayName, IsActive = true,
            }, $"airline:{item.Source.Iata}", item.Approved);
            var email = item.Person.PrimaryEmail!;
            item.Account = new ApplicationUser
            {
                PublicId = HistoryKeys.Key($"account:{item.Source.Iata}"), PersonId = item.Person.Id, UserName = email,
                NormalizedUserName = email.ToUpperInvariant(), Email = email, NormalizedEmail = email.ToUpperInvariant(),
                EmailConfirmed = true, LockoutEnabled = true, PasswordHash = null,
                // Disabled and without password: it only records who signed; it can neither sign in nor receive mail.
                Status = AccountLifecycleStatus.Disabled, InvitationStatus = InvitationStatus.Accepted,
                SecurityStamp = HistoryKeys.Key($"account:{item.Source.Iata}:security").ToString("D"),
                ConcurrencyStamp = HistoryKeys.Key($"account:{item.Source.Iata}:concurrency").ToString("D"),
                CreatedAt = item.Approved, UpdatedAt = item.Approved,
            };
        }
        await chunk.InsertAsync(airlines.SelectMany(item => new object[] { item.Airline, item.Account }), cancellationToken);

        // Layer 3: memberships, billing profiles and the affiliation requests (with the extra requests).
        var extras = ExtraRequests(chunk, airlines, profiles, existingCodes, selected);
        foreach (var item in airlines) item.Request = AffiliationRequest(item, anchors);
        await chunk.InsertAsync(airlines.SelectMany(item => new object[]
            {
                HistoryChunkContext.Stamp(new OrganizationMembership
                {
                    AccountId = item.Account.Id, OrganizationId = item.Organization.Id, Kind = MembershipKind.AirlineClient,
                    Status = MembershipStatus.Active, JobTitle = SignerTitle,
                    ValidFrom = clock.LocalDate(item.Approved),
                }, $"membership:{item.Source.Iata}", item.Approved),
                HistoryChunkContext.Stamp(new AirlineBillingProfile
                {
                    AirlineId = item.Airline.Id, PaymentTermDays = PaymentTerms(item.Source.Index), BillingEmail = null,
                    Notes = "Perfil de cobro sintético de Development: sin correo de facturación.",
                }, $"billing-profile:{item.Source.Iata}", item.Approved.AddDays(4)),
                item.Request,
            }).Concat(extras.Select(extra => extra.Request)), cancellationToken);

        // Layer 4: request items, stations and events; the contracts.
        var pujCode = anchors.Station.Id;
        var issued = await db.Contracts.AsNoTracking().Where(item => item.ContractCode.StartsWith("CTR-2026-"))
            .Select(item => item.ContractCode).ToArrayAsync(cancellationToken);
        var sequence = ContractValidity.NextSequence(issued, 2026);
        var layer4 = new List<object>();
        foreach (var item in airlines)
        {
            var random = HistoryRandom.For($"commercial:{item.Source.Iata}:requested-services");
            var requested = random.Shuffle(services).Take(random.Between(4, Math.Min(6, services.Length)))
                .OrderBy(service => service.Code, StringComparer.Ordinal).ToArray();
            layer4.AddRange(RequestDetails(item.Request, $"request:{item.Source.Iata}", requested, pujCode, item.Submitted,
                [(CommercialRequestStatus.Pending, CommercialRequestStatus.InReview, item.InReview, null),
                 (CommercialRequestStatus.InReview, CommercialRequestStatus.Approved, item.Approved, null)],
                anchors.Contracts.Id, ContractStart, ContractEnd));
            item.Contract = new Contract
            {
                AirlineId = item.Airline.Id, OriginatingServiceRequestId = item.Request.Id,
                ContractCode = ContractValidity.FinalCode(2026, sequence++),
                Status = item.Source.Terminated ? ContractStatus.Terminated : ContractStatus.Active,
                TerminatedOn = item.Source.Terminated ? TerminationDate : null,
            };
        }
        foreach (var extra in extras)
            layer4.AddRange(RequestDetails(extra.Request, extra.Key, extra.Services, pujCode, extra.Request.SubmittedAt,
                extra.Events, anchors.Contracts.Id, null, null));

        // The versions each contract went through, with their business dates.
        foreach (var item in airlines)
        {
            var anchorDay = clock.LocalDate(item.Submitted);
            item.Versions.Add(new VersionRows
            {
                Number = 1, Created = item.Approved, FinanceApproved = clock.At(anchorDay.AddDays(8), new TimeOnly(11, 30)),
                ValidityConfirmed = clock.At(anchorDay.AddDays(10), new TimeOnly(10, 0)),
                AirlineSigned = clock.At(anchorDay.AddDays(12), new TimeOnly(16, 0)),
                AviamSigned = clock.At(anchorDay.AddDays(13), new TimeOnly(11, 0)), SignedValidTo = ContractEnd,
            });
            if (item.Source.Amended)
                item.Versions.Add(new VersionRows
                {
                    Number = 2, Created = clock.At(new DateOnly(2026, 8, 10), new TimeOnly(9, 40)),
                    FinanceApproved = clock.At(new DateOnly(2026, 8, 18), new TimeOnly(15, 10)),
                    ValidityConfirmed = clock.At(new DateOnly(2026, 8, 20), new TimeOnly(10, 20)),
                    AirlineSigned = clock.At(new DateOnly(2026, 8, 25), new TimeOnly(14, 45)),
                    AviamSigned = clock.At(new DateOnly(2026, 8, 26), new TimeOnly(9, 15)), SignedValidTo = ContractEnd,
                });
            var activated = item.Versions[0].AviamSigned;
            var amended = item.Versions.Count > 1 ? item.Versions[1].AviamSigned : activated;
            item.LastChange = item.Source.Terminated ? TerminatedAt(clock) : amended;
            item.Contract.SignedOn = clock.LocalDate(activated);
            HistoryChunkContext.Stamp(item.Contract, $"contract:{item.Source.Iata}", item.Approved, item.LastChange);
        }
        layer4.AddRange(airlines.Select(item => item.Contract));
        await chunk.InsertAsync(layer4, cancellationToken);

        // Layer 5: contract versions in their final state.
        foreach (var item in airlines)
        {
            var name = item.Source.Profile.DisplayName;
            foreach (var version in item.Versions)
            {
                var superseded = version.Number == 1 && item.Versions.Count > 1;
                version.Version = HistoryChunkContext.Stamp(new ContractVersion
                {
                    ContractId = item.Contract.Id, VersionNumber = version.Number,
                    PricingPolicyVersion = ContractDocuments.SignedPricingPolicy,
                    Status = superseded ? ContractVersionStatus.Superseded : ContractVersionStatus.Approved,
                    ValidFrom = version.Number == 1 ? ContractStart : AmendmentStart,
                    // A superseded version ends the day before the one that replaced it (2-C).
                    ValidTo = superseded ? ContractVersionGovernance.SupersededEnd(ContractEnd, AmendmentStart) : ContractEnd,
                    CurrencyCode = "USD",
                    Terms = version.Number == 1
                        ? $"Contrato sintético de Development de servicios de rampa en PUJ para {name}. No es vinculante."
                        : $"Enmienda sintética de Development para {name}: tarifas actualizadas desde el 01/09/2026. No es vinculante.",
                    ApprovedAt = version.FinanceApproved, ApprovedByAccountId = anchors.Finance.Id,
                    RenewalMode = ContractRenewalMode.Manual, RenewalTermMonths = 12, RenewalNoticeDays = 60,
                    TerminationNoticeDays = 90,
                    TerminationTerms = "Cualquiera de las partes puede terminar el contrato con 90 días de aviso por escrito.",
                    ValidityConfirmedAt = version.ValidityConfirmed, ValidityConfirmedByAccountId = anchors.Contracts.Id,
                }, $"contract:{item.Source.Iata}:v{version.Number}", version.Created,
                    superseded ? item.Versions[1].AviamSigned : version.AviamSigned);
            }
        }
        await chunk.InsertAsync(airlines.SelectMany(item => item.Versions.Select(version => (object)version.Version)),
            cancellationToken);

        // Layer 6: stations, rates, frozen surcharges, Finance's approvals and the permits.
        var layer6 = new List<object>();
        foreach (var item in airlines)
        {
            var random = HistoryRandom.For($"commercial:{item.Source.Iata}:rates");
            var factors = services.ToDictionary(service => service.Id, _ => random.Decimal(0.85m, 1.10m, 4));
            foreach (var version in item.Versions)
            {
                var prefix = $"contract:{item.Source.Iata}:v{version.Number}";
                layer6.Add(new ContractVersionStation { ContractVersionId = version.Version.Id, StationId = anchors.Station.Id });
                foreach (var service in services)
                {
                    var baseRate = anchors.UsdServiceRates[service.Id];
                    var first = Math.Round(baseRate.UnitPrice * factors[service.Id], 2, MidpointRounding.AwayFromZero);
                    var price = version.Number == 1 ? first
                        : Math.Round(first * AmendmentIncrease, 2, MidpointRounding.AwayFromZero);
                    var unit = anchors.BillingUnits.ContainsKey(baseRate.BillingUnit) ? baseRate.BillingUnit : "operation";
                    version.Rates.Add((service, baseRate.UnitPrice, price, unit));
                    layer6.Add(HistoryChunkContext.Stamp(new ContractServiceRate
                    {
                        ContractVersionId = version.Version.Id, ServiceDefinitionId = service.Id, BillingUnit = unit,
                        UnitPrice = price, MinimumQuantity = 1m, IsConfirmed = true,
                    }, $"{prefix}:rate:{service.Code}", version.Created));
                }
                foreach (var charge in anchors.Charges)
                {
                    if (!anchors.UsdChargeRates.TryGetValue(charge.Id, out var inherited)) continue;
                    layer6.Add(HistoryChunkContext.Stamp(new ContractChargeRate
                    {
                        ContractVersionId = version.Version.Id, ChargeDefinitionId = charge.Id, IsExcluded = false,
                        Value = inherited.Value, MinimumAmount = inherited.MinimumAmount,
                        DefinitionSnapshotJson = JsonSerializer.Serialize(new ContractChargePolicySnapshot(charge.Code,
                            charge.Name, charge.BillingUnit, charge.Method, charge.QuantityRule, charge.GraceMinutes,
                            charge.RoundingIncrement)),
                    }, $"{prefix}:charge:{charge.Code}", version.FinanceApproved));
                }
                layer6.Add(HistoryChunkContext.Stamp(new ContractFinanceReview
                {
                    ContractVersionId = version.Version.Id, Decision = ContractFinanceDecision.Approved,
                    DecidedByAccountId = anchors.Finance.Id, DecidedAt = version.FinanceApproved,
                    ComparisonJson = JsonSerializer.Serialize(new
                    {
                        Rates = version.Rates.Select(rate => new
                        {
                            Service = rate.Service.Code, rate.Unit, BasePrice = rate.Base, ContractPrice = rate.Price,
                        }).ToArray(),
                        Charges = Array.Empty<object>(), Packages = Array.Empty<object>(),
                    }),
                }, $"{prefix}:finance-review", version.FinanceApproved));
            }
            layer6.AddRange(Permits(item, anchors, clock));
        }
        await chunk.InsertAsync(layer6, cancellationToken);

        // The content both parties signed, read exactly as the API reads it (ContractDocuments), after the version,
        // its rates, stations and surcharges exist. A superseded v1 was signed before its end moved to 2026-08-31.
        var layer7 = new List<object>();
        foreach (var item in airlines)
        {
            foreach (var version in item.Versions)
            {
                var document = await ContractDocuments.LoadAsync(db, version.Version.Id, cancellationToken);
                var hash = (document with { ValidTo = version.SignedValidTo }).ContentSha256;
                var prefix = $"contract:{item.Source.Iata}:v{version.Number}";
                layer7.Add(HistoryChunkContext.Stamp(new ContractSignature
                {
                    ContractVersionId = version.Version.Id, Party = ContractSignatureParty.Airline,
                    SignerAccountId = item.Account.Id, SignerName = $"{item.Person.FirstName} {item.Person.LastName}",
                    SignerTitle = SignerTitle, SignedAt = version.AirlineSigned, DocumentSha256 = hash,
                    RequestId = HistoryKeys.Key($"{prefix}:signature:airline:request"),
                }, $"{prefix}:signature:airline", version.AirlineSigned));
                layer7.Add(HistoryChunkContext.Stamp(new ContractSignature
                {
                    ContractVersionId = version.Version.Id, Party = ContractSignatureParty.Aviam,
                    SignerAccountId = anchors.Contracts.Id, SignerName = anchors.Contracts.Name,
                    SignerTitle = "Analista comercial · Contratos AVIAM", SignedAt = version.AviamSigned,
                    DocumentSha256 = hash, RequestId = HistoryKeys.Key($"{prefix}:signature:aviam:request"),
                }, $"{prefix}:signature:aviam", version.AviamSigned));
            }
            layer7.Add(new ContractStatusEvent
            {
                ContractId = item.Contract.Id, FromStatus = ContractStatus.Draft, ToStatus = ContractStatus.Active,
                OccurredAt = item.Versions[0].AviamSigned, ActorAccountId = anchors.Contracts.Id,
                Reason = "Aprobado por Finanzas, firmado por ambas partes y con permiso de operación vigente.",
            });
            if (item.Source.Terminated)
                layer7.Add(new ContractStatusEvent
                {
                    ContractId = item.Contract.Id, FromStatus = ContractStatus.Active, ToStatus = ContractStatus.Terminated,
                    OccurredAt = TerminatedAt(clock), ActorAccountId = null,
                    Reason = "Terminación programada: el contrato terminó en su fecha efectiva.",
                });
        }
        await chunk.InsertAsync(layer7, cancellationToken);
    }

    private const string SignerTitle = "Director de Operaciones Aeroportuarias";

    private static int PaymentTerms(int index) => (index % 3) switch { 0 => 30, 1 => 15, _ => 45 };

    /// <summary>The sweep closes a scheduled termination on its first day without coverage, early in the morning.</summary>
    private static DateTimeOffset TerminatedAt(HistoryClock clock) => clock.At(TerminationDate, new TimeOnly(6, 5));

    private static AirlineRows Plan(Selected source, HistoryClock clock)
    {
        var random = HistoryRandom.For($"commercial:{source.Iata}:timeline");
        var submittedDay = new DateOnly(2026, 4, 1).AddDays(2 * source.Index);
        var person = People[(source.Index * 7 + 3) % People.Length];
        var email = $"hist.{source.Slug}@dev.elevant.test";
        var submitted = clock.At(submittedDay, new TimeOnly(9, 0).AddMinutes(random.Between(0, 180)));
        var approved = clock.At(submittedDay.AddDays(4), new TimeOnly(15, 0).AddMinutes(random.Between(0, 90)));
        return new AirlineRows
        {
            Source = source,
            Submitted = submitted,
            InReview = clock.At(submittedDay.AddDays(1), new TimeOnly(10, 0).AddMinutes(random.Between(0, 120))),
            RepresentativeConfirmed = clock.At(submittedDay.AddDays(2), new TimeOnly(11, 0).AddMinutes(random.Between(0, 120))),
            Approved = approved,
            PermitSubmitted = clock.At(submittedDay.AddDays(5), new TimeOnly(10, 0).AddMinutes(random.Between(0, 120))),
            PermitVerified = clock.At(submittedDay.AddDays(6), new TimeOnly(12, 0).AddMinutes(random.Between(0, 120))),
            Person = HistoryChunkContext.Stamp(new Person
            {
                FirstName = person.First, LastName = person.Last, PrimaryEmail = email,
                IdentificationType = "Synthetic", IdentificationNumber = $"HIST-SIGNER-{source.Iata}",
            }, $"person:signer:{source.Iata}", approved),
            Organization = HistoryChunkContext.Stamp(new Organization
            {
                Code = $"{HistoryCatalog.HistoryOrganizationPrefix}{source.Iata}", LegalName = source.LegalName,
                DisplayName = source.Profile.DisplayName.Length <= 120 ? source.Profile.DisplayName : source.Profile.DisplayName[..120],
                Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active,
                TaxRegistration = source.TaxRegistration, TaxRegistrationCountryCode = source.TaxRegistration is null ? null : "DO",
            }, $"organization:{source.Iata}", approved),
        };
    }

    private static ServiceRequest AffiliationRequest(AirlineRows item, HistoryAnchors anchors)
    {
        var key = HistoryKeys.Key($"request:{item.Source.Iata}");
        return HistoryChunkContext.Stamp(new ServiceRequest
        {
            RequestCode = key.ToString("N"), AirlineId = item.Airline.Id, AirlineProfileId = item.Source.Profile.Id,
            RequestedAirlineName = item.Source.Profile.DisplayName, AirlineLegalNameSnapshot = item.Source.LegalName,
            Type = CommercialRequestType.Affiliation, Status = CommercialRequestStatus.Approved,
            ContactName = $"{item.Person.FirstName} {item.Person.LastName}", ContactTitle = SignerTitle,
            AuthorityDeclared = true, ContactEmail = item.Person.PrimaryEmail!,
            ContactPhone = $"+1 809 555 {1100 + item.Source.Index:0000}",
            TaxRegistration = item.Source.TaxRegistration,
            TaxRegistrationCountryCode = item.Source.TaxRegistration is null ? null : "DO",
            SubmittedAt = item.Submitted, ReviewedAt = item.Approved, ReviewedByAccountId = anchors.Contracts.Id,
            ProvisionedAccountId = item.Account.Id,
            RepresentativeConfirmedAt = item.RepresentativeConfirmed,
            RepresentativeConfirmedByAccountId = anchors.Contracts.Id,
            RepresentativeConfirmationNote = "Confirmado por correo con la dirección de operaciones de la aerolínea.",
        }, $"request:{item.Source.Iata}", item.Submitted, item.Approved);
    }

    private static IEnumerable<object> RequestDetails(ServiceRequest request, string key,
        IReadOnlyList<ServiceAnchor> services, long stationId, DateTimeOffset submitted,
        IReadOnlyList<(CommercialRequestStatus From, CommercialRequestStatus To, DateTimeOffset At, string? Reason)> events,
        long actorAccountId, DateOnly? from, DateOnly? to)
    {
        yield return new ServiceRequestStation { ServiceRequestId = request.Id, StationId = stationId };
        foreach (var service in services)
            yield return HistoryChunkContext.Stamp(new ServiceRequestItem
            {
                ServiceRequestId = request.Id, ServiceDefinitionId = service.Id, RequestedServiceName = service.Name,
                RequestedUnit = service.DefaultBillingUnit, RequestedFrom = from, RequestedTo = to,
            }, $"{key}:item:{service.Code}", submitted);
        foreach (var change in events)
            yield return new ServiceRequestStatusEvent
            {
                ServiceRequestId = request.Id, FromStatus = change.From, ToStatus = change.To, OccurredAt = change.At,
                ActorAccountId = actorAccountId, Reason = change.Reason,
            };
    }

    private sealed record ExtraRequest(string Key, ServiceRequest Request, IReadOnlyList<ServiceAnchor> Services,
        IReadOnlyList<(CommercialRequestStatus From, CommercialRequestStatus To, DateTimeOffset At, string? Reason)> Events);

    /// <summary>
    /// The 12 requests beyond the affiliations: 3 rejected with a reason, 2 cancelled, 2 approved additional-service
    /// requests of contracted airlines, and 5 still open (3 pending, 2 in review) in the last weeks.
    /// </summary>
    private static List<ExtraRequest> ExtraRequests(HistoryChunkContext chunk, IReadOnlyList<AirlineRows> airlines,
        IReadOnlyDictionary<string, CommercialAirlineProfile> profiles, IReadOnlySet<string> existingCodes,
        IReadOnlyList<Selected> selected)
    {
        var clock = chunk.Clock;
        var anchors = chunk.Anchors;
        var taken = selected.Select(item => item.Profile.SourceName).ToHashSet(StringComparer.Ordinal);
        var applicants = ApplicantProfiles.Where(name => !taken.Contains(name) && profiles.TryGetValue(name, out var profile) &&
                profile.IsPublished && (profile.IataCode is null || !existingCodes.Contains(profile.IataCode)) &&
                (profile.IcaoCode is null || !existingCodes.Contains(profile.IcaoCode)))
            .Select(name => profiles[name]).ToArray();
        var services = anchors.Services.Where(service => service.IsPublic).ToArray();
        if (services.Length == 0) services = [.. anchors.Services];
        var plan = new (DateOnly Day, CommercialRequestStatus Status, bool Additional)[]
        {
            (new DateOnly(2026, 6, 8), CommercialRequestStatus.Rejected, false),
            (new DateOnly(2026, 6, 29), CommercialRequestStatus.Cancelled, false),
            (new DateOnly(2026, 7, 13), CommercialRequestStatus.Approved, true),
            (new DateOnly(2026, 8, 3), CommercialRequestStatus.Rejected, false),
            (new DateOnly(2026, 8, 24), CommercialRequestStatus.Cancelled, false),
            (new DateOnly(2026, 9, 14), CommercialRequestStatus.Approved, true),
            (new DateOnly(2026, 10, 5), CommercialRequestStatus.Rejected, false),
            (new DateOnly(2026, 10, 26), CommercialRequestStatus.InReview, false),
            (new DateOnly(2026, 11, 4), CommercialRequestStatus.Pending, false),
            (new DateOnly(2026, 11, 10), CommercialRequestStatus.InReview, false),
            (new DateOnly(2026, 11, 16), CommercialRequestStatus.Pending, false),
            (new DateOnly(2026, 11, 19), CommercialRequestStatus.Pending, false),
        };
        var extras = new List<ExtraRequest>();
        int applicant = 0, rejected = 0, cancelled = 0, additional = 0;
        // Additional-service requests go to contracted airlines that are still active.
        var active = airlines.Where(item => !item.Source.Terminated).ToArray();
        for (var index = 0; index < plan.Length; index++)
        {
            var (day, status, isAdditional) = plan[index];
            var key = $"request:extra:{index + 1:00}";
            var random = HistoryRandom.For($"commercial:{key}");
            var submitted = clock.At(day, new TimeOnly(9, 30).AddMinutes(random.Between(0, 240)));
            var reviewed = clock.At(day.AddDays(random.Between(2, 5)), new TimeOnly(10, 0).AddMinutes(random.Between(0, 300)));
            AirlineRows? owner = null;
            CommercialAirlineProfile? profile;
            if (isAdditional && active.Length > 0)
            {
                owner = active[additional++ % active.Length];
                profile = owner.Source.Profile;
            }
            else
            {
                if (isAdditional) status = CommercialRequestStatus.Pending;
                if (applicants.Length == 0) continue;
                profile = applicants[applicant++ % applicants.Length];
            }
            var person = People[(index * 5 + 11) % People.Length];
            var contactEmail = owner?.Person.PrimaryEmail ?? $"contacto.solicitud{index + 1:00}@dev.elevant.test";
            var events = new List<(CommercialRequestStatus, CommercialRequestStatus, DateTimeOffset, string?)>();
            string? reason = null;
            var inReview = clock.At(day.AddDays(1), new TimeOnly(11, 0).AddMinutes(random.Between(0, 180)));
            switch (status)
            {
                case CommercialRequestStatus.Rejected:
                    reason = RejectionReasons[rejected++ % RejectionReasons.Length];
                    events.Add((CommercialRequestStatus.Pending, CommercialRequestStatus.InReview, inReview, null));
                    events.Add((CommercialRequestStatus.InReview, CommercialRequestStatus.Rejected, reviewed, reason));
                    break;
                case CommercialRequestStatus.Cancelled:
                    reason = CancellationReasons[cancelled++ % CancellationReasons.Length];
                    events.Add((CommercialRequestStatus.Pending, CommercialRequestStatus.Cancelled, reviewed, reason));
                    break;
                case CommercialRequestStatus.Approved:
                    events.Add((CommercialRequestStatus.Pending, CommercialRequestStatus.InReview, inReview, null));
                    events.Add((CommercialRequestStatus.InReview, CommercialRequestStatus.Approved, reviewed, null));
                    break;
                case CommercialRequestStatus.InReview:
                    events.Add((CommercialRequestStatus.Pending, CommercialRequestStatus.InReview, inReview, null));
                    break;
            }
            var decided = status is CommercialRequestStatus.Approved or CommercialRequestStatus.Rejected or
                CommercialRequestStatus.Cancelled;
            var tax = AviamAirlineReference.DevelopmentTaxRegistrations.GetValueOrDefault(profile.SourceName);
            var request = HistoryChunkContext.Stamp(new ServiceRequest
            {
                RequestCode = HistoryKeys.Key(key).ToString("N"), AirlineId = owner?.Airline.Id,
                AirlineProfileId = profile.Id, RequestedAirlineName = profile.DisplayName,
                AirlineLegalNameSnapshot = owner is null ? null : profile.LegalName,
                Type = owner is null ? CommercialRequestType.Affiliation : CommercialRequestType.AdditionalService,
                Status = status,
                ContactName = owner is null ? $"{person.First} {person.Last}" : $"{owner.Person.FirstName} {owner.Person.LastName}",
                ContactTitle = owner is null ? "Gerente de estaciones" : SignerTitle, AuthorityDeclared = true,
                ContactEmail = contactEmail, ContactPhone = $"+1 809 555 {2100 + index:0000}",
                TaxRegistration = tax, TaxRegistrationCountryCode = tax is null ? null : "DO",
                SubmittedAt = submitted,
                ReviewedAt = decided ? reviewed : null,
                ReviewedByAccountId = decided ? anchors.Contracts.Id : null,
                DecisionReason = reason,
                CancelledAt = status == CommercialRequestStatus.Cancelled ? reviewed : null,
                RepresentativeConfirmedAt = status is CommercialRequestStatus.Approved or CommercialRequestStatus.InReview
                    ? inReview : null,
                RepresentativeConfirmedByAccountId = status is CommercialRequestStatus.Approved or CommercialRequestStatus.InReview
                    ? anchors.Contracts.Id : null,
                RepresentativeConfirmationNote = status is CommercialRequestStatus.Approved or CommercialRequestStatus.InReview
                    ? "Confirmado por teléfono con la oficina de la aerolínea." : null,
            }, key, submitted, decided ? reviewed : status == CommercialRequestStatus.InReview ? inReview : submitted);
            var chosen = random.Shuffle(services).Take(Math.Min(services.Length, random.Between(1, 3)))
                .OrderBy(service => service.Code, StringComparer.Ordinal).ToArray();
            extras.Add(new ExtraRequest(key, request, chosen, events));
        }
        return extras;
    }

    private static IEnumerable<object> Permits(AirlineRows item, HistoryAnchors anchors, HistoryClock clock)
    {
        var iata = item.Source.Iata;
        var random = HistoryRandom.For($"commercial:{iata}:permits");
        var expiresInDecember = item.Source.Index == 0 ? new DateOnly(2026, 12, 15)
            : item.Source.Index == 5 ? new DateOnly(2026, 12, 31) : (DateOnly?)null;
        AirlinePermit Permit(string key, AirlinePermitKind kind, string number, string issuer, DateOnly issued,
            DateOnly expires, AirlinePermitReview review, DateTimeOffset submitted, DateTimeOffset? reviewed, string? note) =>
            HistoryChunkContext.Stamp(new AirlinePermit
            {
                AirlineId = item.Airline.Id, Kind = kind, Number = number, Issuer = issuer, IssuedOn = issued,
                ExpiresOn = expires, Review = review, SubmittedByAccountId = item.Account.Id, ReviewedAt = reviewed,
                ReviewedByAccountId = reviewed is null ? null : anchors.Contracts.Id, ReviewNote = note,
            }, $"permit:{iata}:{key}", submitted, reviewed ?? submitted);

        yield return Permit("operating", AirlinePermitKind.OperatingPermit,
            string.Create(CultureInfo.InvariantCulture, $"JAC-OP-{iata}-2026-{random.Between(100, 999)}"),
            "Junta de Aviación Civil (JAC) · República Dominicana", new DateOnly(2026, 4, 1),
            expiresInDecember ?? new DateOnly(2027, 3, 31), AirlinePermitReview.Verified, item.PermitSubmitted,
            item.PermitVerified, null);
        yield return Permit("aoc", AirlinePermitKind.AirOperatorCertificate,
            string.Create(CultureInfo.InvariantCulture, $"AOC-{item.Source.Icao}-{random.Between(1000, 9999)}"),
            Authority(item.Source.Profile.CountryCode), new DateOnly(2025, 7, 1), new DateOnly(2027, 6, 30),
            AirlinePermitReview.Verified, item.PermitSubmitted, item.PermitVerified, null);
        if (item.Source.Index == 0)
        {
            // A policy that lapsed on 2026-10-31 and its renewal, submitted and still waiting for Contratos.
            yield return Permit("insurance-2025", AirlinePermitKind.Insurance, $"POL-{iata}-2025-{random.Between(10000, 99999)}",
                "Seguros Universal (sintético)", new DateOnly(2025, 11, 1), new DateOnly(2026, 10, 31),
                AirlinePermitReview.Verified, item.PermitSubmitted, item.PermitVerified, null);
            var submitted = clock.At(new DateOnly(2026, 11, 18), new TimeOnly(10, 25));
            yield return Permit("insurance-2026", AirlinePermitKind.Insurance, $"POL-{iata}-2026-{random.Between(10000, 99999)}",
                "Seguros Universal (sintético)", new DateOnly(2026, 11, 1), new DateOnly(2027, 10, 31),
                AirlinePermitReview.Submitted, submitted, null, null);
        }
        if (item.Source.Index == 1)
        {
            var submitted = clock.At(new DateOnly(2026, 7, 10), new TimeOnly(9, 50));
            yield return Permit("aoc-rejected", AirlinePermitKind.AirOperatorCertificate,
                $"AOC-{item.Source.Icao}-R{random.Between(100, 999)}", Authority(item.Source.Profile.CountryCode),
                new DateOnly(2026, 7, 1), new DateOnly(2028, 6, 30), AirlinePermitReview.Rejected, submitted,
                clock.At(new DateOnly(2026, 7, 13), new TimeOnly(16, 20)),
                "El número del certificado no coincide con el registro de la autoridad emisora.");
        }
    }

    private static string Authority(string? countryCode) => countryCode switch
    {
        "US" => "Federal Aviation Administration (FAA)",
        "CA" => "Transport Canada Civil Aviation",
        "ES" => "Agencia Estatal de Seguridad Aérea (AESA)",
        "FR" => "Direction générale de l'Aviation civile (DGAC)",
        "DE" => "Luftfahrt-Bundesamt (LBA)",
        "CH" => "Federal Office of Civil Aviation (FOCA)",
        _ => "Autoridad de aviación civil del país de origen",
    };
}
