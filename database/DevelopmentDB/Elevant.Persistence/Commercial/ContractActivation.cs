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
/// The single place a contract becomes active (ADR-0024): Finance approved the version that is in
/// force or about to start, both parties signed that same content (2-N28), and the airline holds a
/// verified operating permit that has not expired. A contract the sweep suspended for an expired permit
/// resumes once a new permit is verified, with the version that governs it (2-C): a renewal waiting for
/// its signatures never blocks it. Days are AVIAM's business days (2-F).
/// </summary>
internal static class ContractActivation
{
    public const string PermitSuspensionReason = "Permiso de operación vencido o sin verificar.";

    /// <summary>Activates the ready contracts of one airline (or of all when null) and saves.</summary>
    public static async Task<int> ActivateReadyAsync(ElevantDbContext context, long? airlineId, long? actorAccountId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var today = BusinessCalendar.Today(now);
        var candidates = await context.Contracts
            .Where(contract => (airlineId == null || contract.AirlineId == airlineId) &&
                (contract.Status == ContractStatus.Draft || contract.Status == ContractStatus.Expired ||
                 contract.Status == ContractStatus.Suspended) &&
                // A contract whose scheduled termination already took effect never comes back (2-N14).
                (contract.TerminatedOn == null || contract.TerminatedOn > today))
            .ToArrayAsync(cancellationToken);
        var activated = 0;
        foreach (var contract in candidates)
        {
            if (contract.Status == ContractStatus.Suspended && !await SuspendedForPermitAsync(context, contract.Id, cancellationToken))
                continue;
            // A new or expired contract activates only with a version both parties signed over the same
            // content; a suspended one resumes with the version that governs it, legacy ones included.
            var source = contract.Status == ContractStatus.Suspended
                ? GoverningContractVersions.Of(context) : GoverningContractVersions.SignedByBoth(context);
            var version = await source.AsNoTracking()
                .Where(item => item.ContractId == contract.Id && (item.ValidTo == null || item.ValidTo >= today))
                .OrderByDescending(item => item.ValidFrom).FirstOrDefaultAsync(cancellationToken);
            if (version is null || !await HasUsablePermitAsync(context, contract.AirlineId, today, cancellationToken)) continue;

            var from = contract.Status;
            contract.Status = ContractStatus.Active;
            // 2-N05: SignedOn is the business day the contract first became active; renewals never move it.
            contract.SignedOn ??= today;
            contract.UpdatedAt = now;
            context.Set<ContractStatusEvent>().Add(new ContractStatusEvent
            {
                ContractId = contract.Id, FromStatus = from, ToStatus = ContractStatus.Active, OccurredAt = now,
                ActorAccountId = actorAccountId,
                Reason = from == ContractStatus.Suspended
                    ? "Reanudado: la aerolínea tiene un permiso de operación verificado y vigente."
                    : "Aprobado por Finanzas, firmado por ambas partes y con permiso de operación vigente.",
            });
            await AnnounceAsync(context, contract, "contract_activated", now, cancellationToken);
            // A resumed contract keeps the PDF it already sent; a newly active one sends the signed copy.
            if (from != ContractStatus.Suspended)
                await QueueSignedContractEmailsAsync(context, contract.Id, version.Id, now, cancellationToken);
            activated++;
        }
        if (activated > 0) await context.SaveChangesAsync(cancellationToken);
        return activated;
    }

    public static Task<bool> HasUsablePermitAsync(ElevantDbContext context, long airlineId, DateOnly today,
        CancellationToken cancellationToken) =>
        context.AirlinePermits.AsNoTracking().AnyAsync(permit => permit.AirlineId == airlineId &&
            permit.Kind == AirlinePermitKind.OperatingPermit && permit.Review == AirlinePermitReview.Verified &&
            permit.ExpiresOn >= today, cancellationToken);

    /// <summary>Contratos and the airline's portal accounts learn about a lifecycle change.</summary>
    public static async Task AnnounceAsync(ElevantDbContext context, Contract contract, string kind, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == contract.AirlineId)
            .Select(item => new { item.Name, item.OrganizationId }).SingleAsync(cancellationToken);
        await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, "contracts.agreements.read", kind,
            contract.PublicId, $"{contract.ContractCode} · {airline.Name}", now, cancellationToken);
        var accounts = await context.OrganizationMemberships.AsNoTracking()
            .Where(item => item.OrganizationId == airline.OrganizationId && item.Kind == MembershipKind.AirlineClient &&
                item.Status == MembershipStatus.Active)
            .Select(item => item.AccountId).Distinct().ToArrayAsync(cancellationToken);
        foreach (var account in accounts)
            AccountChangeOutboxWriter.Add(context, account, null, "airline_contracts", contract.PublicId, now);
    }

    /// <summary>
    /// Queues the activation email with the signed PDF (ADR-0025) for the airline's active portal
    /// accounts and the AVIAM signer. The PDF is rendered when the email is sent, never stored.
    /// </summary>
    public static async Task QueueSignedContractEmailsAsync(ElevantDbContext context, long contractId, long versionId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var head = await (from version in context.ContractVersions.AsNoTracking()
                          join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                          join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
                          where version.Id == versionId && contract.Id == contractId
                          select new { version.PublicId, version.ValidFrom, version.ValidTo, contract.ContractCode,
                              airline.Name, airline.OrganizationId })
            .SingleAsync(cancellationToken);
        var airlineAccounts = context.OrganizationMemberships.AsNoTracking()
            .Where(item => item.OrganizationId == head.OrganizationId && item.Kind == MembershipKind.AirlineClient &&
                item.Status == MembershipStatus.Active)
            .Select(item => item.AccountId);
        var signers = context.ContractSignatures.AsNoTracking().Where(item => item.ContractVersionId == versionId)
            .Select(item => item.SignerAccountId);
        var emails = await context.Users.AsNoTracking()
            .Where(user => (airlineAccounts.Contains(user.Id) || signers.Contains(user.Id)) &&
                user.Status == AccountLifecycleStatus.Active && user.Email != null)
            .Select(user => user.Email!).ToArrayAsync(cancellationToken);
        foreach (var email in emails.Distinct(StringComparer.OrdinalIgnoreCase))
            EfEmailOutboxStore.Add(context,
                AccountEmailTemplates.ContractActivated(email, head.Name, head.ContractCode, head.ValidFrom, head.ValidTo),
                EmailPurpose.ContractActivated, now, EfContractDocumentStore.AttachmentPrefix + head.PublicId);
    }

    private static async Task<bool> SuspendedForPermitAsync(ElevantDbContext context, long contractId,
        CancellationToken cancellationToken)
    {
        var last = await context.Set<ContractStatusEvent>().AsNoTracking().Where(item => item.ContractId == contractId)
            .OrderByDescending(item => item.OccurredAt).ThenByDescending(item => item.Id).FirstOrDefaultAsync(cancellationToken);
        return last is { ToStatus: ContractStatus.Suspended, ActorAccountId: null, Reason: PermitSuspensionReason };
    }
}
