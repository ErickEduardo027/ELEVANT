using System.Data;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Common;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Realtime;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Contratos' catalog of services. Every write runs serializable; an update or a retirement with an
/// Idempotency-Key keeps its receipt in <c>commercial.finance_pricing_commands</c>
/// (<see cref="CommercialCommandReceipts"/>) and replays the current service. The form hides or
/// reactivates a service; «Dar de baja» is its own command, refused while a contract in force or in
/// approval uses the service as a rate or inside a package (1-N03).
/// </summary>
internal sealed class EfCommercialCatalogManagementStore(
    ElevantDbContext context, CommercialPermissionGuard permissions)
    : ICommercialCatalogManagementStore
{
    private const string UpdateAction = "commercial.catalog.update";
    private const string RetireAction = "commercial.catalog.retire";

    public async Task<IReadOnlyList<ManagedServiceData>?> ListAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAnyAsync(actorId, CatalogReaders, cancellationToken))
            return null;
        var units = await BillingUnitCodes.LoadAsync(context, cancellationToken);
        return (await context.ServiceDefinitions.AsNoTracking()
            .OrderBy(service => service.DisplayOrder).ThenBy(service => service.Name)
            .ToArrayAsync(cancellationToken)).Select(service => Map(service, units)).ToArray();
    }

    public async Task<CatalogMutationResult> SaveAsync(Guid actorId, Guid? serviceId,
        ManagedServiceInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        // Contracts owns what is sold; Finance only prices it (ADR-0016, catalog section).
        if (!await permissions.HasAsync(actorId,
                serviceId is null ? "contracts.catalog.create" : "contracts.catalog.update", cancellationToken))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Forbidden);
        if (!Valid(input))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid, CommercialCatalogIssues.InvalidService);
        // Only an update takes a key (expand: optional while older clients exist).
        var key = serviceId is null ? null : idempotencyKey;
        if (key == Guid.Empty)
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid, "idempotency_key_required");
        if (serviceId is not null && !TryVersion(input.Version, out _))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid, "expected_version_required");
        var code = input.Code.Trim().ToUpperInvariant();
        var name = input.Name.Trim();
        var description = input.Description.Trim();
        var requestedUnit = input.BillingUnit.Trim();
        var imageUrl = EmptyToNull(input.ImageUrl);
        var videoUrl = EmptyToNull(input.VideoUrl);
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, key, UpdateAction, new
        {
            serviceId, code, name, description, billingUnit = requestedUnit, imageUrl, videoUrl,
            input.DisplayOrder, input.IsPublic, input.IsActive, input.Version,
        }, async (now, units) =>
        {
            ServiceDefinition service;
            if (serviceId is null)
            {
                service = new ServiceDefinition { PublicId = Guid.CreateVersion7() };
            }
            else
            {
                var current = await context.ServiceDefinitions.SingleOrDefaultAsync(
                    item => item.PublicId == serviceId, cancellationToken);
                if (current is null) return Step.Fail(CatalogMutationFailure.NotFound, "not_found");
                if (!Convert.ToBase64String(current.RowVersion).Equals(input.Version, StringComparison.Ordinal))
                    return Step.Fail(CatalogMutationFailure.Conflict, "version_conflict");
                if (!string.Equals(current.Code, code, StringComparison.OrdinalIgnoreCase))
                    return Step.Fail(CatalogMutationFailure.Invalid, CommercialCatalogIssues.InvalidService);
                // 1-N03/1-N11: the form never retires; a closure keeps the service hidden until it is reopened.
                var hiddenByClosure = !current.IsPublic && input.IsPublic &&
                    await HiddenByClosureAsync(current.Id, cancellationToken);
                switch (CommercialServiceRetirement.UpdateIssue(current.IsActive, current.IsPublic,
                            input.IsActive, input.IsPublic, hiddenByClosure))
                {
                    case CommercialCatalogIssues.RetirementCommandRequired:
                        return Step.Fail(CatalogMutationFailure.Invalid, CommercialCatalogIssues.RetirementCommandRequired);
                    case { } issue:
                        return Step.Fail(CatalogMutationFailure.Conflict, issue);
                }
                service = current;
            }
            if (BillingUnit(requestedUnit, service.DefaultBillingUnit, units) is not { } billingUnit)
                return Step.Fail(CatalogMutationFailure.Invalid, "billing_unit_unknown");
            if (input.IsPublic && input.IsActive && CommercialCatalogPublication.Problem(code, name,
                    description, imageUrl) is { } problem)
                return Step.Fail(CatalogMutationFailure.Invalid, problem);
            if (!await ValidAssetAsync(imageUrl, "service-image", service.ImageUrl, cancellationToken) ||
                !await ValidAssetAsync(videoUrl, "service-video", service.VideoUrl, cancellationToken))
                return Step.Fail(CatalogMutationFailure.Invalid, CommercialCatalogIssues.MediaInvalid);
            if (serviceId is null) context.ServiceDefinitions.Add(service);
            var beforeName = service.Name;
            var beforePublic = service.IsPublic;
            var beforeActive = service.IsActive;
            service.Code = code;
            service.Name = name;
            service.Description = description;
            service.DefaultBillingUnit = billingUnit;
            service.ImageUrl = imageUrl;
            service.VideoUrl = videoUrl;
            service.DisplayOrder = input.DisplayOrder;
            service.IsPublic = input.IsPublic;
            service.IsActive = input.IsActive;
            service.UpdatedAt = now;
            CommercialAuditWriter.Add(context, actor,
                serviceId is null ? "commercial.catalog.created" : "commercial.catalog.updated",
                "ref.service_definitions", service.PublicId, null,
                new AuditFieldChangeData("service.name", serviceId is null ? null : beforeName, service.Name),
                new AuditFieldChangeData("service.public", serviceId is null ? null : beforePublic.ToString(), service.IsPublic.ToString()),
                new AuditFieldChangeData("service.active", serviceId is null ? null : beforeActive.ToString(), service.IsActive.ToString()));
            await NotifyInternalAsync(service.PublicId, now, cancellationToken);
            // A reactivated service no longer blocks the drafts that kept it marked as retired.
            if (serviceId is not null && beforeActive != service.IsActive)
                await NotifyOpenDraftsAsync(service.Id, now, cancellationToken);
            return Step.Done(service);
        }, cancellationToken);
    }

    public async Task<CatalogMutationResult> RetireAsync(Guid actorId, Guid serviceId, Guid idempotencyKey,
        RetireServiceInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.catalog.delete", cancellationToken))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Forbidden);
        if (idempotencyKey == Guid.Empty)
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid, "idempotency_key_required");
        if (!TryVersion(input?.ExpectedVersion, out _))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid, "expected_version_required");
        if (!CommercialServiceRetirement.TryNormalizeReason(input!.Reason, out var reason))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid, "reason_required");
        return await RetireCoreAsync(actorId, serviceId, idempotencyKey, input.ExpectedVersion!, reason,
            cancellationToken);
    }

    public async Task<CatalogMutationResult> DeleteAsync(Guid actorId, Guid serviceId,
        string? version, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "contracts.catalog.delete", cancellationToken))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Forbidden);
        if (idempotencyKey == Guid.Empty)
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid, "idempotency_key_required");
        if (!TryVersion(version, out _))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid, "expected_version_required");
        return await RetireCoreAsync(actorId, serviceId, idempotencyKey, version!, null, cancellationToken);
    }

    /// <summary>
    /// Retires the service: it leaves the public catalog, new contracts and the operation. A pending or
    /// approved closure is kept as it is; approving one still works on a hidden or retired service.
    /// </summary>
    private async Task<CatalogMutationResult> RetireCoreAsync(Guid actorId, Guid serviceId, Guid? idempotencyKey,
        string expectedVersion, string? reason, CancellationToken cancellationToken)
    {
        var actor = await ActorDatabaseIdAsync(actorId, cancellationToken);
        return await RunAsync(actor, idempotencyKey, RetireAction, new { serviceId, expectedVersion, reason },
            async (now, _) =>
            {
                var service = await context.ServiceDefinitions.SingleOrDefaultAsync(
                    item => item.PublicId == serviceId, cancellationToken);
                if (service is null) return Step.Fail(CatalogMutationFailure.NotFound, "not_found");
                if (!Convert.ToBase64String(service.RowVersion).Equals(expectedVersion, StringComparison.Ordinal))
                    return Step.Fail(CatalogMutationFailure.Conflict, "version_conflict");
                if (!service.IsActive)
                    return Step.Fail(CatalogMutationFailure.Conflict, CommercialCatalogIssues.ServiceRetired);
                // 2-F: a contract keeps the service in force by AVIAM's business day, not the UTC day.
                if (await InForceAsync(service.Id, BusinessCalendar.Today(now), cancellationToken))
                    return Step.Fail(CatalogMutationFailure.Conflict, CommercialCatalogIssues.ServiceInActiveContract);
                var beforePublic = service.IsPublic;
                service.IsActive = false;
                service.IsPublic = false;
                service.UpdatedAt = now;
                CommercialAuditWriter.Add(context, actor,
                    "commercial.catalog.retired", "ref.service_definitions", service.PublicId,
                    reason, new AuditFieldChangeData("service.active", true.ToString(), false.ToString()),
                    new AuditFieldChangeData("service.public", beforePublic.ToString(), false.ToString()));
                await NotifyInternalAsync(service.PublicId, now, cancellationToken);
                // Their readiness now reports service_retired until Contratos removes it (1-N10).
                await NotifyOpenDraftsAsync(service.Id, now, cancellationToken);
                return Step.Done(service);
            }, cancellationToken);
    }

    /// <summary>Contracts manages the catalog; Finance reads it to price the services.</summary>
    internal static readonly string[] CatalogReaders = ["contracts.catalog.read", "finance.tariffs.read"];

    /// <summary>One step of a command: the service it wrote, or the failure that rolls it back.</summary>
    private readonly record struct Step(ServiceDefinition? Service, CatalogMutationResult? Failure)
    {
        public static Step Done(ServiceDefinition service) => new(service, null);

        public static Step Fail(CatalogMutationFailure failure, string code) =>
            new(null, CatalogMutationResult.Failed(failure, code));
    }

    /// <summary>
    /// Runs one command serializable: the receipt of its Idempotency-Key is resolved before anything else
    /// (a legitimate retry sees the rowversion already changed) and replays the current service; the
    /// command applies its rules and the receipt is written in the same transaction.
    /// </summary>
    private async Task<CatalogMutationResult> RunAsync(long actor, Guid? idempotencyKey, string action,
        object payload, Func<DateTimeOffset, BillingUnitCodes, Task<Step>> command,
        CancellationToken cancellationToken)
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
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actor, action, hash,
                        cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return await CurrentAsync(prior.ResultId, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return CatalogMutationResult.Failed(CatalogMutationFailure.Conflict, "idempotency_conflict");
                }
                var now = DateTimeOffset.UtcNow;
                var units = await BillingUnitCodes.LoadAsync(context, cancellationToken);
                var step = await command(now, units);
                if (step.Service is not { } service)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return step.Failure!;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actor, action, hash, service.PublicId, now);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return CatalogMutationResult.Success(Map(service, units));
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return CatalogMutationResult.Failed(CatalogMutationFailure.Conflict, "version_conflict");
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent command with the same key committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actor, action, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await CurrentAsync(concurrent.ResultId, cancellationToken)
                : CatalogMutationResult.Failed(CatalogMutationFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            context.ChangeTracker.Clear();
            return CatalogMutationResult.Failed(CatalogMutationFailure.Conflict, CommercialCatalogIssues.ServiceCodeExists);
        }
    }

    /// <summary>The current shape of the service a replayed command answered.</summary>
    private async Task<CatalogMutationResult> CurrentAsync(Guid serviceId, CancellationToken cancellationToken)
    {
        var service = await context.ServiceDefinitions.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == serviceId, cancellationToken);
        return service is null
            ? CatalogMutationResult.Failed(CatalogMutationFailure.NotFound, "not_found")
            : CatalogMutationResult.Success(Map(service, await BillingUnitCodes.LoadAsync(context, cancellationToken)));
    }

    /// <summary>
    /// Whether a contract keeps the service in force (<see cref="CommercialServiceRetirement.KeepsServiceInForce"/>),
    /// as a rate or inside a linked package. The query narrows to the statuses that rule accepts.
    /// </summary>
    private async Task<bool> InForceAsync(long serviceId, DateOnly today, CancellationToken cancellationToken)
    {
        var rated = context.ContractServiceRates.AsNoTracking()
            .Where(rate => rate.ServiceDefinitionId == serviceId).Select(rate => rate.ContractVersionId);
        var packaged = from link in context.Set<ContractServicePackage>().AsNoTracking()
                       join component in context.Set<ServicePackageComponent>().AsNoTracking()
                           on link.PackageVersionId equals component.PackageVersionId
                       where component.ServiceDefinitionId == serviceId
                       select link.ContractVersionId;
        var versions = await (from version in context.ContractVersions.AsNoTracking()
                              join contract in context.Contracts.AsNoTracking() on version.ContractId equals contract.Id
                              where (rated.Contains(version.Id) || packaged.Contains(version.Id)) &&
                                    (contract.Status == ContractStatus.Draft || contract.Status == ContractStatus.Active ||
                                     contract.Status == ContractStatus.Suspended) &&
                                    (version.Status == ContractVersionStatus.PendingFinanceApproval ||
                                     version.Status == ContractVersionStatus.Approved ||
                                     version.Status == ContractVersionStatus.Superseded)
                              select new { Contract = contract.Status, Version = version.Status, version.ValidTo })
            .ToArrayAsync(cancellationToken);
        return versions.Any(row =>
            CommercialServiceRetirement.KeepsServiceInForce(row.Contract, row.Version, row.ValidTo, today));
    }

    /// <summary>An approved closure that was not reopened keeps the service out of the public catalog.</summary>
    private Task<bool> HiddenByClosureAsync(long serviceId, CancellationToken cancellationToken) =>
        context.ServiceClosureRequests.AnyAsync(item =>
            item.ServiceDefinitionId == serviceId &&
            item.Status == ServiceClosureStatus.Approved &&
            item.ReopenedAt == null, cancellationToken);

    /// <summary>
    /// The unit code to store (1-E): the active unit the text names, by code or by name; an unchanged
    /// legacy text that names no active unit is kept as it is. Null when a new or changed unit is unknown.
    /// </summary>
    private static string? BillingUnit(string? requested, string? current, BillingUnitCodes units)
    {
        var unit = requested?.Trim();
        if (string.IsNullOrEmpty(unit)) return null;
        return units.Resolve(unit) ??
            (current is not null && string.Equals(unit, current.Trim(), StringComparison.Ordinal) ? current.Trim() : null);
    }

    /// <summary>The unit is read as its code; a legacy name («operación») becomes the code it names.</summary>
    private static ManagedServiceData Map(ServiceDefinition item, BillingUnitCodes units) => new(
        item.PublicId, item.Code, item.Name, item.Description ?? string.Empty,
        units.Normalize(item.DefaultBillingUnit), CommercialServiceMediaDefaults.Resolve(item.Code, item.ImageUrl), item.VideoUrl, item.DisplayOrder,
        item.IsPublic, item.IsActive, Convert.ToBase64String(item.RowVersion));

    private Task<long> ActorDatabaseIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id).SingleAsync(cancellationToken);

    private async Task NotifyInternalAsync(Guid serviceId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var recipients = await CommercialNotificationRecipients.WithAnyPermissionAsync(context,
            CatalogReaders, cancellationToken);
        var closureRecipients = await CommercialNotificationRecipients.WithAnyPermissionAsync(context,
            ["contracts.service_closures.read", "operations.service_closures.read"], cancellationToken);
        foreach (var recipient in recipients.Concat(closureRecipients).Distinct())
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "commercial_catalog", serviceId, now);
    }

    /// <summary>Contratos re-reads the open drafts that include the service: their readiness changed.</summary>
    private async Task NotifyOpenDraftsAsync(long serviceId, DateTimeOffset now, CancellationToken cancellationToken)
    {
        var drafts = await (from rate in context.ContractServiceRates.AsNoTracking()
                            join version in context.ContractVersions.AsNoTracking() on rate.ContractVersionId equals version.Id
                            where rate.ServiceDefinitionId == serviceId && version.Status == ContractVersionStatus.Draft
                            select version.PublicId).Distinct().ToArrayAsync(cancellationToken);
        if (drafts.Length == 0) return;
        var recipients = await CommercialNotificationRecipients.WithPermissionAsync(context,
            "contracts.drafts.read", cancellationToken);
        foreach (var draft in drafts)
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null, ContractDraftAudience.DraftsResource, draft, now);
    }

    private static bool Valid(ManagedServiceInput input) =>
        input is not null && ValidCode(input.Code) &&
        ValidText(input.Name, 160) && ValidText(input.Description, 500) &&
        ValidText(input.BillingUnit, 32) && input.DisplayOrder is >= 0 and <= 10000 &&
        ValidMediaUrl(input.ImageUrl) && ValidMediaUrl(input.VideoUrl);

    private static bool ValidCode(string? code) =>
        !string.IsNullOrWhiteSpace(code) && code.Trim().Length <= 40 &&
        code.Trim().All(character => char.IsAsciiLetterUpper(character) ||
            char.IsAsciiDigit(character) || character == '-');

    private static bool ValidText(string? value, int max) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= max;

    private static bool ValidMediaUrl(string? value) =>
        string.IsNullOrWhiteSpace(value) ||
        (value.Length <= 512 &&
            (value.StartsWith("/api/v1/media/", StringComparison.Ordinal) &&
                Guid.TryParse(value["/api/v1/media/".Length..], out _) ||
             value.StartsWith("/assets/", StringComparison.Ordinal) ||
             Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
             uri.Scheme == Uri.UriSchemeHttps && uri.UserInfo.Length == 0));

    private Task<bool> ValidAssetAsync(string? value, string purpose, string? currentUrl,
        CancellationToken cancellationToken)
    {
        if (string.IsNullOrEmpty(value) || !value.StartsWith("/api/v1/media/", StringComparison.Ordinal))
            return Task.FromResult(true);
        var id = Guid.Parse(value["/api/v1/media/".Length..]);
        var cutoff = CommercialMediaLinkPolicy.LinkCutoff(DateTimeOffset.UtcNow);
        return context.MediaAssets.AnyAsync(asset => asset.PublicId == id &&
            asset.Purpose == purpose &&
            (asset.CreatedAt >= cutoff || value == currentUrl), cancellationToken);
    }

    private static bool TryVersion(string? version, out byte[] bytes)
    {
        try { bytes = Convert.FromBase64String(version ?? string.Empty); return bytes.Length == 8; }
        catch (FormatException) { bytes = []; return false; }
    }

    private static string? EmptyToNull(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
