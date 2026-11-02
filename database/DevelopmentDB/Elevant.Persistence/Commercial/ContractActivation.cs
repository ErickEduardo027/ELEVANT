using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// The single place a contract becomes active (ADR-0024): Finance approved the version that is in
/// force or about to start, both parties signed it, and the airline holds a verified operating
/// permit that has not expired. A contract the sweep suspended for an expired permit resumes the
/// same way once a new permit is verified.
/// </summary>
internal static class ContractActivation
{
    public const string PermitSuspensionReason = "Permiso de operación vencido o sin verificar.";

    /// <summary>Activates the ready contracts of one airline (or of all when null) and saves.</summary>
    public static async Task<int> ActivateReadyAsync(ElevantDbContext context, long? airlineId, long? actorAccountId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var today = DateOnly.FromDateTime(now.UtcDateTime);
        var candidates = await context.Contracts
            .Where(contract => (airlineId == null || contract.AirlineId == airlineId) &&
                (contract.Status == ContractStatus.Draft || contract.Status == ContractStatus.Expired ||
                 contract.Status == ContractStatus.Suspended))
            .ToArrayAsync(cancellationToken);
        var activated = 0;
        foreach (var contract in candidates)
        {
            if (contract.Status == ContractStatus.Suspended && !await SuspendedForPermitAsync(context, contract.Id, cancellationToken))
                continue;
            var version = await context.ContractVersions.AsNoTracking()
                .Where(item => item.ContractId == contract.Id && item.Status == ContractVersionStatus.Approved &&
                    (item.ValidTo == null || item.ValidTo >= today))
                .OrderByDescending(item => item.ValidFrom).FirstOrDefaultAsync(cancellationToken);
            if (version is null) continue;
            var parties = await context.ContractSignatures.AsNoTracking().Where(item => item.ContractVersionId == version.Id)
                .Select(item => item.Party).Distinct().CountAsync(cancellationToken);
            if (parties < 2 || !await HasUsablePermitAsync(context, contract.AirlineId, today, cancellationToken)) continue;

            var from = contract.Status;
            contract.Status = ContractStatus.Active;
            contract.SignedOn ??= DateOnly.FromDateTime(now.UtcDateTime);
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

    private static async Task<bool> SuspendedForPermitAsync(ElevantDbContext context, long contractId,
        CancellationToken cancellationToken)
    {
        var last = await context.Set<ContractStatusEvent>().AsNoTracking().Where(item => item.ContractId == contractId)
            .OrderByDescending(item => item.OccurredAt).ThenByDescending(item => item.Id).FirstOrDefaultAsync(cancellationToken);
        return last is { ToStatus: ContractStatus.Suspended, ActorAccountId: null, Reason: PermitSuspensionReason };
    }
}
