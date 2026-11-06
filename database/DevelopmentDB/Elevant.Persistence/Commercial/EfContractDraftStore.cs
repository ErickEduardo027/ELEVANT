using System.Data;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Contract drafts for Contratos and the airline portal (phase 1, block B): the lists, observations
/// in both directions, saving, scope (services and stations), readiness, the submission to Finance
/// and the discard. Commands run serializable with an idempotency receipt
/// (<see cref="CommercialCommandReceipts"/>) and expect the version rowversion; the endpoints that
/// already existed accept both as optional while older clients exist (expand).
/// </summary>
/// <remarks>
/// A draft is a version in Draft or awaiting Finance on a contract that is not terminated, so the
/// renewal of a suspended or expired contract is a draft too.
/// </remarks>
internal sealed partial class EfContractDraftStore(
    ElevantDbContext context,
    IActorContextResolver actors,
    CommercialPermissionGuard permissions) : IContractDraftStore
{
    /// <summary>How the airline portal names Contratos' answers: internal names stay internal.</summary>
    private const string ContractsAuthor = "Contratos AVIAM";

    private sealed record DraftRow(ContractVersion Version, Contract Contract, string Airline);

    public async Task<ContractDraftOverviewData?> GetOverviewForContractsAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.drafts.read", cancellationToken))
            return null;
        var drafts = await (from version in context.ContractVersions.AsNoTracking()
            join contract in context.Contracts.AsNoTracking()
                on version.ContractId equals contract.Id
            join airline in context.Airlines.AsNoTracking()
                on contract.AirlineId equals airline.Id
            where version.Status == ContractVersionStatus.Draft && contract.Status != ContractStatus.Terminated
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
        if (!await permissions.HasAsync(actorId, "contracts.drafts.read", cancellationToken))
            return null;
        return await ListAsync(null, cancellationToken);
    }

    /// <summary>
    /// Drafts of the given airlines (the portal) or of every airline (Contratos). The portal never
    /// receives the Finance base prices, base charge values or the internal reason of a Finance
    /// return (1-N05); the fields stay, null. The base price uses the version's only station, as the
    /// draft creation and the Finance comparison do (1-N06).
    /// </summary>
    private async Task<IReadOnlyList<ContractDraftData>> ListAsync(long[]? airlineIds,
        CancellationToken cancellationToken)
    {
        var forAirline = airlineIds is not null;
        var drafts = await (from version in context.ContractVersions.AsNoTracking()
            join contract in context.Contracts.AsNoTracking()
                on version.ContractId equals contract.Id
            join airline in context.Airlines.AsNoTracking()
                on contract.AirlineId equals airline.Id
            where (version.Status == ContractVersionStatus.Draft ||
                    version.Status == ContractVersionStatus.PendingFinanceApproval) &&
                contract.Status != ContractStatus.Terminated &&
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
            select new { link.ContractVersionId, link.StationId, station.Code, station.Name })
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
        var reviews = (await context.ContractFinanceReviews.AsNoTracking()
                .Where(review => versionIds.Contains(review.ContractVersionId))
                .OrderByDescending(review => review.DecidedAt).ToArrayAsync(cancellationToken))
            .GroupBy(review => review.ContractVersionId).ToDictionary(group => group.Key, group => group.First());
        var contractCharges = (await context.ContractChargeRates.AsNoTracking()
                .Where(rate => versionIds.Contains(rate.ContractVersionId)).ToArrayAsync(cancellationToken))
            .ToLookup(rate => rate.ContractVersionId);
        var charges = await context.ChargeDefinitions.AsNoTracking().Where(charge => charge.IsActive)
            .OrderBy(charge => charge.Code).ToArrayAsync(cancellationToken);
        var basePrices = new Dictionary<long, IReadOnlyDictionary<long, FinanceTariffLookup.BaseServiceRate>>();
        var baseCharges = new Dictionary<long, IReadOnlyDictionary<long, FinanceTariffLookup.BaseChargeRate>>();
        foreach (var draft in drafts)
        {
            if (forAirline)
            {
                basePrices[draft.version.Id] = new Dictionary<long, FinanceTariffLookup.BaseServiceRate>();
                baseCharges[draft.version.Id] = new Dictionary<long, FinanceTariffLookup.BaseChargeRate>();
                continue;
            }
            var serviceIds = rates.Where(rate => rate.rate.ContractVersionId == draft.version.Id)
                .Select(rate => rate.rate.ServiceDefinitionId).ToArray();
            var baseStation = ContractDraftRules.BaseStation(stations
                .Where(station => station.ContractVersionId == draft.version.Id).Select(station => station.StationId).ToArray());
            basePrices[draft.version.Id] = await FinanceTariffLookup.ServiceRatesAsync(context,
                draft.version.CurrencyCode, draft.version.ValidFrom, baseStation, serviceIds, cancellationToken);
            baseCharges[draft.version.Id] = await FinanceTariffLookup.ChargeRatesAsync(context,
                draft.version.CurrencyCode, draft.version.ValidFrom, cancellationToken);
        }
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
                    rate.rate.MinimumQuantity, rate.rate.IsConfirmed == true,
                    basePrices[item.version.Id].GetValueOrDefault(rate.rate.ServiceDefinitionId)?.UnitPrice,
                    basePrices[item.version.Id].GetValueOrDefault(rate.rate.ServiceDefinitionId)?.MinimumBillableQuantity))
                .ToArray(),
            comments.Where(comment => comment.comment.ContractVersionId == item.version.Id)
                .Select(comment =>
                {
                    var fromAirline = airlineAuthors.Contains(comment.comment.AuthorAccountId);
                    return new ContractDraftCommentData(comment.comment.PublicId,
                        forAirline && !fromAirline ? ContractsAuthor : $"{comment.FirstName} {comment.LastName}".Trim(),
                        comment.comment.Body, comment.comment.CreatedAt, fromAirline);
                }).ToArray(),
            item.version.Status.ToString(),
            reviews.GetValueOrDefault(item.version.Id)?.Decision.ToString(),
            forAirline ? null : reviews.GetValueOrDefault(item.version.Id)?.Reason,
            charges.Select(charge =>
            {
                var negotiated = contractCharges[item.version.Id].FirstOrDefault(rate => rate.ChargeDefinitionId == charge.Id);
                return new ContractDraftChargeData(charge.PublicId, charge.Code, charge.Name, charge.Method.ToString(),
                    baseCharges[item.version.Id].GetValueOrDefault(charge.Id)?.Value, negotiated?.IsExcluded == true,
                    negotiated?.Value);
            }).ToArray(), Version(item.version)))
            .ToArray();
    }

    public async Task<ContractDraftQuery<ContractDraftReadinessData>> GetReadinessAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.drafts.read", cancellationToken))
            return ContractDraftQuery.Failed<ContractDraftReadinessData>(ContractDraftFailure.Forbidden);
        var row = await DraftAsync(versionId, false, cancellationToken);
        if (row is null || StateCode(row, allowPending: true) is not null)
            return ContractDraftQuery.Failed<ContractDraftReadinessData>(ContractDraftFailure.NotFound);
        var (issues, portalAccount) = await EvaluateAsync(row, DateTimeOffset.UtcNow, cancellationToken);
        return ContractDraftQuery.Found(new ContractDraftReadinessData(versionId,
            Version(row.Version), row.Version.Status.ToString(),
            row.Version.Status == ContractVersionStatus.Draft && issues.Count == 0, portalAccount,
            issues.Select(issue => new ContractDraftIssueData(issue.Code, issue.Subjects)).ToArray()));
    }

    public async Task<ContractDraftQuery<ContractDraftScopeData>> GetScopeAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.drafts.read", cancellationToken))
            return ContractDraftQuery.Failed<ContractDraftScopeData>(ContractDraftFailure.Forbidden);
        var row = await DraftAsync(versionId, false, cancellationToken);
        if (row is null || StateCode(row, allowPending: true) is not null)
            return ContractDraftQuery.Failed<ContractDraftScopeData>(ContractDraftFailure.NotFound);
        var rates = await context.ContractServiceRates.AsNoTracking()
            .Where(rate => rate.ContractVersionId == row.Version.Id)
            .Select(rate => new { rate.ServiceDefinitionId, rate.PublicId }).ToArrayAsync(cancellationToken);
        var rateOf = rates.ToDictionary(rate => rate.ServiceDefinitionId, rate => rate.PublicId);
        var packaged = (await PackagedServicesAsync(row.Version.Id, cancellationToken)).ToHashSet();
        var serviceKeys = rateOf.Keys.ToArray();
        // Active catalog services can be added; retired ones appear only while the draft still has them.
        var services = await context.ServiceDefinitions.AsNoTracking()
            .Where(service => service.IsActive || serviceKeys.Contains(service.Id))
            .OrderBy(service => service.DisplayOrder).ThenBy(service => service.Code)
            .Select(service => new { service.Id, service.PublicId, service.Code, service.Name, service.IsActive })
            .ToArrayAsync(cancellationToken);
        var stationKeys = await ContractDraftAudience.StationsAsync(context, row.Version.Id, cancellationToken);
        var stations = await context.Stations.AsNoTracking()
            .Where(station => station.IsActive || stationKeys.Contains(station.Id))
            .OrderBy(station => station.Code)
            .Select(station => new { station.Id, station.PublicId, station.Code, station.Name, station.IsActive })
            .ToArrayAsync(cancellationToken);
        return ContractDraftQuery.Found(new ContractDraftScopeData(versionId, Version(row.Version),
            row.Version.Status.ToString(),
            services.Select(service => new ContractDraftScopeServiceData(service.PublicId, service.Code, service.Name,
                service.IsActive, rateOf.ContainsKey(service.Id),
                rateOf.TryGetValue(service.Id, out var rateId) ? (Guid?)rateId : null, packaged.Contains(service.Id))).ToArray(),
            stations.Select(station => new ContractDraftScopeStationData(station.PublicId, station.Code, station.Name,
                station.IsActive, stationKeys.Contains(station.Id))).ToArray()));
    }

    /// <summary>
    /// The readiness facts of a draft (1-D, 1-N14) and its portal account status: Active (someone
    /// accepted the invitation), Invited (an account exists, not activated yet) or Missing.
    /// </summary>
    private async Task<(IReadOnlyList<ContractDraftIssue> Issues, string PortalAccount)> EvaluateAsync(DraftRow row,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var invitations = await (from airline in context.Airlines.AsNoTracking()
                                 join membership in context.OrganizationMemberships.AsNoTracking()
                                     on airline.OrganizationId equals membership.OrganizationId
                                 join user in context.Users.AsNoTracking() on membership.AccountId equals user.Id
                                 where airline.Id == row.Contract.AirlineId &&
                                     membership.Kind == MembershipKind.AirlineClient &&
                                     membership.Status == MembershipStatus.Active &&
                                     user.Status == AccountLifecycleStatus.Active
                                 select user.InvitationStatus).ToArrayAsync(cancellationToken);
        var portalAccount = invitations.Contains(InvitationStatus.Accepted) ? "Active"
            : invitations.Length > 0 ? "Invited" : "Missing";
        var rates = await (from rate in context.ContractServiceRates.AsNoTracking()
                           join service in context.ServiceDefinitions.AsNoTracking()
                               on rate.ServiceDefinitionId equals service.Id
                           where rate.ContractVersionId == row.Version.Id
                           select new { rate.IsConfirmed, service.Code, service.Name, service.IsActive })
            .ToArrayAsync(cancellationToken);
        var stations = await ContractDraftAudience.StationsAsync(context, row.Version.Id, cancellationToken);
        var packages = await LinkedPackagesAsync(row.Version.Id, cancellationToken);
        var reviewers = await ContractDraftAudience.FinanceReviewersAsync(context, "finance.contract_approvals.decide",
            stations, now, cancellationToken);
        var facts = new ContractDraftFacts(portalAccount != "Missing", row.Version.Terms,
            rates.Select(rate => rate.IsConfirmed).ToArray(), stations.Length,
            rates.Where(rate => !rate.IsActive).Select(rate => $"{rate.Code} · {rate.Name}").ToArray(),
            packages.Where(package => !PackageFits(package, row.Version.CurrencyCode, row.Version.ValidFrom,
                row.Version.ValidTo)).Select(package => $"{package.Code} v{package.VersionNumber}").ToArray(),
            row.Version.ValidFrom, await CurrentApprovedStartAsync(row.Contract.Id, row.Version.Id, cancellationToken),
            reviewers.Length > 0);
        return (ContractDraftRules.Readiness(facts), portalAccount);
    }

    /// <summary>A linked package is in rule while it is published (or historical) and fits the version.</summary>
    internal static bool PackageFits(ServicePackageVersion package, string currency, DateOnly validFrom, DateOnly? validTo) =>
        package.Status != TariffVersionStatus.Draft &&
        ContractDraftRules.PackageFits(package.CurrencyCode, package.ValidFrom, package.ValidTo, currency, validFrom, validTo);

    private Task<ServicePackageVersion[]> LinkedPackagesAsync(long versionId, CancellationToken cancellationToken) =>
        (from link in context.Set<ContractServicePackage>().AsNoTracking()
         join package in context.Set<ServicePackageVersion>().AsNoTracking() on link.PackageVersionId equals package.Id
         where link.ContractVersionId == versionId
         select package).ToArrayAsync(cancellationToken);

    /// <summary>Services the linked packages cover: removing one of them would orphan the package.</summary>
    private Task<long[]> PackagedServicesAsync(long versionId, CancellationToken cancellationToken) =>
        (from link in context.Set<ContractServicePackage>().AsNoTracking()
         join component in context.Set<ServicePackageComponent>().AsNoTracking()
             on link.PackageVersionId equals component.PackageVersionId
         where link.ContractVersionId == versionId
         select component.ServiceDefinitionId).Distinct().ToArrayAsync(cancellationToken);

    /// <summary>Start of the latest approved version of the contract, other than this one.</summary>
    private Task<DateOnly?> CurrentApprovedStartAsync(long contractId, long versionId, CancellationToken cancellationToken) =>
        context.ContractVersions.AsNoTracking()
            .Where(item => item.ContractId == contractId && item.Id != versionId &&
                item.Status == ContractVersionStatus.Approved)
            .MaxAsync(item => (DateOnly?)item.ValidFrom, cancellationToken);

    /// <summary>
    /// The version with its contract and airline name; tracked inside a command. The airline name is
    /// read apart: an AsNoTracking source anywhere in a query makes the whole query untracked.
    /// </summary>
    private async Task<DraftRow?> DraftAsync(Guid versionId, bool track, CancellationToken cancellationToken,
        long[]? airlineIds = null)
    {
        var query = from version in context.ContractVersions
                    join contract in context.Contracts on version.ContractId equals contract.Id
                    where version.PublicId == versionId &&
                        (airlineIds == null || airlineIds.Contains(contract.AirlineId))
                    select new { version, contract };
        var row = await (track ? query : query.AsNoTracking()).SingleOrDefaultAsync(cancellationToken);
        if (row is null) return null;
        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == row.contract.AirlineId)
            .Select(item => item.Name).SingleAsync(cancellationToken);
        return new DraftRow(row.version, row.contract, airline);
    }

    /// <summary>
    /// Why the version does not accept the command: <c>draft_in_finance_review</c> while Finance
    /// reviews it (when the command needs a Draft) and <c>draft_closed</c> once approved, discarded or
    /// on a terminated contract.
    /// </summary>
    private static string? StateCode(DraftRow row, bool allowPending) =>
        row.Contract.Status == ContractStatus.Terminated ? "draft_closed"
        : row.Version.Status == ContractVersionStatus.Draft ? null
        : row.Version.Status == ContractVersionStatus.PendingFinanceApproval
            ? allowPending ? null : "draft_in_finance_review"
        : "draft_closed";

    private static string Version(ContractVersion version) => Convert.ToBase64String(version.RowVersion);

    private static ContractDraftResult? HeaderFailure(Guid idempotencyKey, string? expectedVersion) =>
        idempotencyKey == Guid.Empty
            ? ContractDraftResult.Failed(ContractDraftFailure.Invalid, "idempotency_key_required")
            : string.IsNullOrWhiteSpace(expectedVersion)
                ? ContractDraftResult.Failed(ContractDraftFailure.Invalid, "expected_version_required")
                : null;

    private static ContractDraftResult Conflict(string code) => ContractDraftResult.Failed(ContractDraftFailure.Conflict, code);
    private static ContractDraftResult Invalid(string code) => ContractDraftResult.Failed(ContractDraftFailure.Invalid, code);
    private static ContractDraftResult NotFound() => ContractDraftResult.Failed(ContractDraftFailure.NotFound, "not_found");

    private Task<long> ActorDatabaseIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id).SingleAsync(cancellationToken);

    /// <summary>
    /// Runs one command serializable: the receipt of its Idempotency-Key is resolved first (a
    /// legitimate retry sees the rowversion already changed), the command applies its rules and
    /// changes, and the receipt is written in the same transaction. A failed rule rolls back.
    /// </summary>
    private async Task<ContractDraftResult> RunAsync(long actorDatabaseId, Guid? idempotencyKey, string action,
        object payload, Func<DateTimeOffset, Task<ContractDraftResult>> command, CancellationToken cancellationToken)
    {
        var hash = CommercialCommandReceipts.Hash(payload);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(
                    IsolationLevel.Serializable, cancellationToken);
                if (idempotencyKey is { } key)
                {
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return ContractDraftResult.Success(prior.ResultId);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return Conflict("idempotency_conflict");
                }
                var now = DateTimeOffset.UtcNow;
                var result = await command(now);
                if (!result.IsSuccess)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actorDatabaseId, action, hash, result.Id!.Value, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return result;
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return Conflict("version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent command with the same key committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? ContractDraftResult.Success(concurrent.ResultId)
                : Conflict("idempotency_conflict");
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // Another command changed the same rows first (a rate or a station added twice).
            context.ChangeTracker.Clear();
            return Conflict("version_conflict");
        }
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
}
