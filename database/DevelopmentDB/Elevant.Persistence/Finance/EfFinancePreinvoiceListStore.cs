using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed class EfFinancePreinvoiceListStore(
    ElevantDbContext context, TimeProvider timeProvider) : IFinancePreinvoiceListStore
{
    public async Task<FinancePreinvoicePageData?> ListAsync(Guid accountId, Guid stationId,
        int page, int limit, CancellationToken cancellationToken = default)
    {
        if (stationId == Guid.Empty || page < 1 || limit is < 1 or > 50 ||
            (long)(page - 1) * limit > int.MaxValue)
            throw new ArgumentOutOfRangeException(nameof(page));

        var actor = await new EfActorContextResolver(context, timeProvider)
            .ResolveAsync(accountId, cancellationToken);
        if (actor is null ||
            !actor.HasPermission("finance.preinvoices.read") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == stationId))
            return null;

        var now = timeProvider.GetUtcNow();
        var scope = await (
            from account in context.Users.AsNoTracking()
            from station in context.Stations.AsNoTracking()
            where account.PublicId == accountId && station.PublicId == stationId &&
                  station.IsActive && context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == account.Id && grant.StationId == station.Id &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            select new { AccountId = account.Id, StationId = station.Id })
            .SingleOrDefaultAsync(cancellationToken);
        if (scope is null) return null;

        var rows = await (
            from item in context.Preinvoices.AsNoTracking()
            join airline in context.Airlines.AsNoTracking() on item.AirlineId equals airline.Id
            where item.StationId == scope.StationId &&
                  context.AccountStationScopes.AsNoTracking().Any(grant =>
                      grant.AccountId == scope.AccountId && grant.StationId == item.StationId &&
                      grant.GrantedAt <= now && grant.RevokedAt == null)
            orderby item.CreatedAt descending, item.Id descending
            select new
            {
                item.PublicId, AirlineId = airline.PublicId, AirlineName = airline.Name,
                item.From, item.To, item.CurrencyCode, item.Total, item.Status,
                item.CreatedAt,
                LineCount = context.PreinvoiceLines.AsNoTracking()
                    .Count(line => line.PreinvoiceId == item.Id),
            }).Skip((page - 1) * limit).Take(limit + 1).ToArrayAsync(cancellationToken);

        return new FinancePreinvoicePageData(page, limit, rows.Length > limit,
            rows.Take(limit).Select(row => new FinancePreinvoiceListItem(
                row.PublicId, row.AirlineId, row.AirlineName, stationId, row.From,
                row.To, row.CurrencyCode, row.Total, row.Status.ToString(),
                row.LineCount, row.CreatedAt)).ToArray());
    }
}
