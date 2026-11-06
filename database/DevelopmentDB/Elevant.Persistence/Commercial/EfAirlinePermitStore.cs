using System.Data;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Common;
using Elevant.Application.Identity.AccountEmails;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Permit dossier of each airline (ADR-0024): the airline submits from its portal, Contratos verifies or
/// rejects a submitted permit with a note and can revoke a verification (2-N09). A verified, current
/// operating permit is what lets a signed contract become active; verifying one re-evaluates the airline's
/// pending and suspended contracts at once, and revoking it suspends the active contracts left without one.
/// Every command runs in a serializable transaction with an idempotency receipt
/// (<see cref="CommercialCommandReceipts"/>), so a retry never duplicates a permit, a notice or an email.
/// </summary>
internal sealed class EfAirlinePermitStore(ElevantDbContext context, CommercialPermissionGuard permissions,
    TimeProvider timeProvider) : IAirlinePermitStore
{
    private const string ReadPermission = "contracts.permits.read";
    private const string VerifyPermission = "contracts.permits.verify";
    private const string SubmitAction = "commercial.permit.submit";
    private const string ReviewAction = "commercial.permit.review";
    private const string RevokeAction = "commercial.permit.revoke";
    private const string PermitResource = "commercial.airline_permits";
    internal const string RevokedAudit = "commercial.permit.revoked";

    public async Task<IReadOnlyList<AirlinePermitData>?> ListForAirlineAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (await AirlinePortalTenant.AirlineIdAsync(context, actorId, cancellationToken) is not { } airline) return null;
        return await ListAsync(context.AirlinePermits.AsNoTracking().Where(item => item.AirlineId == airline), cancellationToken);
    }

    public async Task<IReadOnlyList<AirlinePermitData>?> ListForContractsAsync(Guid actorId, string? review,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAnyAsync(actorId, [ReadPermission], cancellationToken)) return null;
        var query = context.AirlinePermits.AsNoTracking();
        if (review is not null)
        {
            if (!Enum.TryParse<AirlinePermitReview>(review, out var parsed)) return [];
            query = query.Where(item => item.Review == parsed);
        }
        return await ListAsync(query, cancellationToken);
    }

    public async Task<AirlinePermitResult> SubmitAsync(Guid actorId, SubmitAirlinePermitInput input, Guid? idempotencyKey,
        CancellationToken cancellationToken = default)
    {
        if (await AirlinePortalTenant.AirlineIdAsync(context, actorId, cancellationToken) is not { } airline)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Forbidden, "forbidden");
        // Expand phase: the key is optional; a submission creates the permit, so it has no expected version.
        if (idempotencyKey == Guid.Empty)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "idempotency_key_required");
        var today = Today();
        if (input is null || !Enum.TryParse<AirlinePermitKind>(input.Kind, out var kind) || !Enum.IsDefined(kind) ||
            Text(input.Number, 60) is not { } number || Text(input.Issuer, 120) is not { } issuer)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, AirlinePermitIssues.Invalid);
        if (input.IssuedOn > today || input.ExpiresOn < input.IssuedOn)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, AirlinePermitIssues.DatesInvalid);
        if (input.ExpiresOn < today)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, AirlinePermitIssues.Expired);
        var document = string.IsNullOrWhiteSpace(input.DocumentUrl) ? null : input.DocumentUrl.Trim();
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        if (document is not null && await DocumentIssueAsync(accountId, document, cancellationToken) is { } issue)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, issue);
        var hash = CommercialCommandReceipts.Hash(new
        {
            kind, number, issuer, input.IssuedOn, input.ExpiresOn, document,
        });

        return await CommandAsync(idempotencyKey, accountId, SubmitAction, hash, async () =>
        {
            var now = Now();
            var permit = new AirlinePermit
            {
                PublicId = Guid.CreateVersion7(), AirlineId = airline, Kind = kind, Number = number, Issuer = issuer,
                IssuedOn = input.IssuedOn, ExpiresOn = input.ExpiresOn, DocumentUrl = document,
                Review = AirlinePermitReview.Submitted, SubmittedByAccountId = accountId, CreatedAt = now, UpdatedAt = now,
            };
            context.AirlinePermits.Add(permit);
            var airlineName = await context.Airlines.Where(item => item.Id == airline).Select(item => item.Name)
                .SingleAsync(cancellationToken);
            CommercialAuditWriter.Add(context, accountId, "commercial.permit.submitted", PermitResource,
                permit.PublicId, $"{kind} {number}");
            await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, ReadPermission,
                "permit_submitted", permit.PublicId, airlineName, now, cancellationToken);
            return Outcome.Done(permit.PublicId);
        }, permitId => SubmittedAsync(permitId, cancellationToken), cancellationToken);
    }

    public async Task<AirlinePermitResult> ReviewAsync(Guid actorId, Guid permitId, ReviewAirlinePermitInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAnyAsync(actorId, [VerifyPermission], cancellationToken))
            return AirlinePermitResult.Failed(AirlinePermitFailure.Forbidden, "forbidden");
        // Expand phase: the key is optional; the expected version is the rowversion the screen saw.
        if (idempotencyKey == Guid.Empty)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "idempotency_key_required");
        if (input is not null && string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "expected_version_required");
        var note = string.IsNullOrWhiteSpace(input?.Note) ? null : input.Note.Trim();
        if (input is null || note?.Length > 500 || !input.Verified && note is not { Length: >= 5 })
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, AirlinePermitIssues.NoteRequired);
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { permitId, input.Verified, note, expected = input.ExpectedVersion });

        return await CommandAsync(idempotencyKey, accountId, ReviewAction, hash, async () =>
        {
            var permit = await context.AirlinePermits.SingleOrDefaultAsync(item => item.PublicId == permitId, cancellationToken);
            if (permit is null) return Outcome.Fail(AirlinePermitFailure.NotFound, "not_found");
            // Only a submitted permit is reviewed: a verified one is revoked, never rejected (2-N09).
            if (permit.Review != AirlinePermitReview.Submitted)
                return Outcome.Fail(AirlinePermitFailure.Conflict, AirlinePermitIssues.ReviewClosed);
            if (Convert.ToBase64String(permit.RowVersion) != input.ExpectedVersion)
                return Outcome.Fail(AirlinePermitFailure.Conflict, "version_conflict");
            var now = Now();
            if (input.Verified && permit.ExpiresOn < BusinessCalendar.Today(now))
                return Outcome.Fail(AirlinePermitFailure.Invalid, AirlinePermitIssues.Expired);

            permit.Review = input.Verified ? AirlinePermitReview.Verified : AirlinePermitReview.Rejected;
            permit.ReviewNote = note;
            permit.ReviewedAt = now;
            permit.ReviewedByAccountId = accountId;
            permit.UpdatedAt = now;
            CommercialAuditWriter.Add(context, accountId, input.Verified ? "commercial.permit.verified" : "commercial.permit.rejected",
                PermitResource, permit.PublicId, note);
            await AnnounceToAirlineAsync(permit.AirlineId, permit.PublicId, now, cancellationToken);
            // 2-N13: the airline learns why, by email too, and corrects the permit.
            if (!input.Verified)
                await AirlineNoticeEmails.QueueAsync(context, permit.AirlineId, EmailPurpose.PermitRejected,
                    (email, airline) => AccountEmailTemplates.PermitRejected(email, airline, AirlinePermitNames.Of(permit.Kind),
                        permit.Number, note!), now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            // A newly usable operating permit may complete the conditions of a signed contract or resume one the
            // sweep or a revocation suspended; both happen in this transaction.
            if (input.Verified && permit.Kind == AirlinePermitKind.OperatingPermit)
                await ContractActivation.ActivateReadyAsync(context, permit.AirlineId, accountId, now, cancellationToken);
            return Outcome.Done(permit.PublicId);
        }, id => DecisionAsync(id, permit => permit.ReviewedAt, cancellationToken), cancellationToken);
    }

    public async Task<AirlinePermitResult> RevokeAsync(Guid actorId, Guid permitId, RevokeAirlinePermitInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAnyAsync(actorId, [VerifyPermission], cancellationToken))
            return AirlinePermitResult.Failed(AirlinePermitFailure.Forbidden, "forbidden");
        if (idempotencyKey == Guid.Empty)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "idempotency_key_required");
        if (input is null || string.IsNullOrWhiteSpace(input.ExpectedVersion))
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "expected_version_required");
        if (!ContractLifecycle.ValidReason(input.Reason))
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "reason_required");
        var reason = input.Reason.Trim();
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { permitId, reason, expected = input.ExpectedVersion });

        return await CommandAsync(idempotencyKey, accountId, RevokeAction, hash, async () =>
        {
            var permit = await context.AirlinePermits.SingleOrDefaultAsync(item => item.PublicId == permitId, cancellationToken);
            if (permit is null) return Outcome.Fail(AirlinePermitFailure.NotFound, "not_found");
            if (permit.Review != AirlinePermitReview.Verified)
                return Outcome.Fail(AirlinePermitFailure.Conflict, AirlinePermitIssues.NotVerified);
            if (Convert.ToBase64String(permit.RowVersion) != input.ExpectedVersion)
                return Outcome.Fail(AirlinePermitFailure.Conflict, "version_conflict");

            var now = Now();
            var today = BusinessCalendar.Today(now);
            // The original verification stays on the row (who, when and its note); the revocation is the
            // audited change of state, with its reason.
            permit.Review = AirlinePermitReview.Revoked;
            permit.UpdatedAt = now;
            CommercialAuditWriter.Add(context, accountId, RevokedAudit, PermitResource, permit.PublicId, reason,
                new AuditFieldChangeData("permit.review", nameof(AirlinePermitReview.Verified),
                    nameof(AirlinePermitReview.Revoked)));
            await AnnounceToAirlineAsync(permit.AirlineId, permit.PublicId, now, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);

            // The active contracts left without a usable operating permit are suspended in this transaction.
            var suspended = new List<string>();
            if (permit.Kind == AirlinePermitKind.OperatingPermit &&
                !await ContractActivation.HasUsablePermitAsync(context, permit.AirlineId, today, cancellationToken))
                foreach (var contract in await context.Contracts
                             .Where(item => item.AirlineId == permit.AirlineId && item.Status == ContractStatus.Active)
                             .ToArrayAsync(cancellationToken))
                {
                    context.Set<ContractStatusEvent>().Add(new ContractStatusEvent
                    {
                        ContractId = contract.Id, FromStatus = contract.Status, ToStatus = ContractStatus.Suspended,
                        OccurredAt = now, Reason = ContractActivation.PermitRevokedSuspensionReason,
                    });
                    contract.Status = ContractStatus.Suspended;
                    contract.UpdatedAt = now;
                    await ContractActivation.AnnounceAsync(context, contract, "contract_suspended", now, cancellationToken);
                    await ContractActivation.QueueSuspensionEmailsAsync(context, contract,
                        ContractSuspensionCause.PermitRevoked, now, cancellationToken);
                    suspended.Add(contract.ContractCode);
                }
            await AirlineNoticeEmails.QueueAsync(context, permit.AirlineId, EmailPurpose.PermitRevoked,
                (email, airline) => AccountEmailTemplates.PermitRevoked(email, airline, AirlinePermitNames.Of(permit.Kind),
                    permit.Number, reason, suspended), now, cancellationToken);
            return Outcome.Done(permit.PublicId);
        }, id => DecisionAsync(id, permit => permit.Review == nameof(AirlinePermitReview.Revoked) ? permit.RevokedAt : null,
            cancellationToken), cancellationToken);
    }

    /// <summary>What a command step produced: the permit it changed, or the failure that rolls it back.</summary>
    private readonly record struct Outcome(Guid PermitId, AirlinePermitFailure? Failure, string? Code)
    {
        public static Outcome Done(Guid permitId) => new(permitId, null, null);
        public static Outcome Fail(AirlinePermitFailure failure, string code) => new(Guid.Empty, failure, code);
    }

    /// <summary>
    /// The command pattern of the commercial stores: receipt lookup, the work, the receipt and the commit in
    /// one serializable transaction. A replay answers <paramref name="answer"/> for the permit the first
    /// attempt changed, never repeating its audit, notices or emails.
    /// </summary>
    private async Task<AirlinePermitResult> CommandAsync(Guid? idempotencyKey, long accountId, string action, string hash,
        Func<Task<Outcome>> work, Func<Guid, Task<AirlinePermitResult>> answer, CancellationToken cancellationToken)
    {
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
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return Outcome.Fail(AirlinePermitFailure.Conflict, "idempotency_conflict");
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay) return Outcome.Done(prior.ResultId);
                }
                var done = await work();
                if (done.Failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return done;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, accountId, action, hash, done.PermitId, Now());
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return done;
            });
            context.ChangeTracker.Clear();
            return outcome.Failure is { } failure
                ? AirlinePermitResult.Failed(failure, outcome.Code)
                : await answer(outcome.PermitId);
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return AirlinePermitResult.Failed(AirlinePermitFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key && CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, accountId, action, hash, cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await answer(concurrent.ResultId)
                : AirlinePermitResult.Failed(AirlinePermitFailure.Conflict, "idempotency_conflict");
        }
    }

    private async Task<AirlinePermitResult> SubmittedAsync(Guid permitId, CancellationToken cancellationToken) =>
        AirlinePermitResult.Success(Single(await ListAsync(
            context.AirlinePermits.AsNoTracking().Where(item => item.PublicId == permitId), cancellationToken)));

    /// <summary>
    /// The permit with the contracts the command changed: the status events written at the instant of the
    /// command (<paramref name="at"/>, the review or the revocation), the same for the first answer and a replay.
    /// </summary>
    private async Task<AirlinePermitResult> DecisionAsync(Guid permitId, Func<AirlinePermitData, DateTimeOffset?> at,
        CancellationToken cancellationToken)
    {
        var permit = Single(await ListAsync(
            context.AirlinePermits.AsNoTracking().Where(item => item.PublicId == permitId), cancellationToken));
        var airlineId = await context.AirlinePermits.AsNoTracking().Where(item => item.PublicId == permitId)
            .Select(item => item.AirlineId).SingleAsync(cancellationToken);
        var changes = Array.Empty<AirlinePermitContractChange>();
        if (at(permit) is { } instant)
            changes = (await (from change in context.Set<ContractStatusEvent>().AsNoTracking()
                              join contract in context.Contracts.AsNoTracking() on change.ContractId equals contract.Id
                              where contract.AirlineId == airlineId && change.OccurredAt == instant
                              orderby contract.ContractCode
                              select new { contract.PublicId, contract.ContractCode, change.ToStatus })
                    .ToArrayAsync(cancellationToken))
                .Select(item => new AirlinePermitContractChange(item.PublicId, item.ContractCode, item.ToStatus.ToString()))
                .ToArray();
        return AirlinePermitResult.Success(new AirlinePermitDecisionData(permit, changes));
    }

    private async Task<IReadOnlyList<AirlinePermitData>> ListAsync(IQueryable<AirlinePermit> permits,
        CancellationToken cancellationToken)
    {
        var today = Today();
        var rows = await (from permit in permits
                          join airline in context.Airlines.AsNoTracking() on permit.AirlineId equals airline.Id
                          orderby permit.ExpiresOn, permit.Id
                          select new { Permit = permit, AirlinePublicId = airline.PublicId, airline.Name })
            .ToArrayAsync(cancellationToken);
        // 2-N09: the reason of a revocation lives in the audit trail; the row keeps the original verification.
        var revoked = rows.Where(row => row.Permit.Review == AirlinePermitReview.Revoked)
            .Select(row => (Guid?)row.Permit.PublicId).ToArray();
        var reasons = revoked.Length == 0 ? new Dictionary<Guid, string?>() : (await context.AuditEntries.AsNoTracking()
                .Where(entry => entry.EntityType == PermitResource && entry.Action == RevokedAudit &&
                    revoked.Contains(entry.EntityPublicId))
                .Select(entry => new { Permit = entry.EntityPublicId!.Value, entry.Reason, Entry = entry.Id })
                .ToArrayAsync(cancellationToken))
            .GroupBy(entry => entry.Permit)
            .ToDictionary(group => group.Key, group => group.MaxBy(entry => entry.Entry)!.Reason);
        return rows.Select(row => new AirlinePermitData(row.Permit.PublicId, row.AirlinePublicId, row.Name,
            row.Permit.Kind.ToString(), row.Permit.Number, row.Permit.Issuer, row.Permit.IssuedOn, row.Permit.ExpiresOn,
            ContractLifecycle.Validity(row.Permit.ExpiresOn, today).ToString(), row.Permit.Review.ToString(),
            row.Permit.ReviewNote, row.Permit.DocumentUrl, row.Permit.CreatedAt, row.Permit.ReviewedAt,
            Convert.ToBase64String(row.Permit.RowVersion),
            row.Permit.Review == AirlinePermitReview.Revoked ? row.Permit.UpdatedAt : null,
            reasons.GetValueOrDefault(row.Permit.PublicId))).ToArray();
    }

    /// <summary>
    /// Why the scan cannot be linked: it is not an upload of this account for a permit, or it was uploaded
    /// before the media link window and the cleanup may already be removing it (2-N37).
    /// </summary>
    private async Task<string?> DocumentIssueAsync(long accountId, string url, CancellationToken cancellationToken)
    {
        const string prefix = "/api/v1/media/";
        if (!url.StartsWith(prefix, StringComparison.Ordinal) || !Guid.TryParse(url[prefix.Length..], out var id))
            return AirlinePermitIssues.DocumentInvalid;
        var uploadedAt = await context.MediaAssets.AsNoTracking()
            .Where(asset => asset.PublicId == id && asset.Purpose == "airline-permit" && asset.UploadedByAccountId == accountId)
            .Select(asset => (DateTimeOffset?)asset.CreatedAt).SingleOrDefaultAsync(cancellationToken);
        if (uploadedAt is null) return AirlinePermitIssues.DocumentInvalid;
        return uploadedAt < CommercialMediaLinkPolicy.LinkCutoff(timeProvider.GetUtcNow()) ? AirlinePermitIssues.DocumentExpired : null;
    }

    /// <summary>The airline's portal accounts re-read their dossier and contracts.</summary>
    private async Task AnnounceToAirlineAsync(long airlineId, Guid permitId, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        foreach (var recipient in await AirlineAccountsAsync(airlineId, cancellationToken))
            AccountChangeOutboxWriter.Add(context, recipient, null, "airline_contracts", permitId, now);
    }

    private Task<long[]> AirlineAccountsAsync(long airlineId, CancellationToken cancellationToken) =>
        (from airline in context.Airlines.AsNoTracking()
         join membership in context.OrganizationMemberships.AsNoTracking() on airline.OrganizationId equals membership.OrganizationId
         where airline.Id == airlineId && membership.Kind == MembershipKind.AirlineClient &&
               membership.Status == MembershipStatus.Active
         select membership.AccountId).Distinct().ToArrayAsync(cancellationToken);

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id).SingleAsync(cancellationToken);

    /// <summary>2-F: permits expire by AVIAM's business day (America/Santo_Domingo), not the UTC day.</summary>
    private DateOnly Today() => BusinessCalendar.Today(timeProvider.GetUtcNow());

    /// <summary>
    /// The command instant at the millisecond the columns keep: the contracts a review or a revocation changed
    /// are found again by the status events written at that same instant.
    /// </summary>
    private DateTimeOffset Now()
    {
        var now = timeProvider.GetUtcNow();
        return now.AddTicks(-(now.Ticks % TimeSpan.TicksPerMillisecond));
    }

    private static string? Text(string? value, int max) =>
        value?.Trim() is { Length: > 0 } text && text.Length <= max ? text : null;

    private static AirlinePermitData Single(IReadOnlyList<AirlinePermitData> rows) => rows.Single();
}
