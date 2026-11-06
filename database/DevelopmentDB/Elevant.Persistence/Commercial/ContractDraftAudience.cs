using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Who hears about a contract draft (phase 1, block B): the airline's portal accounts, the Finance
/// reviewers who cover every station of the version (1-N19) and Contratos when the airline's portal
/// account is ready (1-N14). Every notice is written in the transaction of its command.
/// </summary>
internal static class ContractDraftAudience
{
    /// <summary>Resource the Contratos draft screens re-read when a draft changes.</summary>
    public const string DraftsResource = "contract_drafts";

    /// <summary>Active portal accounts of the airline, the ones that review and sign its drafts.</summary>
    public static async Task<long[]> AirlineAccountsAsync(ElevantDbContext context, long airlineId,
        CancellationToken cancellationToken) =>
        await (from airline in context.Airlines.AsNoTracking()
               join membership in context.OrganizationMemberships.AsNoTracking()
                   on airline.OrganizationId equals membership.OrganizationId
               join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
               where airline.Id == airlineId && membership.Kind == MembershipKind.AirlineClient &&
                   membership.Status == MembershipStatus.Active && user.Status == AccountLifecycleStatus.Active
               select user.Id).Distinct().ToArrayAsync(cancellationToken);

    /// <summary>The portal re-reads its drafts and contracts (it observes <c>airline_contracts</c>).</summary>
    public static async Task NotifyAirlineAsync(ElevantDbContext context, Contract contract, DateTimeOffset now,
        CancellationToken cancellationToken)
    {
        foreach (var account in await AirlineAccountsAsync(context, contract.AirlineId, cancellationToken))
            AccountChangeOutboxWriter.Add(context, account, null, "airline_contracts", contract.PublicId, now);
    }

    /// <summary>Contratos sessions with the draft screens re-read them.</summary>
    public static async Task NotifyContractsAsync(ElevantDbContext context, string resource, Guid resourceId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        foreach (var recipient in await CommercialNotificationRecipients.WithPermissionAsync(context,
                     "contracts.drafts.read", cancellationToken))
            AccountChangeOutboxWriter.Add(context, recipient, null, resource, resourceId, now);
    }

    /// <summary>Stations of a version, for its base price and the Finance scope.</summary>
    public static Task<long[]> StationsAsync(ElevantDbContext context, long versionId,
        CancellationToken cancellationToken) =>
        context.Set<ContractVersionStation>().AsNoTracking().Where(link => link.ContractVersionId == versionId)
            .Select(link => link.StationId).ToArrayAsync(cancellationToken);

    /// <summary>
    /// Finance accounts holding <paramref name="permission"/> whose station scope covers every station
    /// of the version: the same rule the approval inbox and the decision apply.
    /// </summary>
    public static async Task<long[]> FinanceReviewersAsync(ElevantDbContext context, string permission,
        IReadOnlyCollection<long> stationIds, DateTimeOffset at, CancellationToken cancellationToken)
    {
        if (stationIds.Count == 0) return [];
        var holders = await DepartmentAccessQueries.AccountsWithPermissionAsync(context, permission, cancellationToken);
        return await StationScopeCoverage.CoveringAsync(context, holders, stationIds, at, cancellationToken);
    }

    /// <summary>
    /// 1-N14: the airline's portal account exists, so Contratos can send the draft to Finance. The
    /// alert points to the live draft of the contract the request created.
    /// </summary>
    public static async Task PortalAccountReadyAsync(ElevantDbContext context, long serviceRequestId,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var draft = await (from contract in context.Contracts.AsNoTracking()
                           join version in context.ContractVersions.AsNoTracking() on contract.Id equals version.ContractId
                           join airline in context.Airlines.AsNoTracking() on contract.AirlineId equals airline.Id
                           where contract.OriginatingServiceRequestId == serviceRequestId &&
                               contract.Status != ContractStatus.Terminated &&
                               (version.Status == ContractVersionStatus.Draft ||
                                version.Status == ContractVersionStatus.PendingFinanceApproval)
                           orderby version.VersionNumber descending
                           select new { version.PublicId, contract.ContractCode, Airline = airline.Name })
            .FirstOrDefaultAsync(cancellationToken);
        if (draft is null) return;
        await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, "contracts.drafts.read",
            "portal_account_ready", draft.PublicId, $"{draft.ContractCode} · {draft.Airline}", now, cancellationToken);
        await NotifyContractsAsync(context, DraftsResource, draft.PublicId, now, cancellationToken);
    }
}
