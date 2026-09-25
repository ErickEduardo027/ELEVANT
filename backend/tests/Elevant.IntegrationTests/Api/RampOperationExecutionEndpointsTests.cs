using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Mvc.Testing;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.DependencyInjection.Extensions;
using Microsoft.IdentityModel.JsonWebTokens;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.IntegrationTests.Api;

public sealed class RampOperationExecutionEndpointsTests(ElevantApiFactory factory)
    : IClassFixture<ElevantApiFactory>
{
    private static readonly Guid AccountId =
        Guid.Parse("40000000-0000-7000-8000-000000000002");
    private static readonly Guid StationId =
        Guid.Parse("20000000-0000-7000-8000-000000000003");
    private static readonly Guid OperationId =
        Guid.Parse("70000000-0000-7000-8000-000000000016");
    private static readonly Guid ChecklistId =
        Guid.Parse("70000000-0000-7000-8000-000000000019");
    private static readonly Guid ChecklistItemId =
        Guid.Parse("70000000-0000-7000-8000-000000000020");
    private static readonly Guid ServiceId =
        Guid.Parse("70000000-0000-7000-8000-000000000017");
    private static readonly Guid InstallationId =
        Guid.Parse("81000000-0000-7000-8000-000000000001");
    private static readonly Guid IdempotencyKey =
        Guid.Parse("82000000-0000-7000-8000-000000000010");
    private static readonly Guid ReceiptId =
        Guid.Parse("83000000-0000-7000-8000-000000000010");

    [Fact]
    public async Task ChecklistReadRequiresBearerAuthenticationAndIsNeverCached()
    {
        await using var application = CreateApplication(new ExecutionState());
        using var client = application.CreateClient();

        using var response = await client.GetAsync(
            $"/api/v1/ramp/operations/{OperationId:D}/checklist",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Fact]
    public async Task CorrectionRequiresBearerAndValidCommandHeaders()
    {
        var state = new ExecutionState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var anonymous = application.CreateClient();
        using var anonymousRequest = new HttpRequestMessage(HttpMethod.Post,
            $"/api/v1/ramp/operations/{OperationId:D}/correction");
        AddCommandHeaders(anonymousRequest, InstallationId.ToString("D"), IdempotencyKey.ToString("D"));
        using var unauthorized = await anonymous.SendAsync(
            anonymousRequest, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, unauthorized.StatusCode);
        AssertPrivateResponse(unauthorized);

        using var authenticated = CreateAuthenticatedClient(application);
        using var missingHeaders = await authenticated.PostAsync(
            $"/api/v1/ramp/operations/{OperationId:D}/correction", null,
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, missingHeaders.StatusCode);
        Assert.Null(state.CorrectionRequest);
    }

    [Fact]
    public async Task CorrectionMapsScopedActorAndExactRevisionReceipt()
    {
        var previousSubmissionId = Guid.Parse("85000000-0000-7000-8000-000000000022");
        var state = new ExecutionState
        {
            Actor = CreateActor(),
            CorrectionResult = RampOperationCorrectionWriteResult.Success(
                new RampOperationCorrectionData(ReceiptId, OperationId,
                    previousSubmissionId, IdempotencyKey, 2, "InProgress",
                    "Corrige la cantidad del servicio."), ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = new HttpRequestMessage(HttpMethod.Post,
            $"/api/v1/ramp/operations/{OperationId:D}/correction");
        AddCommandHeaders(request, InstallationId.ToString("D"), IdempotencyKey.ToString("D"));

        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(ReceiptId, body.GetProperty("receiptId").GetGuid());
        Assert.Equal(IdempotencyKey, body.GetProperty("checklistId").GetGuid());
        Assert.Equal(2, body.GetProperty("revisionNumber").GetInt32());
        Assert.Equal("InProgress", body.GetProperty("status").GetString());
        Assert.Equal("Corrige la cantidad del servicio.", body.GetProperty("returnReason").GetString());
        Assert.NotNull(state.CorrectionRequest);
        Assert.Equal(AccountId, state.CorrectionRequest.ActorAccountId);
        Assert.Equal([StationId], state.CorrectionRequest.AllowedStationIds);
        Assert.Equal(InstallationId, state.CorrectionRequest.InstallationId);
        Assert.Equal(IdempotencyKey, state.CorrectionRequest.IdempotencyKey);
    }

    [Fact]
    public async Task ChecklistReadReturnsCanonicalProjectionAndServerResolvedScope()
    {
        var answeredAt = new DateTimeOffset(2026, 9, 17, 12, 15, 0, TimeSpan.Zero);
        var state = new ExecutionState
        {
            Actor = CreateActor(),
            ChecklistReadResult = RampOperationChecklistReadResult.Success(
                new RampOperationChecklistData(
                    OperationId,
                    ChecklistId,
                    "InProgress",
                    answeredAt.AddMinutes(-5),
                    null,
                    new RampChecklistTemplateData(
                        "TURNAROUND-BASE",
                        "Turnaround base checklist",
                        2),
                    [
                        new RampChecklistSectionData(
                            "Chequeo preuso",
                            [
                                new RampChecklistItemData(
                                    ChecklistItemId,
                                    "PREUSE-EXTERIOR",
                                    "Exterior completo del puente",
                                    1,
                                    true,
                                    true,
                                    new RampChecklistAnswerData("Ok", null, answeredAt)),
                            ]),
                    ])),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var response = await client.GetAsync(
            $"/api/v1/ramp/operations/{OperationId:D}/checklist",
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(OperationId, payload.GetProperty("operationId").GetGuid());
        var checklist = payload.GetProperty("checklist");
        Assert.Equal(ChecklistId, checklist.GetProperty("id").GetGuid());
        Assert.Equal("InProgress", checklist.GetProperty("status").GetString());
        Assert.Equal(2, checklist.GetProperty("template").GetProperty("version").GetInt32());
        var section = Assert.Single(checklist.GetProperty("sections").EnumerateArray());
        Assert.Equal("Chequeo preuso", section.GetProperty("name").GetString());
        var item = Assert.Single(section.GetProperty("items").EnumerateArray());
        Assert.Equal(ChecklistItemId, item.GetProperty("id").GetGuid());
        Assert.Equal("Ok", item.GetProperty("answer").GetProperty("value").GetString());
        Assert.Equal(AccountId, state.ChecklistReadRequest?.ActorAccountId);
        Assert.Equal(OperationId, state.ChecklistReadRequest?.OperationId);
        Assert.Equal([StationId], state.ChecklistReadRequest?.AllowedStationIds);
    }

    [Theory]
    [InlineData("checklist")]
    [InlineData("service")]
    public async Task CommandsRequireBearerAuthenticationAndAreNeverCached(string command)
    {
        await using var application = CreateApplication(new ExecutionState());
        using var client = application.CreateClient();
        using var request = command == "checklist"
            ? CreateChecklistSubmissionRequest()
            : CreateServiceTransitionRequest();

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Equal("Bearer", response.Headers.WwwAuthenticate.Single().Scheme);
    }

    [Theory]
    [InlineData("checklist", null, "82000000-0000-7000-8000-000000000010")]
    [InlineData("checklist", "not-a-uuid", "82000000-0000-7000-8000-000000000010")]
    [InlineData("checklist", "81000000-0000-7000-8000-000000000001", null)]
    [InlineData("checklist", "81000000-0000-7000-8000-000000000001", "not-a-uuid")]
    [InlineData("service", null, "82000000-0000-7000-8000-000000000010")]
    [InlineData("service", "not-a-uuid", "82000000-0000-7000-8000-000000000010")]
    [InlineData("service", "81000000-0000-7000-8000-000000000001", null)]
    [InlineData("service", "81000000-0000-7000-8000-000000000001", "not-a-uuid")]
    public async Task CommandsRejectMissingOrMalformedUuidHeaders(
        string command,
        string? installationId,
        string? idempotencyKey)
    {
        var state = new ExecutionState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = command == "checklist"
            ? CreateChecklistSubmissionRequest(installationId, idempotencyKey)
            : CreateServiceTransitionRequest(installationId, idempotencyKey);

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Null(state.ChecklistSubmissionRequest);
        Assert.Null(state.ServiceTransitionRequest);
    }

    [Fact]
    public async Task ChecklistSubmissionMapsStrictRequestAndCanonicalReceipt()
    {
        var submittedAt = new DateTimeOffset(2026, 9, 17, 12, 30, 0, TimeSpan.Zero);
        var state = new ExecutionState
        {
            Actor = CreateActor(),
            ChecklistSubmissionResult = RampChecklistSubmissionWriteResult.Success(
                new RampChecklistSubmissionData(
                    ReceiptId,
                    new RampChecklistSubmissionSummaryData(
                        ChecklistId,
                        "Submitted",
                        submittedAt.AddMinutes(-15),
                        submittedAt,
                        1)),
                ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateChecklistSubmissionRequest();

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(ReceiptId, payload.GetProperty("receiptId").GetGuid());
        var checklist = payload.GetProperty("checklist");
        Assert.Equal(ChecklistId, checklist.GetProperty("id").GetGuid());
        Assert.Equal("Submitted", checklist.GetProperty("status").GetString());
        Assert.Equal(1, checklist.GetProperty("answerCount").GetInt32());

        var captured = Assert.IsType<RampChecklistSubmissionWriteRequest>(
            state.ChecklistSubmissionRequest);
        Assert.Equal(AccountId, captured.ActorAccountId);
        Assert.Equal([StationId], captured.AllowedStationIds);
        Assert.Equal(OperationId, captured.OperationId);
        Assert.Equal(ChecklistId, captured.ChecklistId);
        Assert.Equal(InstallationId, captured.InstallationId);
        Assert.Equal(IdempotencyKey, captured.IdempotencyKey);
        Assert.Equal(IdempotencyKey, captured.CorrelationId);
        Assert.False(string.IsNullOrWhiteSpace(captured.RequestId));
        var answer = Assert.Single(captured.Answers);
        Assert.Equal(ChecklistItemId, answer.ItemId);
        Assert.Equal(ChecklistAnswerValue.NotOk, answer.Value);
        Assert.Equal("Daño visible", answer.Note);
    }

    [Theory]
    [InlineData("root")]
    [InlineData("answer")]
    public async Task ChecklistSubmissionRejectsUnknownJsonMembersBeforeStore(string location)
    {
        var state = new ExecutionState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        var unknownRoot = location == "root" ? ",\"accountId\":\"40000000-0000-7000-8000-000000000099\"" : string.Empty;
        var unknownAnswer = location == "answer" ? ",\"approved\":true" : string.Empty;
        var json = $$"""
            {
              "checklistId":"{{ChecklistId:D}}",
              "answers":[{
                "itemId":"{{ChecklistItemId:D}}",
                "value":"Ok"{{unknownAnswer}}
              }]{{unknownRoot}}
            }
            """;
        using var request = CreateChecklistSubmissionRequest(json: json);

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Null(state.ChecklistSubmissionRequest);
    }

    [Fact]
    public async Task ServiceTransitionMapsStrictRequestAndCanonicalReceipt()
    {
        var state = new ExecutionState
        {
            Actor = CreateActor(),
            ServiceTransitionResult = RampOperationServiceTransitionWriteResult.Success(
                new RampOperationServiceTransitionData(
                    ReceiptId,
                    new RampOperationServiceExecutionData(
                        ServiceId,
                        "Completed",
                        2m,
                        1.5m,
                        "operation")),
                ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateServiceTransitionRequest();

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        var payload = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(ReceiptId, payload.GetProperty("receiptId").GetGuid());
        var service = payload.GetProperty("service");
        Assert.Equal(ServiceId, service.GetProperty("id").GetGuid());
        Assert.Equal("Completed", service.GetProperty("status").GetString());
        Assert.Equal(1.5m, service.GetProperty("executedQuantity").GetDecimal());

        var captured = Assert.IsType<RampOperationServiceTransitionWriteRequest>(
            state.ServiceTransitionRequest);
        Assert.Equal(AccountId, captured.ActorAccountId);
        Assert.Equal([StationId], captured.AllowedStationIds);
        Assert.Equal(OperationId, captured.OperationId);
        Assert.Equal(ServiceId, captured.ServiceId);
        Assert.Equal(ServiceExecutionStatus.Completed, captured.TargetStatus);
        Assert.Equal(1.5m, captured.ExecutedQuantity);
        Assert.Equal("Servicio completado", captured.Note);
        Assert.Equal(InstallationId, captured.InstallationId);
        Assert.Equal(IdempotencyKey, captured.IdempotencyKey);
        Assert.Equal(IdempotencyKey, captured.CorrelationId);
        Assert.False(string.IsNullOrWhiteSpace(captured.RequestId));
    }

    [Fact]
    public async Task ServiceTransitionRejectsUnknownJsonMembersBeforeStore()
    {
        var state = new ExecutionState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        const string json = """
            {
              "targetStatus":"InProgress",
              "executedQuantity":null,
              "accountId":"40000000-0000-7000-8000-000000000099"
            }
            """;
        using var request = CreateServiceTransitionRequest(json: json);

        using var response = await client.SendAsync(
            request,
            TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        AssertPrivateResponse(response);
        Assert.Null(state.ServiceTransitionRequest);
    }

    [Fact]
    public async Task OpenApiPublishesAuthenticatedStrictRampExecutionContract()
    {
        using var client = factory.CreateClient();

        using var response = await client.GetAsync(
            "/swagger/v1/swagger.json",
            TestContext.Current.CancellationToken);
        response.EnsureSuccessStatusCode();
        var document = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        var paths = document.GetProperty("paths");

        var get = paths
            .GetProperty("/api/v1/ramp/operations/{operationId}/checklist")
            .GetProperty("get");
        Assert.Equal("GetRampOperationChecklist", get.GetProperty("operationId").GetString());
        AssertUuidParameters(get, "operationId");
        AssertResponses(get, "200", "400", "401", "403", "404", "409", "429", "500");
        AssertBearerSecurity(get);

        var submit = paths
            .GetProperty("/api/v1/ramp/operations/{operationId}/checklist/submit")
            .GetProperty("post");
        Assert.Equal("SubmitRampOperationChecklist", submit.GetProperty("operationId").GetString());
        Assert.True(submit.TryGetProperty("requestBody", out _));
        AssertUuidParameters(
            submit,
            "operationId",
            "X-Elevant-Installation-Id",
            "Idempotency-Key");
        AssertResponses(
            submit,
            "200", "400", "401", "403", "404", "409", "413", "415", "429", "500");
        AssertBearerSecurity(submit);

        var transition = paths
            .GetProperty("/api/v1/ramp/operations/{operationId}/services/{serviceId}/transition")
            .GetProperty("post");
        Assert.Equal("TransitionRampOperationService", transition.GetProperty("operationId").GetString());
        Assert.True(transition.TryGetProperty("requestBody", out _));
        AssertUuidParameters(
            transition,
            "operationId",
            "serviceId",
            "X-Elevant-Installation-Id",
            "Idempotency-Key");
        AssertResponses(
            transition,
            "200", "400", "401", "403", "404", "409", "413", "415", "429", "500");
        AssertBearerSecurity(transition);

        var schemas = document.GetProperty("components").GetProperty("schemas");
        Assert.Equal(
            "^(Ok|NotApplicable|NotOk)$",
            schemas.GetProperty("RampChecklistAnswerRequest")
                .GetProperty("properties")
                .GetProperty("value")
                .GetProperty("pattern")
                .GetString());
        Assert.Equal(
            "^(InProgress|Completed|NotPerformed|Exception)$",
            schemas.GetProperty("TransitionRampOperationServiceRequest")
                .GetProperty("properties")
                .GetProperty("targetStatus")
                .GetProperty("pattern")
                .GetString());

        var incidentGet = paths
            .GetProperty("/api/v1/ramp/operations/{operationId}/incidents")
            .GetProperty("get");
        Assert.Equal("GetRampIncidents", incidentGet.GetProperty("operationId").GetString());
        AssertUuidParameters(incidentGet, "operationId");
        AssertBearerSecurity(incidentGet);

        var incidentPost = paths
            .GetProperty("/api/v1/ramp/operations/{operationId}/incidents")
            .GetProperty("post");
        Assert.Equal("ReportRampIncident", incidentPost.GetProperty("operationId").GetString());
        AssertUuidParameters(incidentPost, "operationId", "X-Elevant-Installation-Id", "Idempotency-Key");
        AssertResponses(incidentPost, "200", "400", "401", "403", "404", "409", "413", "415", "429");
        AssertBearerSecurity(incidentPost);

        var handoff = paths
            .GetProperty("/api/v1/ramp/operations/{operationId}/submit")
            .GetProperty("post");
        Assert.Equal("SubmitRampOperation", handoff.GetProperty("operationId").GetString());
        AssertUuidParameters(handoff, "operationId", "X-Elevant-Installation-Id", "Idempotency-Key");
        AssertResponses(handoff, "200", "400", "401", "403", "404", "409", "413", "415", "429");
        AssertBearerSecurity(handoff);
    }

    [Fact]
    public async Task HandoffRequiresBearerAuthenticationAndIsNeverCached()
    {
        await using var application = CreateApplication(new ExecutionState());
        using var client = application.CreateClient();
        using var request = CreateHandoffRequest();
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponse(response);
    }

    [Fact]
    public async Task HandoffUsesServerOwnedScopeAndReturnsVersionedReceipt()
    {
        var now = new DateTimeOffset(2026, 9, 23, 12, 0, 0, TimeSpan.Zero);
        var state = new ExecutionState
        {
            Actor = CreateActor(),
            HandoffResult = RampOperationSubmissionWriteResult.Success(
                new RampOperationSubmissionData(
                    ReceiptId, OperationId, IdempotencyKey, ChecklistId,
                    1, "PendingReview", now, now, "OperaciÃ³n lista"), ReceiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateHandoffRequest();
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(HttpStatusCode.OK, response.StatusCode);
        AssertPrivateResponse(response);
        var body = await response.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(ReceiptId, body.GetProperty("receiptId").GetGuid());
        Assert.Equal(IdempotencyKey, body.GetProperty("submissionId").GetGuid());
        Assert.Equal(1, body.GetProperty("revisionNumber").GetInt32());
        Assert.Equal("PendingReview", body.GetProperty("status").GetString());
        Assert.Equal("OperaciÃ³n lista", state.HandoffRequest?.AgentNote);
        Assert.Equal([StationId], state.HandoffRequest?.AllowedStationIds);
        Assert.Equal(AccountId, state.HandoffRequest?.ActorAccountId);
        Assert.Equal(InstallationId, state.HandoffRequest?.InstallationId);
    }

    [Theory]
    [InlineData("{\"actorId\":\"40000000-0000-7000-8000-000000000002\"}")]
    [InlineData("{\"agentNote\":\"x\\u0000y\"}")]
    public async Task HandoffRejectsUnknownOrUnsafeBodyBeforeStore(string json)
    {
        var state = new ExecutionState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateHandoffRequest(json);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.HandoffRequest);
    }

    [Theory]
    [InlineData(null, "82000000-0000-7000-8000-000000000010")]
    [InlineData("81000000-0000-7000-8000-000000000001", null)]
    [InlineData("not-a-uuid", "82000000-0000-7000-8000-000000000010")]
    public async Task HandoffRequiresBothValidDeviceCommandHeaders(
        string? installationId, string? idempotencyKey)
    {
        var state = new ExecutionState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateHandoffRequest();
        request.Headers.Remove("X-Elevant-Installation-Id");
        request.Headers.Remove("Idempotency-Key");
        AddCommandHeaders(request, installationId, idempotencyKey);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.HandoffRequest);
    }

    [Fact]
    public async Task IncidentsRequireBearerAndAreNotCached()
    {
        await using var application = CreateApplication(new ExecutionState());
        using var client = application.CreateClient();
        using var response = await client.GetAsync(
            $"/api/v1/ramp/operations/{OperationId:D}/incidents",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.Unauthorized, response.StatusCode);
        AssertPrivateResponse(response);
    }

    [Fact]
    public async Task IncidentReadAndReportUseScopedActorAndMinimalReceipt()
    {
        var now = new DateTimeOffset(2026, 9, 23, 12, 0, 0, TimeSpan.Zero);
        var incidentId = Guid.Parse("82000000-0000-7000-8000-000000000010");
        var receiptId = Guid.Parse("83000000-0000-7000-8000-000000000010");
        var state = new ExecutionState
        {
            Actor = CreateActor(),
            IncidentReadResult = RampIncidentReadResult.Success([
                new RampIncidentData(incidentId, "Safety", "High", "Open", "Equipo inmovilizado", now, now)]),
            IncidentWriteResult = RampIncidentWriteResult.Success(
                new RampIncidentReceiptData(receiptId, OperationId, incidentId, "Open", now, now),
                receiptId),
        };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);

        using var read = await client.GetAsync(
            $"/api/v1/ramp/operations/{OperationId:D}/incidents",
            TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, read.StatusCode);
        AssertPrivateResponse(read);
        var readBody = await read.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal("Equipo inmovilizado", readBody.GetProperty("incidents")[0]
            .GetProperty("description").GetString());
        Assert.Equal([StationId], state.IncidentReadRequest!.AllowedStationIds);

        using var request = CreateIncidentRequest();
        using var report = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.OK, report.StatusCode);
        AssertPrivateResponse(report);
        var body = await report.Content.ReadFromJsonAsync<JsonElement>(
            TestContext.Current.CancellationToken);
        Assert.Equal(receiptId, body.GetProperty("receiptId").GetGuid());
        Assert.Equal(incidentId, body.GetProperty("incidentId").GetGuid());
        Assert.False(body.TryGetProperty("description", out _));
        Assert.Equal("Safety", state.IncidentWriteRequest!.IncidentType);
        Assert.Equal(IncidentSeverity.High, state.IncidentWriteRequest.Severity);
        Assert.Equal("Equipo inmovilizado", state.IncidentWriteRequest.Description);
        Assert.Equal(InstallationId, state.IncidentWriteRequest.InstallationId);
        Assert.Equal([StationId], state.IncidentWriteRequest.AllowedStationIds);
    }

    [Theory]
    [InlineData("\"reporterId\":\"40000000-0000-7000-8000-000000000002\",")]
    [InlineData("\"evidence\":[],")]
    public async Task IncidentReportRejectsUnknownMembersBeforeStore(string extra)
    {
        var state = new ExecutionState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateIncidentRequest($$"""
            { {{extra}}"incidentType":"Safety","severity":"High","description":"Equipo inmovilizado","occurredAt":"2026-09-23T12:00:00Z" }
            """);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.IncidentWriteRequest);
    }

    [Theory]
    [InlineData(null, "82000000-0000-7000-8000-000000000010")]
    [InlineData("81000000-0000-7000-8000-000000000001", null)]
    [InlineData("not-a-uuid", "82000000-0000-7000-8000-000000000010")]
    public async Task IncidentReportRequiresBothValidDeviceCommandHeaders(
        string? installationId,
        string? idempotencyKey)
    {
        var state = new ExecutionState { Actor = CreateActor() };
        await using var application = CreateApplication(state);
        using var client = CreateAuthenticatedClient(application);
        using var request = CreateIncidentRequest();
        request.Headers.Remove("X-Elevant-Installation-Id");
        request.Headers.Remove("Idempotency-Key");
        AddCommandHeaders(request, installationId, idempotencyKey);
        using var response = await client.SendAsync(request, TestContext.Current.CancellationToken);
        Assert.Equal(HttpStatusCode.BadRequest, response.StatusCode);
        Assert.Null(state.IncidentWriteRequest);
    }

    private static HttpRequestMessage CreateIncidentRequest(string? json = null)
    {
        json ??= """
            {"incidentType":"Safety","severity":"High","description":"Equipo inmovilizado","occurredAt":"2026-09-23T12:00:00Z"}
            """;
        var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/ramp/operations/{OperationId:D}/incidents")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        AddCommandHeaders(request, InstallationId.ToString("D"), IdempotencyKey.ToString("D"));
        return request;
    }

    private static HttpRequestMessage CreateHandoffRequest(string? json = null)
    {
        var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/ramp/operations/{OperationId:D}/submit")
        {
            Content = new StringContent(
                json ?? """{"agentNote":"OperaciÃ³n lista"}""",
                Encoding.UTF8,
                "application/json"),
        };
        AddCommandHeaders(request, InstallationId.ToString("D"), IdempotencyKey.ToString("D"));
        return request;
    }

    private WebApplicationFactory<Program> CreateApplication(ExecutionState state) =>
        factory.WithWebHostBuilder(builder => builder.ConfigureServices(services =>
        {
            services.RemoveAll<IActorContextResolver>();
            services.RemoveAll<IRampOperationChecklistReadStore>();
            services.RemoveAll<IRampOperationChecklistCommandStore>();
            services.RemoveAll<IRampOperationServiceCommandStore>();
            services.RemoveAll<IRampIncidentStore>();
            services.RemoveAll<IRampOperationSubmissionStore>();
            services.AddSingleton(state);
            services.AddScoped<IActorContextResolver>(_ => state);
            services.AddScoped<IRampOperationChecklistReadStore>(_ => state);
            services.AddScoped<IRampOperationChecklistCommandStore>(_ => state);
            services.AddScoped<IRampOperationServiceCommandStore>(_ => state);
            services.AddScoped<IRampIncidentStore>(_ => state);
            services.AddScoped<IRampOperationSubmissionStore>(_ => state);
            services.AddScoped<IRampOperationCorrectionStore>(_ => state);
        }));

    private static HttpClient CreateAuthenticatedClient(
        WebApplicationFactory<Program> application)
    {
        var client = application.CreateClient();
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue(
            "Bearer",
            CreateAccessToken());
        return client;
    }

    private static string CreateAccessToken()
    {
        var now = DateTimeOffset.UtcNow;
        var signingKey = new SymmetricSecurityKey(
            Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64));
        return new JsonWebTokenHandler().CreateToken(new SecurityTokenDescriptor
        {
            Audience = ElevantApiFactory.AuthenticationAudience,
            Expires = now.AddMinutes(15).UtcDateTime,
            IssuedAt = now.UtcDateTime,
            Issuer = ElevantApiFactory.AuthenticationIssuer,
            NotBefore = now.AddSeconds(-5).UtcDateTime,
            SigningCredentials = new SigningCredentials(
                signingKey,
                SecurityAlgorithms.HmacSha256),
            Subject = new System.Security.Claims.ClaimsIdentity(
            [
                new System.Security.Claims.Claim(
                    JwtRegisteredClaimNames.Sub,
                    AccountId.ToString("D")),
                new System.Security.Claims.Claim(
                    JwtRegisteredClaimNames.Jti,
                    Guid.NewGuid().ToString("D")),
                new System.Security.Claims.Claim(
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.ClaimType,
                    Elevant.Infrastructure.Authentication.SessionSecurityVersion.Fingerprint(ElevantApiFactory.TestSecurityStamp)),
            ]),
            TokenType = "at+jwt",
        });
    }

    private static HttpRequestMessage CreateChecklistSubmissionRequest(
        string? installationId = "81000000-0000-7000-8000-000000000001",
        string? idempotencyKey = "82000000-0000-7000-8000-000000000010",
        string? json = null)
    {
        json ??= $$"""
            {
              "checklistId":"{{ChecklistId:D}}",
              "answers":[{
                "itemId":"{{ChecklistItemId:D}}",
                "value":"NotOk",
                "note":"Daño visible"
              }]
            }
            """;
        var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/ramp/operations/{OperationId:D}/checklist/submit")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        AddCommandHeaders(request, installationId, idempotencyKey);
        return request;
    }

    private static HttpRequestMessage CreateServiceTransitionRequest(
        string? installationId = "81000000-0000-7000-8000-000000000001",
        string? idempotencyKey = "82000000-0000-7000-8000-000000000010",
        string? json = null)
    {
        json ??= """
            {
              "targetStatus":"Completed",
              "executedQuantity":1.5,
              "note":"Servicio completado"
            }
            """;
        var request = new HttpRequestMessage(
            HttpMethod.Post,
            $"/api/v1/ramp/operations/{OperationId:D}/services/{ServiceId:D}/transition")
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json"),
        };
        AddCommandHeaders(request, installationId, idempotencyKey);
        return request;
    }

    private static void AddCommandHeaders(
        HttpRequestMessage request,
        string? installationId,
        string? idempotencyKey)
    {
        if (installationId is not null)
        {
            request.Headers.TryAddWithoutValidation("X-Elevant-Installation-Id", installationId);
        }

        if (idempotencyKey is not null)
        {
            request.Headers.TryAddWithoutValidation("Idempotency-Key", idempotencyKey);
        }
    }

    private static ActorContext CreateActor() => new(
        AccountId,
        "ramp.agent@dev.elevant.test",
        "Riley Ramp",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000002"),
                "RAMP_AGENT",
                "Ramp Agent",
                PortalKind.RampMobileApp,
                "ramp_agent"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000002"),
                Guid.Parse("10000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM Development",
                OrganizationType.AviamOperator,
                MembershipKind.InternalStaff),
        ],
        [new ActorStationScope(StationId, "PUJ")]);

    private static void AssertPrivateResponse(HttpResponseMessage response)
    {
        Assert.Contains(
            "no-store",
            response.Headers.CacheControl?.ToString(),
            StringComparison.Ordinal);
        Assert.Contains("no-cache", response.Headers.Pragma.Select(value => value.Name));
    }

    private static void AssertUuidParameters(JsonElement operation, params string[] names)
    {
        var parameters = operation.GetProperty("parameters").EnumerateArray().ToArray();
        Assert.Equal(names.Length, parameters.Length);
        foreach (var name in names)
        {
            var parameter = Assert.Single(parameters, item =>
                string.Equals(item.GetProperty("name").GetString(), name, StringComparison.Ordinal));
            Assert.True(parameter.GetProperty("required").GetBoolean());
            Assert.Equal("uuid", parameter.GetProperty("schema").GetProperty("format").GetString());
        }
    }

    private static void AssertResponses(JsonElement operation, params string[] expected)
    {
        var responses = operation.GetProperty("responses");
        foreach (var statusCode in expected)
        {
            Assert.True(responses.TryGetProperty(statusCode, out _), statusCode);
        }
    }

    private static void AssertBearerSecurity(JsonElement operation)
    {
        var security = Assert.Single(operation.GetProperty("security").EnumerateArray());
        Assert.True(security.TryGetProperty("Bearer", out _));
    }

    private sealed class ExecutionState :
        IActorContextResolver,
        IRampOperationChecklistReadStore,
        IRampOperationChecklistCommandStore,
        IRampOperationServiceCommandStore,
        IRampIncidentStore,
        IRampOperationSubmissionStore,
        IRampOperationCorrectionStore
    {
        public ActorContext? Actor { get; init; }

        public RampOperationChecklistReadResult ChecklistReadResult { get; init; } =
            RampOperationChecklistReadResult.Failed(RampOperationChecklistReadFailure.NotFound);

        public RampChecklistSubmissionWriteResult ChecklistSubmissionResult { get; init; } =
            RampChecklistSubmissionWriteResult.Failed(
                RampChecklistSubmissionWriteFailure.Conflict);

        public RampOperationServiceTransitionWriteResult ServiceTransitionResult { get; init; } =
            RampOperationServiceTransitionWriteResult.Failed(
                RampOperationServiceTransitionWriteFailure.Conflict);

        public RampOperationChecklistReadRequest? ChecklistReadRequest { get; private set; }

        public RampChecklistSubmissionWriteRequest? ChecklistSubmissionRequest { get; private set; }

        public RampOperationServiceTransitionWriteRequest? ServiceTransitionRequest { get; private set; }

        public RampIncidentReadRequest? IncidentReadRequest { get; private set; }

        public RampIncidentWriteRequest? IncidentWriteRequest { get; private set; }

        public RampIncidentReadResult IncidentReadResult { get; init; } =
            RampIncidentReadResult.Success([]);

        public RampIncidentWriteResult IncidentWriteResult { get; init; } =
            RampIncidentWriteResult.Failed(RampOperationsFailure.Conflict);

        public RampOperationSubmissionWriteRequest? HandoffRequest { get; private set; }

        public RampOperationSubmissionWriteResult HandoffResult { get; init; } =
            RampOperationSubmissionWriteResult.Failed(RampOperationsFailure.Conflict);

        public RampOperationCorrectionWriteRequest? CorrectionRequest { get; private set; }

        public RampOperationCorrectionWriteResult CorrectionResult { get; init; } =
            RampOperationCorrectionWriteResult.Failed(RampOperationsFailure.Conflict);

        public Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            return Task.FromResult(Actor);
        }

        public Task<RampOperationChecklistReadResult> GetChecklistAsync(
            RampOperationChecklistReadRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ChecklistReadRequest = request;
            return Task.FromResult(ChecklistReadResult);
        }

        public Task<RampChecklistSubmissionWriteResult> SubmitChecklistAsync(
            RampChecklistSubmissionWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ChecklistSubmissionRequest = request;
            return Task.FromResult(ChecklistSubmissionResult);
        }

        public Task<RampOperationServiceTransitionWriteResult> TransitionServiceAsync(
            RampOperationServiceTransitionWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            ServiceTransitionRequest = request;
            return Task.FromResult(ServiceTransitionResult);
        }

        public Task<RampIncidentReadResult> GetAsync(
            RampIncidentReadRequest request,
            CancellationToken cancellationToken = default)
        {
            IncidentReadRequest = request;
            return Task.FromResult(IncidentReadResult);
        }

        public Task<RampIncidentWriteResult> ReportAsync(
            RampIncidentWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            IncidentWriteRequest = request;
            return Task.FromResult(IncidentWriteResult);
        }

        public Task<RampOperationSubmissionWriteResult> SubmitAsync(
            RampOperationSubmissionWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            HandoffRequest = request;
            return Task.FromResult(HandoffResult);
        }

        public Task<RampOperationCorrectionWriteResult> ReopenAsync(
            RampOperationCorrectionWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            CorrectionRequest = request;
            return Task.FromResult(CorrectionResult);
        }

    }
}
