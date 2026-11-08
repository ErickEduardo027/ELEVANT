using System.Data;
using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// Finance service packages and their link to contract drafts, plus the contract amendment (1-C).
/// Every command runs serializable with an idempotency receipt in
/// <c>commercial.finance_pricing_commands</c> (<see cref="CommercialCommandReceipts"/>).
/// </summary>
internal sealed class EfFinancePackageStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider clock) : IFinancePackageStore
{
    private const string DiscardAction = "finance.package.discard";
    private const string RetireAction = "finance.package.retire";
    private const string AmendmentAction = "contract.amendment";
    private const int ReasonMaxLength = 500;

    private sealed record Actor(long Id, ActorContext Access);
    private async Task<Actor?> ActorAsync(Guid id, string permission, CancellationToken ct)
    {
        var actor = await actors.ResolveAsync(id, ct);
        if (actor is null || !actor.HasPermission(permission) || !actor.Memberships.Any(x => x.Kind == MembershipKind.InternalStaff && x.OrganizationType == OrganizationType.AviamOperator)) return null;
        return new(await context.Users.Where(x => x.PublicId == id).Select(x => x.Id).SingleAsync(ct), actor);
    }
    private async Task<bool> CanReadAsync(Guid id, CancellationToken ct) =>
        await ActorAsync(id, "finance.packages.read", ct) is not null || await ActorAsync(id, "contracts.drafts.read", ct) is not null;
    private async Task<bool> ContractInScopeAsync(Guid actorId, long contractVersionId, CancellationToken ct)
    {
        var actor = await actors.ResolveAsync(actorId, ct);
        if (actor?.EffectiveAccess?.IsSuperAdministrator == true) return true;
        if (actor is null) return false;
        var stations = await (from link in context.Set<ContractVersionStation>().AsNoTracking() join station in context.Stations.AsNoTracking() on link.StationId equals station.Id where link.ContractVersionId == contractVersionId select station.PublicId).ToArrayAsync(ct);
        return stations.Length > 0 && stations.All(id => actor.StationScopes.Any(s => s.StationId == id));
    }
    private static string Version(byte[] version) => Convert.ToBase64String(version);

    public async Task<IReadOnlyList<PackageData>?> ListAsync(Guid actorId, CancellationToken cancellationToken = default)
    {
        if (!await CanReadAsync(actorId, cancellationToken)) return null;
        return await ReadAsync(null, cancellationToken);
    }
    private async Task<PackageData[]> ReadAsync(long[]? ids, CancellationToken ct)
    {
        var versions = await context.Set<ServicePackageVersion>().AsNoTracking().Where(x => ids == null || ids.Contains(x.Id))
            .OrderBy(x => x.Code).ThenByDescending(x => x.VersionNumber).Take(500).ToArrayAsync(ct);
        var keys = versions.Select(x => x.Id).ToArray();
        var components = await (from c in context.Set<ServicePackageComponent>().AsNoTracking()
            join s in context.ServiceDefinitions.AsNoTracking() on c.ServiceDefinitionId equals s.Id
            where keys.Contains(c.PackageVersionId)
            orderby s.Code
            select new { c.PackageVersionId, Data = new PackageComponentData(s.PublicId, s.Code, s.Name, c.BillingUnit, c.IncludedQuantity, c.ExcessBlockSize, c.ExcessBlockPrice) }).ToArrayAsync(ct);
        return versions.Select(x => new PackageData(x.PublicId, x.Code, x.Name, x.VersionNumber, x.Status.ToString(), x.CurrencyCode, x.BasePrice, x.Scope.ToString(), x.FlightDirection?.ToString(), x.PeriodDays, x.ValidFrom, x.ValidTo, Version(x.RowVersion), components.Where(c => c.PackageVersionId == x.Id).Select(c => c.Data).ToArray())).ToArray();
    }

