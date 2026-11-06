using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Contratos' review of public requests (phase 1, block A): inbox, representative confirmation,
/// verification from the request, cancellation, idempotent and versioned decision, the rules that
/// keep one contract per airline (1-N01), airlines without IATA (1-N17) and proposed airlines (1-N25).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string CommercialReviewMigration = "20261106020045_AddCommercialRequestReviewAndIcaoOnlyAirlines";

    private static SubmitCommercialRequestCommand CommercialApplication(Guid requestId, Guid profileId, Guid serviceId,
        string email) => new(requestId, profileId, [serviceId], "Ana Rivera", "Gerente comercial", email,
        "+1 809 555 0142", true, RepresentativeDocumentType: "NationalId", RepresentativeDocumentNumber: "00112345673");

    [Fact]
    public async Task CommercialReviewConfirmsOnceApprovesOnceAndCancelsTheDuplicateWithItsReason()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
        var intake = new SubmitCommercialRequestHandler(scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>());
        var workflow = scope.ServiceProvider.GetRequiredService<ICommercialWorkflowStore>();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var profile = catalog.Airlines.First(item => !item.IsVerified);
        var service = catalog.Services[0].Id;
        var original = Guid.NewGuid();
        var duplicate = Guid.NewGuid();
        var rejected = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(CommercialApplication(original, profile.Id, service, "ana@carrier.example.com"), ct)).IsSuccess);
        Assert.True((await intake.HandleAsync(CommercialApplication(duplicate, profile.Id, service, "ana.r@carrier.example.com"), ct)).IsSuccess);
        Assert.True((await intake.HandleAsync(CommercialApplication(rejected, profile.Id, service, "otra@carrier.example.com"), ct)).IsSuccess);
        async Task<CommercialInboxRequestData> ItemAsync(Guid id) => (await workflow.ListInboxAsync(ContractsAdministrator,
                new CommercialInboxQuery(CommercialInboxQuery.All, null, 1, 50), ct))!
            .Requests.Single(item => item.Id == id);
        async Task<int> AuditsAsync(string action, Guid id) =>
            await context.AuditEntries.CountAsync(entry => entry.Action == action && entry.EntityPublicId == id, ct);

        // 1-N23: open requests first come, first served; search and paging run on the server.
        var inbox = (await workflow.ListInboxAsync(ContractsAdministrator,
            new CommercialInboxQuery(CommercialInboxQuery.Open, null, 1, 25), ct))!;
        Assert.Equal([original, duplicate, rejected], inbox.Requests.Select(item => item.Id));
        Assert.Equal((3, 3, 0), (inbox.Total, inbox.Counts.Pending, inbox.Counts.InReview));
        var second = (await workflow.ListInboxAsync(ContractsAdministrator,
            new CommercialInboxQuery(CommercialInboxQuery.Open, null, 2, 1), ct))!;
        Assert.Equal(duplicate, Assert.Single(second.Requests).Id);
        Assert.True(second.HasMore);
        Assert.Equal(duplicate, Assert.Single((await workflow.ListInboxAsync(ContractsAdministrator,
            new CommercialInboxQuery(CommercialInboxQuery.Open, "ana.r@", 1, 25), ct))!.Requests).Id);
        Assert.Null(await workflow.ListInboxAsync(PortalAirlineAccount,
            new CommercialInboxQuery(CommercialInboxQuery.Open, null, 1, 25), ct));
        Assert.All(inbox.Requests, item => Assert.Null(item.RepresentativeConfirmation));

        // 1-A, 1-N18: the confirmation is recorded once, replays its key and moves the request to review.
        var originalRow = await context.ServiceRequests.AsNoTracking().SingleAsync(item => item.PublicId == original, ct);
        var confirmKey = Guid.NewGuid();
        var confirmation = new ConfirmCommercialRepresentativeInput(inbox.Requests[0].Version,
            "Llamada a la central de la aerolínea: confirmó la gerencia comercial.");
        Assert.Equal("confirmation_note_required", (await workflow.ConfirmRepresentativeAsync(ContractsAdministrator,
            original, Guid.NewGuid(), confirmation with { Note = "ok" }, ct)).Code);
        Assert.Equal("idempotency_key_required", (await workflow.ConfirmRepresentativeAsync(ContractsAdministrator,
            original, Guid.Empty, confirmation, ct)).Code);
        Assert.Equal("expected_version_required", (await workflow.ConfirmRepresentativeAsync(ContractsAdministrator,
            original, Guid.NewGuid(), confirmation with { ExpectedVersion = " " }, ct)).Code);
        var confirmed = await workflow.ConfirmRepresentativeAsync(ContractsAdministrator, original, confirmKey, confirmation, ct);
        Assert.True(confirmed.IsSuccess, confirmed.Code);
        Assert.Equal(original, (await workflow.ConfirmRepresentativeAsync(ContractsAdministrator, original, confirmKey,
            confirmation, ct)).ResourceId);
        Assert.Equal("idempotency_conflict", (await workflow.ConfirmRepresentativeAsync(ContractsAdministrator,
            original, confirmKey, confirmation with { Note = "Otra forma de confirmación." }, ct)).Code);
        Assert.Equal("version_conflict", (await workflow.ConfirmRepresentativeAsync(ContractsAdministrator,
            original, Guid.NewGuid(), confirmation, ct)).Code);
        Assert.Equal("representative_already_confirmed", (await workflow.ConfirmRepresentativeAsync(ContractsAdministrator,
            original, Guid.NewGuid(), confirmation with { ExpectedVersion = (await ItemAsync(original)).Version }, ct)).Code);
        var reviewed = await ItemAsync(original);
        Assert.Equal("InReview", reviewed.Status);
        Assert.Equal(confirmation.Note, reviewed.RepresentativeConfirmation!.Note);
        Assert.False(string.IsNullOrWhiteSpace(reviewed.RepresentativeConfirmation.ConfirmedBy));
        Assert.Equal(1, await AuditsAsync("commercial.request.representative_confirmed", original));
        Assert.Equal(1, await context.Set<ServiceRequestStatusEvent>().CountAsync(item =>
            item.ServiceRequestId == originalRow.Id && item.ToStatus == CommercialRequestStatus.InReview, ct));

        // Verifying from the request needs the official identity; IATA is optional, ICAO is not.
        Assert.Equal("invalid_airline", (await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, original,
            Guid.NewGuid(), new VerifyRequestAirlineInput(reviewed.Version), ct)).Code);
        Assert.Equal("invalid_airline", (await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, original,
            Guid.NewGuid(), new VerifyRequestAirlineInput(reviewed.Version, null, "Carrier Test S.A.", "DO", "Q7", "QQ",
                "https://registry.example.test/q7"), ct)).Code);
        Assert.Equal("airline_already_linked", (await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, original,
            Guid.NewGuid(), new VerifyRequestAirlineInput(reviewed.Version, profile.Id), ct)).Code);
        var verified = await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, original, Guid.NewGuid(),
            new VerifyRequestAirlineInput(reviewed.Version, null, "Carrier Test S.A.", "do", "q7", "qqt",
                "https://registry.example.test/q7"), ct);
        Assert.True(verified.IsSuccess, verified.Code);
        var airlineVerified = await ItemAsync(original);
        Assert.True(airlineVerified.AirlineVerified);
        Assert.Equal(("Q7", "QQT", "DO"), (airlineVerified.IataCode, airlineVerified.IcaoCode, airlineVerified.CountryCode));

        // 1-D: the decision with a key and the version replays its contract; stale or keyless retries do not.
        var station = (await workflow.ListStationsAsync(ContractsAdministrator, ct))!.Single();
        var approval = new ReviewCommercialInput(true, null, [station.Id], airlineVerified.Version);
        Assert.Equal("expected_version_required", (await workflow.DecideAsync(ContractsAdministrator, original,
            approval with { ExpectedVersion = null }, Guid.NewGuid(), ct)).Code);
        Assert.Equal("idempotency_key_required", (await workflow.DecideAsync(ContractsAdministrator, original,
            approval, Guid.Empty, ct)).Code);
        var decisionKey = Guid.NewGuid();
        var approved = await workflow.DecideAsync(ContractsAdministrator, original, approval, decisionKey, ct);
        Assert.True(approved.IsSuccess, approved.Code);
        Assert.Equal(approved.ResourceId, (await workflow.DecideAsync(ContractsAdministrator, original, approval,
            decisionKey, ct)).ResourceId);
        Assert.Equal("version_conflict", (await workflow.DecideAsync(ContractsAdministrator, original, approval,
            Guid.NewGuid(), ct)).Code);
        Assert.Equal("request_closed", (await workflow.DecideAsync(ContractsAdministrator, original,
            approval with { ExpectedVersion = null }, null, ct)).Code);
        Assert.Equal(1, await context.Contracts.CountAsync(item => item.OriginatingServiceRequestId == originalRow.Id, ct));
        Assert.Equal(1, await AuditsAsync("commercial.request.approved", original));
        var approvalEmail = await context.Set<EmailOutboxMessage>().AsNoTracking()
            .SingleAsync(item => item.Purpose == EmailPurpose.CommercialDecision && item.Recipient == "ana@carrier.example.com", ct);
        Assert.Null(approvalEmail.AttachmentReference);
        Assert.Contains(originalRow.RequestCode, approvalEmail.TextBody);

        // 1-N01: the duplicate cannot open a second contract for the same airline.
        var duplicateItem = await ItemAsync(duplicate);
        Assert.True(duplicateItem.ExistingCustomer);
        Assert.True((await workflow.ConfirmRepresentativeAsync(ContractsAdministrator, duplicate, Guid.NewGuid(),
            new ConfirmCommercialRepresentativeInput(duplicateItem.Version, "Correo desde el dominio corporativo."), ct)).IsSuccess);
        Assert.Equal("airline_already_contracted", (await workflow.DecideAsync(ContractsAdministrator, duplicate,
            new ReviewCommercialInput(true, null, [station.Id], (await ItemAsync(duplicate)).Version), Guid.NewGuid(), ct)).Code);
        var airlineId = await context.ServiceRequests.Where(item => item.PublicId == original)
            .Select(item => item.AirlineId!.Value).SingleAsync(ct);
        Assert.Equal(1, await context.Contracts.CountAsync(item => item.AirlineId == airlineId, ct));

        // 1-A, 1-N02: Contratos cancels the duplicate with a reason; the applicant is told why.
        var cancel = new CancelCommercialRequestInput((await ItemAsync(duplicate)).Version,
            "Solicitud duplicada de la referencia original.");
        Assert.Equal(CommercialWorkflowFailure.Forbidden, (await workflow.CancelAsync(PortalAirlineAccount, duplicate,
            Guid.NewGuid(), cancel, ct)).Failure);
        Assert.Equal("reason_required", (await workflow.CancelAsync(ContractsAdministrator, duplicate, Guid.NewGuid(),
            cancel with { Reason = "dup" }, ct)).Code);
        var cancelKey = Guid.NewGuid();
        Assert.True((await workflow.CancelAsync(ContractsAdministrator, duplicate, cancelKey, cancel, ct)).IsSuccess);
        Assert.True((await workflow.CancelAsync(ContractsAdministrator, duplicate, cancelKey, cancel, ct)).IsSuccess);
        Assert.Equal("version_conflict", (await workflow.CancelAsync(ContractsAdministrator, duplicate, Guid.NewGuid(),
            cancel, ct)).Code);
        Assert.Equal("request_closed", (await workflow.CancelAsync(ContractsAdministrator, duplicate, Guid.NewGuid(),
            cancel with { ExpectedVersion = (await ItemAsync(duplicate)).Version }, ct)).Code);
        var cancelled = await context.ServiceRequests.AsNoTracking().SingleAsync(item => item.PublicId == duplicate, ct);
        Assert.Equal((CommercialRequestStatus.Cancelled, cancel.Reason), (cancelled.Status, cancelled.DecisionReason));
        Assert.NotNull(cancelled.CancelledAt);
        Assert.True(await context.Set<ServiceRequestStatusEvent>().AnyAsync(item => item.ServiceRequestId == cancelled.Id &&
            item.FromStatus == CommercialRequestStatus.InReview && item.ToStatus == CommercialRequestStatus.Cancelled &&
            item.Reason == cancel.Reason, ct));
        Assert.Equal(1, await AuditsAsync("commercial.request.cancelled", duplicate));
        var cancelEmail = await context.Set<EmailOutboxMessage>().AsNoTracking()
            .SingleAsync(item => item.Purpose == EmailPurpose.CommercialDecision && item.Recipient == "ana.r@carrier.example.com", ct);
        Assert.Contains(cancel.Reason!, cancelEmail.TextBody);

        // The rejection keeps its reason and tells the applicant.
        Assert.Equal("reason_required", (await workflow.DecideAsync(ContractsAdministrator, rejected,
            new ReviewCommercialInput(false, " ", []), null, ct)).Code);
        Assert.True((await workflow.DecideAsync(ContractsAdministrator, rejected,
            new ReviewCommercialInput(false, "Faltan códigos ICAO válidos.", [], (await ItemAsync(rejected)).Version),
            Guid.NewGuid(), ct)).IsSuccess);
        Assert.Contains("Motivo: Faltan códigos ICAO válidos.", (await context.Set<EmailOutboxMessage>().AsNoTracking()
            .SingleAsync(item => item.Purpose == EmailPurpose.CommercialDecision && item.Recipient == "otra@carrier.example.com", ct))
            .TextBody);

        var closed = (await workflow.ListInboxAsync(ContractsAdministrator,
            new CommercialInboxQuery(nameof(CommercialRequestStatus.Cancelled), null, 1, 25), ct))!;
        Assert.Equal(duplicate, Assert.Single(closed.Requests).Id);
        // The seeded Demo Airlines request was approved long ago.
        Assert.Equal((0, 0, 2, 1, 1), (closed.Counts.Pending, closed.Counts.InReview, closed.Counts.Approved,
            closed.Counts.Rejected, closed.Counts.Cancelled));
        Assert.Empty((await workflow.ListInboxAsync(ContractsAdministrator,
            new CommercialInboxQuery(CommercialInboxQuery.Open, null, 1, 25), ct))!.Requests);
    }

    [Fact]
    public async Task AnApprovalOnAScreenOlderThanTheSharedAirlineIdentityIsAVersionConflict()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
        var intake = new SubmitCommercialRequestHandler(scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>());
        var workflow = scope.ServiceProvider.GetRequiredService<ICommercialWorkflowStore>();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var profile = catalog.Airlines.First(item => !item.IsVerified);
        var service = catalog.Services[0].Id;
        var station = (await workflow.ListStationsAsync(ContractsAdministrator, ct))!.Single();
        // Two open requests of the same airline share its catalog profile.
        var first = Guid.NewGuid();
        var second = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(CommercialApplication(first, profile.Id, service, "ana@carrier.example.com"), ct)).IsSuccess);
        Assert.True((await intake.HandleAsync(CommercialApplication(second, profile.Id, service, "luis@carrier.example.com"), ct)).IsSuccess);
        async Task<CommercialInboxRequestData> ItemAsync(Guid id) => (await workflow.ListInboxAsync(ContractsAdministrator,
                new CommercialInboxQuery(CommercialInboxQuery.All, null, 1, 50), ct))!
            .Requests.Single(item => item.Id == id);
        static VerifyRequestAirlineInput Identity(string version, string legalName, string icao) =>
            new(version, null, legalName, "DO", null, icao, $"https://aoc.example.gob.do/{icao.ToLowerInvariant()}");

        // Reviewer 1 verifies the airline from the first request and confirms its representative.
        Assert.True((await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, first, Guid.NewGuid(),
            Identity((await ItemAsync(first)).Version, "Carrier Uno S.A.", "QWA"), ct)).IsSuccess);
        Assert.True((await workflow.ConfirmRepresentativeAsync(ContractsAdministrator, first, Guid.NewGuid(),
            new ConfirmCommercialRepresentativeInput((await ItemAsync(first)).Version,
                "Llamada a la central de la aerolínea: confirmó la gerencia comercial."), ct)).IsSuccess);
        var seen = await ItemAsync(first);
        Assert.Equal(("Carrier Uno S.A.", "QWA"), (seen.LegalName, seen.IcaoCode));
        var firstRow = await context.ServiceRequests.AsNoTracking().SingleAsync(item => item.PublicId == first, ct);

        // Reviewer 2 corrects the shared profile from the second request; the first request's row is untouched.
        Assert.True((await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, second, Guid.NewGuid(),
            Identity((await ItemAsync(second)).Version, "Carrier Dos Corp.", "QWB"), ct)).IsSuccess);
        Assert.Equal(firstRow.RowVersion, (await context.ServiceRequests.AsNoTracking()
            .SingleAsync(item => item.PublicId == first, ct)).RowVersion);

        // 1-D: reviewer 1's screen is stale, so the approval freezes nothing; any other command is stale too.
        var approval = new ReviewCommercialInput(true, null, [station.Id], seen.Version);
        Assert.Equal("version_conflict", (await workflow.DecideAsync(ContractsAdministrator, first, approval,
            Guid.NewGuid(), ct)).Code);
        Assert.Equal("version_conflict", (await workflow.CancelAsync(ContractsAdministrator, first, Guid.NewGuid(),
            new CancelCommercialRequestInput(seen.Version, "Solicitud duplicada de otra referencia."), ct)).Code);
        Assert.False(await context.Contracts.AnyAsync(item => item.OriginatingServiceRequestId == firstRow.Id, ct));
        Assert.False(await context.Airlines.AnyAsync(item => item.IcaoCode == "QWA" || item.IcaoCode == "QWB", ct));

        // A change of the profile made outside the review (Superadministración) makes the screen stale as well.
        var reread = await ItemAsync(first);
        Assert.Equal(("Carrier Dos Corp.", "QWB"), (reread.LegalName, reread.IcaoCode));
        await context.CommercialAirlineProfiles.Where(item => item.PublicId == profile.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.DisplayName, "Carrier Dos"), ct);
        Assert.Equal("version_conflict", (await workflow.DecideAsync(ContractsAdministrator, first,
            approval with { ExpectedVersion = reread.Version }, Guid.NewGuid(), ct)).Code);

        // Once re-read, the approval freezes exactly the identity on screen.
        var approved = await workflow.DecideAsync(ContractsAdministrator, first,
            approval with { ExpectedVersion = (await ItemAsync(first)).Version }, Guid.NewGuid(), ct);
        Assert.True(approved.IsSuccess, approved.Code);
        var decided = await context.ServiceRequests.AsNoTracking().SingleAsync(item => item.PublicId == first, ct);
        Assert.Equal("Carrier Dos Corp.", decided.AirlineLegalNameSnapshot);
        var airline = await context.Airlines.AsNoTracking().SingleAsync(item => item.Id == decided.AirlineId, ct);
        Assert.Equal(("QWB", "Carrier Dos"), (airline.IcaoCode, airline.Name));
    }

    [Fact]
    public async Task ProposedAirlineWithoutIataIsVerifiedApprovedAndAffiliatesAgainOnlyWhenFree()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var catalog = await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct);
        var intake = new SubmitCommercialRequestHandler(scope.ServiceProvider.GetRequiredService<ICommercialIntakeStore>());
        var workflow = scope.ServiceProvider.GetRequiredService<ICommercialWorkflowStore>();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var service = catalog.Services[0].Id;
        var station = (await workflow.ListStationsAsync(ContractsAdministrator, ct))!.Single();
        async Task<CommercialInboxRequestData> ItemAsync(Guid id) => (await workflow.ListInboxAsync(ContractsAdministrator,
                new CommercialInboxQuery(CommercialInboxQuery.All, null, 1, 50), ct))!
            .Requests.Single(item => item.Id == id);
        async Task ConfirmAsync(Guid id) => Assert.True((await workflow.ConfirmRepresentativeAsync(ContractsAdministrator,
            id, Guid.NewGuid(), new ConfirmCommercialRepresentativeInput((await ItemAsync(id)).Version,
                "Confirmado con la central de operaciones de la aerolínea."), ct)).IsSuccess);
        async Task<CommercialWorkflowResult> ApproveAsync(Guid id) => await workflow.DecideAsync(ContractsAdministrator,
            id, new ReviewCommercialInput(true, null, [station.Id], (await ItemAsync(id)).Version), Guid.NewGuid(), ct);

        // 1-N25: the applicant proposes an airline that is not in the catalog; it stays on the request.
        var first = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(CommercialApplication(first, Guid.Empty, service, "ops@caribecargo.example.com") with
        {
            ProposedAirline = new CommercialAirlineProposal("Caribe Cargo Express", "DO", null, "CCX",
                "https://www.caribecargo.example.com/"),
        }, ct)).IsSuccess);
        var proposed = await ItemAsync(first);
        Assert.Null(proposed.AirlineProfileId);
        Assert.False(proposed.AirlineVerified);
        Assert.Equal(new CommercialProposedAirlineData("Caribe Cargo Express", "DO", null, "CCX",
            "https://www.caribecargo.example.com/"), proposed.ProposedAirline);
        Assert.Equal(("CCX", "https://www.caribecargo.example.com/"), (proposed.IcaoCode, proposed.AirlineWebsiteUrl));
        Assert.DoesNotContain((await workflow.ListRequestsAsync(ContractsAdministrator, ct))!, item => item.Id == first);
        Assert.Equal(catalog.Airlines.Count, (await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>()
            .GetPublicAsync(ct)).Airlines.Count);

        await ConfirmAsync(first);
        Assert.Equal("airline_unverified", (await ApproveAsync(first)).Code);
        Assert.Equal("profile_not_found", (await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, first,
            Guid.NewGuid(), new VerifyRequestAirlineInput((await ItemAsync(first)).Version, Guid.NewGuid()), ct)).Code);

        // 1-N17: Contratos verifies it without IATA; the new profile is verified and published.
        var verified = await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, first, Guid.NewGuid(),
            new VerifyRequestAirlineInput((await ItemAsync(first)).Version, null, "Caribe Cargo Express S.R.L.", "DO",
                null, "CCX", "https://aoc.example.gob.do/ccx"), ct);
        Assert.True(verified.IsSuccess, verified.Code);
        var created = await context.CommercialAirlineProfiles.AsNoTracking().SingleAsync(item => item.IcaoCode == "CCX", ct);
        Assert.Equal(("Otras aerolíneas", true, null, "https://www.caribecargo.example.com/"),
            (created.Region, created.IsPublished, created.IataCode, created.SourceUrl));
        Assert.NotNull(created.VerifiedAt);
        Assert.Contains((await scope.ServiceProvider.GetRequiredService<ICommercialCatalogStore>().GetPublicAsync(ct)).Airlines,
            item => item.Id == created.PublicId && item.IsVerified);
        Assert.Equal(created.PublicId, (await ItemAsync(first)).AirlineProfileId);

        var approved = await ApproveAsync(first);
        Assert.True(approved.IsSuccess, approved.Code);
        var airline = await context.Airlines.AsNoTracking().SingleAsync(item => item.IcaoCode == "CCX", ct);
        Assert.Null(airline.IataCode);

        // A second request of the same airline links the verified profile, but cannot open a second contract.
        var again = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(CommercialApplication(again, Guid.Empty, service, "ops2@caribecargo.example.com") with
        {
            ProposedAirline = new CommercialAirlineProposal("Caribe Cargo", "DO", null, "CCX", null),
        }, ct)).IsSuccess);
        await ConfirmAsync(again);
        Assert.True((await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, again, Guid.NewGuid(),
            new VerifyRequestAirlineInput((await ItemAsync(again)).Version, created.PublicId), ct)).IsSuccess);
        Assert.Equal("airline_identity_locked", (await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, again,
            Guid.NewGuid(), new VerifyRequestAirlineInput((await ItemAsync(again)).Version, null, "Otra razón social",
                "DO", null, "CCX", "https://aoc.example.gob.do/ccx"), ct)).Code);
        Assert.Equal("airline_already_contracted", (await ApproveAsync(again)).Code);

        // Once the contract is over, the airline's active portal accounts still block a new affiliation.
        var provisioning = scope.ServiceProvider.GetRequiredService<ICommercialProvisioningStore>();
        var provisioned = await provisioning.ProvisionAsync(
            SuperAdministratorAccount, first, new ProvisionAirlineInput("ops@caribecargo.example.com", "Synthetic-AirlineNew!234"),
            null, ct);
        Assert.True(provisioned.IsSuccess, provisioned.Code);
        // 1-N16: the provisioning failures say why (the request is done; the email already has an account).
        Assert.Equal("request_unavailable", (await provisioning.ProvisionAsync(SuperAdministratorAccount, first,
            new ProvisionAirlineInput("otra@caribecargo.example.com", "Synthetic-AirlineNew!234"), null, ct)).Code);
        await context.Contracts.Where(item => item.AirlineId == airline.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, ContractStatus.Terminated), ct);
        Assert.Equal("airline_has_portal_account", (await ApproveAsync(again)).Code);
        await context.OrganizationMemberships.Where(item => item.OrganizationId == airline.OrganizationId)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.Status, MembershipStatus.Ended), ct);
        context.ChangeTracker.Clear();
        var reaffiliated = await ApproveAsync(again);
        Assert.True(reaffiliated.IsSuccess, reaffiliated.Code);
        Assert.Equal(2, await context.Contracts.CountAsync(item => item.AirlineId == airline.Id, ct));
        // 1-N13: the returning airline's representative already has its portal account; it is linked, not recreated.
        Assert.Equal("email_has_account", (await provisioning.ProvisionAsync(SuperAdministratorAccount, again,
            new ProvisionAirlineInput("ops@caribecargo.example.com", "Synthetic-AirlineNew!234"), null, ct)).Code);

        // A designator that belongs to another operating airline stops the approval.
        var taken = Guid.NewGuid();
        Assert.True((await intake.HandleAsync(CommercialApplication(taken, Guid.Empty, service, "ops@demo-copy.example.com") with
        {
            ProposedAirline = new CommercialAirlineProposal("Demo Copy Air", "DO", null, "DZZ", null),
        }, ct)).IsSuccess);
        await ConfirmAsync(taken);
        Assert.True((await workflow.VerifyRequestAirlineAsync(ContractsAdministrator, taken, Guid.NewGuid(),
            new VerifyRequestAirlineInput((await ItemAsync(taken)).Version, null, "Demo Copy Air S.R.L.", "DO", null,
                "DZZ", "https://aoc.example.gob.do/dzz"), ct)).IsSuccess);
        Assert.Equal("airline_code_in_use", (await ApproveAsync(taken)).Code);

        // The airline without IATA designator and the proposals are history: the downgrade refuses to drop them.
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, CommercialReviewMigration) - 1];
        var failure = await Assert.ThrowsAsync<SqlException>(() => context.GetService<IMigrator>().MigrateAsync(previous, ct));
        Assert.Equal(52370, failure.Number);
    }

    [Fact]
    public async Task CommercialReviewMigrationRoundTripsTheSeededDatabaseAndFiltersTheIataIndex()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        (await SeededFinanceProviderAsync(database, ct)).Dispose();
        await using var context = CreateContext(database.ConnectionString);
        async Task<(bool Nullable, bool Filtered)> IataColumnAsync() => (
            await context.Database.SqlQueryRaw<bool>("SELECT is_nullable AS Value FROM sys.columns " +
                "WHERE object_id = OBJECT_ID('ref.airlines') AND name = 'iata_code'").SingleAsync(ct),
            await context.Database.SqlQueryRaw<bool>("SELECT has_filter AS Value FROM sys.indexes " +
                "WHERE object_id = OBJECT_ID('ref.airlines') AND name = 'IX_airlines_iata_code'").SingleAsync(ct));
        var requests = await context.ServiceRequests.AsNoTracking().Select(item => item.PublicId).OrderBy(item => item)
            .ToArrayAsync(ct);
        var airlines = await context.Airlines.AsNoTracking().Select(item => item.PublicId).OrderBy(item => item).ToArrayAsync(ct);
        Assert.NotEmpty(requests);
        Assert.Equal((true, true), await IataColumnAsync());

        // Without confirmations, proposals or ICAO-only airlines the downgrade is clean and the upgrade restores it.
        var chain = context.Database.GetMigrations().ToArray();
        var previous = chain[Array.IndexOf(chain, CommercialReviewMigration) - 1];
        await context.GetService<IMigrator>().MigrateAsync(previous, ct);
        Assert.Equal((false, false), await IataColumnAsync());
        await context.GetService<IMigrator>().MigrateAsync(cancellationToken: ct);
        Assert.Equal((true, true), await IataColumnAsync());
        Assert.Equal(requests, await context.ServiceRequests.AsNoTracking().Select(item => item.PublicId)
            .OrderBy(item => item).ToArrayAsync(ct));
        Assert.Equal(airlines, await context.Airlines.AsNoTracking().Select(item => item.PublicId).OrderBy(item => item)
            .ToArrayAsync(ct));
        Assert.True(await context.ServiceRequests.AllAsync(item => item.RepresentativeConfirmedAt == null &&
            item.ProposedAirlineIcaoCode == null, ct));

        // Two airlines may lack IATA; two may not share one.
        var organizations = Enumerable.Range(0, 3).Select(index => new Organization
        {
            PublicId = Guid.CreateVersion7(), Code = $"AIR-ICAO-ONLY-{index}", LegalName = $"Icao Only {index}",
            DisplayName = $"Icao Only {index}", Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active,
        }).ToArray();
        context.Organizations.AddRange(organizations);
        await context.SaveChangesAsync(ct);
        context.Airlines.AddRange(
            new Airline { PublicId = Guid.CreateVersion7(), OrganizationId = organizations[0].Id, IcaoCode = "QIA", Name = "Icao Only 0", IsActive = true },
            new Airline { PublicId = Guid.CreateVersion7(), OrganizationId = organizations[1].Id, IcaoCode = "QIB", Name = "Icao Only 1", IsActive = true });
        await context.SaveChangesAsync(ct);
        context.Airlines.Add(new Airline { PublicId = Guid.CreateVersion7(), OrganizationId = organizations[2].Id,
            IataCode = "ZZ", IcaoCode = "QIC", Name = "Icao Only 2", IsActive = true });
        var duplicate = await Assert.ThrowsAsync<DbUpdateException>(() => context.SaveChangesAsync(ct));
        Assert.Equal(2601, Assert.IsType<SqlException>(duplicate.InnerException).Number);
    }
}
