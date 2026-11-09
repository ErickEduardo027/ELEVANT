using Elevant.Application.Common;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Targets current AVIAM Finance members in the approval transaction.</summary>
internal static class FinanceApprovedServiceChangeWriter
{
    /// <summary>
    /// 4-N11: an invoice of the station was issued, paid, applied, reversed or adjusted. «Por facturar» and «Facturas»
    /// read it again; the feed delivers it only to who reads invoicing or «Facturas» at the invoice's station.
    /// </summary>
    public const string InvoicesResource = "finance_invoices";

    public static async Task AddAsync(
        ElevantDbContext context, long stationId, Guid operationId,
        DateTimeOffset occurredAt, CancellationToken cancellationToken)
        => await AddAsync(context, stationId, operationId, occurredAt,
            "finance_approved_services", cancellationToken);

    public static Task AddAsync(
        ElevantDbContext context, long stationId, Guid resourceId,
        DateTimeOffset occurredAt, string resource, CancellationToken cancellationToken) =>
        AddAsync(context, stationId, [resourceId], occurredAt, resource, cancellationToken);

    /// <summary>4-N11: the hint of each invoice that changed, for the invoices of one station.</summary>
    public static Task AddInvoicesAsync(ElevantDbContext context, long stationId, IReadOnlyCollection<Guid> invoiceIds,
        DateTimeOffset occurredAt, CancellationToken cancellationToken) =>
        invoiceIds.Count == 0 ? Task.CompletedTask
            : AddAsync(context, stationId, invoiceIds, occurredAt, InvoicesResource, cancellationToken);

    /// <summary>One hint per resource for every current Finance member of the station.</summary>
    public static async Task AddAsync(
        ElevantDbContext context, long stationId, IReadOnlyCollection<Guid> resourceIds,
        DateTimeOffset occurredAt, string resource, CancellationToken cancellationToken)
    {
        if (resourceIds.Count == 0) return;
        // A membership is valid by AVIAM's business day (4-N10).
        var today = BusinessCalendar.Today(occurredAt);
        var recipients = await context.Users.AsNoTracking()
            .Where(account => account.Status == AccountLifecycleStatus.Active &&
                account.InvitationStatus == InvitationStatus.Accepted && account.EmailConfirmed &&
                context.UserRoles.Any(userRole => userRole.UserId == account.Id &&
                    context.Roles.Any(role => role.Id == userRole.RoleId &&
                        role.NormalizedName == "FINANZAS" && role.Portal == PortalKind.BackOffice)) &&
                context.AccountStationScopes.Any(scope => scope.AccountId == account.Id &&
                    scope.StationId == stationId && scope.GrantedAt <= occurredAt &&
                    scope.RevokedAt == null) &&
                context.OrganizationMemberships.Any(membership =>
                    membership.AccountId == account.Id &&
                    membership.Kind == MembershipKind.InternalStaff &&
                    membership.Status == MembershipStatus.Active &&
                    (membership.ValidFrom == null || membership.ValidFrom <= today) &&
                    (membership.ValidTo == null || membership.ValidTo >= today) &&
                    context.Organizations.Any(organization =>
                        organization.Id == membership.OrganizationId &&
                        organization.Type == OrganizationType.AviamOperator &&
                        organization.Status == OrganizationStatus.Active)))
            .Select(account => account.Id).Distinct().ToArrayAsync(cancellationToken);

        foreach (var recipient in recipients)
            foreach (var resourceId in resourceIds.Distinct())
                AccountChangeOutboxWriter.Add(context, recipient, stationId,
                    resource, resourceId, occurredAt);
    }
}