    public async Task<PackageWriteResult> SaveAsync(Guid actorId, Guid? id, SavePackageInput input, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, id is null ? "finance.packages.create" : "finance.packages.update", cancellationToken);
        if (actor is null) return PackageWriteResult.Fail("forbidden");
        if (input is null || !Enum.TryParse<PackageConsumptionScope>(input.Scope, out var scope) || !Enum.IsDefined(scope) ||
            input.CurrencyCode is not ("USD" or "DOP") || input.Code is null || input.Code.Length is < 2 or > 32 ||
            input.Code.Any(c => !(char.IsAsciiLetterUpper(c) || char.IsAsciiDigit(c) || c == '-')) ||
            string.IsNullOrWhiteSpace(input.Name) || input.Name.Trim().Length > 120 || input.BasePrice is < 0 or > 900_000_000_000m ||
            input.ValidTo < input.ValidFrom || input.Components is null || input.Components.Count is < 1 or > 100 ||
            input.Components.Select(x => x.ServiceId).Distinct().Count() != input.Components.Count ||
            input.Components.Any(x => x.ServiceId == Guid.Empty || string.IsNullOrWhiteSpace(x.BillingUnit) || x.BillingUnit.Length > 32 || x.IncludedQuantity < 0 || x.ExcessBlockSize <= 0 || x.ExcessBlockPrice < 0)) return PackageWriteResult.Fail("invalid_package");
        FlightDirection? direction = null;
        if (scope == PackageConsumptionScope.Flight)
        {
            if (!Enum.TryParse<FlightDirection>(input.FlightDirection, out var parsed) || !Enum.IsDefined(parsed)) return PackageWriteResult.Fail("flight_direction_required");
            direction = parsed;
        }
        else if (input.FlightDirection is not null) return PackageWriteResult.Fail("invalid_package_scope");
        if ((scope == PackageConsumptionScope.Period && input.PeriodDays is not (>= 1 and <= 366)) || (scope != PackageConsumptionScope.Period && input.PeriodDays is not null)) return PackageWriteResult.Fail("invalid_package_period");
        return await CommandAsync(actor, input.RequestId, "package.save", new { id, input }, async () =>
        {
            var serviceIds = input.Components.Select(x => x.ServiceId).ToArray();
            var services = await context.ServiceDefinitions.Where(x => serviceIds.Contains(x.PublicId) && x.IsActive).ToDictionaryAsync(x => x.PublicId, cancellationToken);
            if (services.Count != serviceIds.Length) return PackageWriteResult.Fail("package_reference_invalid");
            // 1-E: a component keeps the unit code; a unit name («Operación») is saved as its code.
            var units = await BillingUnitCodes.LoadAsync(context, cancellationToken);
            var componentUnits = input.Components.ToDictionary(x => x.ServiceId, x => units.Resolve(x.BillingUnit));
            if (componentUnits.Values.Any(unit => unit is null)) return PackageWriteResult.Fail("billing_unit_unknown");
            var now = clock.GetUtcNow();
            ServicePackageVersion? row;
            if (id is not null)
            {
                row = await context.Set<ServicePackageVersion>().SingleOrDefaultAsync(x => x.PublicId == id, cancellationToken);
                if (row is null) return PackageWriteResult.Fail("not_found");
                if (row.Status != TariffVersionStatus.Draft || Version(row.RowVersion) != input.ExpectedVersion) return PackageWriteResult.Fail("version_conflict");
                if (row.Code != input.Code || row.CurrencyCode != input.CurrencyCode) return PackageWriteResult.Fail("package_identity_locked");
                context.Set<ServicePackageComponent>().RemoveRange(await context.Set<ServicePackageComponent>().Where(x => x.PackageVersionId == row.Id).ToArrayAsync(cancellationToken));
                await context.SaveChangesAsync(cancellationToken);
            }
            else
            {
                var number = (await context.Set<ServicePackageVersion>().Where(x => x.Code == input.Code).MaxAsync(x => (int?)x.VersionNumber, cancellationToken) ?? 0) + 1;
                row = new ServicePackageVersion { PublicId = Guid.CreateVersion7(), Code = input.Code, CurrencyCode = input.CurrencyCode, VersionNumber = number, CreatedByAccountId = actor.Id, CreatedAt = now };
                context.Set<ServicePackageVersion>().Add(row);
            }
            row.Name = input.Name.Trim(); row.BasePrice = input.BasePrice; row.Scope = scope; row.FlightDirection = direction; row.PeriodDays = input.PeriodDays; row.ValidFrom = input.ValidFrom; row.ValidTo = input.ValidTo; row.UpdatedAt = now;
            await context.SaveChangesAsync(cancellationToken);
            foreach (var component in input.Components) context.Set<ServicePackageComponent>().Add(new() { PublicId = Guid.CreateVersion7(), PackageVersionId = row.Id, ServiceDefinitionId = services[component.ServiceId].Id, BillingUnit = componentUnits[component.ServiceId]!, IncludedQuantity = component.IncludedQuantity, ExcessBlockSize = component.ExcessBlockSize, ExcessBlockPrice = component.ExcessBlockPrice, CreatedAt = now, UpdatedAt = now });
            await ChangedAsync(actor.Id, "finance.package.saved", row.PublicId, now, cancellationToken);
            return PackageWriteResult.Success(row.PublicId);
        }, cancellationToken);
    }

    public async Task<PackageWriteResult> PublishAsync(Guid actorId, Guid id, PackageCommandInput input, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, "finance.packages.publish", cancellationToken);
        if (actor is null) return PackageWriteResult.Fail("forbidden");
        return await CommandAsync(actor, input.RequestId, "package.publish", new { id, input }, async () =>
        {
            var row = await context.Set<ServicePackageVersion>().SingleOrDefaultAsync(x => x.PublicId == id, cancellationToken);
            if (row is null) return PackageWriteResult.Fail("not_found");
            if (row.Status != TariffVersionStatus.Draft || Version(row.RowVersion) != input.ExpectedVersion) return PackageWriteResult.Fail("version_conflict");
            if (!await context.Set<ServicePackageComponent>().AnyAsync(x => x.PackageVersionId == row.Id, cancellationToken)) return PackageWriteResult.Fail("package_empty");
            var previous = await context.Set<ServicePackageVersion>().Where(x => x.Code == row.Code && x.CurrencyCode == row.CurrencyCode && x.Status == TariffVersionStatus.Published).ToArrayAsync(cancellationToken);
            foreach (var old in previous) old.Status = TariffVersionStatus.Superseded;
            row.Status = TariffVersionStatus.Published; row.PublishedByAccountId = actor.Id; row.PublishedAt = clock.GetUtcNow(); row.UpdatedAt = row.PublishedAt.Value;
            await ChangedAsync(actor.Id, "finance.package.published", row.PublicId, row.UpdatedAt, cancellationToken);
            return PackageWriteResult.Success(row.PublicId);
        }, cancellationToken);
    }

    /// <summary>1-N27: a draft that will not be published is kept as Discarded, with the reason audited.</summary>
    public async Task<PackageWriteResult> DiscardAsync(Guid actorId, Guid id, Guid idempotencyKey, PackageLifecycleInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, "finance.packages.delete", cancellationToken);
        if (actor is null) return PackageWriteResult.Fail("forbidden");
        if (LifecycleFailure(idempotencyKey, input) is { } failure) return failure;
        var reason = input.Reason.Trim();
        return await CommandAsync(actor, idempotencyKey, DiscardAction, new { id, input.ExpectedVersion, reason }, async () =>
        {
            var row = await context.Set<ServicePackageVersion>().SingleOrDefaultAsync(x => x.PublicId == id, cancellationToken);
            if (row is null) return PackageWriteResult.Fail("not_found");
            if (Version(row.RowVersion) != input.ExpectedVersion) return PackageWriteResult.Fail("version_conflict");
            if (row.Status != TariffVersionStatus.Draft) return PackageWriteResult.Fail("package_not_draft");
            var now = clock.GetUtcNow();
            // Nothing is deleted; the filtered unique index on drafts frees the code for a new draft.
            row.Status = TariffVersionStatus.Discarded; row.UpdatedAt = now;
            await ChangedAsync(actor.Id, "finance.package.discarded", row.PublicId, now, cancellationToken, reason);
            return PackageWriteResult.Success(row.PublicId);
        }, cancellationToken);
    }

    /// <summary>
    /// 1-N27: the published version stops being offered. Approved contracts keep the package they froze
    /// (billing reads their link); drafts that link it are blocked until Contratos unlinks it.
    /// </summary>
    public async Task<PackageWriteResult> RetireAsync(Guid actorId, Guid id, Guid idempotencyKey, PackageLifecycleInput input,
        CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, "finance.packages.retire", cancellationToken);
        if (actor is null) return PackageWriteResult.Fail("forbidden");
        if (LifecycleFailure(idempotencyKey, input) is { } failure) return failure;
        var reason = input.Reason.Trim();
        return await CommandAsync(actor, idempotencyKey, RetireAction, new { id, input.ExpectedVersion, reason }, async () =>
        {
            var row = await context.Set<ServicePackageVersion>().SingleOrDefaultAsync(x => x.PublicId == id, cancellationToken);
            if (row is null) return PackageWriteResult.Fail("not_found");
            if (Version(row.RowVersion) != input.ExpectedVersion) return PackageWriteResult.Fail("version_conflict");
            if (row.Status != TariffVersionStatus.Published) return PackageWriteResult.Fail("package_not_published");
            var now = clock.GetUtcNow();
            // The previous publication stays Superseded: retiring never revives an older definition.
            row.Status = TariffVersionStatus.Retired; row.UpdatedAt = now;
            await ChangedAsync(actor.Id, "finance.package.retired", row.PublicId, now, cancellationToken, reason);
            // Contratos re-reads the open drafts that link it: their readiness now reports package_retired.
            var drafts = await (from link in context.Set<ContractServicePackage>().AsNoTracking()
                                join version in context.ContractVersions.AsNoTracking() on link.ContractVersionId equals version.Id
                                where link.PackageVersionId == row.Id && (version.Status == ContractVersionStatus.Draft ||
                                    version.Status == ContractVersionStatus.PendingFinanceApproval)
                                select version.PublicId).ToArrayAsync(cancellationToken);
            foreach (var draft in drafts)
                await ContractDraftAudience.NotifyContractsAsync(context, ContractDraftAudience.DraftsResource, draft, now,
                    cancellationToken);
            return PackageWriteResult.Success(row.PublicId);
        }, cancellationToken);
    }

    private static PackageWriteResult? LifecycleFailure(Guid idempotencyKey, PackageLifecycleInput? input) =>
        idempotencyKey == Guid.Empty ? PackageWriteResult.Fail("idempotency_key_required")
        : string.IsNullOrWhiteSpace(input?.ExpectedVersion) ? PackageWriteResult.Fail("expected_version_required")
        : input.Reason?.Trim().Length is not (>= 5 and <= ReasonMaxLength) ? PackageWriteResult.Fail("reason_required")
        : null;

    public async Task<IReadOnlyList<PackageData>?> ListForContractAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default)
    {
        if (!await CanReadAsync(actorId, cancellationToken)) return null;
        var version = await context.ContractVersions.AsNoTracking().SingleOrDefaultAsync(x => x.PublicId == versionId, cancellationToken);
        if (version is null || !await ContractInScopeAsync(actorId, version.Id, cancellationToken)) return null;
        var ids = await context.Set<ContractServicePackage>().Where(x => x.ContractVersionId == version.Id).Select(x => x.PackageVersionId).ToArrayAsync(cancellationToken);
        return await ReadAsync(ids, cancellationToken);
    }

    public async Task<PackageWriteResult> SetContractPackagesAsync(Guid actorId, Guid versionId, SetContractPackagesInput input, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, "contracts.drafts.update", cancellationToken);
        if (actor is null) return PackageWriteResult.Fail("forbidden");
        if (input.PackageVersionIds is null || input.PackageVersionIds.Count > 50 || input.PackageVersionIds.Distinct().Count() != input.PackageVersionIds.Count) return PackageWriteResult.Fail("invalid_selection");
        return await CommandAsync(actor, input.RequestId, "contract.packages", new { versionId, input }, async () =>
        {
            var version = await context.ContractVersions.SingleOrDefaultAsync(x => x.PublicId == versionId, cancellationToken);
            if (version is null || !await ContractInScopeAsync(actorId, version.Id, cancellationToken)) return PackageWriteResult.Fail("not_found");
            if (version.Status != ContractVersionStatus.Draft || Version(version.RowVersion) != input.ExpectedVersion) return PackageWriteResult.Fail("version_conflict");
            var packageIds = input.PackageVersionIds.ToArray();
            var packages = await context.Set<ServicePackageVersion>().Where(x => packageIds.Contains(x.PublicId)).ToArrayAsync(cancellationToken);
            if (packages.Length != packageIds.Length) return PackageWriteResult.Fail("package_not_eligible");
            // 1-N27: Finance retired it; it is no longer assignable.
            if (packages.Any(x => x.Status == TariffVersionStatus.Retired)) return PackageWriteResult.Fail("package_retired");
            if (packages.Any(x => x.Status is not (TariffVersionStatus.Published or TariffVersionStatus.Superseded))) return PackageWriteResult.Fail("package_not_eligible");
            // Publication status describes catalog history, not the version effective on this contract's start date.
            // Keep old definitions intact and choose the latest applicable publication for each code/currency. A
            // retired publication stays in that history, so it never lets an older version become effective again.
            var codes = packages.Select(x => x.Code).Distinct().ToArray();
            var history = await context.Set<ServicePackageVersion>().AsNoTracking().Where(x => codes.Contains(x.Code) &&
                x.CurrencyCode == version.CurrencyCode && x.ValidFrom <= version.ValidFrom &&
                (x.Status == TariffVersionStatus.Published || x.Status == TariffVersionStatus.Superseded ||
                 x.Status == TariffVersionStatus.Retired))
                .OrderByDescending(x => x.ValidFrom).ThenByDescending(x => x.VersionNumber).ToArrayAsync(cancellationToken);
            var effective = history.GroupBy(x => x.Code).ToDictionary(g => g.Key, g => g.First().Id);
            if (packages.Any(x => x.CurrencyCode != version.CurrencyCode || x.ValidFrom > version.ValidFrom ||
                effective.GetValueOrDefault(x.Code) != x.Id || x.ValidTo is not null && (version.ValidTo is null || x.ValidTo < version.ValidTo)))
                return PackageWriteResult.Fail("package_not_eligible");
            var internalIds = packages.Select(x => x.Id).ToArray();
            var components = await context.Set<ServicePackageComponent>().Where(x => internalIds.Contains(x.PackageVersionId)).ToArrayAsync(cancellationToken);
            if (components.GroupBy(x => x.ServiceDefinitionId).Any(g => g.Count() > 1)) return PackageWriteResult.Fail("ambiguous_package_coverage");
            var services = await context.ContractServiceRates.Where(x => x.ContractVersionId == version.Id).Select(x => x.ServiceDefinitionId).ToArrayAsync(cancellationToken);
            if (components.Any(x => !services.Contains(x.ServiceDefinitionId))) return PackageWriteResult.Fail("package_service_not_in_contract");
            context.Set<ContractServicePackage>().RemoveRange(await context.Set<ContractServicePackage>().Where(x => x.ContractVersionId == version.Id).ToArrayAsync(cancellationToken));
            await context.SaveChangesAsync(cancellationToken);
            var now = clock.GetUtcNow();
            foreach (var package in packages) context.Set<ContractServicePackage>().Add(new() { PublicId = Guid.CreateVersion7(), ContractVersionId = version.Id, PackageVersionId = package.Id, CreatedAt = now, UpdatedAt = now });
            version.UpdatedAt = now;
            await ChangedAsync(actor.Id, "commercial.contract.packages_set", versionId, now, cancellationToken);
            return PackageWriteResult.Success(versionId);
        }, cancellationToken);
    }

    /// <summary>
    /// 1-C: a new Draft from the latest approved version that governs (signed by both parties, 2-C) with
    /// «Vigente desde» after its start and not after its end, which it inherits. Not while another
    /// approved version waits for its signatures (version_awaiting_signatures), nor on a terminated
    /// contract or on or after a scheduled termination (2-N15). Rates are copied unconfirmed (units as codes, 1-E), with the
    /// stations, the negotiated charges and the packages (<see cref="ContractVersionCopy"/>): a surcharge Finance only
    /// inherited from the base tariff is not copied, so approving the amendment inherits the base tariff of its own start
    /// and a later renewal never takes the old base value as negotiated (2-N03). The actor's station scope covers both the
    /// version in the route and the approved version copied, otherwise the contract is not found. The status the user saw
    /// is the token (the same one the contract lifecycle uses); the serializable transaction re-checks that no
    /// other draft is in progress.
    /// </summary>
    public async Task<PackageWriteResult> CreateAmendmentAsync(Guid actorId, Guid versionId, Guid idempotencyKey,
        CreateAmendmentInput input, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, "contracts.drafts.update", cancellationToken);
        if (actor is null) return PackageWriteResult.Fail("forbidden");
        if (idempotencyKey == Guid.Empty) return PackageWriteResult.Fail("idempotency_key_required");
        if (string.IsNullOrWhiteSpace(input?.ExpectedStatus)) return PackageWriteResult.Fail("expected_version_required");
        if (!Enum.TryParse<ContractStatus>(input.ExpectedStatus, false, out var expected) || !Enum.IsDefined(expected) ||
            input.ValidFrom == default)
            return PackageWriteResult.Fail(ContractAmendmentIssues.InvalidAmendment);
        return await CommandAsync(actor, idempotencyKey, AmendmentAction, new { versionId, expected, input.ValidFrom }, async () =>
        {
            var route = await context.ContractVersions.AsNoTracking().SingleOrDefaultAsync(x => x.PublicId == versionId, cancellationToken);
            if (route is null || !await ContractInScopeAsync(actorId, route.Id, cancellationToken)) return PackageWriteResult.Fail("not_found");
            var contract = await context.Contracts.SingleAsync(x => x.Id == route.ContractId, cancellationToken);
            // The amendment starts from the version that governs (2-C), never from one nobody signed.
            var source = await GoverningContractVersions.Of(context).AsNoTracking()
                .Where(x => x.ContractId == contract.Id && x.Status == ContractVersionStatus.Approved)
                .OrderByDescending(x => x.ValidFrom).ThenByDescending(x => x.VersionNumber).FirstOrDefaultAsync(cancellationToken);
            // The amendment copies the stations, rates, charges and packages of that approved version, which may
            // cover stations the route version does not (a renewal or a draft scope can add them): the actor's
            // station scope must cover the version copied, before anything about the contract is answered.
            if (source is not null && !await ContractInScopeAsync(actorId, source.Id, cancellationToken))
                return PackageWriteResult.Fail("not_found");
            if (contract.Status != expected) return PackageWriteResult.Fail("version_conflict");
            // 2-N15: a terminated contract is not amended, and nothing starts on or after a scheduled termination.
            if (ContractLifecycle.ClosedFor(contract.Status, contract.TerminatedOn, input.ValidFrom) is { } closed)
                return PackageWriteResult.Fail(closed);
            if (!ContractAmendment.CanAmend(contract.Status)) return PackageWriteResult.Fail(ContractAmendmentIssues.ContractNotAmendable);
            if (await context.ContractVersions.AnyAsync(x => x.ContractId == contract.Id &&
                    (x.Status == ContractVersionStatus.Draft || x.Status == ContractVersionStatus.PendingFinanceApproval), cancellationToken))
                return PackageWriteResult.Fail(ContractAmendmentIssues.DraftInProgress);
            // 2-N01: an approved version still waiting for both signatures is finished or withdrawn first.
            if (await GoverningContractVersions.AwaitingSignatures(context).AnyAsync(x => x.ContractId == contract.Id, cancellationToken))
                return PackageWriteResult.Fail(ContractLifecycleIssues.VersionAwaitingSignatures);
            if (source is null) return PackageWriteResult.Fail(ContractAmendmentIssues.NoApprovedVersion);
            if (ContractAmendment.StartIssue(input.ValidFrom, source.ValidFrom, source.ValidTo) is { } issue)
                return PackageWriteResult.Fail(issue);
            var now = clock.GetUtcNow();
            var number = await context.ContractVersions.Where(x => x.ContractId == contract.Id).MaxAsync(x => x.VersionNumber, cancellationToken) + 1;
            var next = new ContractVersion
            {
                PublicId = Guid.CreateVersion7(), ContractId = contract.Id, VersionNumber = number, Status = ContractVersionStatus.Draft,
                CurrencyCode = source.CurrencyCode, ValidFrom = input.ValidFrom, ValidTo = source.ValidTo, Terms = source.Terms,
                CreatedAt = now, UpdatedAt = now,
            };
            context.ContractVersions.Add(next);
            await context.SaveChangesAsync(cancellationToken);
            await ContractVersionCopy.CopyAsync(context, source, next, ratesConfirmed: false, now, cancellationToken);
            CommercialAuditWriter.Add(context, actor.Id, "commercial.contract.amendment_created", "commercial.contract_versions",
                next.PublicId, null, new AuditFieldChangeData("amendment.valid_from",
                    source.ValidFrom.ToString("O", CultureInfo.InvariantCulture),
                    next.ValidFrom.ToString("O", CultureInfo.InvariantCulture)));
            // Contratos completes it in Borradores; the airline reviews it in its portal.
            await ContractDraftAudience.NotifyContractsAsync(context, ContractDraftAudience.DraftsResource, next.PublicId, now,
                cancellationToken);
            await ContractDraftAudience.NotifyAirlineAsync(context, contract, now, cancellationToken);
            return PackageWriteResult.Success(next.PublicId);
        }, cancellationToken);
    }

    private async Task ChangedAsync(long actorId, string action, Guid id, DateTimeOffset now, CancellationToken ct,
        string? reason = null)
    {
        CommercialAuditWriter.Add(context, actorId, action, "commercial.service_package_versions", id, reason);
        foreach (var recipient in await DepartmentAccessQueries.AccountsWithPermissionAsync(context, "finance.packages.read", ct)) AccountChangeOutboxWriter.Add(context, recipient, null, "finance_packages", id, now);
    }

    /// <summary>
    /// Runs a command serializable: the receipt of its key is resolved first (a legitimate retry sees
    /// the rowversion already changed), the command applies its rules and the receipt is written in the
    /// same transaction. A concurrent command with the same key resolves to its replay or a conflict.
    /// </summary>
    private async Task<PackageWriteResult> CommandAsync(Actor actor, Guid requestId, string action, object payload, Func<Task<PackageWriteResult>> command, CancellationToken ct)
    {
        if (requestId == Guid.Empty) return PackageWriteResult.Fail("request_id_required");
        var hash = CommercialCommandReceipts.Hash(payload);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var tx = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var prior = await CommercialCommandReceipts.FindAsync(context, requestId, actor.Id, action, hash, ct);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay) return PackageWriteResult.Success(prior.ResultId);
                if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict) return PackageWriteResult.Fail("idempotency_conflict");
                var result = await command();
                if (!result.IsSuccess) { await tx.RollbackAsync(ct); context.ChangeTracker.Clear(); return result; }
                CommercialCommandReceipts.Add(context, requestId, actor.Id, action, hash, result.Id!.Value, clock.GetUtcNow());
                await context.SaveChangesAsync(ct); await tx.CommitAsync(ct); return result;
            });
        }
        catch (DbUpdateConcurrencyException) { context.ChangeTracker.Clear(); return PackageWriteResult.Fail("version_conflict"); }
        catch (DbUpdateException exception) when (CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, requestId, actor.Id, action, hash, ct);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? PackageWriteResult.Success(concurrent.ResultId) : PackageWriteResult.Fail("idempotency_conflict");
        }
        catch (DbUpdateException) { context.ChangeTracker.Clear(); return PackageWriteResult.Fail("version_conflict"); }
    }
}
