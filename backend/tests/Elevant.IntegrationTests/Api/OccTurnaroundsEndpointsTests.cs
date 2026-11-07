using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.AspNetCore.TestHost;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

/// <summary>
/// Phase 3, block A: the turnaround detail travels with its ETag; reschedule and cancellation need their key and the
/// ETag in If-Match (428 without it, 412 when stale) and fail with Spanish, coded Problem Details (3-A); the minimal
/// charter carrier answers 201, the replay 200 and a taken code the airline that holds it (3-N21); the positions
/// commands take optional headers with the ETag in the answer (3-N10); the tablet reads the aircraft types (3-B).
/// </summary>
public sealed class OccTurnaroundsEndpointsTests(ElevantApiFactory factory) : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000007");
    private static readonly Guid StationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid TurnaroundId = Guid.Parse("70000000-0000-7000-8000-000000000012");
    private const string Version = "AAAAAAAAB9E=";

    [Fact]
    public async Task TheDetailCarriesItsVersionAsAStrongETag()
    {
        var store = new TurnaroundStub();
        await using var application = Application(services => Replace<IOccTurnaroundStore>(services, store));
        using var client = Authorized(application);

        using var response = await client.GetAsync($"/api/v1/occ/planning/turnarounds/{TurnaroundId}",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        Assert.Equal($"\"{Version}\"", response.Headers.ETag?.ToString());
        using var answer = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(["station", "turnaround", "version", "isCharter", "allowedActions"],
            answer.RootElement.EnumerateObject().Select(item => item.Name).ToArray());
        Assert.Equal("America/Santo_Domingo", answer.RootElement.GetProperty("station").GetProperty("ianaTimeZone").GetString());
        Assert.Equal(["reschedule", "cancel", "divert"],
            answer.RootElement.GetProperty("allowedActions").EnumerateArray().Select(item => item.GetString()!).ToArray());

        store.Detail = MasterDataResult<OccTurnaroundDetailData>.Failed(MasterDataFailure.NotFound, "not_found");
        using var missing = await client.GetAsync($"/api/v1/occ/planning/turnarounds/{TurnaroundId}",
            TestContext.Current.CancellationToken);
        Assert.Equal((HttpStatusCode.NotFound, "not_found"), (missing.StatusCode, (await ProblemAsync(missing)).Code));
    }

    [Fact]
    public async Task ChangesNeedTheirKeyAndTheETagAndAnswerCodedProblems()
    {
        var store = new TurnaroundStub();
        await using var application = Application(services => Replace<IOccTurnaroundStore>(services, store));
        using var client = Authorized(application);
        var cancel = new { outcome = "Cancelled", reason = "Vuelo creado por error" };
        var path = $"occ/planning/turnarounds/{TurnaroundId}/status-changes";

        using var noKey = await SendAsync(client, HttpMethod.Post, path, null, $"\"{Version}\"", cancel);
        Assert.Equal((HttpStatusCode.BadRequest, "idempotency_key_required"), (noKey.StatusCode, (await ProblemAsync(noKey)).Code));
        using var noVersion = await SendAsync(client, HttpMethod.Post, path, Guid.NewGuid(), null, cancel);
        Assert.Equal((HttpStatusCode.PreconditionRequired, "expected_version_required"),
            (noVersion.StatusCode, (await ProblemAsync(noVersion)).Code));
        var calls = store.Calls;
        using var weak = await SendAsync(client, HttpMethod.Post, path, Guid.NewGuid(), $"W/\"{Version}\"", cancel);
        Assert.Equal((HttpStatusCode.BadRequest, "invalid_turnaround_change"), (weak.StatusCode, (await ProblemAsync(weak)).Code));
        Assert.Equal(calls, store.Calls);

        var key = Guid.NewGuid();
        using var cancelled = await SendAsync(client, HttpMethod.Post, path, key, $"\"{Version}\"", cancel);
        Assert.Equal(HttpStatusCode.OK, cancelled.StatusCode);
        Assert.Equal($"\"{Version}\"", cancelled.Headers.ETag?.ToString());
        Assert.Equal((key, Version, "Cancelled", "Vuelo creado por error"),
            (store.LastKey, store.LastStatus!.ExpectedVersion, store.LastStatus.Outcome, store.LastStatus.Reason));

        using var unknown = await SendAsync(client, HttpMethod.Post, path, Guid.NewGuid(), $"\"{Version}\"",
            new { outcome = "Cancelled", reason = "Vuelo creado por error", stationId = StationId });
        Assert.Equal(HttpStatusCode.BadRequest, unknown.StatusCode);

        foreach (var (failure, code, status, reasons) in new (MasterDataFailure, string, HttpStatusCode, string[])[]
        {
            (MasterDataFailure.Conflict, "version_conflict", HttpStatusCode.PreconditionFailed, []),
            (MasterDataFailure.Conflict, "operation_started", HttpStatusCode.Conflict, []),
            (MasterDataFailure.Conflict, "turnaround_closed", HttpStatusCode.Conflict, []),
            (MasterDataFailure.Conflict, "idempotency_conflict", HttpStatusCode.Conflict, []),
            (MasterDataFailure.Conflict, "assigned_agent_unavailable", HttpStatusCode.Conflict, ["shift_not_covering", "simultaneous_limit"]),
            (MasterDataFailure.Conflict, "stand_unavailable", HttpStatusCode.Conflict, ["stand_taken"]),
            (MasterDataFailure.Invalid, "reason_required", HttpStatusCode.BadRequest, []),
            (MasterDataFailure.Forbidden, "forbidden", HttpStatusCode.Forbidden, []),
            (MasterDataFailure.NotFound, "not_found", HttpStatusCode.NotFound, []),
        })
        {
            store.Command = MasterDataResult<OccTurnaroundDetailData>.Failed(failure, code, reasons);
            using var refused = await SendAsync(client, HttpMethod.Put, $"occ/planning/turnarounds/{TurnaroundId}/schedule",
                Guid.NewGuid(), $"\"{Version}\"", new
                {
                    arrivalFlightNumber = "EV311", arrivalOriginIata = "MIA", arrivalScheduledAt = "2026-11-05T16:00:00Z",
                    departureFlightNumber = "EV312", departureDestinationIata = "MIA", departureScheduledAt = "2026-11-05T18:00:00Z",
                    reason = "Cambio de horario",
                });
            Assert.Equal(status, refused.StatusCode);
            var problem = await ProblemAsync(refused);
            Assert.Equal(code, problem.Code);
            Assert.Equal(reasons, problem.Reasons);
            Assert.DoesNotContain("The ", problem.Title, StringComparison.Ordinal);
        }
    }

    [Fact]
    public async Task TheCharterCarrierIsCreatedOnceAndATakenCodeNamesItsAirline()
    {
        var store = new TurnaroundStub();
        await using var application = Application(services => Replace<IOccTurnaroundStore>(services, store));
        using var client = Authorized(application);
        var body = new { name = "Sky High Charter", icaoCode = "SHC", iataCode = "9Z" };

        using var noKey = await SendAsync(client, HttpMethod.Post, "occ/planning/charter-airlines", null, null, body);
        Assert.Equal((HttpStatusCode.BadRequest, "idempotency_key_required"), (noKey.StatusCode, (await ProblemAsync(noKey)).Code));
        using var created = await SendAsync(client, HttpMethod.Post, "occ/planning/charter-airlines", Guid.NewGuid(), null, body);
        Assert.Equal(HttpStatusCode.Created, created.StatusCode);
        using var answer = JsonDocument.Parse(await created.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal(["id", "icaoCode", "iataCode", "name"], answer.RootElement.EnumerateObject().Select(item => item.Name).ToArray());
        store.Airline = store.Airline with { Replayed = true };
        using var replayed = await SendAsync(client, HttpMethod.Post, "occ/planning/charter-airlines", Guid.NewGuid(), null, body);
        Assert.Equal(HttpStatusCode.OK, replayed.StatusCode);

        var holder = Guid.NewGuid();
        store.Airline = MasterDataResult<OccCharterAirlineData>.Failed(MasterDataFailure.Conflict, "airline_code_in_use", null, holder);
        using var taken = await SendAsync(client, HttpMethod.Post, "occ/planning/charter-airlines", Guid.NewGuid(), null, body);
        Assert.Equal(HttpStatusCode.Conflict, taken.StatusCode);
        using var problem = JsonDocument.Parse(await taken.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        Assert.Equal("airline_code_in_use", problem.RootElement.GetProperty("code").GetString());
        Assert.Equal(holder, problem.RootElement.GetProperty("airlineId").GetGuid());

        // A creation carries no If-Match: a version conflict (a repeated deadlock) is a 409, never a failed precondition.
        store.Airline = MasterDataResult<OccCharterAirlineData>.Failed(MasterDataFailure.Conflict, "version_conflict");
        using var concurrent = await SendAsync(client, HttpMethod.Post, "occ/planning/charter-airlines", Guid.NewGuid(), null, body);
        Assert.Equal((HttpStatusCode.Conflict, "version_conflict"), (concurrent.StatusCode, (await ProblemAsync(concurrent)).Code));
    }

    [Fact]
    public async Task PositionsCommandsTakeOptionalHeadersAndAnswerTheirETag()
    {
        var store = new PositionsStub();
        await using var application = Application(services => Replace<IOccPositionStore>(services, store));
        using var client = Authorized(application);
        var arrival = $"occ/turnarounds/{TurnaroundId}/arrival";
        var body = new { aircraftRegistration = "HI1055", arrivedAt = "2026-11-05T16:05:00Z",
            aircraftTypeId = Guid.NewGuid(), reason = (string?)null };

        // An older screen sends neither header: the command still runs, without a version.
        using var legacy = await client.PostAsJsonAsync($"/api/v1/{arrival}",
            new { aircraftRegistration = "HI1055", arrivedAt = (string?)null }, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        Assert.Equal(OccPositionCommand.None, store.LastCommand);

        using var noVersion = await SendAsync(client, HttpMethod.Post, arrival, Guid.NewGuid(), null, body);
        Assert.Equal((HttpStatusCode.PreconditionRequired, "expected_version_required"),
            (noVersion.StatusCode, (await ProblemAsync(noVersion)).Code));
        var key = Guid.NewGuid();
        using var recorded = await SendAsync(client, HttpMethod.Post, arrival, key, $"\"{Version}\"", body);
        Assert.Equal(HttpStatusCode.OK, recorded.StatusCode);
        Assert.Equal("\"AAAAAAAAB9I=\"", recorded.Headers.ETag?.ToString());
        Assert.Equal(new OccPositionCommand(key, Version), store.LastCommand);
        Assert.Equal(body.aircraftTypeId, store.LastArrival!.AircraftTypeId);

        using var weak = await SendAsync(client, HttpMethod.Post, $"occ/turnarounds/{TurnaroundId}/stand", Guid.NewGuid(),
            "AAAAAAAAB9E=", new { standId = Guid.NewGuid(), reason = (string?)null });
        Assert.Equal((HttpStatusCode.BadRequest, "invalid_position_request"), (weak.StatusCode, (await ProblemAsync(weak)).Code));

        foreach (var (code, reasons, ifMatch, status) in new (string, string[], string?, HttpStatusCode)[]
        {
            ("stand_unavailable", ["stand_taken"], null, HttpStatusCode.Conflict),
            ("stand_unavailable", ["stand_narrowbody_only"], $"\"{Version}\"", HttpStatusCode.Conflict),
            ("version_conflict", [], $"\"{Version}\"", HttpStatusCode.PreconditionFailed),
            ("version_conflict", [], null, HttpStatusCode.Conflict),
            ("arrival_locked", [], $"\"{Version}\"", HttpStatusCode.Conflict),
            ("aircraft_type_locked", [], $"\"{Version}\"", HttpStatusCode.Conflict),
            ("turnaround_closed", [], null, HttpStatusCode.Conflict),
        })
        {
            store.Result = new OccPositionResult(null, OccPositionFailure.Conflict, reasons, code);
            using var refused = await SendAsync(client, HttpMethod.Post, $"occ/turnarounds/{TurnaroundId}/stand",
                ifMatch is null ? null : Guid.NewGuid(), ifMatch, new { standId = Guid.NewGuid(), reason = (string?)null });
            Assert.Equal(status, refused.StatusCode);
            var problem = await ProblemAsync(refused);
            Assert.Equal(code, problem.Code);
            Assert.Equal(reasons, problem.Reasons);
            Assert.DoesNotContain("The ", problem.Title, StringComparison.Ordinal);
        }

        store.Result = new OccPositionResult(null, OccPositionFailure.Invalid, null, "reason_required");
        using var noReason = await SendAsync(client, HttpMethod.Post, $"occ/turnarounds/{TurnaroundId}/stand/release",
            Guid.NewGuid(), $"\"{Version}\"", null);
        Assert.Equal((HttpStatusCode.BadRequest, "reason_required"), (noReason.StatusCode, (await ProblemAsync(noReason)).Code));
    }

    [Fact]
    public async Task TheTabletReadsTheActiveAircraftTypes()
    {
        var store = new ReferenceStub();
        await using var application = Application(services => Replace<IRampReferenceStore>(services, store));
        using var client = Authorized(application);

        using var response = await client.GetAsync("/api/v1/ramp/aircraft-types", TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        using var answer = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var type = Assert.Single(answer.RootElement.GetProperty("aircraftTypes").EnumerateArray());
        Assert.Equal(["id", "icaoCode", "iataCode", "manufacturer", "model"], type.EnumerateObject().Select(item => item.Name).ToArray());

        store.Types = null;
        using var forbidden = await client.GetAsync("/api/v1/ramp/aircraft-types", TestContext.Current.CancellationToken);
        // A refused permission keeps the uncoded 403 of the ramp controllers.
        Assert.Equal((HttpStatusCode.Forbidden, (string?)null), (forbidden.StatusCode, (await ProblemAsync(forbidden)).Code));
    }

    /// <summary>
    /// 3-B: the tablet's flight data keep the 409 the deployed APK explains by its status. A refused aircraft type now
    /// carries its code, any other refusal stays uncoded, and a command without a type still means «keep the current one».
    /// </summary>
    [Fact]
    public async Task TheTabletsAircraftTypeRefusalsKeepTheirStatusAndCarryTheirCode()
    {
        var commands = new FlightDataStub();
        await using var application = Application(services =>
        {
            Replace<IActorContextResolver>(services, new RampActorResolver());
            Replace<IRampExecutionCommandStore>(services, commands);
        });
        using var client = Authorized(application);
        var path = $"ramp/operations/{TurnaroundId}/flight-data";
        var typeId = Guid.NewGuid();

        using var legacy = await FlightDataAsync(client, path,
            new { passengersIn = 120, passengersOut = 118, mtowKg = 70_000, aircraftRegistration = (string?)null });
        Assert.Equal(HttpStatusCode.OK, legacy.StatusCode);
        Assert.Null(commands.Last!.AircraftTypeId);

        foreach (var (code, expected) in new (string, string?)[]
                 {
                     ("aircraft_type_unavailable", "aircraft_type_unavailable"),
                     ("aircraft_type_locked", "aircraft_type_locked"),
                     ("conflict", null),
                 })
        {
            commands.Code = code;
            using var refused = await FlightDataAsync(client, path, new
            {
                passengersIn = 120, passengersOut = 118, mtowKg = 70_000, aircraftRegistration = (string?)null,
                aircraftTypeId = typeId,
            });
            Assert.Equal(HttpStatusCode.Conflict, refused.StatusCode);
            Assert.Equal(expected, (await ProblemAsync(refused)).Code);
            Assert.Equal(typeId, commands.Last!.AircraftTypeId);
        }
    }

    private static async Task<HttpResponseMessage> FlightDataAsync(HttpClient client, string path, object body)
    {
        using var request = new HttpRequestMessage(HttpMethod.Put, $"/api/v1/{path}") { Content = JsonContent.Create(body) };
        request.Headers.Add("X-Elevant-Installation-Id", Guid.NewGuid().ToString("D"));
        request.Headers.Add("Idempotency-Key", Guid.NewGuid().ToString("D"));
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<HttpResponseMessage> SendAsync(HttpClient client, HttpMethod method, string path, Guid? key,
        string? ifMatch, object? body)
    {
        using var request = new HttpRequestMessage(method, $"/api/v1/{path}");
        if (body is not null) request.Content = JsonContent.Create(body);
        if (key is { } value) request.Headers.Add("Idempotency-Key", value.ToString("D"));
        if (ifMatch is not null) request.Headers.TryAddWithoutValidation("If-Match", ifMatch);
        return await client.SendAsync(request, TestContext.Current.CancellationToken);
    }

    private static async Task<(string? Code, string Title, string[] Reasons)> ProblemAsync(HttpResponseMessage response)
    {
        using var problem = JsonDocument.Parse(await response.Content.ReadAsStringAsync(TestContext.Current.CancellationToken));
        var root = problem.RootElement;
        return (root.TryGetProperty("code", out var code) ? code.GetString() : null,
            root.GetProperty("title").GetString() ?? string.Empty,
            root.TryGetProperty("reasons", out var reasons)
                ? reasons.EnumerateArray().Select(item => item.GetString()!).ToArray()
                : []);
    }

    private static void Replace<T>(IServiceCollection services, T implementation) where T : class
    {
        services.RemoveAll<T>();
        services.AddSingleton(implementation);
    }

    private WebApplicationFactory<Program> Application(Action<IServiceCollection> configure) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureTestServices(configure));

    private static HttpClient Authorized(WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        var now = DateTimeOffset.UtcNow;
        var token = new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(new SymmetricSecurityKey(
                Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64)),
                SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Sub, AccountId.ToString("D")),
                new System.Security.Claims.Claim(JwtRegisteredClaimNames.Jti, Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(
                        ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", token);
        return client;
    }

    private static OccTurnaroundDetailData Detail() => new(
        new OccStationData(StationId, "PUJ", "Punta Cana", "America/Santo_Domingo"),
        new OccTurnaroundData(TurnaroundId, "PUJ-20261105-001", new DateOnly(2026, 11, 5), "Confirmed",
            new OccAirlineData(Guid.NewGuid(), "ZZ", "DZZ", "Demo Airlines"), null, null, null, null,
            new OccGroundOperationData(Guid.NewGuid(), "Assigned", null, null, null, null), [], [], []),
        Version, false, ["reschedule", "cancel", "divert"]);

    private sealed class TurnaroundStub : IOccTurnaroundStore
    {
        public MasterDataResult<OccTurnaroundDetailData> Detail { get; set; } =
            MasterDataResult<OccTurnaroundDetailData>.Success(OccTurnaroundsEndpointsTests.Detail());
        public MasterDataResult<OccTurnaroundDetailData> Command { get; set; } =
            MasterDataResult<OccTurnaroundDetailData>.Success(OccTurnaroundsEndpointsTests.Detail());
        public MasterDataResult<OccCharterAirlineData> Airline { get; set; } =
            MasterDataResult<OccCharterAirlineData>.Success(new OccCharterAirlineData(Guid.NewGuid(), "SHC", "9Z",
                "Sky High Charter"));
        public int Calls { get; private set; }
        public Guid? LastKey { get; private set; }
        public TurnaroundStatusChangeInput? LastStatus { get; private set; }

        public Task<MasterDataResult<OccTurnaroundDetailData>> ReadAsync(Guid actorId, Guid turnaroundId,
            CancellationToken cancellationToken = default) => Task.FromResult(Detail);

        public Task<MasterDataResult<OccTurnaroundDetailData>> RescheduleAsync(Guid actorId, Guid turnaroundId,
            RescheduleTurnaroundInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default) =>
            Task.FromResult(Headers(idempotencyKey, input.ExpectedVersion) ?? Command);

        public Task<MasterDataResult<OccTurnaroundDetailData>> ChangeStatusAsync(Guid actorId, Guid turnaroundId,
            TurnaroundStatusChangeInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            LastStatus = input;
            return Task.FromResult(Headers(idempotencyKey, input.ExpectedVersion) ?? Command);
        }

        public Task<MasterDataResult<OccCharterAirlineData>> CreateCharterAirlineAsync(Guid actorId, CharterAirlineInput input,
            Guid? idempotencyKey, CancellationToken cancellationToken = default)
        {
            Calls++;
            LastKey = idempotencyKey;
            return Task.FromResult(idempotencyKey is null
                ? MasterDataResult<OccCharterAirlineData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required")
                : Airline);
        }

        /// <summary>The header checks of the real store: the key first, then the version.</summary>
        private MasterDataResult<OccTurnaroundDetailData>? Headers(Guid? key, string? version)
        {
            Calls++;
            LastKey = key;
            return key is null
                ? MasterDataResult<OccTurnaroundDetailData>.Failed(MasterDataFailure.Invalid, "idempotency_key_required")
                : version is null
                    ? MasterDataResult<OccTurnaroundDetailData>.Failed(MasterDataFailure.Invalid, "expected_version_required")
                    : null;
        }
    }

    private sealed class PositionsStub : IOccPositionStore
    {
        private static readonly OccPositionBoardData Board = new(StationId, "PUJ", new DateOnly(2026, 11, 5),
            DateTimeOffset.UtcNow, [], [], true);

        public OccPositionResult Result { get; set; } = new(Board, null, null, null, "AAAAAAAAB9I=");
        public OccPositionCommand? LastCommand { get; private set; }
        public RecordArrivalInput? LastArrival { get; private set; }

        public Task<OccPositionResult> ReadAsync(Guid actorId, Guid stationId, DateOnly operationDate,
            CancellationToken cancellationToken = default) => Task.FromResult(new OccPositionResult(Board, null));

        public Task<OccPositionResult> RecordArrivalAsync(Guid actorId, Guid turnaroundId, RecordArrivalInput input,
            OccPositionCommand command, CancellationToken cancellationToken = default)
        {
            LastArrival = input;
            return Task.FromResult(Run(command));
        }

        public Task<OccPositionResult> LocateStandAsync(Guid actorId, Guid standId, decimal? latitude, decimal? longitude,
            DateOnly operationDate, CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<OccPositionResult> AssignAsync(Guid actorId, Guid turnaroundId, Guid standId, string? reason,
            OccPositionCommand command, CancellationToken cancellationToken = default) => Task.FromResult(Run(command));

        public Task<OccPositionResult> ReleaseAsync(Guid actorId, Guid turnaroundId, OccPositionCommand command,
            CancellationToken cancellationToken = default) => Task.FromResult(Run(command));

        /// <summary>The header rule of the real store: with a key the version is required.</summary>
        private OccPositionResult Run(OccPositionCommand command)
        {
            LastCommand = command;
            return command.IdempotencyKey is not null && command.ExpectedVersion is null
                ? new OccPositionResult(null, OccPositionFailure.Invalid, null, "expected_version_required")
                : Result;
        }
    }

    private sealed class ReferenceStub : IRampReferenceStore
    {
        public IReadOnlyList<RampAircraftTypeData>? Types { get; set; } =
            [new RampAircraftTypeData(Guid.NewGuid(), "A320", "320", "Airbus", "A320-200")];

        public Task<IReadOnlyList<RampAircraftTypeData>?> ListAircraftTypesAsync(Guid actorId,
            CancellationToken cancellationToken = default) => Task.FromResult(Types);
    }

    /// <summary>The flight-data store: it applies the command, or refuses it with the receipt code it was given.</summary>
    private sealed class FlightDataStub : IRampExecutionCommandStore
    {
        public string? Code { get; set; }
        public RampFlightDataWriteRequest? Last { get; private set; }

        public Task<RampExecutionWriteResult> RecordMilestoneAsync(RampMilestoneWriteRequest request,
            CancellationToken cancellationToken = default) => throw new NotSupportedException();

        public Task<RampExecutionWriteResult> UpdateFlightDataAsync(RampFlightDataWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            Last = request;
            return Task.FromResult(Code is null
                ? RampExecutionWriteResult.Success(new RampExecutionData(Guid.NewGuid(), request.OperationId, [],
                    new RampFlightData(request.PassengersIn, request.PassengersOut, request.MtowKg),
                    request.AircraftRegistration), Guid.NewGuid())
                : RampExecutionWriteResult.Failed(RampExecutionWriteFailure.Conflict, Guid.NewGuid(), Code));
        }
    }

    /// <summary>The ramp agent of the token, with the station of the tests in scope.</summary>
    private sealed class RampActorResolver : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult<ActorContext?>(new ActorContext(accountId, "ramp.agent@dev.elevant.test", "Riley Ramp",
                [new ActorRole(Guid.Parse("41000000-0000-7000-8000-000000000003"), "RAMP_AGENT", "Agente de rampa",
                    PortalKind.RampMobileApp, "ramp_agent")],
                [new ActorMembership(Guid.Parse("42000000-0000-7000-8000-000000000003"),
                    Guid.Parse("10000000-0000-7000-8000-000000000001"), "AVIAM", "AVIAM Development",
                    OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
                [new ActorStationScope(StationId, "PUJ")]));
    }
}
