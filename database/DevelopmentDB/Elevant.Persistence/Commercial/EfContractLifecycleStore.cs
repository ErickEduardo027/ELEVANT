using System.Data;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Chronological lifecycle of a contract (ADR-0024): manual actions of Contratos, the daily sweep
/// and the merged history from the request to the last change. Every change writes a
/// <see cref="ContractStatusEvent"/>.
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
        var commandAction = $"contract.lifecycle.{action.ToString().ToLowerInvariant()}";
        var hash = CommercialCommandReceipts.Hash(new { versionId, action, reason, expected, input.ValidFrom, input.ValidTo });
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
                var result = await ApplyInTransactionAsync(actor, versionId, input, action, expected, reason,
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
        ContractLifecycleAction action, ContractStatus expected, string reason, CancellationToken cancellationToken)
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
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        Guid? draftId = null;
        switch (action)
        {
            case ContractLifecycleAction.Reactivate:
                if (!await ContractActivation.HasUsablePermitAsync(context, contract.AirlineId, today, cancellationToken))
                    return Failed(ContractLifecycleFailure.Invalid, "permit_required");
                if (!await context.ContractVersions.AnyAsync(item => item.ContractId == contract.Id &&
                        item.Status == ContractVersionStatus.Approved && (item.ValidTo == null || item.ValidTo >= today), cancellationToken))
                    return Failed(ContractLifecycleFailure.Invalid, "no_version_in_force");
                break;
            case ContractLifecycleAction.Terminate:
                contract.TerminatedOn = contract.SignedOn is { } signed && signed > today ? signed : today;
                // A terminated contract («Descartar contrato» too, 1-B) closes its open versions: they
                // leave Borradores and the Finance inbox.
                await CloseOpenVersionsAsync(contract, actor, reason, now, cancellationToken);
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
                ActorAccountId = actor, Reason = reason,
            });
            contract.Status = target;
            contract.UpdatedAt = now;
        }
        CommercialAuditWriter.Add(context, actor, $"commercial.contract.{action.ToString().ToLowerInvariant()}",
            "commercial.contracts", contract.PublicId, reason);
        await ContractActivation.AnnounceAsync(context, contract, "contract_lifecycle", now, cancellationToken);
        return new(new ContractLifecycleResult(contract.Status.ToString(), draftId, null), contract.PublicId);
    }

    /// <summary>
    /// The drafts and versions awaiting Finance of a terminated contract become Rejected: nothing is
    /// deleted, and Finance no longer sees them as pending.
    /// </summary>
    private async Task CloseOpenVersionsAsync(Contract contract, long actor, string reason, DateTimeOffset now,
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
    }

    /// <summary>Copies the latest approved version into a new draft with the new validity; Finance approves it as usual.</summary>
    private async Task<ContractLifecycleResult> RenewAsync(Contract contract, ContractLifecycleInput input, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        if (input.ValidFrom is not { } from || input.ValidTo is { } until && until < from)
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Invalid, "renewal_dates_invalid");
        if (await context.ContractVersions.AnyAsync(item => item.ContractId == contract.Id &&
                (item.Status == ContractVersionStatus.Draft || item.Status == ContractVersionStatus.PendingFinanceApproval), cancellationToken))
            return ContractLifecycleResult.Failed(ContractLifecycleFailure.Conflict, "draft_in_progress");
        var source = await context.ContractVersions.AsNoTracking()
            .Where(item => item.ContractId == contract.Id && item.Status == ContractVersionStatus.Approved)
            .OrderByDescending(item => item.ValidFrom).FirstOrDefaultAsync(cancellationToken);
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
        foreach (var rate in await context.ContractServiceRates.AsNoTracking().Where(item => item.ContractVersionId == source.Id)
                     .ToArrayAsync(cancellationToken))
            context.ContractServiceRates.Add(new ContractServiceRate
            {
                PublicId = Guid.CreateVersion7(), ContractVersionId = draft.Id, ServiceDefinitionId = rate.ServiceDefinitionId,
                BillingUnit = rate.BillingUnit, UnitPrice = rate.UnitPrice, MinimumQuantity = rate.MinimumQuantity,
                IsConfirmed = true, CreatedAt = now, UpdatedAt = now,
            });
        foreach (var station in await context.Set<ContractVersionStation>().AsNoTracking()
                     .Where(item => item.ContractVersionId == source.Id).Select(item => item.StationId).ToArrayAsync(cancellationToken))
            context.Set<ContractVersionStation>().Add(new ContractVersionStation { ContractVersionId = draft.Id, StationId = station });
        return new ContractLifecycleResult(contract.Status.ToString(), draft.PublicId, null);
    }

    public async Task<ContractLifecycleSweep> SweepAsync(CancellationToken cancellationToken = default)
    {
        var now = timeProvider.GetUtcNow();
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var activated = await ContractActivation.ActivateReadyAsync(context, null, null, now, cancellationToken);

        // Expired: no approved version is in force today or later.
        var expired = 0;
        foreach (var contract in await context.Contracts
                     .Where(item => (item.Status == ContractStatus.Active || item.Status == ContractStatus.Suspended) &&
                         !context.ContractVersions.Any(version => version.ContractId == item.Id &&
                             version.Status == ContractVersionStatus.Approved && (version.ValidTo == null || version.ValidTo >= today)))
                     .ToArrayAsync(cancellationToken))
        {
            Change(contract, ContractStatus.Expired, "Venció la vigencia de la última versión aprobada.", now);
            await ContractActivation.AnnounceAsync(context, contract, "contract_expired", now, cancellationToken);
            expired++;
        }

        // Suspended: the airline had a verified operating permit, but none is usable today. Contracts
        // signed before the permit dossier existed are left alone (expand phase, ADR-0024).
        var suspended = 0;
        foreach (var contract in await context.Contracts
                     .Where(item => item.Status == ContractStatus.Active &&
                         context.AirlinePermits.Any(permit => permit.AirlineId == item.AirlineId &&
                             permit.Kind == AirlinePermitKind.OperatingPermit && permit.Review == AirlinePermitReview.Verified) &&
                         !context.AirlinePermits.Any(permit => permit.AirlineId == item.AirlineId &&
                             permit.Kind == AirlinePermitKind.OperatingPermit && permit.Review == AirlinePermitReview.Verified &&
                             permit.ExpiresOn >= today))
                     .ToArrayAsync(cancellationToken))
        {
            Change(contract, ContractStatus.Suspended, ContractActivation.PermitSuspensionReason, now);
            await ContractActivation.AnnounceAsync(context, contract, "contract_suspended", now, cancellationToken);
            suspended++;
        }

        // 30-day notices, once per permit and per version in force.
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
            permitNotices++;
        }
        var contractNotices = 0;
        foreach (var contract in await context.Contracts
                     .Where(item => item.Status == ContractStatus.Active && item.ExpiryNoticeSentAt == null &&
                         context.ContractVersions.Any(version => version.ContractId == item.Id &&
                             version.Status == ContractVersionStatus.Approved && version.ValidTo != null &&
                             version.ValidTo >= today && version.ValidTo <= limit) &&
                         !context.ContractVersions.Any(version => version.ContractId == item.Id &&
                             version.Status == ContractVersionStatus.Approved && (version.ValidTo == null || version.ValidTo > limit)))
                     .ToArrayAsync(cancellationToken))
        {
            contract.ExpiryNoticeSentAt = now;
            await ContractActivation.AnnounceAsync(context, contract, "contract_expiring", now, cancellationToken);
            contractNotices++;
        }
        await context.SaveChangesAsync(cancellationToken);
        await StartAutomaticRenewalsAsync(today, now, cancellationToken);
        return new ContractLifecycleSweep(activated, expired, suspended, permitNotices, contractNotices);
    }

    /// <summary>
    /// ADR-0025: a version with automatic renewal starts its renewal draft by itself
    /// <c>RenewalNoticeDays</c> before it ends, once. The draft copies rates and terms with the
    /// next period and still needs Finance, the validity step and both signatures: nothing is
    /// extended silently, because signed content and prices are immutable.
    /// </summary>
    private async Task StartAutomaticRenewalsAsync(DateOnly today, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var due = await (from version in context.ContractVersions
                         join contract in context.Contracts on version.ContractId equals contract.Id
                         where version.Status == ContractVersionStatus.Approved &&
                               version.RenewalMode == ContractRenewalMode.Automatic && version.RenewalStartedAt == null &&
                               version.RenewalTermMonths != null && version.ValidTo != null && version.ValidTo >= today &&
                               contract.Status == ContractStatus.Active
                         select new { Version = version, Contract = contract }).ToArrayAsync(cancellationToken);
        foreach (var item in due)
        {
            var end = item.Version.ValidTo!.Value;
            if (end.AddDays(-(item.Version.RenewalNoticeDays ?? 0)) > today) continue;
            // Only the latest approved version renews; a later one means the cycle already moved on.
            if (await context.ContractVersions.AnyAsync(other => other.ContractId == item.Contract.Id &&
                    other.Id != item.Version.Id && other.ValidFrom > item.Version.ValidFrom &&
                    other.Status != ContractVersionStatus.Superseded, cancellationToken))
            {
                item.Version.RenewalStartedAt = now;
                continue;
            }
            var from = end.AddDays(1);
            var input = new ContractLifecycleInput(nameof(ContractLifecycleAction.Renew), "Renovación automática",
                item.Contract.Status.ToString(), from, from.AddMonths(item.Version.RenewalTermMonths!.Value).AddDays(-1));
            var renewal = await RenewAsync(item.Contract, input, now, cancellationToken);
            item.Version.RenewalStartedAt = now;
            item.Version.UpdatedAt = now;
            if (renewal.Failure is null)
            {
                // Contratos and the airline hear about it; Finance does when Contratos submits the draft.
                await ContractActivation.AnnounceAsync(context, item.Contract, "contract_renewal_started", now, cancellationToken);
            }
            await context.SaveChangesAsync(cancellationToken);
        }
    }

    private void Change(Contract contract, ContractStatus target, string reason, DateTimeOffset now)
    {
        context.Set<ContractStatusEvent>().Add(new ContractStatusEvent
        {
            ContractId = contract.Id, FromStatus = contract.Status, ToStatus = target, OccurredAt = now, Reason = reason,
        });
        contract.Status = target;
        contract.UpdatedAt = now;
    }

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
            // A discarded version keeps its history; the reason stays in the audit trail.
            if (version.Status == ContractVersionStatus.Rejected)
                entries.Add(new(version.UpdatedAt, "draft", $"Contratos descartó la versión {version.VersionNumber}", null, null));
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
        foreach (var signature in await context.ContractSignatures.AsNoTracking()
                     .Where(item => versionIds.Contains(item.ContractVersionId)).ToArrayAsync(cancellationToken))
            entries.Add(new(signature.SignedAt, "signature",
                signature.Party == ContractSignatureParty.Aviam ? "Firma de AVIAM" : "Firma de la aerolínea",
                $"{signature.SignerName} · {signature.SignerTitle}", null));
        foreach (var change in await context.Set<ContractStatusEvent>().AsNoTracking()
                     .Where(item => item.ContractId == contract.Id).ToArrayAsync(cancellationToken))
            entries.Add(new(change.OccurredAt, "status", change is { FromStatus: ContractStatus.Draft, ToStatus: ContractStatus.Terminated }
                ? "Contrato descartado antes de activarse" : StatusTitle(change.ToStatus), change.Reason, await Name(change.ActorAccountId)));
        foreach (var permit in await context.AirlinePermits.AsNoTracking().Where(item => item.AirlineId == contract.AirlineId)
                     .ToArrayAsync(cancellationToken))
        {
            entries.Add(new(permit.CreatedAt, "permit", $"Permiso enviado: {PermitTitle(permit.Kind)}",
                $"{permit.Number} · {permit.Issuer} · vence el {permit.ExpiresOn:dd/MM/yyyy}", null));
            if (permit.ReviewedAt is { } reviewed)
                entries.Add(new(reviewed, "permit", permit.Review == AirlinePermitReview.Verified
                    ? $"Contratos verificó {PermitTitle(permit.Kind)}" : $"Contratos rechazó {PermitTitle(permit.Kind)}",
                    permit.ReviewNote, await Name(permit.ReviewedByAccountId)));
        }
        // What comes next, so the cycle can be read forward too.
        var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        if (versions.Where(item => item.Status == ContractVersionStatus.Approved).MaxBy(item => item.ValidFrom) is { ValidTo: { } end } &&
            end >= today && contract.Status is ContractStatus.Active or ContractStatus.Suspended)
            entries.Add(new(new DateTimeOffset(end.ToDateTime(TimeOnly.MaxValue), TimeSpan.Zero), "upcoming",
                "Vencimiento previsto del contrato", null, null));
        return new ContractTimelineData(contract.PublicId, contract.ContractCode, contract.Status.ToString(),
            entries.OrderBy(item => item.At).ToArray());
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

    private static string PermitTitle(AirlinePermitKind kind) => kind switch
    {
        AirlinePermitKind.OperatingPermit => "permiso de operación",
        AirlinePermitKind.AirOperatorCertificate => "certificado de explotador",
        AirlinePermitKind.Insurance => "póliza de seguro",
        _ => "documento",
    };
}
