using System.Data;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed class EfFinancePackageStore(ElevantDbContext context, IActorContextResolver actors, TimeProvider clock) : IFinancePackageStore
{
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
            var units = await context.BillingUnits.Where(x => x.IsActive).Select(x => x.Code).ToArrayAsync(cancellationToken);
            if (services.Count != serviceIds.Length || input.Components.Any(x => !units.Contains(x.BillingUnit))) return PackageWriteResult.Fail("package_reference_invalid");
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
            foreach (var component in input.Components) context.Set<ServicePackageComponent>().Add(new() { PublicId = Guid.CreateVersion7(), PackageVersionId = row.Id, ServiceDefinitionId = services[component.ServiceId].Id, BillingUnit = component.BillingUnit, IncludedQuantity = component.IncludedQuantity, ExcessBlockSize = component.ExcessBlockSize, ExcessBlockPrice = component.ExcessBlockPrice, CreatedAt = now, UpdatedAt = now });
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
            var packages = await context.Set<ServicePackageVersion>().Where(x => packageIds.Contains(x.PublicId) &&
                (x.Status == TariffVersionStatus.Published || x.Status == TariffVersionStatus.Superseded)).ToArrayAsync(cancellationToken);
            if (packages.Length != packageIds.Length) return PackageWriteResult.Fail("package_not_eligible");
            // Publication status describes catalog history, not the version effective on this contract's start date.
            // Keep old definitions intact and choose the latest applicable publication for each code/currency.
            var codes = packages.Select(x => x.Code).Distinct().ToArray();
            var history = await context.Set<ServicePackageVersion>().AsNoTracking().Where(x => codes.Contains(x.Code) &&
                x.CurrencyCode == version.CurrencyCode && x.ValidFrom <= version.ValidFrom &&
                (x.Status == TariffVersionStatus.Published || x.Status == TariffVersionStatus.Superseded))
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

    public async Task<PackageWriteResult> CreateAmendmentAsync(Guid actorId, Guid versionId, PackageCommandInput input, CancellationToken cancellationToken = default)
    {
        var actor = await ActorAsync(actorId, "contracts.drafts.update", cancellationToken);
        if (actor is null) return PackageWriteResult.Fail("forbidden");
        return await CommandAsync(actor, input.RequestId, "contract.amendment", new { versionId, input }, async () =>
        {
            var original = await context.ContractVersions.SingleOrDefaultAsync(x => x.PublicId == versionId, cancellationToken);
            if (original is null || !await ContractInScopeAsync(actorId, original.Id, cancellationToken)) return PackageWriteResult.Fail("not_found");
            if (original.Status != ContractVersionStatus.Approved || Version(original.RowVersion) != input.ExpectedVersion || await context.ContractVersions.AnyAsync(x => x.ContractId == original.ContractId && (x.Status == ContractVersionStatus.Draft || x.Status == ContractVersionStatus.PendingFinanceApproval), cancellationToken)) return PackageWriteResult.Fail("version_conflict");
            var now = clock.GetUtcNow();
            var next = new ContractVersion { PublicId = Guid.CreateVersion7(), ContractId = original.ContractId, VersionNumber = await context.ContractVersions.Where(x => x.ContractId == original.ContractId).MaxAsync(x => x.VersionNumber, cancellationToken) + 1, Status = ContractVersionStatus.Draft, CurrencyCode = original.CurrencyCode, ValidFrom = original.ValidFrom, ValidTo = original.ValidTo, Terms = original.Terms, CreatedAt = now, UpdatedAt = now };
            context.ContractVersions.Add(next); await context.SaveChangesAsync(cancellationToken);
            foreach (var rate in await context.ContractServiceRates.Where(x => x.ContractVersionId == original.Id).ToArrayAsync(cancellationToken)) context.ContractServiceRates.Add(new() { PublicId = Guid.CreateVersion7(), ContractVersionId = next.Id, ServiceDefinitionId = rate.ServiceDefinitionId, BillingUnit = rate.BillingUnit, UnitPrice = rate.UnitPrice, MinimumQuantity = rate.MinimumQuantity, IsConfirmed = false, CreatedAt = now, UpdatedAt = now });
            foreach (var station in await context.Set<ContractVersionStation>().Where(x => x.ContractVersionId == original.Id).ToArrayAsync(cancellationToken)) context.Add(new ContractVersionStation { ContractVersionId = next.Id, StationId = station.StationId });
            foreach (var rate in await context.ContractChargeRates.Where(x => x.ContractVersionId == original.Id).ToArrayAsync(cancellationToken)) context.ContractChargeRates.Add(new() { PublicId = Guid.CreateVersion7(), ContractVersionId = next.Id, ChargeDefinitionId = rate.ChargeDefinitionId, IsExcluded = rate.IsExcluded, Value = rate.Value, MinimumAmount = rate.MinimumAmount, CreatedAt = now, UpdatedAt = now });
            foreach (var package in await context.Set<ContractServicePackage>().Where(x => x.ContractVersionId == original.Id).ToArrayAsync(cancellationToken)) context.Set<ContractServicePackage>().Add(new() { PublicId = Guid.CreateVersion7(), ContractVersionId = next.Id, PackageVersionId = package.PackageVersionId, CreatedAt = now, UpdatedAt = now });
            await ChangedAsync(actor.Id, "commercial.contract.amendment_created", next.PublicId, now, cancellationToken);
            return PackageWriteResult.Success(next.PublicId);
        }, cancellationToken);
    }

    private async Task ChangedAsync(long actorId, string action, Guid id, DateTimeOffset now, CancellationToken ct)
    {
        CommercialAuditWriter.Add(context, actorId, action, "commercial.service_package_versions", id);
        foreach (var recipient in await DepartmentAccessQueries.AccountsWithPermissionAsync(context, "finance.packages.read", ct)) AccountChangeOutboxWriter.Add(context, recipient, null, "finance_packages", id, now);
    }
    private async Task<PackageWriteResult> CommandAsync(Actor actor, Guid requestId, string action, object payload, Func<Task<PackageWriteResult>> command, CancellationToken ct)
    {
        if (requestId == Guid.Empty) return PackageWriteResult.Fail("request_id_required");
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(payload))));
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var tx = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var prior = await context.Set<FinancePricingCommand>().SingleOrDefaultAsync(x => x.RequestId == requestId, ct);
                if (prior is not null) return prior.ActorAccountId == actor.Id && prior.Action == action && prior.PayloadHash == hash ? PackageWriteResult.Success(prior.ResultId) : PackageWriteResult.Fail("idempotency_conflict");
                var result = await command();
                if (!result.IsSuccess) { await tx.RollbackAsync(ct); context.ChangeTracker.Clear(); return result; }
                var now = clock.GetUtcNow();
                context.Set<FinancePricingCommand>().Add(new() { PublicId = Guid.CreateVersion7(), RequestId = requestId, ActorAccountId = actor.Id, Action = action, PayloadHash = hash, ResultId = result.Id!.Value, CreatedAt = now, UpdatedAt = now });
                await context.SaveChangesAsync(ct); await tx.CommitAsync(ct); return result;
            });
        }
        catch (DbUpdateException) { context.ChangeTracker.Clear(); return PackageWriteResult.Fail("version_conflict"); }
    }
}
