using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Common;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Phase 2, block A, through the stores: which version governs (2-C), renewals and amendments while a version
/// waits for its signatures (2-N01, 2-N03), the signed surcharges and packages (2-N04), the date a version is
/// signed on (2-N05), the withdrawal of an unsigned version (2-N10), terminations with notice (2-N14, 2-N15),
/// blocked automatic renewals (2-N27), the countersignature over the same content (2-N28) and AVIAM's business
/// day (2-F).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    /// <summary>21:00 on 5 November 2026 in Santo Domingo: the UTC day is already 6 November.</summary>
    private static readonly DateTimeOffset EveningInSantoDomingo = new(2026, 11, 6, 1, 0, 0, TimeSpan.Zero);
    private static readonly DateOnly SantoDomingoToday = new(2026, 11, 5);

    /// <summary>
    /// Confirms the validity of an approved version when it has none (manual renewal, no notice) and signs it for
    /// the airline and then for AVIAM; returns the signed content hash.
    /// </summary>
    private static async Task<string> SignByBothAsync(IContractDocumentStore documents, Guid versionId, CancellationToken ct,
        DateOnly? validFrom = null, DateOnly? validTo = null)
    {
        var current = (await documents.ReadAsync(ContractsAdministrator, versionId, ct)).Document!;
        if (current.Validity is null)
        {
            var from = validFrom ?? current.ValidFrom;
            var confirmed = await documents.SetValidityAsync(ContractsAdministrator, versionId, new ContractValidityInput(
                from, validTo ?? current.ValidTo ?? from.AddYears(1).AddDays(-1), "Manual", null, 0, 0, null,
                current.ContentSha256), Guid.NewGuid(), ct);
            Assert.Null(confirmed.Code);
            current = confirmed.Document!;
        }
        var airline = await documents.SignAsync(PortalAirlineAccount, versionId, new SignContractInput(Guid.NewGuid(),
            "Casey Airline", "Director", current.ContentSha256, true, SignaturePng), ct);
        Assert.Null(airline.Code);
        var aviam = await documents.SignAsync(ContractsAdministrator, versionId, new SignContractInput(Guid.NewGuid(),
            "Ana Pérez", "Gerente comercial", current.ContentSha256, true, SignaturePng), ct);
        Assert.Null(aviam.Code);
        return current.ContentSha256;
    }

    private static Turnaround Flight(long airlineId, long stationId, DateOnly date, TurnaroundStatus status, long versionId,
        DateTimeOffset now) => new()
    {
        PublicId = Guid.NewGuid(), OperationCode = $"A2-{Guid.NewGuid():N}", AirlineId = airlineId, StationId = stationId,
        OperationDate = date, CurrentStatus = status, Source = OperationalDataSource.Manual, ContractVersionId = versionId,
        CreatedAt = now, UpdatedAt = now,
    };

    /// <summary>A published package of the seeded baggage service; returns its internal key.</summary>
    private static async Task<long> PublishedBaggagePackageAsync(IFinancePackageStore packages, ElevantDbContext context,
        CancellationToken ct)
    {
        var baggage = await context.ServiceDefinitions.AsNoTracking().SingleAsync(item => item.Code == "BAGGAGE", ct);
        var saved = await packages.SaveAsync(FinanceAccount, null, new SavePackageInput(Guid.NewGuid(), "RENEW-PACKAGE",
            "Equipaje incluido", "USD", 300m, "Turnaround", null, null, new DateOnly(2026, 1, 1), null,
            [new PackageComponentInput(baggage.PublicId, "operation", 1m, 1m, 50m)], null), ct);
        Assert.True(saved.IsSuccess, saved.Code);
        var package = Assert.Single((await packages.ListAsync(FinanceAccount, ct))!, item => item.Id == saved.Id);
        Assert.True((await packages.PublishAsync(FinanceAccount, package.Id, new(Guid.NewGuid(), package.Version), ct)).IsSuccess);
        return await context.Set<ServicePackageVersion>().AsNoTracking().Where(item => item.PublicId == package.Id)
            .Select(item => item.Id).SingleAsync(ct);
    }

    [Fact]
    public async Task ARenewalCopiesTheVersionInForceAndGovernsOnlyOnceBothPartiesSignTheSameContent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var clock = new MovableTimeProvider(EveningInSantoDomingo);
        await using var provider = await SeededFinanceProviderAsync(database, ct, clock);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var v1 = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.PublicId == SeededContractVersion, ct);
        var contract = await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == v1.ContractId, ct);
        var puj = await context.Stations.AsNoTracking().Where(item => item.Code == "PUJ").Select(item => item.Id).SingleAsync(ct);
        async Task<long?> GoverningAsync(DateOnly date) => (await ApplicableContracts.For(context, contract.AirlineId, puj, date)
            .Select(row => (long?)row.VersionId).ToArrayAsync(ct)).SingleOrDefault();

        // The version in force ends this year, exempts the night surcharge and links a package; the overtime value
        // Finance only inherited from the base tariff at its approval is not something the parties negotiated.
        var end = new DateOnly(2026, 12, 31);
        await context.ContractVersions.Where(item => item.Id == v1.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.ValidTo, end), ct);
        var night = await context.ChargeDefinitions.AsNoTracking().SingleAsync(item => item.Code == "NIGHT", ct);
        var overtime = await context.ChargeDefinitions.AsNoTracking().SingleAsync(item => item.Code == "OVERTIME", ct);
        // The package store clears the change tracker, so the package is published before anything is staged.
        var package = await PublishedBaggagePackageAsync(packages, context, ct);
        var approvedAt = v1.ApprovedAt!.Value;
        context.ContractChargeRates.AddRange(
            new ContractChargeRate { PublicId = Guid.NewGuid(), ContractVersionId = v1.Id, ChargeDefinitionId = night.Id,
                IsExcluded = true, CreatedAt = approvedAt.AddDays(-1), UpdatedAt = approvedAt.AddDays(-1) },
            new ContractChargeRate { PublicId = Guid.NewGuid(), ContractVersionId = v1.Id, ChargeDefinitionId = overtime.Id,
                Value = 45m, MinimumAmount = 0m, CreatedAt = approvedAt, UpdatedAt = approvedAt });
        context.Set<ContractServicePackage>().Add(new ContractServicePackage { PublicId = Guid.NewGuid(),
            ContractVersionId = v1.Id, PackageVersionId = package, CreatedAt = clock.Now, UpdatedAt = clock.Now });
        await context.SaveChangesAsync(ct);

        // 2-N03: the renewal copies rates, stations, the negotiated exemption and the package of the version in force.
        var renewal = await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion, new ContractLifecycleInput(
            "Renew", "Renovación anual", "Active", new DateOnly(2027, 1, 1), new DateOnly(2027, 12, 31)), Guid.NewGuid(), ct);
        Assert.Null(renewal.Code);
        var draftKey = await context.ContractVersions.AsNoTracking().Where(item => item.PublicId == renewal.DraftVersionId)
            .Select(item => item.Id).SingleAsync(ct);
        Assert.Equal(await context.ContractServiceRates.CountAsync(item => item.ContractVersionId == v1.Id, ct),
            await context.ContractServiceRates.CountAsync(item => item.ContractVersionId == draftKey, ct));
        var exemption = Assert.Single(await context.ContractChargeRates.AsNoTracking()
            .Where(item => item.ContractVersionId == draftKey).ToArrayAsync(ct));
        Assert.Equal((night.Id, true, (decimal?)null), (exemption.ChargeDefinitionId, exemption.IsExcluded, exemption.Value));
        Assert.Equal(package, (await context.Set<ContractServicePackage>().AsNoTracking()
            .SingleAsync(item => item.ContractVersionId == draftKey, ct)).PackageVersionId);
        Assert.True(await context.Set<ContractVersionStation>().AnyAsync(item => item.ContractVersionId == draftKey &&
            item.StationId == puj, ct));

        // 2-N12: the expiry notice of the version in force went out; the renewal restarts it only once it governs.
        await context.Contracts.Where(item => item.Id == contract.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.ExpiryNoticeSentAt, clock.Now), ct);
        async Task<DateTimeOffset?> NoticeSentAsync() => await context.Contracts.AsNoTracking()
            .Where(item => item.Id == contract.Id).Select(item => item.ExpiryNoticeSentAt).SingleAsync(ct);

        // Contratos raises the prices and Finance approves them.
        var draft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!,
            item => item.Id == renewal.DraftVersionId);
        var saved = await drafts.UpdateAsync(ContractsAdministrator, draft.Id, new UpdateContractDraftInput(draft.ValidFrom,
            draft.ValidTo, draft.CurrencyCode, draft.Terms!, draft.Rates.Select(rate => new UpdateDraftRateInput(rate.Id,
                rate.BillingUnit, rate.UnitPrice + 20m, rate.MinimumQuantity, true)).ToArray(), null, draft.Version),
            Guid.NewGuid(), ct);
        Assert.True(saved.IsSuccess, saved.Code);
        draft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!, item => item.Id == draft.Id);
        var submitted = await drafts.ActivateAsync(ContractsAdministrator, draft.Id, new SubmitContractDraftInput(draft.Version),
            Guid.NewGuid(), ct);
        Assert.True(submitted.IsSuccess, submitted.Code);
        var pending = (await book.GetContractApprovalAsync(FinanceAccount, draft.Id, ct))!;
        var approved = await book.DecideContractApprovalAsync(FinanceAccount, draft.Id,
            new DecideContractApprovalInput("Approved", null, pending.Summary.Version), Guid.NewGuid(), ct);
        Assert.True(approved.IsSuccess, approved.Code);

        // 2-C: Finance approval alone changes nothing that is covered or billed.
        context.ChangeTracker.Clear();
        var inForce = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.Id == v1.Id, ct);
        Assert.Equal((ContractVersionStatus.Approved, (DateOnly?)end), (inForce.Status, inForce.ValidTo));
        Assert.Equal(v1.Id, await GoverningAsync(SantoDomingoToday));
        Assert.Null(await GoverningAsync(new DateOnly(2027, 1, 15)));
        Assert.NotNull(await NoticeSentAsync());
        // 2-N01: no other renewal or amendment starts while an approved version waits for both signatures.
        Assert.Equal("version_awaiting_signatures", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Renew", "Otra renovación", "Active", new DateOnly(2028, 1, 1), null), null, ct)).Code);
        Assert.Equal("version_awaiting_signatures", (await packages.CreateAmendmentAsync(ContractsAdministrator,
            SeededContractVersion, Guid.NewGuid(), new CreateAmendmentInput("Active", new DateOnly(2026, 12, 1)), ct)).Code);

        // 2-N04: the surcharges Finance froze (the exemption and the inherited base values) and the package are part
        // of the content to sign; the airline reads them as not signed yet.
        var unsigned = (await documents.ReadAsync(ContractsAdministrator, draft.Id, ct)).Document!;
        Assert.NotNull(unsigned.Pricing);
        Assert.Contains(unsigned.Pricing!.Charges, charge => charge.ChargeCode == "NIGHT" && charge.IsExcluded);
        Assert.Contains(unsigned.Pricing.Charges, charge => charge.ChargeCode == "OVERTIME" && !charge.IsExcluded);
        Assert.Single(unsigned.Pricing.Packages);
        Assert.NotEqual((unsigned with { Pricing = null }).ContentSha256, unsigned.ContentSha256);
        var terms = (await documents.ReadPricingTermsAsync(PortalAirlineAccount, draft.Id, ct)).Terms!;
        Assert.Equal((true, false), (terms.InDocument, terms.Signed));

        // The validity step replays with its key and refuses that key with another body.
        var validityKey = Guid.NewGuid();
        var validity = new ContractValidityInput(new DateOnly(2027, 1, 1), new DateOnly(2027, 12, 31), "Manual", 12, 30, 60,
            "Incumplimiento grave de pago.", unsigned.ContentSha256);
        var confirmed = await documents.SetValidityAsync(ContractsAdministrator, draft.Id, validity, validityKey, ct);
        Assert.Null(confirmed.Code);
        var hash = confirmed.Document!.ContentSha256;
        // 2-N13: the airline is emailed that the renewal can be signed; the replay below queues nothing more.
        var ready = await context.EmailOutbox.AsNoTracking().Where(item => item.Purpose == EmailPurpose.ContractReadyToSign)
            .Select(item => item.TextBody).ToArrayAsync(ct);
        Assert.NotEmpty(ready);
        Assert.All(ready, body => Assert.Contains("sigue vigente la versión actual", body));
        Assert.Equal(hash, (await documents.SetValidityAsync(ContractsAdministrator, draft.Id, validity, validityKey, ct))
            .Document!.ContentSha256);
        Assert.Equal(ready.Length, await context.EmailOutbox.CountAsync(item => item.Purpose == EmailPurpose.ContractReadyToSign, ct));
        // 2-N12: the coverage end did not move, so the notice is not sent again.
        Assert.NotNull(await NoticeSentAsync());
        Assert.Equal("idempotency_conflict", (await documents.SetValidityAsync(ContractsAdministrator, draft.Id,
            validity with { RenewalNoticeDays = 45 }, validityKey, ct)).Code);
        Assert.Equal(1, await context.AuditEntries.CountAsync(item => item.Action == "commercial.contract.validity_confirmed" &&
            item.EntityPublicId == draft.Id, ct));

        // One signature changes nothing either.
        Assert.Null((await documents.SignAsync(PortalAirlineAccount, draft.Id, new SignContractInput(Guid.NewGuid(),
            "Casey Airline", "Director", hash, true, SignaturePng), ct)).Code);
        Assert.Null(await GoverningAsync(new DateOnly(2027, 1, 15)));

        // 2-N28: AVIAM countersigns only the content the airline signed.
        var airlineSignature = await context.ContractSignatures.AsNoTracking()
            .SingleAsync(item => item.ContractVersionId == draftKey && item.Party == ContractSignatureParty.Airline, ct);
        await context.ContractSignatures.Where(item => item.Id == airlineSignature.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.DocumentSha256, new string('a', 64)), ct);
        Assert.Null((await documents.ReadAsync(ContractsAdministrator, draft.Id, ct)).Document!.SignableBy);
        var refused = await documents.SignAsync(ContractsAdministrator, draft.Id, new SignContractInput(Guid.NewGuid(),
            "Ana Pérez", "Gerente comercial", hash, true, SignaturePng), ct);
        Assert.Equal(("airline_signed_other_content", ContractDocumentFailure.Conflict), (refused.Code, refused.Failure));
        await context.ContractSignatures.Where(item => item.Id == airlineSignature.Id)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.DocumentSha256, airlineSignature.DocumentSha256), ct);

        // Flights of the version in force within the renewal: one not started moves to it, an executed one stays.
        var waiting = Flight(contract.AirlineId, puj, new DateOnly(2027, 2, 1), TurnaroundStatus.Scheduled, v1.Id, clock.Now);
        var flown = Flight(contract.AirlineId, puj, new DateOnly(2027, 2, 2), TurnaroundStatus.Completed, v1.Id, clock.Now);
        context.Turnarounds.AddRange(waiting, flown);
        await context.SaveChangesAsync(ct);

        var countersigned = await documents.SignAsync(ContractsAdministrator, draft.Id, new SignContractInput(Guid.NewGuid(),
            "Ana Pérez", "Gerente comercial", hash, true, SignaturePng), ct);
        Assert.Null(countersigned.Code);
        // 2-N05: the version is signed on the business day of its second signature, still 5 November at 21:00 in
        // Santo Domingo; the contract keeps the day it first became active.
        Assert.Equal(SantoDomingoToday, countersigned.Document!.SignedOn);
        context.ChangeTracker.Clear();
        // 2-N12: the coverage end moved with the renewal that now governs, so its expiry notice starts again.
        Assert.Null(await NoticeSentAsync());
        Assert.Equal(contract.SignedOn, (await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == contract.Id, ct))
            .SignedOn);
        // 2-C: the second signature makes the renewal govern its dates; the version it replaces keeps the dates before.
        var replaced = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.Id == v1.Id, ct);
        Assert.Equal((ContractVersionStatus.Superseded, (DateOnly?)end), (replaced.Status, replaced.ValidTo));
        Assert.Equal(draftKey, await GoverningAsync(new DateOnly(2027, 1, 15)));
        Assert.Equal(v1.Id, await GoverningAsync(end));
        Assert.Equal(draftKey, (await context.Turnarounds.AsNoTracking().SingleAsync(item => item.Id == waiting.Id, ct))
            .ContractVersionId);
        Assert.Equal(v1.Id, (await context.Turnarounds.AsNoTracking().SingleAsync(item => item.Id == flown.Id, ct))
            .ContractVersionId);
        Assert.True(await context.AuditEntries.AnyAsync(item => item.Action == "commercial.contract.version_superseded" &&
            item.EntityPublicId == SeededContractVersion, ct));
        // The renewal of a contract in force sends its signed PDF, and its pricing is signed content now.
        Assert.True(await context.EmailOutbox.AnyAsync(item => item.Purpose == EmailPurpose.ContractActivated &&
            item.AttachmentReference == "contract-version:" + draft.Id, ct));
        Assert.True((await documents.ReadPricingTermsAsync(PortalAirlineAccount, draft.Id, ct)).Terms!.Signed);
    }

    [Fact]
    public async Task AnApprovedVersionOnlyTheAirlineSignedIsWithdrawnAndANeverActiveContractGetsItsContentBackAsADraft()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var contractId = await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .Select(item => item.ContractId).SingleAsync(ct);
        await context.Contracts.Where(item => item.Id == contractId).ExecuteUpdateAsync(update => update
            .SetProperty(item => item.Status, ContractStatus.Draft).SetProperty(item => item.SignedOn, (DateOnly?)null), ct);
        var today = BusinessCalendar.Today(DateTimeOffset.UtcNow);
        var hash = await ConfirmValidityAsync(documents, SeededContractVersion, today, ct);
        Assert.Null((await documents.SignAsync(PortalAirlineAccount, SeededContractVersion, new SignContractInput(Guid.NewGuid(),
            "Casey Airline", "Director", hash, true, SignaturePng), ct)).Code);
        // Once the airline signed, the validity no longer changes: withdrawing the version is the way out (2-N10).
        Assert.Equal("already_signed", (await documents.SetValidityAsync(ContractsAdministrator, SeededContractVersion,
            new ContractValidityInput(today, today.AddYears(2), "Manual", null, 0, 0, null, hash), null, ct)).Code);

        var input = new WithdrawContractVersionInput("La vigencia quedó con el año equivocado.", hash);
        Task<ContractWithdrawalResult> WithdrawAsync(Guid actor, WithdrawContractVersionInput body, Guid key) =>
            documents.WithdrawAsync(actor, SeededContractVersion, body, key, ct);
        Assert.Equal(ContractDocumentFailure.Forbidden, (await WithdrawAsync(PortalAirlineAccount, input, Guid.NewGuid())).Failure);
        Assert.Equal("idempotency_key_required", (await WithdrawAsync(ContractsAdministrator, input, Guid.Empty)).Code);
        Assert.Equal("expected_version_required", (await WithdrawAsync(ContractsAdministrator,
            input with { ExpectedDocumentSha256 = "x" }, Guid.NewGuid())).Code);
        Assert.Equal("reason_required", (await WithdrawAsync(ContractsAdministrator, input with { Reason = "no" },
            Guid.NewGuid())).Code);
        Assert.Equal("content_changed", (await WithdrawAsync(ContractsAdministrator,
            input with { ExpectedDocumentSha256 = new string('b', 64) }, Guid.NewGuid())).Code);

        var key = Guid.NewGuid();
        var withdrawn = (await WithdrawAsync(ContractsAdministrator, input, key)).Withdrawal!;
        Assert.Equal(("Rejected", "Draft"), (withdrawn.VersionStatus, withdrawn.ContractStatus));
        Assert.NotNull(withdrawn.DraftVersionId);
        // A retry replays it; the key with another reason is a conflict, and nothing is withdrawn twice.
        Assert.Equal(withdrawn, (await WithdrawAsync(ContractsAdministrator, input, key)).Withdrawal);
        Assert.Equal("idempotency_conflict", (await WithdrawAsync(ContractsAdministrator,
            input with { Reason = "Otro motivo distinto." }, key)).Code);
        Assert.Equal("not_approved", (await WithdrawAsync(ContractsAdministrator, input, Guid.NewGuid())).Code);

        // The version keeps its approval and its one-party signature, voided in the audit trail.
        var version = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.PublicId == SeededContractVersion, ct);
        Assert.Equal(ContractVersionStatus.Rejected, version.Status);
        Assert.NotNull(version.ApprovedAt);
        Assert.Equal(1, await context.ContractSignatures.CountAsync(item => item.ContractVersionId == version.Id, ct));
        Assert.True(await context.AuditEntries.AnyAsync(item => item.Action == "commercial.contract.signature_voided", ct));
        Assert.Equal(1, await context.AuditEntries.CountAsync(item => item.Action == "commercial.contract.version_withdrawn" &&
            item.EntityPublicId == SeededContractVersion, ct));
        // The same content comes back as a draft to correct and send to Finance again.
        var draft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!,
            item => item.Id == withdrawn.DraftVersionId);
        Assert.Equal((version.ValidFrom, version.ValidTo, version.Terms), (draft.ValidFrom, draft.ValidTo, draft.Terms));
        Assert.Equal(await context.ContractServiceRates.CountAsync(item => item.ContractVersionId == version.Id, ct),
            draft.Rates.Count);
        var timeline = (await lifecycle.TimelineAsync(ContractsAdministrator, withdrawn.DraftVersionId!.Value, ct))!;
        Assert.Contains(timeline.Entries, item => item.Title == "Firma de la aerolínea (anulada al retirar la versión)");
        Assert.Contains(timeline.Entries, item => item.Title == "Contratos retiró la versión 1 sin las dos firmas");
    }

    [Fact]
    public async Task WithdrawingAnUnsignedReplacementRestoresTheEndThePreviousSignaturesAccepted()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var now = DateTimeOffset.UtcNow;
        var today = BusinessCalendar.Today(now);
        var signedEnd = today.AddYears(1).AddDays(-1);
        await SignByBothAsync(documents, SeededContractVersion, ct, today, signedEnd);

        // Before 2-C, Finance approval of a renewal ended the version in force the day before its start, with nobody's
        // signature on the renewal yet.
        var v1 = await context.ContractVersions.SingleAsync(item => item.PublicId == SeededContractVersion, ct);
        var start = today.AddDays(30);
        var v2 = new ContractVersion
        {
            PublicId = Guid.NewGuid(), ContractId = v1.ContractId, VersionNumber = 2, Status = ContractVersionStatus.Approved,
            ValidFrom = start, ValidTo = start.AddYears(1), CurrencyCode = v1.CurrencyCode, Terms = v1.Terms,
            ApprovedAt = now, CreatedAt = now, UpdatedAt = now,
        };
        context.ContractVersions.Add(v2);
        v1.Status = ContractVersionStatus.Superseded;
        v1.ValidTo = start.AddDays(-1);
        await context.SaveChangesAsync(ct);

        var unsigned = (await documents.ReadAsync(ContractsAdministrator, v2.PublicId, ct)).Document!;
        var result = await documents.WithdrawAsync(ContractsAdministrator, v2.PublicId,
            new WithdrawContractVersionInput("Renovación sin acuerdo con la aerolínea.", unsigned.ContentSha256), Guid.NewGuid(), ct);
        Assert.Null(result.Code);
        Assert.Equal(("Rejected", "Active", (Guid?)null),
            (result.Withdrawal!.VersionStatus, result.Withdrawal.ContractStatus, result.Withdrawal.DraftVersionId));
        // The version in force gets back the end its two signatures accepted, and the change is audited.
        context.ChangeTracker.Clear();
        var restored = await context.ContractVersions.AsNoTracking().SingleAsync(item => item.PublicId == SeededContractVersion, ct);
        Assert.Equal((ContractVersionStatus.Approved, (DateOnly?)signedEnd), (restored.Status, restored.ValidTo));
        Assert.True(await context.AuditEntries.AnyAsync(item => item.Action == "commercial.contract.version_end_restored" &&
            item.EntityPublicId == SeededContractVersion, ct));
        // A version both parties signed governs and is never withdrawn.
        var signed = (await documents.ReadAsync(ContractsAdministrator, SeededContractVersion, ct)).Document!;
        Assert.Equal("version_signed", (await documents.WithdrawAsync(ContractsAdministrator, SeededContractVersion,
            new WithdrawContractVersionInput("Intento de retirar la versión vigente.", signed.ContentSha256), Guid.NewGuid(),
            ct)).Code);
    }

    [Fact]
    public async Task ATerminationRespectsTheSignedNoticeTakesEffectInTheSweepAndClosesWhatIsStillOpen()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var clock = new MovableTimeProvider(EveningInSantoDomingo);
        await using var provider = await SeededFinanceProviderAsync(database, ct, clock);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var contractId = await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .Select(item => item.ContractId).SingleAsync(ct);
        var airlineId = await context.Contracts.Where(item => item.Id == contractId).Select(item => item.AirlineId).SingleAsync(ct);
        var puj = await context.Stations.AsNoTracking().Where(item => item.Code == "PUJ").Select(item => item.Id).SingleAsync(ct);
        Task<ContractLifecycleResult> ApplyAsync(ContractLifecycleInput input, Guid? key = null) =>
            lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion, input, key ?? Guid.NewGuid(), ct);
        static ContractLifecycleInput Terminate(DateOnly? effectiveOn, string? cause = null, string status = "Active") =>
            new("Terminate", "Fin de la relación comercial.", status, EffectiveOn: effectiveOn, ImmediateCause: cause);

        // The version in force signed 60 days of notice.
        await ConfirmValidityAsync(documents, SeededContractVersion, SantoDomingoToday, ct);
        Assert.Equal("termination_date_required", (await ApplyAsync(Terminate(null))).Code);
        Assert.Equal("termination_notice_not_met", (await ApplyAsync(Terminate(SantoDomingoToday.AddDays(59)))).Code);
        Assert.Equal("immediate_cause_invalid", (await ApplyAsync(Terminate(null, "Cansancio"))).Code);
        var effective = SantoDomingoToday.AddDays(60);
        var timeline = (await lifecycle.TimelineAsync(ContractsAdministrator, SeededContractVersion, ct))!;
        Assert.Equal(((DateOnly?)null, (DateOnly?)effective), (timeline.TerminatesOn, timeline.EarliestTerminationOn));

        // A renewal draft is open when Contratos schedules the termination: it closes in the same transaction.
        var renewal = await ApplyAsync(new ContractLifecycleInput("Renew", "Renovación anual", "Active",
            SantoDomingoToday.AddYears(1), null));
        Assert.Null(renewal.Code);
        var scheduleKey = Guid.NewGuid();
        var scheduled = await ApplyAsync(Terminate(effective), scheduleKey);
        Assert.Equal(("Active", (string?)null), (scheduled.Status, scheduled.Code));
        Assert.Equal("Active", (await ApplyAsync(Terminate(effective), scheduleKey)).Status);
        context.ChangeTracker.Clear();
        var contract = await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == contractId, ct);
        Assert.Equal((ContractStatus.Active, (DateOnly?)effective), (contract.Status, contract.TerminatedOn));
        Assert.Equal(ContractVersionStatus.Rejected, (await context.ContractVersions.AsNoTracking()
            .SingleAsync(item => item.PublicId == renewal.DraftVersionId, ct)).Status);
        Assert.Equal(1, await context.AuditEntries.CountAsync(item =>
            item.Action == "commercial.contract.termination_scheduled" && item.EntityPublicId == contract.PublicId, ct));
        timeline = (await lifecycle.TimelineAsync(ContractsAdministrator, SeededContractVersion, ct))!;
        Assert.Equal(((DateOnly?)effective, (DateOnly?)null), (timeline.TerminatesOn, timeline.EarliestTerminationOn));
        Assert.Contains(timeline.Entries, item => item.Kind == "upcoming" && item.Title == "Terminación programada del contrato");
        // It keeps covering up to the day before its first day without coverage.
        Assert.Single(await ApplicableContracts.For(context, airlineId, puj, effective.AddDays(-1)).ToArrayAsync(ct));
        Assert.Empty(await ApplicableContracts.For(context, airlineId, puj, effective).ToArrayAsync(ct));

        // 2-N15: nothing renews and no version starts on or after that day; another date needs a cancellation first.
        Assert.Equal("termination_scheduled", (await ApplyAsync(new ContractLifecycleInput("Renew", "Renovación anual",
            "Active", SantoDomingoToday.AddYears(1), null))).Code);
        Assert.Equal("termination_scheduled", (await packages.CreateAmendmentAsync(ContractsAdministrator,
            SeededContractVersion, Guid.NewGuid(), new CreateAmendmentInput("Active", effective), ct)).Code);
        Assert.Equal("termination_scheduled", (await ApplyAsync(Terminate(effective.AddDays(10)))).Code);
        var cancel = new ContractLifecycleInput("CancelTermination", "La aerolínea renovó su interés.", "Active");
        Assert.Equal("Active", (await ApplyAsync(cancel)).Status);
        Assert.Null((await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == contractId, ct)).TerminatedOn);
        Assert.Equal("termination_not_scheduled", (await ApplyAsync(cancel)).Code);
        Assert.Equal("Active", (await ApplyAsync(Terminate(effective))).Status);
        // An amendment that starts before the termination waits in Borradores.
        var amendment = await packages.CreateAmendmentAsync(ContractsAdministrator, SeededContractVersion, Guid.NewGuid(),
            new CreateAmendmentInput("Active", SantoDomingoToday.AddDays(20)), ct);
        Assert.True(amendment.IsSuccess, amendment.Code);

        // On its effective day the sweep terminates the contract and, as the system, closes what nobody finished.
        clock.Now = BusinessCalendar.StartOfDay(effective).AddHours(1);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).Terminated);
        context.ChangeTracker.Clear();
        Assert.Equal(ContractStatus.Terminated,
            (await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == contractId, ct)).Status);
        Assert.Equal(ContractVersionStatus.Rejected, (await context.ContractVersions.AsNoTracking()
            .SingleAsync(item => item.PublicId == amendment.Id, ct)).Status);
        Assert.True(await context.AuditEntries.AnyAsync(item => item.Action == "commercial.draft.discarded" &&
            item.EntityPublicId == amendment.Id && item.ActorType == AuditActorType.System, ct));
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).Terminated);
        // A terminated contract takes no new validity, no signature and no cancellation.
        var document = (await documents.ReadAsync(ContractsAdministrator, SeededContractVersion, ct)).Document!;
        Assert.Equal("contract_terminated", (await documents.SetValidityAsync(ContractsAdministrator, SeededContractVersion,
            new ContractValidityInput(effective, effective.AddYears(1), "Manual", null, 0, 0, null, document.ContentSha256),
            null, ct)).Code);
        Assert.Equal("contract_terminated", (await documents.SignAsync(PortalAirlineAccount, SeededContractVersion,
            new SignContractInput(Guid.NewGuid(), "Casey Airline", "Director", document.ContentSha256, true, SignaturePng),
            ct)).Code);
        Assert.Equal("transition_not_allowed", (await ApplyAsync(cancel with { ExpectedStatus = "Terminated" })).Code);
    }

    [Fact]
    public async Task ABlockedAutomaticRenewalIsRetriedAndAnExpiredContractRenewsBackToActive()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var clock = new MovableTimeProvider(EveningInSantoDomingo);
        await using var provider = await SeededFinanceProviderAsync(database, ct, clock);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var drafts = scope.ServiceProvider.GetRequiredService<IContractDraftStore>();
        var book = scope.ServiceProvider.GetRequiredService<IFinanceTariffBookStore>();
        var packages = scope.ServiceProvider.GetRequiredService<IFinancePackageStore>();
        var permits = scope.ServiceProvider.GetRequiredService<IAirlinePermitStore>();
        var contractId = await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .Select(item => item.ContractId).SingleAsync(ct);
        async Task<ContractStatus> StatusAsync() =>
            await context.Contracts.AsNoTracking().Where(item => item.Id == contractId).Select(item => item.Status).SingleAsync(ct);
        Task<DepartmentNotificationRow[]> BlockedNoticesAsync() => context.DepartmentNotifications.AsNoTracking()
            .Where(item => item.Kind == "contract_renewal_blocked")
            .Select(item => new DepartmentNotificationRow(item.Id, item.OccurredAt)).ToArrayAsync(ct);

        // Automatic renewal for 12 months with 30 days' notice; the version in force ends in ten days.
        await ConfirmValidityAsync(documents, SeededContractVersion, SantoDomingoToday, ct);
        var end = SantoDomingoToday.AddDays(10);
        await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .ExecuteUpdateAsync(update => update.SetProperty(item => item.ValidTo, end), ct);
        // 2-N27: an amendment in progress blocks the renewal. It is not marked as started, the next sweep retries it
        // and Contratos hears about it at most once per business day.
        var amendment = await packages.CreateAmendmentAsync(ContractsAdministrator, SeededContractVersion, Guid.NewGuid(),
            new CreateAmendmentInput("Active", SantoDomingoToday.AddDays(5)), ct);
        Assert.True(amendment.IsSuccess, amendment.Code);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).RenewalsBlocked);
        var first = await BlockedNoticesAsync();
        Assert.NotEmpty(first);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).RenewalsBlocked);
        Assert.Equal(first.Select(item => item.OccurredAt), (await BlockedNoticesAsync()).Select(item => item.OccurredAt));
        Assert.Null((await context.ContractVersions.AsNoTracking().SingleAsync(item => item.PublicId == SeededContractVersion,
            ct)).RenewalStartedAt);
        clock.Now = clock.Now.AddDays(1);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).RenewalsBlocked);
        Assert.All(await BlockedNoticesAsync(), item => Assert.True(item.OccurredAt > first.Max(row => row.OccurredAt)));

        // Discarded, the amendment frees the renewal: its draft starts once, with the next period.
        var amendmentDraft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!,
            item => item.Id == amendment.Id);
        Assert.True((await drafts.DiscardAsync(ContractsAdministrator, amendmentDraft.Id, Guid.NewGuid(),
            new DiscardContractDraftInput(amendmentDraft.Version, "La enmienda ya no hace falta."), ct)).IsSuccess);
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).RenewalsBlocked);
        var renewal = Assert.Single(await context.ContractVersions.AsNoTracking()
            .Where(item => item.ContractId == contractId && item.Status == ContractVersionStatus.Draft).ToArrayAsync(ct));
        Assert.Equal(end.AddDays(1), renewal.ValidFrom);
        Assert.NotNull((await context.ContractVersions.AsNoTracking().SingleAsync(item => item.PublicId == SeededContractVersion,
            ct)).RenewalStartedAt);

        // 2-N01: the contract expires while the renewal waits. The draft stays in Borradores and goes through Finance,
        // the validity and both signatures; with a verified permit the contract is active again.
        clock.Now = BusinessCalendar.StartOfDay(end.AddDays(1)).AddHours(2);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).Expired);
        Assert.Equal(ContractStatus.Expired, await StatusAsync());
        var draft = Assert.Single((await drafts.ListForContractsAsync(ContractsAdministrator, ct))!,
            item => item.Id == renewal.PublicId);
        var submitted = await drafts.ActivateAsync(ContractsAdministrator, draft.Id, new SubmitContractDraftInput(draft.Version),
            Guid.NewGuid(), ct);
        Assert.True(submitted.IsSuccess, submitted.Code);
        var pending = (await book.GetContractApprovalAsync(FinanceAccount, draft.Id, ct))!;
        Assert.True((await book.DecideContractApprovalAsync(FinanceAccount, draft.Id,
            new DecideContractApprovalInput("Approved", null, pending.Summary.Version), Guid.NewGuid(), ct)).IsSuccess);
        var permit = (await permits.SubmitAsync(PortalAirlineAccount, new SubmitAirlinePermitInput("OperatingPermit",
            "JAC-2027-A", "Junta de Aviación Civil", end, end.AddYears(1), null), null, ct)).Permit!;
        Assert.Equal("Verified", (await permits.ReviewAsync(ContractsAdministrator, permit.Id,
            new ReviewAirlinePermitInput(true, null, permit.Version), null, ct)).Permit!.Review);
        // The permit alone reactivates nothing: no version both parties signed is in force.
        Assert.Equal(ContractStatus.Expired, await StatusAsync());
        await SignByBothAsync(documents, draft.Id, ct);
        Assert.Equal(ContractStatus.Active, await StatusAsync());

        // 2-N14: an explicit cause ends it at once, and the history names it before the note.
        Assert.Equal("Terminated", (await lifecycle.ApplyAsync(ContractsAdministrator, SeededContractVersion,
            new ContractLifecycleInput("Terminate", "Acuerdo firmado con la aerolínea.", "Active",
                ImmediateCause: "MutualAgreement"), Guid.NewGuid(), ct)).Status);
        Assert.True(await context.Set<ContractStatusEvent>().AnyAsync(item => item.ContractId == contractId &&
            item.ToStatus == ContractStatus.Terminated && item.Reason == "Mutuo acuerdo: Acuerdo firmado con la aerolínea.", ct));
    }

    private sealed record DepartmentNotificationRow(long Id, DateTimeOffset OccurredAt);

    [Fact]
    public async Task ContractsAndPermitsFollowTheBusinessDayOfSantoDomingoNotTheUtcDay()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        // 21:30 on 5 November in Santo Domingo, 01:30 on 6 November in UTC.
        var clock = new MovableTimeProvider(EveningInSantoDomingo.AddMinutes(30));
        await using var provider = await SeededFinanceProviderAsync(database, ct, clock);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var documents = scope.ServiceProvider.GetRequiredService<IContractDocumentStore>();
        var lifecycle = scope.ServiceProvider.GetRequiredService<IContractLifecycleStore>();
        var permits = scope.ServiceProvider.GetRequiredService<IAirlinePermitStore>();
        var contractId = await context.ContractVersions.Where(item => item.PublicId == SeededContractVersion)
            .Select(item => item.ContractId).SingleAsync(ct);
        await context.Contracts.Where(item => item.Id == contractId).ExecuteUpdateAsync(update => update
            .SetProperty(item => item.Status, ContractStatus.Draft).SetProperty(item => item.SignedOn, (DateOnly?)null), ct);

        // The validity may still start today, and a permit that expires today is still current.
        var hash = await ConfirmValidityAsync(documents, SeededContractVersion, SantoDomingoToday, ct);
        var submitted = await permits.SubmitAsync(PortalAirlineAccount, new SubmitAirlinePermitInput("OperatingPermit",
            "JAC-2F", "Junta de Aviación Civil", SantoDomingoToday.AddDays(-30), SantoDomingoToday, null), null, ct);
        Assert.Null(submitted.Code);
        Assert.Equal("Verified", (await permits.ReviewAsync(ContractsAdministrator, submitted.Permit!.Id,
            new ReviewAirlinePermitInput(true, null, submitted.Permit.Version), null, ct)).Permit!.Review);
        Assert.Null((await documents.SignAsync(PortalAirlineAccount, SeededContractVersion, new SignContractInput(Guid.NewGuid(),
            "Casey Airline", "Director", hash, true, SignaturePng), ct)).Code);
        var countersigned = await documents.SignAsync(ContractsAdministrator, SeededContractVersion, new SignContractInput(
            Guid.NewGuid(), "Ana Pérez", "Gerente comercial", hash, true, SignaturePng), ct);
        Assert.Equal(SantoDomingoToday, countersigned.Document!.SignedOn);
        var contract = await context.Contracts.AsNoTracking().SingleAsync(item => item.Id == contractId, ct);
        Assert.Equal((ContractStatus.Active, (DateOnly?)SantoDomingoToday), (contract.Status, contract.SignedOn));

        // The hourly sweep keeps the contract until the business day ends, not at 20:00.
        Assert.Equal(0, (await lifecycle.SweepAsync(ct)).Suspended);
        clock.Now = BusinessCalendar.StartOfDay(SantoDomingoToday.AddDays(1)).AddMinutes(30);
        Assert.Equal(1, (await lifecycle.SweepAsync(ct)).Suspended);
    }
}
