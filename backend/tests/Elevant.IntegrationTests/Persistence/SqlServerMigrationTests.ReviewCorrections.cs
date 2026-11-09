using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Finance;
using Elevant.Application.Operations;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Operations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 3, block D: OCC approves and Finance bills exactly the Service Order the airline and AVIAM signed, or OCC's
/// recorded correction of it (3-N02); a service in exception is billed by its quantity unless OCC excludes it (3-N11);
/// a charge the contract excludes is never added nor valued at zero (3-N29); and an approval nothing was invoiced from
/// is reopened as a new revision without undoing the release of its agent and stand (3-H).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string OccReviewCorrectionsMigration =
        "20261108043225_AddOccIncidentsReviewReopenAndServiceOrderCorrections";

    private sealed record ReviewOperationState(long OperationId, long TurnaroundId, long AgentId, long[] ServiceIds,
        Guid[] ServicePublicIds, long ContractVersionId);

    [Fact]
    public async Task OccApprovesOnlyTheSignedServiceOrderAndRecordsItsCorrections()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await TimingProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var installation = await RegisterTimingTabletAsync(provider, "81000000-0000-7000-8000-0000000000d1", ct);
        // A night operation: block-on 23:10 station time; the GPU worked 2 hours with a failure (exception).
        var blockOn = new DateTimeOffset(2026, 8, 18, 23, 10, 0, TimeSpan.FromHours(-4)).ToUniversalTime();
        ReviewOperationState state;
        await using (var setup = CreateContext(database.ConnectionString))
            state = await PrepareReviewOperationAsync(setup, blockOn, 2m, ct);
        Task<int> VersionCountAsync() => Run(services => services.GetRequiredService<ElevantDbContext>()
            .Set<OperationDocumentVersion>().CountAsync(item => item.GroundOperationId == state.OperationId &&
                item.Kind == OperationDocumentKind.ServiceOrder, ct));

        // 1. Before the hand-off the Service Order already shows the night surcharge on both services, the one in
        // exception included (3-N11); nothing is marked yet (3-N02).
        var projected = (await Run(services => services.GetRequiredService<IOperationDocumentStore>()
                .ReadForAgentAsync(TimingAgent, [TimingStation], TimingOperation, ct)))!
            .Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder);
        Assert.Equal(2, projected.Content.Surcharges.Count(item => item.Code == AutomaticSurchargeCodes.Night));
        Assert.Equal(2m, projected.Content.Services[1].Quantity);
        Assert.Equal(20m, projected.Content.Services[1].Amount);
        await using (var check = CreateContext(database.ConnectionString))
            Assert.False(await check.OperationServiceCharges.AnyAsync(mark => state.ServiceIds.Contains(mark.OperationServiceId), ct));

        // 2. Signed on the ramp, then handed off: the hand-off marks the same surcharges, so OCC reviews what was signed.
        await SignServiceOrderAsync(provider, TimingAgent, TimingStation, TimingOperation, installation, ct);
        var handOffKey = Guid.NewGuid();
        var handedOff = await Run(services => services.GetRequiredService<IRampOperationSubmissionStore>().SubmitAsync(
            new RampOperationSubmissionWriteRequest(TimingAgent, [TimingStation], TimingOperation, installation, handOffKey,
                null, Guid.NewGuid(), "review-handoff"), ct));
        Assert.True(handedOff.IsSuccess, handedOff.Failure?.ToString());
        Task<OccReviewDetailData> DetailAsync() => Run(async services =>
            (await services.GetRequiredService<IOccReviewStore>().GetDetailAsync(TimingOperation, [TimingStation], ct))!);
        var detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.FullySigned, detail.ServiceOrderState);
        Assert.Equal(1, await VersionCountAsync());
        Task<OccReviewDecisionWriteResult> Decide(string token, string outcome, string? reason, Guid? key) =>
            Run(services => services.GetRequiredService<IOccReviewStore>().DecideAsync(new OccReviewDecisionWriteRequest(
                TimingOcc, [TimingStation], TimingOperation, handOffKey, token, outcome, reason, Guid.NewGuid(),
                "review-decide", key), ct));

        // 3. A billable datum captured before the hand-off arrives late: the signed order is stale and OCC cannot
        // approve it; the tablet signs the new content.
        Assert.True((await Run(services => services.GetRequiredService<IRampExecutionCommandStore>().UpdateFlightDataAsync(
            new RampFlightDataWriteRequest(TimingAgent, [TimingStation], TimingOperation, 151, 147, 77_500, null,
                installation, Guid.NewGuid(), "review-late"), ct))).IsSuccess);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.Stale, detail.ServiceOrderState);
        var stale = await Decide(detail.ConcurrencyToken, "Approved", null, Guid.NewGuid());
        Assert.Equal((OccReviewFailure.Conflict, "service_order_stale"), (stale.Failure, stale.Code));
        await SignServiceOrderAsync(provider, TimingAgent, TimingStation, TimingOperation, installation, ct);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.FullySigned, detail.ServiceOrderState);
        Assert.Equal(2, await VersionCountAsync());

        // 4. OCC adds a charge after the signature: the order becomes OCC's correction of the signed one, with its reason.
        var adminFee = detail.Close!.ChargeOptions.Single(option => option.Code == "ADMIN-FEE");
        var firstService = state.ServicePublicIds[0];
        Task<OccReviewChargeAdjustResult> Adjust(string token, Guid? serviceId, Guid? chargeId, Guid? markId,
            string reason, Guid? key) =>
            Run(services => services.GetRequiredService<IOccReviewStore>().AdjustChargeAsync(new OccReviewChargeAdjustRequest(
                TimingOcc, [TimingStation], TimingOperation, handOffKey, token, serviceId, chargeId, markId, reason,
                Guid.NewGuid(), "review-adjust", key), ct));
        var addKey = Guid.NewGuid();
        var added = await Adjust(detail.ConcurrencyToken, firstService, adminFee.ChargeId, null,
            "Cargo administrativo acordado", addKey);
        Assert.True(added.IsSuccess, added.Code);
        Assert.Equal(added.ConcurrencyToken, (await Adjust(detail.ConcurrencyToken, firstService, adminFee.ChargeId, null,
            "Cargo administrativo acordado", addKey)).ConcurrencyToken);
        Assert.Equal("idempotency_conflict", (await Adjust(detail.ConcurrencyToken, firstService, adminFee.ChargeId, null,
            "Otro motivo para el mismo envío", addKey)).Code);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.Corrected, detail.ServiceOrderState);
        Assert.Equal("charge_already_marked", (await Adjust(detail.ConcurrencyToken, firstService, adminFee.ChargeId, null,
            "Cargo administrativo repetido", null)).Code);
        long correctedId;
        await using (var check = CreateContext(database.ConnectionString))
        {
            var corrected = await check.Set<OperationDocumentVersion>().AsNoTracking()
                .SingleAsync(item => item.GroundOperationId == state.OperationId && item.CorrectsVersionId != null, ct);
            correctedId = corrected.Id;
            Assert.Equal("Cargo administrativo acordado", corrected.CorrectionReason);
            Assert.NotNull(corrected.CorrectedAt);
            Assert.NotNull(corrected.CorrectedByAccountId);
            Assert.False(await check.Set<OperationDocumentSignature>().AnyAsync(item =>
                item.OperationDocumentVersionId == corrected.Id, ct));
        }

        // 5. Taking it back returns to the signed order without a new version; adding it again reuses the correction.
        var occMark = detail.Close!.Charges.Single(charge => charge.Source == "Occ");
        var removed = await Adjust(detail.ConcurrencyToken, null, null, occMark.MarkId, "Se cobra en otra factura", null);
        Assert.True(removed.IsSuccess, removed.Code);
        Assert.Equal("charge_already_removed", (await Adjust(removed.ConcurrencyToken!, null, null, occMark.MarkId,
            "Se cobra en otra factura", null)).Code);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.FullySigned, detail.ServiceOrderState);
        Assert.True((await Adjust(detail.ConcurrencyToken, firstService, adminFee.ChargeId, null,
            "Cargo administrativo acordado", null)).IsSuccess);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.Corrected, detail.ServiceOrderState);
        Assert.Equal(3, await VersionCountAsync());

        // 6. The airline sees the corrected order with the signatures it drew and OCC's correction; so does OCC's copy.
        Guid organization;
        await using (var check = CreateContext(database.ConnectionString))
            organization = await (from turnaround in check.Turnarounds
                                  join airline in check.Airlines on turnaround.AirlineId equals airline.Id
                                  join item in check.Organizations on airline.OrganizationId equals item.Id
                                  where turnaround.Id == state.TurnaroundId
                                  select item.PublicId).SingleAsync(ct);
        var portal = (await Run(services => services.GetRequiredService<IOperationDocumentStore>()
            .ReadSignedServiceOrderForAirlineAsync(organization, TimingOperation, ct)))!;
        Assert.Equal(2, portal.Signatures.Count);
        Assert.Equal("Cargo administrativo acordado", Assert.Single(portal.Corrections!).Reason);
        Assert.Contains(portal.Content.Surcharges, item => item.Code == "ADMIN-FEE");
        var occCopy = await Run(services => services.GetRequiredService<IOperationDocumentStore>()
            .ReadCorrectedServiceOrderForOccAsync([TimingStation], TimingOperation, ct));
        Assert.Equal(portal.ContentSha256, occCopy!.ContentSha256);
        var pdf = new OperationDocumentPdfRenderer().Render(portal.Content, portal.ContentSha256, portal.Signatures,
            new Dictionary<Guid, DamagePhoto>(), portal.Corrections);
        Assert.Equal("%PDF"u8.ToArray(), pdf[..4]);

        // 7. Approved with its Idempotency-Key: a retry replays the decision, the key with another body is refused,
        // and the approved evidence keeps OCC's charge and the night surcharge of the service in exception.
        var decideKey = Guid.NewGuid();
        var approved = await Decide(detail.ConcurrencyToken, "Approved", null, decideKey);
        Assert.True(approved.IsSuccess, approved.Code);
        var replay = await Decide(detail.ConcurrencyToken, "Approved", null, decideKey);
        Assert.Equal((approved.Decision!.DecidedAt, approved.CommitAuditId), (replay.Decision!.DecidedAt, replay.CommitAuditId));
        Assert.Equal("idempotency_conflict", (await Decide(detail.ConcurrencyToken, "Returned",
            "Corregir el servicio de equipaje", decideKey)).Code);
        var late = await Decide(detail.ConcurrencyToken, "Approved", null, Guid.NewGuid());
        Assert.Equal((OccReviewFailure.PreconditionFailed, "version_conflict"), (late.Failure, late.Code));
        await using (var check = CreateContext(database.ConnectionString))
        {
            var decision = await check.ReviewDecisions.AsNoTracking().SingleAsync(item =>
                item.PublicId == approved.CommitAuditId, ct);
            Assert.Contains("ADMIN-FEE", decision.ApprovedEvidenceJson!, StringComparison.Ordinal);
            Assert.Equal(2, await check.OperationServiceCharges.CountAsync(mark =>
                state.ServiceIds.Contains(mark.OperationServiceId) && mark.RemovedAt == null &&
                check.ChargeDefinitions.Any(charge => charge.Id == mark.ChargeDefinitionId && charge.Code == "NIGHT"), ct));
            Assert.Equal(correctedId, await check.Set<OperationDocumentVersion>().AsNoTracking()
                .Where(item => item.GroundOperationId == state.OperationId && item.CorrectsVersionId != null)
                .Select(item => item.Id).SingleAsync(ct));
        }
        Assert.Equal(ServiceOrderStates.Corrected, (await DetailAsync()).ServiceOrderState);

        // 8. 3-H with 3-N02: a reopened revision is approved again only on a signed order and never goes back to the
        // ramp, so an approval whose Service Order no longer matches what was signed stays approved: no revision.
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var service = await setup.OperationServices.SingleAsync(item => item.Id == state.ServiceIds[0], ct);
            service.ExecutedQuantity += 1;
            service.UpdatedAt = DateTimeOffset.UtcNow;
            await setup.SaveChangesAsync(ct);
        }
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.Stale, detail.ServiceOrderState);
        var refusedReopen = await Run(services => services.GetRequiredService<IOccReviewStore>().ReopenAsync(
            new OccReviewReopenRequest(TimingOcc, [TimingStation], TimingOperation, handOffKey, detail.ConcurrencyToken,
                "La aerolínea disputa la Orden de Servicio", Guid.NewGuid(), Guid.NewGuid(), "reopen-stale"), ct));
        Assert.Equal((OccReviewFailure.Conflict, "service_order_stale"), (refusedReopen.Failure, refusedReopen.Code));
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.Equal(1, await check.OperationSubmissions.CountAsync(item => item.GroundOperationId == state.OperationId,
                ct));
            Assert.Equal(GroundOperationStatus.Approved, (await check.GroundOperations.AsNoTracking()
                .SingleAsync(item => item.Id == state.OperationId, ct)).CurrentStatus);
        }
    }

    [Fact]
    public async Task TheReviewExcludesWhatIsNotBilledAndReopensAnApprovalNothingWasInvoicedFrom()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await TimingProviderAsync(database, ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var installation = await RegisterTimingTabletAsync(provider, "81000000-0000-7000-8000-0000000000d2", ct);
        // A day operation (no automatic surcharge): the GPU worked 2 units with a failure (exception). The contract
        // excludes the administrative charge, and the agent marked it on the first service before that rule existed.
        var blockOn = new DateTimeOffset(2026, 8, 18, 12, 10, 0, TimeSpan.FromHours(-4)).ToUniversalTime();
        ReviewOperationState state;
        Guid adminFee;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            state = await PrepareReviewOperationAsync(setup, blockOn, 2m, ct);
            var charge = await setup.ChargeDefinitions.SingleAsync(item => item.Code == "ADMIN-FEE", ct);
            adminFee = charge.PublicId;
            setup.Add(new ContractChargeRate
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = state.ContractVersionId, ChargeDefinitionId = charge.Id,
                IsExcluded = true, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
            setup.OperationServiceCharges.Add(new OperationServiceCharge
            {
                PublicId = Guid.CreateVersion7(), OperationServiceId = state.ServiceIds[0], ChargeDefinitionId = charge.Id,
                Source = ChargeMarkSource.Agent, AppliedByRampAgentId = state.AgentId, AppliedAt = blockOn.AddMinutes(20),
                CreatedAt = blockOn.AddMinutes(20), UpdatedAt = blockOn.AddMinutes(20),
            });
            await setup.SaveChangesAsync(ct);
        }
        var handOffKey = Guid.NewGuid();
        Assert.True((await Run(services => services.GetRequiredService<IRampOperationSubmissionStore>().SubmitAsync(
            new RampOperationSubmissionWriteRequest(TimingAgent, [TimingStation], TimingOperation, installation, handOffKey,
                null, Guid.NewGuid(), "exclusion-handoff"), ct))).IsSuccess);
        Task<OccReviewDetailData> DetailAsync() => Run(async services =>
            (await services.GetRequiredService<IOccReviewStore>().GetDetailAsync(TimingOperation, [TimingStation], ct))!);
        Task<OccReviewDecisionWriteResult> Decide(Guid submissionId, string token, string outcome, string? reason = null) =>
            Run(services => services.GetRequiredService<IOccReviewStore>().DecideAsync(new OccReviewDecisionWriteRequest(
                TimingOcc, [TimingStation], TimingOperation, submissionId, token, outcome, reason, Guid.NewGuid(),
                "exclusion-decide", Guid.NewGuid()), ct));
        Task<OccReviewChargeAdjustResult> Exclude(Guid submissionId, string token, Guid serviceId, bool excluded,
            string reason, Guid key) =>
            Run(services => services.GetRequiredService<IOccReviewStore>().SetServiceBillingExclusionAsync(
                new OccReviewBillingExclusionRequest(TimingOcc, [TimingStation], TimingOperation, serviceId, submissionId,
                    token, excluded, reason, key, Guid.NewGuid(), "exclusion-test"), ct));

        // 1. Nobody signed the Service Order yet: OCC cannot approve it.
        var detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.NeverSigned, detail.ServiceOrderState);
        var unsigned = await Decide(handOffKey, detail.ConcurrencyToken, "Approved");
        Assert.Equal((OccReviewFailure.Conflict, "service_order_unsigned"), (unsigned.Failure, unsigned.Code));
        await SignServiceOrderAsync(provider, TimingAgent, TimingStation, TimingOperation, installation, ct);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.FullySigned, detail.ServiceOrderState);

        // 2. 3-N29: OCC is never offered what the contract excludes, and the command refuses it.
        Assert.DoesNotContain(detail.Close!.ChargeOptions, option => option.Code == "ADMIN-FEE");
        var excludedCharge = await Run(services => services.GetRequiredService<IOccReviewStore>().AdjustChargeAsync(
            new OccReviewChargeAdjustRequest(TimingOcc, [TimingStation], TimingOperation, handOffKey, detail.ConcurrencyToken,
                state.ServicePublicIds[1], adminFee, null, "Cargo administrativo acordado", Guid.NewGuid(), "excluded", null),
            ct));
        Assert.Equal((OccReviewFailure.Conflict, "charge_excluded_by_contract"), (excludedCharge.Failure, excludedCharge.Code));

        // 3. 3-N11: only the service in exception with its quantity is excluded from billing, with a reason.
        var completed = await Exclude(handOffKey, detail.ConcurrencyToken, state.ServicePublicIds[0], true,
            "No corresponde cobrarlo", Guid.NewGuid());
        Assert.Equal((OccReviewFailure.Conflict, "billing_exclusion_not_allowed"), (completed.Failure, completed.Code));
        var exclusionKey = Guid.NewGuid();
        var excluded = await Exclude(handOffKey, detail.ConcurrencyToken, state.ServicePublicIds[1], true,
            "La GPU falló y la aerolínea no la acepta", exclusionKey);
        Assert.True(excluded.IsSuccess, excluded.Code);
        Assert.Equal(excluded.ConcurrencyToken, (await Exclude(handOffKey, detail.ConcurrencyToken, state.ServicePublicIds[1],
            true, "La GPU falló y la aerolínea no la acepta", exclusionKey)).ConcurrencyToken);
        Assert.Equal("idempotency_conflict", (await Exclude(handOffKey, detail.ConcurrencyToken, state.ServicePublicIds[1],
            true, "Otro motivo para el mismo envío", exclusionKey)).Code);
        detail = await DetailAsync();
        var exclusion = Assert.Single(detail.Close!.BillingExclusions!);
        Assert.Equal((state.ServicePublicIds[1], "La GPU falló y la aerolínea no la acepta"), (exclusion.ServiceId, exclusion.Reason));
        Assert.Equal(ServiceOrderStates.Corrected, detail.ServiceOrderState);
        var order = (await Run(services => services.GetRequiredService<IOperationDocumentStore>()
                .ReadForOccAsync([TimingStation], TimingOperation, ct)))!
            .Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder).Content;
        Assert.Equal(0m, order.Services[1].Amount);
        Assert.EndsWith(OperationDocumentAssembler.ExcludedLineSuffix, order.Services[1].Name, StringComparison.Ordinal);
        Assert.Equal(order.Services[0].Amount, order.TotalAmount);
        // Included again it is the signed order; excluded again it reuses OCC's correction.
        Assert.True((await Exclude(handOffKey, detail.ConcurrencyToken, state.ServicePublicIds[1], false,
            "Se revisó con la aerolínea", Guid.NewGuid())).IsSuccess);
        detail = await DetailAsync();
        Assert.Empty(detail.Close!.BillingExclusions!);
        Assert.Equal(ServiceOrderStates.FullySigned, detail.ServiceOrderState);
        Assert.True((await Exclude(handOffKey, detail.ConcurrencyToken, state.ServicePublicIds[1], true,
            "La GPU falló y la aerolínea no la acepta", Guid.NewGuid())).IsSuccess);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.Corrected, detail.ServiceOrderState);

        // 4. 3-G: an incident still open is resolved by the approval; the one OCC resolved keeps its note and author.
        Guid tabletIncident;
        await using (var setup = CreateContext(database.ConnectionString))
        {
            var incident = new Incident
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = state.OperationId, ReportedByRampAgentId = state.AgentId,
                IncidentType = "Equipment", Severity = IncidentSeverity.Medium, Status = IncidentStatus.Open,
                Description = "La GPU se apagó durante el servicio", OccurredAt = blockOn.AddMinutes(30),
                ReportedAt = blockOn.AddMinutes(31), CreatedAt = blockOn.AddMinutes(31), UpdatedAt = blockOn.AddMinutes(31),
            };
            setup.Incidents.Add(incident);
            await setup.SaveChangesAsync(ct);
            tabletIncident = incident.PublicId;
        }
        var reported = await Run(services => services.GetRequiredService<IOccIncidentStore>().ReportAsync(TimingOcc,
            TimingOperation, new OccIncidentReportInput("Operational", "Low", "Demora en la entrega del equipaje",
                blockOn.AddMinutes(40), null), Guid.NewGuid(), ct));
        Assert.Null(reported.Failure);
        var occIncident = reported.Value!.Id;
        var resolved = await Run(services => services.GetRequiredService<IOccIncidentStore>().ChangeStatusAsync(TimingOcc,
            occIncident, new OccIncidentStatusInput("Resolved", "Resuelta con la aerolínea", reported.Value.Version),
            Guid.NewGuid(), ct));
        Assert.Null(resolved.Failure);

        // 5. Approved: Finance blocks the excluded service and the one with the excluded charge, and the e-CF says why.
        detail = await DetailAsync();
        var approved = await Decide(handOffKey, detail.ConcurrencyToken, "Approved");
        Assert.True(approved.IsSuccess, approved.Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var incidents = await check.Incidents.AsNoTracking().Where(item => item.GroundOperationId == state.OperationId)
                .ToDictionaryAsync(item => item.PublicId, ct);
            Assert.Equal((IncidentStatus.Resolved, EfOccReviewStore.ApprovalResolutionNote),
                (incidents[tabletIncident].Status, incidents[tabletIncident].ResolutionNote));
            Assert.Equal((IncidentStatus.Resolved, "Resuelta con la aerolínea"),
                (incidents[occIncident].Status, incidents[occIncident].ResolutionNote));
            var tabletEvent = await check.Set<IncidentStatusEvent>().AsNoTracking().SingleAsync(item =>
                item.IncidentId == incidents[tabletIncident].Id, ct);
            Assert.Equal((IncidentStatus.Open, IncidentStatus.Resolved), (tabletEvent.FromStatus!.Value, tabletEvent.ToStatus));
            Assert.Equal(2, await check.Set<IncidentStatusEvent>().CountAsync(item =>
                item.IncidentId == incidents[occIncident].Id, ct));
        }
        // 4-A: «Por facturar» reads the pending operations (the approved-services read left with the preinvoice). A
        // service OCC excluded is not billable, so it is not listed; the one with the excluded charge is, blocked.
        async Task<IReadOnlyList<FinancePendingServiceData>> ToInvoiceAsync() =>
            (await Run(services => services.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
                new GetFinancePendingOperationsQuery(FinanceAccount, TimingStation, new DateOnly(2026, 8, 18),
                    new DateOnly(2026, 8, 18), null, null), ct)))!
            .Operations.Where(item => item.OperationId == TimingOperation).SelectMany(item => item.Services).ToArray();
        var blocked = await ToInvoiceAsync();
        Assert.Equal([(state.ServicePublicIds[0], false, "charge_excluded_by_contract")],
            blocked.Select(item => (item.ServiceId, item.Ready, item.BlockingReason)).ToArray());
        Task<IssueInvoiceResult> IssueAsync() => Run(services => Handler(services).HandleAsync(
            new IssueInvoiceRequest(FinanceAccount, TimingStation, [TimingOperation], Guid.NewGuid()), ct));
        var refused = await IssueAsync();
        Assert.Equal((IssueInvoiceFailure.Unprocessable, "charge_excluded_by_contract"), (refused.Failure!.Value, refused.Reason));

        // 6. 3-H: OCC reopens the approval nothing was invoiced from, with its key, version and reason.
        detail = await DetailAsync();
        Task<OccReviewReopenResult> Reopen(string token, string reason, Guid key, Guid? account = null,
            Guid? submission = null) =>
            Run(services => services.GetRequiredService<IOccReviewStore>().ReopenAsync(new OccReviewReopenRequest(
                account ?? TimingOcc, [TimingStation], TimingOperation, submission ?? handOffKey, token, reason, key,
                Guid.NewGuid(), "reopen-test"), ct));
        var staleReopen = await Reopen("\"" + new string('0', 64) + "\"", "Quitar el cargo que el contrato excluye",
            Guid.NewGuid());
        Assert.Equal((OccReviewFailure.PreconditionFailed, "version_conflict"), (staleReopen.Failure, staleReopen.Code));
        Assert.Equal(OccReviewFailure.NotFound,
            (await Reopen(detail.ConcurrencyToken, "Quitar el cargo que el contrato excluye", Guid.NewGuid(), TimingAgent)).Failure);
        var reopenKey = Guid.NewGuid();
        var reopened = await Reopen(detail.ConcurrencyToken, "Quitar el cargo que el contrato excluye", reopenKey);
        Assert.True(reopened.IsSuccess, reopened.Code);
        Assert.Equal((2, "PendingReview", false), (reopened.Data!.RevisionNumber, reopened.Data.Status, reopened.Replayed));
        var again = await Reopen(detail.ConcurrencyToken, "Quitar el cargo que el contrato excluye", reopenKey);
        Assert.Equal((reopened.Data.SubmissionId, true), (again.Data!.SubmissionId, again.Replayed));
        Assert.Equal("idempotency_conflict",
            (await Reopen(detail.ConcurrencyToken, "Otro motivo para la misma clave", reopenKey)).Code);
        Assert.Equal("review_not_approved", (await Reopen(reopened.Data.ReviewVersion,
            "Quitar el cargo que el contrato excluye", Guid.NewGuid(), submission: reopened.Data.SubmissionId)).Code);
        await using (var check = CreateContext(database.ConnectionString))
        {
            var revisions = await check.OperationSubmissions.AsNoTracking()
                .Where(item => item.GroundOperationId == state.OperationId).OrderBy(item => item.RevisionNumber)
                .ToArrayAsync(ct);
            Assert.Equal([(1, SubmissionStatus.Approved), (2, SubmissionStatus.PendingReview)],
                revisions.Select(item => (item.RevisionNumber, item.Status)).ToArray());
            Assert.Equal((revisions[0].SubmittedAt, revisions[0].SubmittedByRampAgentId, revisions[0].EvidenceJson,
                    revisions[0].OperationChecklistId, revisions[0].Id),
                (revisions[1].SubmittedAt, revisions[1].SubmittedByRampAgentId, revisions[1].EvidenceJson,
                    revisions[1].OperationChecklistId, revisions[1].ReopenedFromSubmissionId!.Value));
            Assert.Equal("Quitar el cargo que el contrato excluye", revisions[1].ReopenReason);
            Assert.True(await check.ReviewDecisions.AnyAsync(item => item.OperationSubmissionId == revisions[0].Id &&
                item.Outcome == ReviewOutcome.Approved, ct));
            var operation = await check.GroundOperations.AsNoTracking().SingleAsync(item => item.Id == state.OperationId, ct);
            Assert.Equal(GroundOperationStatus.PendingReview, operation.CurrentStatus);
            // The release of block B stands: the turnaround stays completed and the assignment stays of record.
            Assert.Equal(TurnaroundStatus.Completed, (await check.Turnarounds.AsNoTracking()
                .SingleAsync(item => item.Id == state.TurnaroundId, ct)).CurrentStatus);
            Assert.True(await check.OperationAgentAssignments.AnyAsync(item => item.GroundOperationId == state.OperationId &&
                item.ReleasedAt == null, ct));
            Assert.True(await check.Set<GroundOperationStatusEvent>().AnyAsync(item =>
                item.GroundOperationId == state.OperationId && item.FromStatus == GroundOperationStatus.Approved &&
                item.ToStatus == GroundOperationStatus.PendingReview, ct));
            Assert.Equal(1, await check.AuditEntries.CountAsync(item => item.Action == "occ.operation.review.reopened", ct));
        }
        Assert.Empty(await ToInvoiceAsync());
        detail = await DetailAsync();
        Assert.Equal(("Quitar el cargo que el contrato excluye", 1),
            (detail.Reopening!.Reason, detail.Reopening.FromRevisionNumber));
        Assert.True(detail.Close!.CanAdjustCharges);
        var returned = await Decide(reopened.Data.SubmissionId, detail.ConcurrencyToken, "Returned",
            "Corregir el servicio de equipaje");
        Assert.Equal((OccReviewFailure.Conflict, "reopened_review_cannot_return"), (returned.Failure, returned.Code));

        // 7. OCC removes the charge the contract excludes and approves again: Finance bills the completed service only.
        var agentMark = detail.Close.Charges.Single(charge => charge.Code == "ADMIN-FEE");
        var removed = await Run(services => services.GetRequiredService<IOccReviewStore>().AdjustChargeAsync(
            new OccReviewChargeAdjustRequest(TimingOcc, [TimingStation], TimingOperation, reopened.Data.SubmissionId,
                detail.ConcurrencyToken, null, null, agentMark.MarkId, "El contrato excluye el cargo", Guid.NewGuid(),
                "reopen-adjust", Guid.NewGuid()), ct));
        Assert.True(removed.IsSuccess, removed.Code);
        detail = await DetailAsync();
        Assert.Equal(ServiceOrderStates.Corrected, detail.ServiceOrderState);
        Assert.True((await Decide(reopened.Data.SubmissionId, detail.ConcurrencyToken, "Approved")).IsSuccess);
        var billable = await ToInvoiceAsync();
        Assert.Equal([(state.ServicePublicIds[0], true, (string?)null)],
            billable.Select(item => (item.ServiceId, item.Ready, item.BlockingReason)).ToArray());
        var issued = await IssueAsync();
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.Equal([state.ServiceIds[0]], await check.PreinvoiceLines.AsNoTracking()
                .Where(line => line.Kind == PreinvoiceLineKind.Service && line.OperationServiceId != null &&
                    state.ServiceIds.Contains(line.OperationServiceId.Value))
                .Select(line => line.OperationServiceId!.Value).ToArrayAsync(ct));
            Assert.Equal(1, await check.Set<TurnaroundStatusEvent>().CountAsync(item =>
                item.TurnaroundId == state.TurnaroundId && item.ToStatus == TurnaroundStatus.Completed, ct));
        }

        // 8. Once invoiced, the correction is a credit note.
        detail = await DetailAsync();
        Assert.Equal("already_invoiced", (await Reopen(detail.ConcurrencyToken, "Revisar otra vez la operación",
            Guid.NewGuid(), submission: reopened.Data.SubmissionId)).Code);
    }

    /// <summary>
    /// The migration of block D: without its history the downgrade is clean and the upgrade restores it; with an
    /// incident's history or a reopened review it refuses to drop them.
    /// </summary>
    [Fact]
    public async Task OccReviewCorrectionsMigrationRoundTripsAndKeepsItsHistory()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        (await SeededFinanceProviderAsync(database, ct)).Dispose();
        await using var context = CreateContext(database.ConnectionString);
        async Task<bool> ColumnAsync(string table, string column) =>
            await context.Database.SqlQuery<int>(
                $"SELECT COUNT(*) AS Value FROM sys.columns WHERE object_id = OBJECT_ID({table}) AND name = {column}")
                .SingleAsync(ct) == 1;
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, OccReviewCorrectionsMigration) - 1];
        Assert.True(await ColumnAsync("ops.operation_services", "billing_excluded_at"));

        await context.GetService<IMigrator>().MigrateAsync(previous, ct);
        Assert.False(await ColumnAsync("ops.operation_submissions", "reopened_from_submission_id"));
        Assert.False(await ColumnAsync("ops.incidents", "reported_by_account_id"));
        await context.GetService<IMigrator>().MigrateAsync(cancellationToken: ct);
        Assert.True(await ColumnAsync("ops.operation_document_versions", "corrects_version_id"));

        // An incident OCC reported has no agent: the downgrade stops instead of inventing one.
        var operation = await context.GroundOperations.AsNoTracking().Select(item => item.Id).FirstAsync(ct);
        var occ = await context.Users.Where(user => user.PublicId == TimingOcc).Select(user => user.Id).SingleAsync(ct);
        var now = DateTimeOffset.UtcNow;
        context.Incidents.Add(new Incident
        {
            PublicId = Guid.CreateVersion7(), GroundOperationId = operation, ReportedByAccountId = occ,
            IncidentType = "Operational", Severity = IncidentSeverity.Low, Status = IncidentStatus.Open,
            Description = "Reportada por OCC en la prueba", OccurredAt = now, ReportedAt = now, CreatedAt = now,
            UpdatedAt = now,
        });
        await context.SaveChangesAsync(ct);
        var failure = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52380, failure.Number);
        Assert.True(await ColumnAsync("ops.incidents", "reported_by_account_id"));
    }

    /// <summary>
    /// 3-N02: the airline's representative and the AVIAM agent sign the operation's current Service Order on the tablet
    /// (the roles that have not signed this content yet), as OCC approves only a signed order.
    /// </summary>
    private static async Task SignServiceOrderAsync(IServiceProvider provider, Guid agent, Guid station, Guid operationId,
        Guid installation, CancellationToken ct)
    {
        await using var scope = provider.CreateAsyncScope();
        var documents = scope.ServiceProvider.GetRequiredService<IOperationDocumentStore>();
        var order = (await documents.ReadForAgentAsync(agent, [station], operationId, ct))!
            .Documents.Single(item => item.Content.Kind == OperationDocumentKind.ServiceOrder);
        foreach (var role in order.RequiredRoles.Where(role => order.Signatures.All(signature => signature.Role != role)))
        {
            var signed = await documents.SignAsync(new OperationDocumentSignRequest(agent, [station], operationId,
                OperationDocumentKind.ServiceOrder, role,
                role == OperationSignatureRole.AirlineRepresentative ? "Ana Pérez" : "Riley Ramp", order.ContentSha256,
                [[0.1m, 0.5m, 0.4m, 0.2m, 0.7m, 0.6m]], DateTimeOffset.UtcNow, installation, Guid.NewGuid(),
                "service-order-sign"), ct);
            Assert.True(signed.IsSuccess, $"{signed.Failure} {signed.Code}");
        }
    }

    /// <summary>
    /// Riley's seeded operation at PUJ ready to hand off: started at <paramref name="blockOn"/> with block-on then and
    /// push-back an hour later, the arrival on time, both services priced from the base contract (BAGGAGE, 10 USD per
    /// minute) and finished, the second one in exception with <paramref name="exceptionQuantity"/>, and its execution
    /// checklist submitted.
    /// </summary>
    private static async Task<ReviewOperationState> PrepareReviewOperationAsync(ElevantDbContext setup,
        DateTimeOffset blockOn, decimal exceptionQuantity, CancellationToken ct)
    {
        var operation = await setup.GroundOperations.SingleAsync(item => item.PublicId == TimingOperation, ct);
        operation.CurrentStatus = GroundOperationStatus.InProgress;
        operation.ActualStartAt = blockOn;
        operation.ActualEndAt = null;
        var turnaround = await setup.Turnarounds.SingleAsync(item => item.Id == operation.TurnaroundId, ct);
        turnaround.CurrentStatus = TurnaroundStatus.InProgress;
        var agentId = await (from agent in setup.RampAgents
                             join account in setup.Users on agent.PersonId equals account.PersonId
                             where account.PublicId == TimingAgent
                             select agent.Id).SingleAsync(ct);
        var definition = await setup.ServiceDefinitions.SingleAsync(item => item.Code == "BAGGAGE", ct);
        var contract = await setup.Contracts.SingleAsync(item => item.ContractCode == "DEV-CONTRACT-0001", ct);
        var version = await setup.ContractVersions.SingleAsync(item => item.ContractId == contract.Id, ct);
        var rate = await setup.ContractServiceRates.SingleAsync(item => item.ContractVersionId == version.Id &&
            item.ServiceDefinitionId == definition.Id, ct);
        var services = await setup.OperationServices.Where(item => item.GroundOperationId == operation.Id)
            .OrderBy(item => item.LineNumber).ToArrayAsync(ct);
        for (var index = 0; index < services.Length; index++)
        {
            var service = services[index];
            var exception = index == 1;
            service.ServiceDefinitionId = definition.Id;
            service.ContractServiceRateId = rate.Id;
            service.CurrentStatus = exception ? ServiceExecutionStatus.Exception : ServiceExecutionStatus.Completed;
            service.ContractedQuantity = 1;
            service.ExecutedQuantity = exception ? exceptionQuantity : 1;
            service.UnitPriceSnapshot = 10;
            service.CurrencyCodeSnapshot = "USD";
            service.BillingUnitSnapshot = "minute";
            setup.Set<OperationServiceStatusEvent>().Add(new OperationServiceStatusEvent
            {
                OperationServiceId = service.Id, ToStatus = ServiceExecutionStatus.InProgress, OccurredAt = blockOn.AddMinutes(5),
            });
            setup.Set<OperationServiceStatusEvent>().Add(new OperationServiceStatusEvent
            {
                OperationServiceId = service.Id, FromStatus = ServiceExecutionStatus.InProgress,
                ToStatus = service.CurrentStatus, OccurredAt = blockOn.AddMinutes(35),
                Note = exception ? "La GPU falló a mitad del servicio." : null,
            });
        }
        foreach (var (code, at) in new[] { ("BLOCK_ON", blockOn), ("PUSHBACK", blockOn.AddMinutes(60)) })
            setup.Set<OperationMilestone>().Add(new OperationMilestone
            {
                PublicId = Guid.CreateVersion7(), GroundOperationId = operation.Id, Code = code, ActualAt = at,
                Status = MilestoneStatus.Actual, Source = OperationalDataSource.Manual,
                CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow,
            });
        var arrival = await setup.FlightLegs.SingleAsync(leg => leg.TurnaroundId == operation.TurnaroundId &&
            leg.Direction == FlightDirection.Arrival, ct);
        arrival.ScheduledAt = blockOn.AddMinutes(-10);
        arrival.ActualAt = blockOn.AddMinutes(-10);
        // Every execution checklist of the first round is submitted: the hand-off takes the latest template's.
        foreach (var checklist in await (from item in setup.OperationChecklists
                                         join templateVersion in setup.Set<ChecklistTemplateVersion>()
                                             on item.ChecklistTemplateVersionId equals templateVersion.Id
                                         join template in setup.Set<ChecklistTemplate>()
                                             on templateVersion.ChecklistTemplateId equals template.Id
                                         where item.GroundOperationId == operation.Id &&
                                               RampChecklists.Execution.Contains(template.Code) && item.RevisionNumber == 1
                                         select item).ToArrayAsync(ct))
        {
            checklist.Status = ChecklistStatus.Submitted;
            checklist.StartedAt = blockOn;
            checklist.SubmittedAt = blockOn.AddMinutes(55);
            checklist.SubmittedByRampAgentId = agentId;
        }
        await setup.SaveChangesAsync(ct);
        return new ReviewOperationState(operation.Id, turnaround.Id, agentId, services.Select(item => item.Id).ToArray(),
            services.Select(item => item.PublicId).ToArray(), version.Id);
    }
}
