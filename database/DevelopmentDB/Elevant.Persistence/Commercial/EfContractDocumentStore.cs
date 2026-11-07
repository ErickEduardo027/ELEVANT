using System.Data;
using Elevant.Application.Abstractions.Commercial;
using System.Security.Cryptography;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Common;
using Elevant.Application.Identity;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Formal contract document, its validity step, the party signatures and the withdrawal of a version
/// not signed by both parties (ADR-0024, ADR-0025, phase 2 block A). The signature and the validity
/// step run serializable and both change the version row, so a race between them is lost with
/// <c>content_changed</c> (2-N28). It also resolves the signed PDF attached to the activation email.
/// </summary>
internal sealed class EfContractDocumentStore(ElevantDbContext context, IActorContextResolver actors,
    TimeProvider timeProvider) : IContractDocumentStore
{
    private const string SignPermission = "contracts.agreements.sign";
    private const string ValidityPermission = "contracts.agreements.validity";
    private const string LifecyclePermission = "contracts.agreements.lifecycle";
    private const string ValidityAction = "contract.version.confirm_validity";
    private const string WithdrawAction = "contract.version.withdraw";
    public const string AttachmentPrefix = "contract-version:";
    private static readonly string[] InternalReaders = ["contracts.agreements.read", "finance.contract_approvals.read"];

    private sealed record Reader(long AccountId, ContractSignatureParty Party, bool CanSign);

    private readonly record struct VersionRow(long VersionId, long ContractId, Guid ContractPublicId, long AirlineId,
        ContractVersionStatus Status);

    public async Task<ContractDocumentResult> ReadAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        var row = await VersionAsync(versionId, cancellationToken);
        if (row is null) return Failed(ContractDocumentFailure.NotFound, "not_found");
        var reader = await ReaderAsync(actor, actorId, row.Value.AirlineId, cancellationToken);
        if (reader is null) return Failed(ContractDocumentFailure.Forbidden, "forbidden");
        var document = await ContractDocuments.LoadAsync(context, row.Value.VersionId, cancellationToken);
        return new(document with { SignableBy = SignableBy(document, reader) }, null);
    }

    public async Task<ContractDocumentResult> ReadDraftAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        var row = await VersionAsync(versionId, cancellationToken, draft: true);
        if (row is null) return Failed(ContractDocumentFailure.NotFound, "not_found");
        if (await ReaderAsync(actor, actorId, row.Value.AirlineId, cancellationToken) is null)
            return Failed(ContractDocumentFailure.Forbidden, "forbidden");
        return new(await ContractDocuments.LoadAsync(context, row.Value.VersionId, cancellationToken), null);
    }

    public async Task<ContractPricingTermsResult> ReadPricingTermsAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        var row = await VersionAsync(versionId, cancellationToken);
        if (row is null) return new(null, ContractDocumentFailure.NotFound);
        if (await ReaderAsync(actor, actorId, row.Value.AirlineId, cancellationToken) is null)
            return new(null, ContractDocumentFailure.Forbidden);
        var version = await context.ContractVersions.AsNoTracking().Where(item => item.Id == row.Value.VersionId)
            .Select(item => new { item.PublicId, item.CurrencyCode, item.PricingPolicyVersion }).SingleAsync(cancellationToken);
        var pricing = await ContractDocuments.PricingAsync(context, row.Value.VersionId, cancellationToken);
        var inDocument = version.PricingPolicyVersion >= ContractDocuments.SignedPricingPolicy;
        var signed = inDocument && ContractVersionGovernance.SignedByBoth(
            await GoverningContractVersions.SignaturesAsync(context, row.Value.VersionId, cancellationToken));
        return new(new ContractPricingTermsData(version.PublicId, version.CurrencyCode, inDocument, signed,
            pricing.Charges, pricing.Packages), null);
    }

    public async Task<ContractDocumentResult> SignAsync(Guid actorId, Guid versionId, SignContractInput input,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var name = input.SignerName?.Trim();
        var title = input.SignerTitle?.Trim();
        if (input.RequestId == Guid.Empty || !input.Accepted || name is not { Length: >= 3 and <= 160 } ||
            title is not { Length: >= 2 and <= 120 } || input.DocumentSha256 is not { Length: 64 })
            return Failed(ContractDocumentFailure.Invalid, "signature_invalid");
        // ADR-0025: every new signature is drawn; the PNG is checked before anything else is read.
        var image = ContractValidity.DecodeSignature(input.SignatureImagePng);
        if (image is null) return Failed(ContractDocumentFailure.Invalid, "signature_image_invalid");
        var imageSha256 = Convert.ToHexStringLower(SHA256.HashData(image));
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        var row = await VersionAsync(versionId, cancellationToken);
        if (row is null) return Failed(ContractDocumentFailure.NotFound, "not_found");
        var reader = await ReaderAsync(actor, actorId, row.Value.AirlineId, cancellationToken);
        if (reader is null || !reader.CanSign) return Failed(ContractDocumentFailure.Forbidden, "forbidden");
        var signature = new SignatureIntent(input.RequestId, name, title, input.DocumentSha256.ToLowerInvariant(), image,
            imageSha256);

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                var result = await SignInTransactionAsync(row.Value, reader, signature, cancellationToken);
                if (result.Failure is not null || result.Replayed)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result;
                }
                await transaction.CommitAsync(cancellationToken);
                return result;
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            // The contract changed after the checks; nothing was signed.
            context.ChangeTracker.Clear();
            return Failed(ContractDocumentFailure.Conflict,
                await TerminatedAsync(row.Value.ContractId, cancellationToken)
                    ? ContractLifecycleIssues.ContractTerminated : ContractLifecycleIssues.ContentChanged);
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // A concurrent retry of the same request won, or this party signed in the meantime.
            context.ChangeTracker.Clear();
            return await ReplayAsync(row.Value, reader, signature, cancellationToken) ??
                Failed(ContractDocumentFailure.AlreadySigned, "already_signed");
        }
    }

    private sealed record SignatureIntent(Guid RequestId, string Name, string Title, string DocumentSha256, byte[] Image,
        string ImageSha256);

    /// <summary>A retry of the same request returns the recorded signature; another use of the key is a conflict.</summary>
    private async Task<ContractDocumentResult?> ReplayAsync(VersionRow row, Reader reader, SignatureIntent intent,
        CancellationToken cancellationToken)
    {
        var previous = await context.ContractSignatures.AsNoTracking()
            .SingleOrDefaultAsync(item => item.RequestId == intent.RequestId, cancellationToken);
        if (previous is null) return null;
        return previous.ContractVersionId == row.VersionId && previous.SignerAccountId == reader.AccountId &&
               previous.SignerName == intent.Name && previous.SignerTitle == intent.Title &&
               previous.DocumentSha256 == intent.DocumentSha256 && previous.SignatureImageSha256 == intent.ImageSha256
            ? new(await ContractDocuments.LoadAsync(context, row.VersionId, cancellationToken), null, true)
            : Failed(ContractDocumentFailure.Conflict, "idempotency_conflict");
    }

    private async Task<ContractDocumentResult> SignInTransactionAsync(VersionRow row, Reader reader, SignatureIntent intent,
        CancellationToken cancellationToken)
    {
        if (await ReplayAsync(row, reader, intent, cancellationToken) is { } replay) return replay;
        var version = await context.ContractVersions.SingleAsync(item => item.Id == row.VersionId, cancellationToken);
        var contract = await context.Contracts.SingleAsync(item => item.Id == row.ContractId, cancellationToken);
        var document = await ContractDocuments.LoadAsync(context, version.Id, cancellationToken);
        if (version.Status != ContractVersionStatus.Approved)
            return Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.NotApproved);
        // A discarded or terminated contract is closed, and nothing starts on or after a scheduled
        // termination: its approved version is history, not an offer (2-N15).
        if (ContractLifecycle.ClosedFor(contract.Status, contract.TerminatedOn, version.ValidFrom) is { } closed)
            return Failed(ContractDocumentFailure.Conflict, closed);
        if (!string.Equals(document.ContentSha256, intent.DocumentSha256, StringComparison.OrdinalIgnoreCase))
            return Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.ContentChanged);
        if (document.Signatures.Any(item => item.Party == reader.Party.ToString()))
            return Failed(ContractDocumentFailure.AlreadySigned, "already_signed");
        if (document.Validity is null) return Failed(ContractDocumentFailure.ValidityPending, "validity_pending");
        // The airline signs first; AVIAM countersigns exactly what the airline accepted (2-N28). A
        // signature over other content can only be withdrawn with its version.
        var other = document.Signatures.FirstOrDefault(item => item.Party != reader.Party.ToString());
        if (reader.Party == ContractSignatureParty.Aviam && other is null)
            return Failed(ContractDocumentFailure.AirlineSignaturePending, "airline_signature_pending");
        if (other is not null && !string.Equals(other.DocumentSha256, document.ContentSha256, StringComparison.OrdinalIgnoreCase))
            return Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.AirlineSignedOtherContent);

        var now = Milliseconds(timeProvider.GetUtcNow());
        context.ContractSignatures.Add(new ContractSignature
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id, Party = reader.Party,
            SignerAccountId = reader.AccountId, SignerName = intent.Name, SignerTitle = intent.Title, SignedAt = now,
            DocumentSha256 = document.ContentSha256, RequestId = intent.RequestId, CreatedAt = now, UpdatedAt = now,
            SignatureImage = intent.Image, SignatureImageSha256 = intent.ImageSha256,
        });
        // 2-N28: every signature changes the version row, so a validity change read before it loses the race.
        version.UpdatedAt = now;
        CommercialAuditWriter.Add(context, reader.AccountId, "commercial.contract.signed",
            "commercial.contract_versions", version.PublicId, $"{reader.Party}: {intent.Name}, {intent.Title}");
        foreach (var recipient in await CommercialNotificationRecipients.WithPermissionAsync(context,
                     "contracts.agreements.read", cancellationToken))
            AccountChangeOutboxWriter.Add(context, recipient, null, "airline_contracts", row.ContractPublicId, now);
        if (reader.Party == ContractSignatureParty.Airline)
            await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, "contracts.agreements.read",
                "contract_signed", version.PublicId, document.AirlineName, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);

        // The second signature makes the version govern (2-C): what it replaces ends the day before it
        // starts and the flights not executed yet move to it. SignedOn of the contract is the day it first
        // activated and never moves (2-N05). A renewal of a contract already in force activates nothing,
        // so its signed PDF is sent from here; otherwise the activation conditions are checked (ADR-0024).
        if (other is not null)
        {
            await ContractVersionSupersession.ApplyAsync(context, version, reader.AccountId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            if (contract.Status == ContractStatus.Active)
            {
                await ContractActivation.QueueSignedContractEmailsAsync(context, contract.Id, version.Id, now,
                    cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
            }
            else await ContractActivation.ActivateReadyAsync(context, row.AirlineId, reader.AccountId, now, cancellationToken);
        }
        return new(await ContractDocuments.LoadAsync(context, version.Id, cancellationToken) with { SignableBy = null }, null);
    }

    public async Task<ContractDocumentResult> SetValidityAsync(Guid actorId, Guid versionId, ContractValidityInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!IsInternal(actor, ValidityPermission)) return Failed(ContractDocumentFailure.Forbidden, "forbidden");
        // Expand phase: the key is optional; the expected content hash is the version token.
        if (idempotencyKey == Guid.Empty) return Failed(ContractDocumentFailure.Invalid, "idempotency_key_required");
        if (input.ExpectedDocumentSha256 is not { Length: 64 })
            return Failed(ContractDocumentFailure.Invalid, "expected_version_required");
        var row = await VersionAsync(versionId, cancellationToken);
        if (row is null) return Failed(ContractDocumentFailure.NotFound, "not_found");
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var terms = string.IsNullOrWhiteSpace(input.TerminationTerms) ? null : input.TerminationTerms.Trim();
        var hash = CommercialCommandReceipts.Hash(new
        {
            versionId, input.ValidFrom, input.ValidTo, input.RenewalMode, input.RenewalTermMonths, input.RenewalNoticeDays,
            input.TerminationNoticeDays, terms, expected = input.ExpectedDocumentSha256.ToLowerInvariant(),
        });

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            var outcome = await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                if (idempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, accountId, ValidityAction, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return Failed(ContractDocumentFailure.Conflict, "idempotency_conflict");
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return new ContractDocumentResult(null, null, true);
                }
                var failure = await SetValidityInTransactionAsync(row.Value, input, terms, accountId, cancellationToken);
                if (failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return failure;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, accountId, ValidityAction, hash, versionId,
                        timeProvider.GetUtcNow());
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return new ContractDocumentResult(null, null);
            });
            if (outcome.Failure is not null) return outcome;
            return await WithReaderAsync(actor, actorId, row.Value, outcome.Replayed, cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return Failed(ContractDocumentFailure.Conflict,
                await TerminatedAsync(row.Value.ContractId, cancellationToken)
                    ? ContractLifecycleIssues.ContractTerminated : ContractLifecycleIssues.ContentChanged);
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, accountId, ValidityAction, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await WithReaderAsync(actor, actorId, row.Value, true, cancellationToken)
                : Failed(ContractDocumentFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // Another contract took the same final code at the same time: read again and retry.
            context.ChangeTracker.Clear();
            return Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.ContentChanged);
        }
    }

    private async Task<ContractDocumentResult?> SetValidityInTransactionAsync(VersionRow row, ContractValidityInput input,
        string? terms, long accountId, CancellationToken cancellationToken)
    {
        var version = await context.ContractVersions.SingleAsync(item => item.Id == row.VersionId, cancellationToken);
        var contract = await context.Contracts.SingleAsync(item => item.Id == row.ContractId, cancellationToken);
        if (version.Status != ContractVersionStatus.Approved)
            return Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.NotApproved);
        var current = await ContractDocuments.LoadAsync(context, version.Id, cancellationToken);
        if (current.Signatures.Count > 0) return Failed(ContractDocumentFailure.Conflict, "already_signed");
        if (ContractLifecycle.ClosedFor(contract.Status, contract.TerminatedOn, input.ValidFrom) is { } closed)
            return Failed(ContractDocumentFailure.Conflict, closed);
        if (!string.Equals(current.ContentSha256, input.ExpectedDocumentSha256, StringComparison.OrdinalIgnoreCase))
            return Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.ContentChanged);

        var now = Milliseconds(timeProvider.GetUtcNow());
        // 2-F: «today» is AVIAM's business day; from 20:00 in Santo Domingo the UTC day is already tomorrow.
        var today = BusinessCalendar.Today(now);
        var previousFrom = await context.ContractVersions.AsNoTracking()
            .Where(item => item.ContractId == row.ContractId && item.Id != row.VersionId &&
                (item.Status == ContractVersionStatus.Approved || item.Status == ContractVersionStatus.Superseded))
            .OrderByDescending(item => item.ValidFrom).Select(item => (DateOnly?)item.ValidFrom)
            .FirstOrDefaultAsync(cancellationToken);
        if (ContractValidity.Check(input.ValidFrom, input.ValidTo, input.RenewalMode, input.RenewalTermMonths,
                input.RenewalNoticeDays, input.TerminationNoticeDays, input.TerminationTerms, today, previousFrom) is { } code)
            return Failed(ContractDocumentFailure.Invalid, code);
        // A renewal or an amendment keeps starting after the version it follows (the rule Finance approved it
        // with): the version in force is replaced at the second signature, never overlapped (2-C).
        if (previousFrom is { } previous && input.ValidFrom <= previous)
            return Failed(ContractDocumentFailure.Invalid, ContractDraftIssues.ValidFromNotAfterCurrent);
        // Packages Finance approved must still cover the confirmed dates.
        var packages = await (from link in context.Set<ContractServicePackage>().AsNoTracking()
                              join package in context.Set<ServicePackageVersion>().AsNoTracking()
                                  on link.PackageVersionId equals package.Id
                              where link.ContractVersionId == row.VersionId
                              select new { package.ValidFrom, package.ValidTo }).ToArrayAsync(cancellationToken);
        if (packages.Any(package => package.ValidFrom > input.ValidFrom ||
                package.ValidTo is { } until && until < input.ValidTo!.Value))
            return Failed(ContractDocumentFailure.Invalid, "packages_out_of_range");

        // Since 2-C the version this one replaces keeps its end until the second signature. A version a
        // Finance approval ended before that change still follows a moved start.
        if (version.ValidFrom != input.ValidFrom)
            foreach (var replaced in await context.ContractVersions
                         .Where(item => item.ContractId == row.ContractId && item.Id != row.VersionId &&
                             item.Status == ContractVersionStatus.Superseded && item.ValidTo == version.ValidFrom.AddDays(-1))
                         .ToArrayAsync(cancellationToken))
            {
                if (input.ValidFrom.AddDays(-1) < replaced.ValidFrom)
                    return Failed(ContractDocumentFailure.Invalid, "valid_from_past");
                replaced.ValidTo = input.ValidFrom.AddDays(-1);
                replaced.UpdatedAt = now;
            }
        version.ValidFrom = input.ValidFrom;
        version.ValidTo = input.ValidTo;
        version.RenewalMode = Enum.Parse<ContractRenewalMode>(input.RenewalMode);
        version.RenewalTermMonths = input.RenewalTermMonths;
        version.RenewalNoticeDays = input.RenewalNoticeDays;
        version.TerminationNoticeDays = input.TerminationNoticeDays;
        version.TerminationTerms = terms;
        version.ValidityConfirmedAt = now;
        version.ValidityConfirmedByAccountId = accountId;
        version.RenewalStartedAt = null;
        // 2-N04: nobody signed it yet, so the surcharges Finance froze and its packages join the content to
        // sign. A version approved before the frozen policy (0) keeps billing the base surcharges unsigned.
        if (version.PricingPolicyVersion > 0)
            version.PricingPolicyVersion = Math.Max(version.PricingPolicyVersion, ContractDocuments.SignedPricingPolicy);
        version.UpdatedAt = now;
        // The final code is printed on what both parties sign, so it is assigned now and never changes.
        if (ContractValidity.IsDraftCode(contract.ContractCode))
        {
            // Next number of the year from the codes already issued; the unique index on the code
            // turns a concurrent duplicate into a conflict the caller retries (CRUD schemas hold no
            // sequences: verify-development-team-access.sql).
            var prefix = ContractValidity.FinalCode(now.Year, 0)[..^4];
            var issued = await context.Contracts.AsNoTracking().Where(item => item.ContractCode.StartsWith(prefix))
                .Select(item => item.ContractCode).ToArrayAsync(cancellationToken);
            contract.ContractCode = ContractValidity.FinalCode(now.Year, ContractValidity.NextSequence(issued, now.Year));
        }
        // 2-N12: the expiry notice restarts only when the coverage end changes: here for a version that already
        // governs (the legacy exemption); a renewal or an amendment restarts it at its second signature
        // (ContractVersionSupersession), so the airline is not told twice about the same end.
        if (await GoverningContractVersions.Of(context).AnyAsync(item => item.Id == version.Id, cancellationToken))
            contract.ExpiryNoticeSentAt = null;
        contract.UpdatedAt = now;
        CommercialAuditWriter.Add(context, accountId, "commercial.contract.validity_confirmed",
            "commercial.contract_versions", version.PublicId,
            $"{input.ValidFrom:yyyy-MM-dd} – {input.ValidTo:yyyy-MM-dd} · {input.RenewalMode}");
        await ContractActivation.AnnounceAsync(context, contract, "contract_validity", now, cancellationToken);
        // 2-N13: the version can be signed from now on, so the airline is told by email, not when Finance approves.
        // Queued in this transaction: a replay of the validity step never repeats it.
        await AirlineNoticeEmails.QueueAsync(context, contract.AirlineId, EmailPurpose.ContractReadyToSign,
            (email, airline) => AccountEmailTemplates.ContractReadyToSign(email, airline, contract.ContractCode,
                version.VersionNumber, input.ValidFrom, input.ValidTo,
                contract.Status is ContractStatus.Active or ContractStatus.Suspended), now, cancellationToken);
        return null;
    }

    public async Task<ContractWithdrawalResult> WithdrawAsync(Guid actorId, Guid versionId, WithdrawContractVersionInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(input);
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (!IsInternal(actor, LifecyclePermission))
            return ContractWithdrawalResult.Failed(ContractDocumentFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty)
            return ContractWithdrawalResult.Failed(ContractDocumentFailure.Invalid, "idempotency_key_required");
        if (input.ExpectedDocumentSha256 is not { Length: 64 } expected)
            return ContractWithdrawalResult.Failed(ContractDocumentFailure.Invalid, "expected_version_required");
        if (!ContractLifecycle.ValidReason(input.Reason))
            return ContractWithdrawalResult.Failed(ContractDocumentFailure.Invalid, "reason_required");
        var reason = input.Reason.Trim();
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { versionId, reason, expected = expected.ToLowerInvariant() });

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                var prior = await CommercialCommandReceipts.FindAsync(context, idempotencyKey, accountId, WithdrawAction, hash,
                    cancellationToken);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                    return ContractWithdrawalResult.Failed(ContractDocumentFailure.Conflict, "idempotency_conflict");
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                    return await WithdrawalReplayAsync(versionId, prior.ResultId, cancellationToken);
                var result = await WithdrawInTransactionAsync(versionId, expected, reason, accountId, cancellationToken);
                if (result.Failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result;
                }
                CommercialCommandReceipts.Add(context, idempotencyKey, accountId, WithdrawAction, hash,
                    result.Withdrawal!.DraftVersionId ?? versionId, timeProvider.GetUtcNow());
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return result;
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return ContractWithdrawalResult.Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.ContentChanged);
        }
        catch (DbUpdateException exception) when (CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, idempotencyKey, accountId, WithdrawAction,
                hash, cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await WithdrawalReplayAsync(versionId, concurrent.ResultId, cancellationToken)
                : ContractWithdrawalResult.Failed(ContractDocumentFailure.Conflict, "idempotency_conflict");
        }
    }

    /// <summary>A retry answers the version and contract as they are now and the draft the withdrawal created.</summary>
    private async Task<ContractWithdrawalResult> WithdrawalReplayAsync(Guid versionId, Guid resultId,
        CancellationToken cancellationToken)
    {
        var state = await (from version in context.ContractVersions.AsNoTracking()
                           join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                           where version.PublicId == versionId
                           select new { version.Status, ContractStatus = contract.Status }).SingleAsync(cancellationToken);
        return new(new ContractWithdrawalData(versionId, state.Status.ToString(), state.ContractStatus.ToString(),
            resultId == versionId ? null : resultId), null);
    }

    private async Task<ContractWithdrawalResult> WithdrawInTransactionAsync(Guid versionId, string expected, string reason,
        long accountId, CancellationToken cancellationToken)
    {
        var version = await context.ContractVersions.SingleOrDefaultAsync(item => item.PublicId == versionId, cancellationToken);
        if (version is null) return ContractWithdrawalResult.Failed(ContractDocumentFailure.NotFound, "not_found");
        var contract = await context.Contracts.SingleAsync(item => item.Id == version.ContractId, cancellationToken);
        if (version.Status != ContractVersionStatus.Approved)
            return ContractWithdrawalResult.Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.NotApproved);
        var document = await ContractDocuments.LoadAsync(context, version.Id, cancellationToken);
        if (!string.Equals(document.ContentSha256, expected, StringComparison.OrdinalIgnoreCase))
            return ContractWithdrawalResult.Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.ContentChanged);
        // Signed by both, or the legacy version an active contract runs on: it governs and stays.
        if (await GoverningContractVersions.Of(context).AnyAsync(item => item.Id == version.Id, cancellationToken))
            return ContractWithdrawalResult.Failed(ContractDocumentFailure.Conflict, ContractLifecycleIssues.VersionSigned);

        var now = Milliseconds(timeProvider.GetUtcNow());
        await ContractVersionWithdrawal.WithdrawAsync(context, version, accountId, reason, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        // A contract that never activated and has nothing else alive gets the same content back as a draft,
        // so Contratos corrects it and sends it to Finance again instead of starting from a new request.
        Guid? draftId = null;
        if (contract.Status == ContractStatus.Draft && !await context.ContractVersions.AnyAsync(item =>
                item.ContractId == contract.Id && item.Status != ContractVersionStatus.Rejected, cancellationToken))
        {
            var number = await context.ContractVersions.Where(item => item.ContractId == contract.Id)
                .MaxAsync(item => item.VersionNumber, cancellationToken);
            var draft = new ContractVersion
            {
                PublicId = Guid.CreateVersion7(), ContractId = contract.Id, VersionNumber = number + 1,
                Status = ContractVersionStatus.Draft, ValidFrom = version.ValidFrom, ValidTo = version.ValidTo,
                CurrencyCode = version.CurrencyCode, Terms = version.Terms, CreatedAt = now, UpdatedAt = now,
            };
            context.ContractVersions.Add(draft);
            await context.SaveChangesAsync(cancellationToken);
            await ContractVersionCopy.CopyAsync(context, version, draft, ratesConfirmed: true, now, cancellationToken);
            await ContractDraftAudience.NotifyContractsAsync(context, ContractDraftAudience.DraftsResource, draft.PublicId,
                now, cancellationToken);
            draftId = draft.PublicId;
        }
        contract.UpdatedAt = now;
        await ContractActivation.AnnounceAsync(context, contract, "contract_version_withdrawn", now, cancellationToken);
        return new(new ContractWithdrawalData(versionId, version.Status.ToString(), contract.Status.ToString(), draftId), null);
    }

    /// <summary>Document of an approved or superseded version for system use (the activation email), without a reader.</summary>
    internal async Task<ContractDocumentData?> SystemDocumentAsync(Guid versionId, CancellationToken cancellationToken)
    {
        var row = await VersionAsync(versionId, cancellationToken);
        return row is null ? null : await ContractDocuments.LoadAsync(context, row.Value.VersionId, cancellationToken);
    }

    private async Task<ContractDocumentResult> WithReaderAsync(ActorContext? actor, Guid actorId, VersionRow row,
        bool replayed, CancellationToken cancellationToken)
    {
        var reader = await ReaderAsync(actor, actorId, row.AirlineId, cancellationToken);
        var document = await ContractDocuments.LoadAsync(context, row.VersionId, cancellationToken);
        return new(reader is null ? document : document with { SignableBy = SignableBy(document, reader) }, null, replayed);
    }

    private static ContractDocumentResult Failed(ContractDocumentFailure failure, string? code = null) =>
        new(null, failure, Code: code);

    private static DateTimeOffset Milliseconds(DateTimeOffset value) =>
        new(value.Ticks - value.Ticks % TimeSpan.TicksPerMillisecond, TimeSpan.Zero);

    private static bool IsInternal(ActorContext? actor, string permission) =>
        actor is not null && actor.HasPermission(permission) &&
        actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
            membership.OrganizationType == OrganizationType.AviamOperator);

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.AsNoTracking().Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

    /// <summary>Whether the contract is terminated now, read past the change tracker (after a conflict).</summary>
    private Task<bool> TerminatedAsync(long contractId, CancellationToken cancellationToken) =>
        context.Contracts.AsNoTracking()
            .AnyAsync(item => item.Id == contractId && item.Status == ContractStatus.Terminated, cancellationToken);

    /// <summary>
    /// The party may sign now: validity confirmed, not signed yet, the contract open for this version and,
    /// for AVIAM, after the airline signed this same content.
    /// </summary>
    private static string? SignableBy(ContractDocumentData document, Reader reader) =>
        reader.CanSign && document.VersionStatus == nameof(ContractVersionStatus.Approved) && document.Validity is not null &&
        document.ContractStatus != nameof(ContractStatus.Terminated) &&
        document.Signatures.All(item => item.Party != reader.Party.ToString()) &&
        (reader.Party == ContractSignatureParty.Airline
            ? document.Signatures.All(item => string.Equals(item.DocumentSha256, document.ContentSha256, StringComparison.OrdinalIgnoreCase))
            : document.Signatures.Any(item => item.Party == nameof(ContractSignatureParty.Airline) &&
                string.Equals(item.DocumentSha256, document.ContentSha256, StringComparison.OrdinalIgnoreCase)))
            ? reader.Party.ToString() : null;

    private async Task<VersionRow?> VersionAsync(Guid versionId, CancellationToken cancellationToken, bool draft = false)
    {
        // Drafts follow the draft lists: editable or awaiting Finance, on a contract that is not terminated.
        var row = await (from version in context.ContractVersions.AsNoTracking()
                         join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                         where version.PublicId == versionId && (draft
                             ? (version.Status == ContractVersionStatus.Draft ||
                                version.Status == ContractVersionStatus.PendingFinanceApproval) &&
                               contract.Status != ContractStatus.Terminated
                             : version.Status == ContractVersionStatus.Approved || version.Status == ContractVersionStatus.Superseded)
                         select new { version.Id, ContractId = contract.Id, contract.PublicId, contract.AirlineId, version.Status })
            .SingleOrDefaultAsync(cancellationToken);
        return row is null ? null : new VersionRow(row.Id, row.ContractId, row.PublicId, row.AirlineId, row.Status);
    }

    private async Task<Reader?> ReaderAsync(ActorContext? actor, Guid actorId, long airlineId,
        CancellationToken cancellationToken)
    {
        if (actor is null) return null;
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        if (actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return InternalReaders.Any(actor.HasPermission)
                ? new Reader(accountId, ContractSignatureParty.Aviam, actor.HasPermission(SignPermission)) : null;
        if (!actor.Roles.Any(role => role.Code == "AIRLINE_CLIENT" && role.Portal == PortalKind.AirlinePortal)) return null;
        var organizations = actor.Memberships.Where(membership => membership.Kind == MembershipKind.AirlineClient &&
                membership.OrganizationType == OrganizationType.AirlineCustomer)
            .Select(membership => membership.OrganizationId).ToArray();
        var owns = await (from organization in context.Organizations.AsNoTracking()
                          join airline in context.Airlines.AsNoTracking() on organization.Id equals airline.OrganizationId
                          where organizations.Contains(organization.PublicId) && organization.Status == OrganizationStatus.Active &&
                                airline.IsActive && airline.Id == airlineId
                          select airline.Id).AnyAsync(cancellationToken);
        return owns ? new Reader(accountId, ContractSignatureParty.Airline, true) : null;
    }
}
