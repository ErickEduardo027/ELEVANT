using System.Data;
using System.Globalization;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Common;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Chronological lifecycle of a contract (ADR-0024): manual actions of Contratos, the daily sweep
/// and the merged history from the request to the last change. Every change writes a
/// <see cref="ContractStatusEvent"/>. Versions are read through <see cref="GoverningContractVersions"/>
/// (2-C) and days are AVIAM's business days (2-F).
/// </summary>
internal sealed class EfContractLifecycleStore(ElevantDbContext context, CommercialPermissionGuard permissions,
    TimeProvider timeProvider) : IContractLifecycleStore
{
    private const string LifecyclePermission = "contracts.agreements.lifecycle";
    private static readonly string[] Readers = ["contracts.agreements.read", "finance.contract_approvals.read"];

    public async Task<ContractLifecycleResult> ApplyAsync(Guid actorId, Guid versionId, ContractLifecycleInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAnyAsync(actorId, [LifecyclePermission], cancellationToken))
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Forbidden);
        // Expand phase: the key is optional; the expected status is the version token it goes with.
        if (idempotencyKey == Guid.Empty)
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Invalid, "idempotency_key_required");
        if (input is not null && string.IsNullOrWhiteSpace(input.ExpectedStatus))
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Invalid, "expected_version_required");
        if (input is null || !Enum.TryParse<ContractLifecycleAction>(input.Action, true, out var action) ||
            !Enum.IsDefined(action) || !Enum.TryParse<ContractStatus>(input.ExpectedStatus, out var expected))
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Invalid, "invalid_lifecycle_action");
        if (!ContractLifecycle.ValidReason(input.Reason))
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Invalid, "reason_required");
        var reason = input.Reason.Trim();
        var cause = string.IsNullOrWhiteSpace(input.ImmediateCause) ? null : input.ImmediateCause.Trim();
        var commandAction = $"contract.lifecycle.{action.ToString().ToLowerInvariant()}";
        // The fields a termination gained (2-N14) join the hash only when present, so receipts stored
        // before keep replaying their result.
        var hash = input.EffectiveOn is null && cause is null
            ? CommercialCommandReceipts.Hash(new { versionId, action, reason, expected, input.ValidFrom, input.ValidTo })
            : CommercialCommandReceipts.Hash(new
            {
                versionId, action, reason, expected, input.ValidFrom, input.ValidTo, input.EffectiveOn, immediateCause = cause,
            });
        var actor = await context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id)
            .SingleAsync(cancellationToken);

        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                if (idempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actor, commandAction, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict, "idempotency_conflict");
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return await ReplayAsync(versionId, action, prior.ResultId, cancellationToken);
                }
                var result = await ApplyInTransactionAsync(actor, versionId, input, action, expected, reason, cause,
                    cancellationToken);
                if (result.Failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result.Public;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actor, commandAction, hash,
                        result.DraftVersionId ?? result.ContractId, timeProvider.GetUtcNow());
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return result.Public;
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict, "status_changed");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actor, commandAction, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await ReplayAsync(versionId, action, concurrent.ResultId, cancellationToken)
                : ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict, "idempotency_conflict");
        }
    }

    /// <summary>A retry answers the contract's current status and, for a renewal, its draft.</summary>
    private async Task<ContractLifecycleResult> ReplayAsync(Guid versionId, ContractLifecycleAction action, Guid resultId,
        CancellationToken cancellationToken)
    {
        var status = await (from version in context.ContractVersions.AsNoTracking()
                            join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                            where version.PublicId == versionId
                            select contract.Status).SingleAsync(cancellationToken);
        return new ContractLifecycleResult(status.ToString(), action == ContractLifecycleAction.Renew ? resultId : null, null);
    }

    private sealed record Applied(ContractLifecycleResult Public, Guid ContractId)
    {
        public ContractLifecycleFailure? Failure => Public.Failure;
        public Guid? DraftVersionId => Public.DraftVersionId;
    }

    private async Task<Applied> ApplyInTransactionAsync(long actor, Guid versionId, ContractLifecycleInput input,
        ContractLifecycleAction action, ContractStatus expected, string reason, string? cause,
        CancellationToken cancellationToken)
    {
        Applied Failed(ContractLifecycleFailure failure, string? code = null) =>
            new(ContractLifecycleResult.Failed(failure, code), Guid.Empty);
        var contractId = await context.ContractVersions.Where(item => item.PublicId == versionId)
            .Select(item => (long?)item.ContractId).SingleOrDefaultAsync(cancellationToken);
        if (contractId is null) return Failed(ContractLifecycleFailure.NotFound, "not_found");
        var contract = await context.Contracts.SingleAsync(item => item.Id == contractId, cancellationToken);
        if (contract.Status != expected) return Failed(ContractLifecycleFailure.Conflict, "status_changed");
        if (ContractLifecycle.Target(action, contract.Status) is not { } target)
            return Failed(ContractLifecycleFailure.Conflict, "transition_not_allowed");

        var now = timeProvider.GetUtcNow();
        // 2-F: lifecycle days are AVIAM's business days.
        var today = BusinessCalendar.Today(now);
        var governing = GoverningContractVersions.Of(context);
        Guid? draftId = null;
        var kind = "contract_lifecycle";
        var auditAction = $"commercial.contract.{action.ToString().ToLowerInvariant()}";
        var changes = Array.Empty<AuditFieldChangeData>();
        var eventReason = reason;
        switch (action)
        {
            case ContractLifecycleAction.Reactivate:
                if (contract.TerminatedOn is { } terminatedOn && terminatedOn <= today)
                    return Failed(ContractLifecycleFailure.Conflict, ContractLifecycleIssues.ContractTerminated);
                if (!await ContractActivation.HasUsablePermitAsync(context, contract.AirlineId, today, cancellationToken))
                    return Failed(ContractLifecycleFailure.Invalid, "permit_required");
                // 2-C: the version in force is one that governs; Finance approval alone is not enough.
                if (!await governing.AnyAsync(item => item.ContractId == contract.Id &&
                        (item.ValidTo == null || item.ValidTo >= today), cancellationToken))
                    return Failed(ContractLifecycleFailure.Invalid, "no_version_in_force");
                break;
            case ContractLifecycleAction.Terminate:
                var notice = await NoticeDaysAsync(contract.Id, today, cancellationToken);
                var (plan, issue) = ContractLifecycle.PlanTermination(contract.Status, today, input.EffectiveOn, cause,
                    notice, contract.TerminatedOn);
                if (issue is not null)
                    return Failed(issue == ContractLifecycleIssues.TerminationScheduled
                        ? ContractLifecycleFailure.Conflict : ContractLifecycleFailure.Invalid, issue);
                var first = plan!.Value.TerminatedOn;
                // ck_contract_dates: a legacy SignedOn recorded as a UTC day may be one day ahead.
                if (contract.SignedOn is { } signed && signed > first) first = signed;
                // An immediate cause may bring a scheduled termination forward; the audit keeps both dates.
                changes = [new AuditFieldChangeData("contract.terminated_on", Text(contract.TerminatedOn), Text(first))];
                contract.TerminatedOn = first;
                contract.UpdatedAt = now;
                // A terminated contract («Descartar contrato» too, 1-B) closes its drafts and the approved
                // versions still waiting for signatures in the same transaction (2-N15).
                await CloseOpenVersionsAsync(contract, actor, reason, now, cancellationToken);
                // The history names the immediate cause before the note that explains it.
                if (cause is not null && contract.Status is ContractStatus.Active or ContractStatus.Suspended)
                    eventReason = $"{ContractTerminationCauses.Label(cause)}: {reason}";
                if (!plan.Value.Immediate)
                {
                    // 2-N14: the contract keeps covering until its first day without coverage; the sweep ends it.
                    target = contract.Status;
                    kind = "contract_termination_scheduled";
                    auditAction = "commercial.contract.termination_scheduled";
                }
                break;
            case ContractLifecycleAction.CancelTermination:
                if (contract.TerminatedOn is not { } scheduled)
                    return Failed(ContractLifecycleFailure.Conflict, ContractLifecycleIssues.TerminationNotScheduled);
                if (scheduled <= today)
                    return Failed(ContractLifecycleFailure.Conflict, ContractLifecycleIssues.ContractTerminated);
                changes = [new AuditFieldChangeData("contract.terminated_on", Text(scheduled), null)];
                contract.TerminatedOn = null;
                contract.UpdatedAt = now;
                kind = "contract_termination_cancelled";
                auditAction = "commercial.contract.termination_cancelled";
                break;
            case ContractLifecycleAction.Renew:
                var renewal = await RenewAsync(contract, input, now, cancellationToken);
                if (renewal.Failure is not null) return new(renewal, Guid.Empty);
                draftId = renewal.DraftVersionId;
                break;
        }
        if (target != contract.Status)
        {
            context.Set<ContractStatusEvent>().Add(new ContractStatusEvent
            {
                ContractId = contract.Id, FromStatus = contract.Status, ToStatus = target, OccurredAt = now,
                ActorAccountId = actor, Reason = eventReason,
            });
            contract.Status = target;
            contract.UpdatedAt = now;
        }
        CommercialAuditWriter.Add(context, actor, auditAction, "commercial.contracts", contract.PublicId, eventReason, changes);
        await ContractActivation.AnnounceAsync(context, contract, kind, now, cancellationToken);
        // 2-N12: the airline learns about a manual suspension by email, never with the internal reason.
        if (action == ContractLifecycleAction.Suspend)
            await ContractActivation.QueueSuspensionEmailsAsync(context, contract, ContractSuspensionCause.Manual, now,
                cancellationToken);
        return new(new ContractLifecycleResult(contract.Status.ToString(), draftId, null), contract.PublicId);
    }

    /// <summary>Notice days the version in force today signed (2-N14); a version without validity terms has none.</summary>
    private async Task<int> NoticeDaysAsync(long contractId, DateOnly today, CancellationToken cancellationToken) =>
        await GoverningContractVersions.Of(context)
            .Where(item => item.ContractId == contractId && item.ValidFrom <= today && (item.ValidTo == null || item.ValidTo >= today))
            .OrderByDescending(item => item.ValidFrom).Select(item => item.TerminationNoticeDays)
            .FirstOrDefaultAsync(cancellationToken) ?? 0;

    /// <summary>
    /// The drafts and versions awaiting Finance of a terminated contract become Rejected, and so do the
    /// approved versions that still wait for both signatures (2-N15): nothing is deleted, Finance no longer
    /// sees them as pending and nobody signs them. A null <paramref name="actor"/> is the sweep that ends a
    /// scheduled termination.
    /// </summary>
    private async Task CloseOpenVersionsAsync(Contract contract, long? actor, string reason, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var open = await context.ContractVersions.Where(item => item.ContractId == contract.Id &&
                (item.Status == ContractVersionStatus.Draft || item.Status == ContractVersionStatus.PendingFinanceApproval))
            .ToArrayAsync(cancellationToken);
        foreach (var version in open)
        {
            var pending = version.Status == ContractVersionStatus.PendingFinanceApproval;
            version.Status = ContractVersionStatus.Rejected;
            version.UpdatedAt = now;
            CommercialAuditWriter.Add(context, actor, "commercial.draft.discarded", "commercial.contract_versions",
                version.PublicId, reason);
            await ContractDraftAudience.NotifyContractsAsync(context, ContractDraftAudience.DraftsResource,
                version.PublicId, now, cancellationToken);
            if (!pending) continue;
            foreach (var recipient in await CommercialNotificationRecipients.WithPermissionAsync(context,
                         "finance.contract_approvals.read", cancellationToken))
                AccountChangeOutboxWriter.Add(context, recipient, null, "contract_approvals", version.PublicId, now);
        }
        // Approved versions that do not govern: on a contract that never activated, every one not signed by
        // both; otherwise the renewals and amendments still waiting (the version in force stays as history).
        var awaiting = GoverningContractVersions.AwaitingSignatures(context);
        foreach (var version in await context.ContractVersions.Where(item => item.ContractId == contract.Id &&
                         awaiting.Any(waiting => waiting.Id == item.Id)).ToArrayAsync(cancellationToken))
            await ContractVersionWithdrawal.WithdrawAsync(context, version, actor, reason, now, cancellationToken);
    }

    /// <summary>
    /// Copies the version in force into a new draft with the new validity; Finance approves it as usual
    /// (2-N01, 2-N03): rates, terms, stations, negotiated surcharges, exemptions and packages. Never from a
    /// contract with a scheduled termination, nor while an approved version waits for its signatures.
    /// </summary>
    private async Task<ContractLifecycleResult> RenewAsync(Contract contract, ContractLifecycleInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (input.ValidFrom is not { } from || input.ValidTo is { } until && until < from)
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Invalid, "renewal_dates_invalid");
        if (contract.TerminatedOn is not null)
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict, ContractLifecycleIssues.TerminationScheduled);
        if (await context.ContractVersions.AnyAsync(item => item.ContractId == contract.Id &&
                (item.Status == ContractVersionStatus.Draft || item.Status == ContractVersionStatus.PendingFinanceApproval), cancellationToken))
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict, "draft_in_progress");
        if (await GoverningContractVersions.AwaitingSignatures(context).AnyAsync(item => item.ContractId == contract.Id,
                cancellationToken))
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict, ContractLifecycleIssues.VersionAwaitingSignatures);
        var source = await GoverningContractVersions.Of(context).AsNoTracking()
            .Where(item => item.ContractId == contract.Id && item.Status == ContractVersionStatus.Approved)
            .OrderByDescending(item => item.ValidFrom).ThenByDescending(item => item.VersionNumber)
            .FirstOrDefaultAsync(cancellationToken);
        if (source is null) return ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict, "no_approved_version");
        if (from <= source.ValidFrom)
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Invalid, "renewal_dates_invalid");
        var number = await context.ContractVersions.Where(item => item.ContractId == contract.Id)
            .MaxAsync(item => item.VersionNumber, cancellationToken);
        var draft = new ContractVersion
        {
            PublicId = Guid.CreateVersion7(), ContractId = contract.Id, VersionNumber = number + 1,
            Status = ContractVersionStatus.Draft, ValidFrom = from, ValidTo = input.ValidTo,
            CurrencyCode = source.CurrencyCode, Terms = source.Terms, CreatedAt = now, UpdatedAt = now,
        };
        context.ContractVersions.Add(draft);
        await context.SaveChangesAsync(cancellationToken);
        await ContractVersionCopy.CopyAsync(context, source, draft, ratesConfirmed: true, now, cancellationToken);
        return new ContractLifecycleResult(contract.Status.ToString(), draft.PublicId, null);
    }

    public async Task<ContractLifecycleSweep> SweepAsync(CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        // 2-F: a contract or a permit ends at the close of AVIAM's business day, not at 20:00 in Santo Domingo.
        var today = BusinessCalendar.Today(now);

        // 2-N14: a scheduled termination takes effect on its first day without coverage. What was still open
        // (an amendment that started before that day and nobody finished) closes with the contract (2-N15).
        var terminated = 0;
        foreach (var contract in await context.Contracts
                     .Where(item => (item.Status == ContractStatus.Active || item.Status == ContractStatus.Suspended ||
                             item.Status == ContractStatus.Expired) && item.TerminatedOn != null && item.TerminatedOn <= today)
                     .ToArrayAsync(cancellationToken))
        {
            const string reason = "Terminación programada: el contrato terminó en su fecha efectiva.";
            await CloseOpenVersionsAsync(contract, null, reason, now, cancellationToken);
            Change(contract, ContractStatus.Terminated, reason, now);
            await ContractActivation.AnnounceAsync(context, contract, "contract_terminated", now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            terminated++;
        }
        var activated = await ContractActivation.ActivateReadyAsync(context, null, null, now, cancellationToken);

        // Expired: no version that governs (2-C) is in force today or later. A renewal Finance approved but
        // nobody signed does not extend the contract.
        var governing = GoverningContractVersions.Of(context);
        var expired = 0;
        foreach (var contract in await context.Contracts
                     .Where(item => (item.Status == ContractStatus.Active || item.Status == ContractStatus.Suspended) &&
                         !governing.Any(version => version.ContractId == item.Id &&
                             (version.ValidTo == null || version.ValidTo >= today)))
                     .ToArrayAsync(cancellationToken))
        {
            Change(contract, ContractStatus.Expired, "Venció la vigencia de la última versión firmada.", now);
            await ContractActivation.AnnounceAsync(context, contract, "contract_expired", now, cancellationToken);
            expired++;
        }

        // Suspended: the airline had a verified operating permit (or one Contratos revoked, 2-N09), but none is
        // usable today. Contracts signed before the permit dossier existed are left alone (expand phase, ADR-0024).
        var suspended = 0;
        foreach (var contract in await context.Contracts
                     .Where(item => item.Status == ContractStatus.Active &&
                         context.AirlinePermits.Any(permit => permit.AirlineId == item.AirlineId &&
                             permit.Kind == AirlinePermitKind.OperatingPermit &&
                             (permit.Review == AirlinePermitReview.Verified || permit.Review == AirlinePermitReview.Revoked)) &&
                         !context.AirlinePermits.Any(permit => permit.AirlineId == item.AirlineId &&
                             permit.Kind == AirlinePermitKind.OperatingPermit && permit.Review == AirlinePermitReview.Verified &&
                             permit.ExpiresOn >= today))
                     .ToArrayAsync(cancellationToken))
        {
            Change(contract, ContractStatus.Suspended, ContractActivation.PermitSuspensionReason, now);
            await ContractActivation.AnnounceAsync(context, contract, "contract_suspended", now, cancellationToken);
            // 2-N12: the airline learns it by email, with how the contract resumes.
            await ContractActivation.QueueSuspensionEmailsAsync(context, contract, ContractSuspensionCause.PermitExpired, now,
                cancellationToken);
            suspended++;
        }

        // 30-day notices of the verified permits, once per permit, to Contratos and to the airline (2-N12).
        var limit = today.AddDays(ContractLifecycle.NoticeDays);
        var permitNotices = 0;
        foreach (var permit in await context.AirlinePermits
                     .Where(item => item.Review == AirlinePermitReview.Verified && item.ExpiryNoticeSentAt == null &&
                         item.ExpiresOn >= today && item.ExpiresOn <= limit)
                     .ToArrayAsync(cancellationToken))
        {
            permit.ExpiryNoticeSentAt = now;
            var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == permit.AirlineId)
                .Select(item => item.Name).SingleAsync(cancellationToken);
            await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, "contracts.permits.read",
                "permit_expiring", permit.PublicId, $"{airline} · vence el {permit.ExpiresOn:dd/MM/yyyy}", now, cancellationToken);
            await AirlineNoticeEmails.QueueAsync(context, permit.AirlineId, EmailPurpose.PermitExpiring,
                (email, name) => AccountEmailTemplates.PermitExpiring(email, name, AirlinePermitNames.Of(permit.Kind),
                    permit.Number, permit.ExpiresOn, permit.Kind == AirlinePermitKind.OperatingPermit), now, cancellationToken);
            permitNotices++;
        }
        var contractNotices = await ContractExpiryNoticesAsync(today, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        var blocked = await StartAutomaticRenewalsAsync(today, now, cancellationToken);
        return new ContractLifecycleSweep(activated, expired, suspended, permitNotices, contractNotices, terminated, blocked);
    }

    /// <summary>
    /// 2-N12: an active contract is announced as expiring the RenewalNoticeDays its last version signed before
    /// its end («AVIAM avisa con N días de antelación»), or <see cref="ContractLifecycle.NoticeDays"/> for a
    /// version without validity terms; once per version in force (the validity step resets the mark). Contratos
    /// and the airline hear about it, the airline by email too. A scheduled termination that comes first is
    /// what ends the contract, so it is not announced as expiring.
    /// </summary>
    private async Task<int> ContractExpiryNoticesAsync(DateOnly today, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var governing = GoverningContractVersions.Of(context);
        var horizon = today.AddDays(ContractValidity.MaximumNoticeDays);
        var candidates = await context.Contracts
            .Where(item => item.Status == ContractStatus.Active && item.ExpiryNoticeSentAt == null &&
                governing.Any(version => version.ContractId == item.Id && version.ValidTo != null &&
                    version.ValidTo >= today && version.ValidTo <= horizon) &&
                !governing.Any(version => version.ContractId == item.Id &&
                    (version.ValidTo == null || version.ValidTo > horizon)))
            .ToArrayAsync(cancellationToken);
        var notices = 0;
        foreach (var contract in candidates)
        {
            // The version whose end is the contract's end: the notice days it signed are the promise kept.
            var last = await GoverningContractVersions.Of(context).AsNoTracking()
                .Where(version => version.ContractId == contract.Id && version.ValidTo != null)
                .OrderByDescending(version => version.ValidTo).ThenByDescending(version => version.ValidFrom)
                .Select(version => new { version.ValidTo, version.RenewalNoticeDays, version.RenewalMode, version.RenewalTermMonths })
                .FirstAsync(cancellationToken);
            var end = last.ValidTo!.Value;
            if (contract.TerminatedOn is { } terminatesOn && terminatesOn <= end) continue;
            if (!ContractLifecycle.ExpiryNoticeDue(end, ContractLifecycle.ExpiryNoticeDays(last.RenewalNoticeDays), today))
                continue;
            contract.ExpiryNoticeSentAt = now;
            await ContractActivation.AnnounceAsync(context, contract, "contract_expiring", now, cancellationToken);
            await AirlineNoticeEmails.QueueAsync(context, contract.AirlineId, EmailPurpose.ContractExpiring,
                (email, airline) => AccountEmailTemplates.ContractExpiring(email, airline, contract.ContractCode, end,
                    last.RenewalMode == ContractRenewalMode.Automatic ? last.RenewalTermMonths : null), now, cancellationToken);
            notices++;
        }
        return notices;
    }

    /// <summary>
    /// ADR-0025: a version with automatic renewal starts its renewal draft by itself
    /// <c>RenewalNoticeDays</c> before it ends, once. The draft copies the version in force with the next
    /// period and still needs Finance, the validity step and both signatures: nothing is extended
    /// silently. A renewal that cannot start is not marked as started (2-N27): the next sweep retries it
    /// and Contratos hears about it at most once per contract and business day. Returns how many could
    /// not start.
    /// </summary>
    private async Task<int> StartAutomaticRenewalsAsync(DateOnly today, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var governing = GoverningContractVersions.Of(context);
        var due = await (from version in context.ContractVersions
                         join contract in context.Contracts on version.ContractId equals contract.Id
                         where version.Status == ContractVersionStatus.Approved &&
                               governing.Any(item => item.Id == version.Id) &&
                               version.RenewalMode == ContractRenewalMode.Automatic && version.RenewalStartedAt == null &&
                               version.RenewalTermMonths != null && version.ValidTo != null && version.ValidTo >= today &&
                               contract.Status == ContractStatus.Active && contract.TerminatedOn == null
                         select new { Version = version, Contract = contract }).ToArrayAsync(cancellationToken);
        var blocked = 0;
        foreach (var item in due)
        {
            var end = item.Version.ValidTo!.Value;
            if (end.AddDays(-(item.Version.RenewalNoticeDays ?? 0)) > today) continue;
            // Only the latest version that governs renews; a later one that governs means the cycle already
            // moved on. A later draft, or one awaiting Finance or the signatures, blocks the renewal instead:
            // it is retried until that version is finished or withdrawn (2-N27).
            if (await governing.AnyAsync(other => other.ContractId == item.Contract.Id && other.Id != item.Version.Id &&
                    other.ValidFrom > item.Version.ValidFrom, cancellationToken))
            {
                item.Version.RenewalStartedAt = now;
                await context.SaveChangesAsync(cancellationToken);
                continue;
            }
            var from = end.AddDays(1);
            var input = new ContractLifecycleInput(nameof(ContractLifecycleAction.Renew), "Renovación automática",
                item.Contract.Status.ToString(), from, from.AddMonths(item.Version.RenewalTermMonths!.Value).AddDays(-1));
            var renewal = await RenewAsync(item.Contract, input, now, cancellationToken);
            if (renewal.Failure is not null)
            {
                blocked++;
                await RenewalBlockedAsync(item.Contract, renewal.Code, today, now, cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                continue;
            }
            item.Version.RenewalStartedAt = now;
            item.Version.UpdatedAt = now;
            // Contratos and the airline hear about it; Finance does when Contratos submits the draft.
            await ContractActivation.AnnounceAsync(context, item.Contract, "contract_renewal_started", now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
        }
        return blocked;
    }

    /// <summary>Contratos learns why the automatic renewal could not start, at most once per business day (2-N27).</summary>
    private async Task RenewalBlockedAsync(Contract contract, string? code, DateOnly today, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var since = BusinessCalendar.StartOfDay(today);
        if (await context.DepartmentNotifications.AnyAsync(item => item.Kind == ContractLifecycleIssues.RenewalBlocked &&
                item.SourceId == contract.PublicId && item.OccurredAt >= since, cancellationToken))
            return;
        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == contract.AirlineId)
            .Select(item => item.Name).SingleAsync(cancellationToken);
        await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, "contracts.agreements.read",
            ContractLifecycleIssues.RenewalBlocked, contract.PublicId,
            $"{contract.ContractCode} · {airline} · {RenewalBlockedReason(code)}", now, cancellationToken);
    }

    private static string RenewalBlockedReason(string? code) => code switch
    {
        "draft_in_progress" => "hay un borrador en curso",
        ContractLifecycleIssues.VersionAwaitingSignatures => "una versión aprobada espera las firmas",
        "no_approved_version" => "no hay una versión firmada que renovar",
        _ => "revise el contrato",
    };

    private void Change(Contract contract, ContractStatus target, string reason, DateTimeOffset now)
    {
        context.Set<ContractStatusEvent>().Add(new ContractStatusEvent
        {
            ContractId = contract.Id, FromStatus = contract.Status, ToStatus = target, OccurredAt = now, Reason = reason,
        });
        contract.Status = target;
        contract.UpdatedAt = now;
    }

    private static string? Text(DateOnly? day) => day?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);

    public async Task<ContractTimelineData?> TimelineAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        var contract = await (from version in context.ContractVersions.AsNoTracking()
                              join item in context.Contracts.AsNoTracking() on version.ContractId equals item.Id
                              where version.PublicId == versionId
                              select item).SingleOrDefaultAsync(cancellationToken);
        if (contract is null) return null;
        var internalReader = await permissions.HasAnyAsync(actorId, Readers, cancellationToken);
        if (!internalReader && await AirlinePortalTenant.AirlineIdAsync(context, actorId, cancellationToken) != contract.AirlineId)
            return null;

        var names = new Dictionary<long, string>();
        async Task<string?> Name(long? accountId)
        {
            if (accountId is not { } id) return "Sistema";
            if (!internalReader) return null;
            if (names.TryGetValue(id, out var cached)) return cached;
            var name = await (from user in context.Users.AsNoTracking()
                              join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                              where user.Id == id
                              select person.FirstName + " " + person.LastName).SingleOrDefaultAsync(cancellationToken);
            return names[id] = name ?? "Usuario";
        }

        var entries = new List<ContractTimelineEntry>();
        if (contract.OriginatingServiceRequestId is { } requestId)
        {
            var request = await context.ServiceRequests.AsNoTracking().SingleAsync(item => item.Id == requestId, cancellationToken);
            entries.Add(new(request.CreatedAt, "request", "Solicitud recibida", request.RequestCode, request.ContactName));
            foreach (var change in await context.Set<ServiceRequestStatusEvent>().AsNoTracking()
                         .Where(item => item.ServiceRequestId == requestId).OrderBy(item => item.OccurredAt).ToArrayAsync(cancellationToken))
                entries.Add(new(change.OccurredAt, "request", RequestTitle(change.ToStatus), change.Reason, await Name(change.ActorAccountId)));
        }
        var versions = await context.ContractVersions.AsNoTracking().Where(item => item.ContractId == contract.Id)
            .OrderBy(item => item.VersionNumber).ToArrayAsync(cancellationToken);
        var versionIds = versions.Select(item => item.Id).ToArray();
        foreach (var version in versions)
        {
            entries.Add(new(version.CreatedAt, "draft", $"Borrador de la versión {version.VersionNumber}",
                $"Vigencia {version.ValidFrom:dd/MM/yyyy} – {(version.ValidTo is { } to ? to.ToString("dd/MM/yyyy") : "sin fin")}", null));
            if (version.ApprovedAt is { } approved)
                entries.Add(new(approved, "finance", $"Finanzas aprobó la versión {version.VersionNumber}", null,
                    await Name(version.ApprovedByAccountId)));
            // A discarded or withdrawn version keeps its history; the reason stays in the audit trail.
            if (version.Status == ContractVersionStatus.Rejected)
                entries.Add(new(version.UpdatedAt, "draft", version.ApprovedAt is null
                    ? $"Contratos descartó la versión {version.VersionNumber}"
                    : $"Contratos retiró la versión {version.VersionNumber} sin las dos firmas", null, null));
            if (version.ValidityConfirmedAt is { } confirmed)
                entries.Add(new(confirmed, "validity", $"Contratos fijó la vigencia de la versión {version.VersionNumber}",
                    $"{version.ValidFrom:dd/MM/yyyy} – {version.ValidTo:dd/MM/yyyy} · renovación " +
                    (version.RenewalMode == ContractRenewalMode.Automatic ? $"automática ({version.RenewalTermMonths} meses)" : "manual"),
                    await Name(version.ValidityConfirmedByAccountId)));
        }
        foreach (var review in await context.ContractFinanceReviews.AsNoTracking()
                     .Where(item => versionIds.Contains(item.ContractVersionId) && item.Decision == ContractFinanceDecision.Returned)
                     .ToArrayAsync(cancellationToken))
            entries.Add(new(review.DecidedAt, "finance", "Finanzas devolvió la versión a Contratos",
                internalReader ? review.Reason : null, await Name(review.DecidedByAccountId)));
        var withdrawn = versions.Where(item => item.Status == ContractVersionStatus.Rejected).Select(item => item.Id).ToHashSet();
        foreach (var signature in await context.ContractSignatures.AsNoTracking()
                     .Where(item => versionIds.Contains(item.ContractVersionId)).ToArrayAsync(cancellationToken))
            entries.Add(new(signature.SignedAt, "signature",
                (signature.Party == ContractSignatureParty.Aviam ? "Firma de AVIAM" : "Firma de la aerolínea") +
                (withdrawn.Contains(signature.ContractVersionId) ? " (anulada al retirar la versión)" : string.Empty),
                $"{signature.SignerName} · {signature.SignerTitle}", null));
        foreach (var change in await context.Set<ContractStatusEvent>().AsNoTracking()
                     .Where(item => item.ContractId == contract.Id).ToArrayAsync(cancellationToken))
            entries.Add(new(change.OccurredAt, "status", change is { FromStatus: ContractStatus.Draft, ToStatus: ContractStatus.Terminated }
                ? "Contrato descartado antes de activarse" : StatusTitle(change.ToStatus), change.Reason, await Name(change.ActorAccountId)));
        var permits = await context.AirlinePermits.AsNoTracking().Where(item => item.AirlineId == contract.AirlineId)
            .ToArrayAsync(cancellationToken);
        // 2-N09: a revoked permit keeps its verification; the revocation, with its reason, is in the audit trail.
        var revokedIds = permits.Where(item => item.Review == AirlinePermitReview.Revoked).Select(item => (Guid?)item.PublicId).ToArray();
        var revocations = await context.AuditEntries.AsNoTracking()
            .Where(entry => entry.Action == EfAirlinePermitStore.RevokedAudit && revokedIds.Contains(entry.EntityPublicId))
            .Select(entry => new { entry.EntityPublicId, entry.Reason, entry.ActorAccountId }).ToArrayAsync(cancellationToken);
        foreach (var permit in permits)
        {
            entries.Add(new(permit.CreatedAt, "permit", $"Permiso enviado: {PermitTitle(permit.Kind)}",
                $"{permit.Number} · {permit.Issuer} · vence el {permit.ExpiresOn:dd/MM/yyyy}", null));
            if (permit.ReviewedAt is { } reviewed)
                entries.Add(new(reviewed, "permit", permit.Review is AirlinePermitReview.Verified or AirlinePermitReview.Revoked
                    ? $"Contratos verificó {PermitTitle(permit.Kind)}" : $"Contratos rechazó {PermitTitle(permit.Kind)}",
                    permit.ReviewNote, await Name(permit.ReviewedByAccountId)));
            if (permit.Review == AirlinePermitReview.Revoked)
            {
                var revocation = revocations.LastOrDefault(entry => entry.EntityPublicId == permit.PublicId);
                entries.Add(new(permit.UpdatedAt, "permit", $"Contratos revocó la verificación: {PermitTitle(permit.Kind)}",
                    revocation?.Reason, await Name(revocation?.ActorAccountId)));
            }
        }
        // What comes next, so the cycle can be read forward too: the end of the version that governs
        // (2-C) and a scheduled termination (2-N14), at the close or start of AVIAM's business day.
        var today = BusinessCalendar.Today(timeProvider.GetUtcNow());
        var governing = await GoverningContractVersions.Of(context).Where(item => item.ContractId == contract.Id)
            .Select(item => item.Id).ToArrayAsync(cancellationToken);
        if (versions.Where(item => governing.Contains(item.Id)).MaxBy(item => item.ValidFrom) is { ValidTo: { } end } &&
            end >= today && contract.Status is ContractStatus.Active or ContractStatus.Suspended &&
            (contract.TerminatedOn is null || end < contract.TerminatedOn))
            entries.Add(new(BusinessCalendar.EndOfDay(end), "upcoming", "Vencimiento previsto del contrato", null, null));
        DateOnly? scheduledOn = null;
        if (contract.TerminatedOn is { } terminatesOn && terminatesOn > today && contract.Status != ContractStatus.Terminated)
        {
            scheduledOn = terminatesOn;
            entries.Add(new(BusinessCalendar.StartOfDay(terminatesOn), "upcoming", "Terminación programada del contrato",
                $"Último día con cobertura: {terminatesOn.AddDays(-1):dd/MM/yyyy}", null));
        }
        // The earliest date a termination with notice may take today (2-N14), the one the server enforces.
        DateOnly? earliest = scheduledOn is null && contract.Status is ContractStatus.Active or ContractStatus.Suspended
            ? today.AddDays(await NoticeDaysAsync(contract.Id, today, cancellationToken)) : null;
        return new ContractTimelineData(contract.PublicId, contract.ContractCode, contract.Status.ToString(),
            entries.OrderBy(item => item.At).ToArray(), scheduledOn, earliest);
    }

    private static string RequestTitle(CommercialRequestStatus status) => status switch
    {
        CommercialRequestStatus.InReview => "Solicitud en revisión",
        CommercialRequestStatus.Approved => "Solicitud aprobada por Contratos",
        CommercialRequestStatus.Rejected => "Solicitud rechazada",
        CommercialRequestStatus.Cancelled => "Solicitud cancelada",
        _ => "Solicitud registrada",
    };

    private static string StatusTitle(ContractStatus status) => status switch
    {
        ContractStatus.Active => "Contrato activo",
        ContractStatus.Suspended => "Contrato suspendido",
        ContractStatus.Terminated => "Contrato terminado",
        ContractStatus.Expired => "Contrato vencido",
        _ => "Contrato en borrador",
    };

    private static string PermitTitle(AirlinePermitKind kind) => AirlinePermitNames.Of(kind);
}
