using System.Globalization;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Elevant.Persistence.Finance;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfContractDraftStore(
    ElevantDbContext context,
    IActorContextResolver actors,
    CommercialPermissionGuard permissions) : IContractDraftStore
{
    public async Task<ContractDraftOverviewData?> GetOverviewForContractsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "commercial.requests.read", cancellationToken))
            return null;
        var drafts = await (from version in context.ContractVersions.AsNoTracking()
            join contract in context.Contracts.AsNoTracking()
                on version.ContractId equals contract.Id
            join airline in context.Airlines.AsNoTracking()
                on contract.AirlineId equals airline.Id
            where version.Status == ContractVersionStatus.Draft &&
                contract.Status == ContractStatus.Draft
            orderby version.Id descending
            select new { version.PublicId, contract.ContractCode, Airline = airline.Name })
            .Take(100).ToArrayAsync(cancellationToken);
        return new ContractDraftOverviewData(drafts.Length, drafts.Take(5)
            .Select(item => new ContractDraftOverviewItemData(item.PublicId,
                item.ContractCode, item.Airline)).ToArray());
    }

    public async Task<IReadOnlyList<ContractDraftData>?> ListForAirlineAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var airlineIds = await AuthorizedAirlineIdsAsync(actorId, cancellationToken);
        return airlineIds is null ? null : await ListAsync(airlineIds, cancellationToken);
    }

    public async Task<IReadOnlyList<ContractDraftData>?> ListForContractsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "commercial.requests.read", cancellationToken))
            return null;
        return await ListAsync(null, cancellationToken);
    }

    private async Task<IReadOnlyList<ContractDraftData>> ListAsync(long[]? airlineIds,
        CancellationToken cancellationToken)
    {
        var drafts = await (from version in context.ContractVersions.AsNoTracking()
            join contract in context.Contracts.AsNoTracking()
                on version.ContractId equals contract.Id
            join airline in context.Airlines.AsNoTracking()
                on contract.AirlineId equals airline.Id
            where version.Status == ContractVersionStatus.Draft &&
                contract.Status == ContractStatus.Draft &&
                (airlineIds == null || airlineIds.Contains(airline.Id))
            orderby version.Id descending
            select new { version, contract, airline.Name }).Take(100)
            .ToArrayAsync(cancellationToken);
        var versionIds = drafts.Select(item => item.version.Id).ToArray();
        var rates = await (from rate in context.ContractServiceRates.AsNoTracking()
            join service in context.ServiceDefinitions.AsNoTracking()
                on rate.ServiceDefinitionId equals service.Id
            where versionIds.Contains(rate.ContractVersionId)
            select new { rate, service.Name }).ToArrayAsync(cancellationToken);
        var stations = await (from link in context.Set<ContractVersionStation>().AsNoTracking()
            join station in context.Stations.AsNoTracking()
                on link.StationId equals station.Id
            where versionIds.Contains(link.ContractVersionId)
            select new { link.ContractVersionId, station.Code, station.Name })
            .ToArrayAsync(cancellationToken);
        var comments = await (from comment in context.ContractDraftComments.AsNoTracking()
            join account in context.Users.AsNoTracking()
                on comment.AuthorAccountId equals account.Id
            join person in context.Persons.AsNoTracking()
                on account.PersonId equals person.Id
            where versionIds.Contains(comment.ContractVersionId)
            orderby comment.CreatedAt
            select new { comment, person.FirstName, person.LastName })
            .ToArrayAsync(cancellationToken);
        var airlineAuthors = await (from assignment in context.Set<IdentityUserRole<long>>().AsNoTracking()
            join role in context.Roles.AsNoTracking() on assignment.RoleId equals role.Id
            where role.NormalizedName == "AIRLINE_CLIENT"
            select assignment.UserId).Distinct().ToArrayAsync(cancellationToken);
        return drafts.Select(item => new ContractDraftData(
            item.version.PublicId, item.contract.PublicId, item.contract.ContractCode,
            item.Name, item.contract.Status.ToString(), item.version.ValidFrom,
            item.version.ValidTo, item.version.CurrencyCode, item.version.Terms,
            stations.Where(station => station.ContractVersionId == item.version.Id)
                .Select(station => $"{station.Code} · {station.Name}").ToArray(),
            rates.Where(rate => rate.rate.ContractVersionId == item.version.Id)
                .Select(rate => new ContractDraftRateData(rate.rate.PublicId,
                    rate.Name, rate.rate.BillingUnit, rate.rate.UnitPrice,
                    rate.rate.MinimumQuantity, rate.rate.IsConfirmed == true)).ToArray(),
            comments.Where(comment => comment.comment.ContractVersionId == item.version.Id)
                .Select(comment => new ContractDraftCommentData(comment.comment.PublicId,
                    $"{comment.FirstName} {comment.LastName}".Trim(),
                    comment.comment.Body, comment.comment.CreatedAt,
                    airlineAuthors.Contains(comment.comment.AuthorAccountId))).ToArray()))
            .ToArray();
    }

    public async Task<ContractDraftResult> AddAirlineCommentAsync(Guid actorId,
        Guid versionId, string body, CancellationToken cancellationToken = default)
    {
        var airlineIds = await AuthorizedAirlineIdsAsync(actorId, cancellationToken);
        if (airlineIds is null) return ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        if (string.IsNullOrWhiteSpace(body) || body.Trim().Length > 2000)
            return ContractDraftResult.Failed(ContractDraftFailure.Invalid);
        var row = await (from version in context.ContractVersions
            join contract in context.Contracts on version.ContractId equals contract.Id
            where version.PublicId == versionId &&
                version.Status == ContractVersionStatus.Draft &&
                contract.Status == ContractStatus.Draft &&
                airlineIds.Contains(contract.AirlineId)
            select new { Version = version, Contract = contract })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null) return ContractDraftResult.Failed(ContractDraftFailure.NotFound);
        var accountId = await context.Users.Where(item => item.PublicId == actorId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        var comment = new ContractDraftComment
        {
            PublicId = Guid.CreateVersion7(), ContractVersionId = row.Version.Id,
            AuthorAccountId = accountId, Body = body.Trim(),
            CreatedAt = now, UpdatedAt = now,
        };
        context.ContractDraftComments.Add(comment);
        CommercialAuditWriter.Add(context, accountId, "commercial.draft.commented",
            "commercial.contract_versions", row.Version.PublicId);
        await NotifyReadersAsync("contract_draft_comments", row.Version.PublicId,
            now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return ContractDraftResult.Success(comment.PublicId);
    }

    public async Task<ContractDraftResult> UpdateAsync(Guid actorId, Guid versionId,
        UpdateContractDraftInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "commercial.requests.edit", cancellationToken))
            return ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        if (input is null || string.IsNullOrWhiteSpace(input.Terms) ||
            input.Terms.Trim().Length > 10000 || input.CurrencyCode?.Length != 3 ||
            !input.CurrencyCode.All(char.IsAsciiLetterUpper) ||
            input.ValidTo is not null && input.ValidTo < input.ValidFrom ||
            input.Rates is null or { Count: < 1 or > 100 } ||
            input.Rates.Select(rate => rate.Id).Distinct().Count() != input.Rates.Count ||
            input.Rates.Any(rate => rate.UnitPrice < 0 || rate.MinimumQuantity < 0 ||
                string.IsNullOrWhiteSpace(rate.BillingUnit) || rate.BillingUnit.Length > 32))
            return ContractDraftResult.Failed(ContractDraftFailure.Invalid);
        var row = await (from version in context.ContractVersions
            join contract in context.Contracts on version.ContractId equals contract.Id
            where version.PublicId == versionId &&
                version.Status == ContractVersionStatus.Draft &&
                contract.Status == ContractStatus.Draft
            select new { Version = version, Contract = contract })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null) return ContractDraftResult.Failed(ContractDraftFailure.NotFound);
        var rates = await context.ContractServiceRates.Where(rate =>
            rate.ContractVersionId == row.Version.Id).ToArrayAsync(cancellationToken);
        if (rates.Length != input.Rates.Count || rates.Any(rate =>
            !input.Rates.Any(item => item.Id == rate.PublicId)))
            return ContractDraftResult.Failed(ContractDraftFailure.Invalid);
        var beforePrices = string.Join(", ", rates.OrderBy(rate => rate.PublicId)
            .Select(rate => $"{rate.PublicId}:{rate.UnitPrice.ToString(CultureInfo.InvariantCulture)}"));
        var beforeConfirmation = string.Join(", ", rates.OrderBy(rate => rate.PublicId)
            .Select(rate => $"{rate.PublicId}:{(rate.IsConfirmed == true ? "confirmed" : "pending")}"));
        row.Version.Terms = input.Terms.Trim();
        row.Version.CurrencyCode = input.CurrencyCode;
        row.Version.ValidFrom = input.ValidFrom;
        row.Version.ValidTo = input.ValidTo;
        row.Version.UpdatedAt = DateTimeOffset.UtcNow;
        foreach (var rate in rates)
        {
            var inputRate = input.Rates.Single(item => item.Id == rate.PublicId);
            rate.BillingUnit = inputRate.BillingUnit.Trim();
            rate.UnitPrice = inputRate.UnitPrice;
            rate.MinimumQuantity = inputRate.MinimumQuantity;
            rate.IsConfirmed = inputRate.IsConfirmed;
            rate.UpdatedAt = DateTimeOffset.UtcNow;
        }
        var recipientIds = await context.ServiceRequests.AsNoTracking()
            .Where(request => request.Id == row.Contract.OriginatingServiceRequestId &&
                request.ProvisionedAccountId != null)
            .Select(request => request.ProvisionedAccountId!.Value)
            .ToArrayAsync(cancellationToken);
        foreach (var recipient in recipientIds)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "airline_contracts", row.Contract.PublicId, DateTimeOffset.UtcNow);
        var editorId = await context.Users.Where(item => item.PublicId == actorId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        CommercialAuditWriter.Add(context, editorId, "commercial.draft.updated",
            "commercial.contract_versions", row.Version.PublicId, null,
            new AuditFieldChangeData("rate.price", beforePrices,
                string.Join(", ", rates.OrderBy(rate => rate.PublicId)
                    .Select(rate => $"{rate.PublicId}:{rate.UnitPrice.ToString(CultureInfo.InvariantCulture)}"))),
            new AuditFieldChangeData("rate.confirmed", beforeConfirmation,
                string.Join(", ", rates.OrderBy(rate => rate.PublicId)
                    .Select(rate => $"{rate.PublicId}:{(rate.IsConfirmed == true ? "confirmed" : "pending")}"))));
        await context.SaveChangesAsync(cancellationToken);
        return ContractDraftResult.Success(versionId);
    }

    public async Task<ContractDraftResult> ActivateAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "commercial.requests.full", cancellationToken))
            return ContractDraftResult.Failed(ContractDraftFailure.Forbidden);
        var row = await (from version in context.ContractVersions
            join contract in context.Contracts on version.ContractId equals contract.Id
            join request in context.ServiceRequests on contract.OriginatingServiceRequestId equals request.Id
            where version.PublicId == versionId &&
                version.Status == ContractVersionStatus.Draft &&
                contract.Status == ContractStatus.Draft
            select new { Version = version, Contract = contract, Request = request })
            .SingleOrDefaultAsync(cancellationToken);
        if (row is null) return ContractDraftResult.Failed(ContractDraftFailure.NotFound);
        var rates = await context.ContractServiceRates.Where(rate =>
            rate.ContractVersionId == row.Version.Id).ToArrayAsync(cancellationToken);
        if (row.Request.ProvisionedAccountId is null ||
            string.IsNullOrWhiteSpace(row.Version.Terms) ||
            !ContractRateConfirmationPolicy.CanActivate(rates) ||
            !await context.Set<ContractVersionStation>().AnyAsync(station =>
                station.ContractVersionId == row.Version.Id, cancellationToken))
            return ContractDraftResult.Failed(ContractDraftFailure.Conflict);
        var actorDatabaseId = await context.Users.Where(item => item.PublicId == actorId)
            .Select(item => item.Id).SingleAsync(cancellationToken);
        var now = DateTimeOffset.UtcNow;
        row.Version.Status = ContractVersionStatus.Approved;
        row.Version.ApprovedAt = now;
        row.Version.ApprovedByAccountId = actorDatabaseId;
        row.Version.UpdatedAt = now;
        row.Contract.Status = ContractStatus.Active;
        row.Contract.SignedOn = DateOnly.FromDateTime(now.UtcDateTime);
        row.Contract.UpdatedAt = now;
        context.Set<ContractStatusEvent>().Add(new ContractStatusEvent
        {
            ContractId = row.Contract.Id, FromStatus = ContractStatus.Draft,
            ToStatus = ContractStatus.Active, OccurredAt = now,
            ActorAccountId = actorDatabaseId,
        });
        AccountChangeOutboxWriter.Add(context, row.Request.ProvisionedAccountId.Value,
            null, "airline_contracts", row.Contract.PublicId, now);
        var coveredStations = await context.Set<ContractVersionStation>().AsNoTracking()
            .Where(station => station.ContractVersionId == row.Version.Id)
            .Select(station => station.StationId).ToArrayAsync(cancellationToken);
        foreach (var coveredStation in coveredStations)
            await FinanceApprovedServiceChangeWriter.AddAsync(context, coveredStation,
                row.Version.PublicId, now, "finance_tariffs", cancellationToken);
        CommercialAuditWriter.Add(context, actorDatabaseId, "commercial.contract.activated",
            "commercial.contracts", row.Contract.PublicId);
        await context.SaveChangesAsync(cancellationToken);
        return ContractDraftResult.Success(row.Contract.PublicId);
    }

    private async Task<long[]?> AuthorizedAirlineIdsAsync(Guid actorId,
        CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.Roles.Any(role =>
            role.Code == "AIRLINE_CLIENT" && role.Portal == PortalKind.AirlinePortal))
            return null;
        var organizationIds = actor.Memberships.Where(membership =>
            membership.Kind == MembershipKind.AirlineClient &&
            membership.OrganizationType == OrganizationType.AirlineCustomer)
            .Select(membership => membership.OrganizationId).ToArray();
        if (organizationIds.Length == 0) return null;
        return await (from organization in context.Organizations.AsNoTracking()
            join airline in context.Airlines.AsNoTracking()
                on organization.Id equals airline.OrganizationId
            where organizationIds.Contains(organization.PublicId) &&
                organization.Status == OrganizationStatus.Active && airline.IsActive
            select airline.Id).ToArrayAsync(cancellationToken);
    }

    private async Task NotifyReadersAsync(string resource,
        Guid resourceId, DateTimeOffset at, CancellationToken cancellationToken)
    {
        var recipients = await CommercialNotificationRecipients.WithPermissionAsync(context,
            "commercial.requests.read", cancellationToken);
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                resource, resourceId, at);
    }
}
