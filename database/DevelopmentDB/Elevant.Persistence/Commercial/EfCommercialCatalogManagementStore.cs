using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.AspNetCore.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialCatalogManagementStore(
    ElevantDbContext context, CommercialPermissionGuard permissions)
    : ICommercialCatalogManagementStore
{
    public async Task<IReadOnlyList<ManagedServiceData>?> ListAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAnyAsync(actorId, ["contracts.catalog.read", "finance.catalog.read"], cancellationToken))
            return null;
        return (await context.ServiceDefinitions.AsNoTracking()
            .OrderBy(service => service.DisplayOrder).ThenBy(service => service.Name)
            .ToArrayAsync(cancellationToken)).Select(Map).ToArray();
    }

    public async Task<CatalogMutationResult> SaveAsync(Guid actorId, Guid? serviceId,
        ManagedServiceInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "finance.catalog.manage", cancellationToken))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Forbidden);
        if (!Valid(input) || (serviceId is not null &&
            !TryVersion(input.Version, out _)))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid);
        ServiceDefinition service;
        if (serviceId is null)
        {
            service = new ServiceDefinition { PublicId = Guid.CreateVersion7() };
        }
        else
        {
            service = await context.ServiceDefinitions.SingleOrDefaultAsync(
                item => item.PublicId == serviceId, cancellationToken)
                ?? null!;
            if (service is null) return CatalogMutationResult.Failed(CatalogMutationFailure.NotFound);
            if (!Convert.ToBase64String(service.RowVersion).Equals(input.Version, StringComparison.Ordinal))
                return CatalogMutationResult.Failed(CatalogMutationFailure.Conflict);
            if (!string.Equals(service.Code, input.Code.Trim(), StringComparison.OrdinalIgnoreCase))
                return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid);
            if (!service.IsPublic && input.IsPublic &&
                await context.ServiceClosureRequests.AnyAsync(item =>
                    item.ServiceDefinitionId == service.Id &&
                    item.Status == Elevant.Domain.Entities.Commercial.ServiceClosureStatus.Approved &&
                    item.ReopenedAt == null, cancellationToken))
                return CatalogMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
        if (!await ValidAssetAsync(input.ImageUrl, "service-image", service.ImageUrl, cancellationToken) ||
            !await ValidAssetAsync(input.VideoUrl, "service-video", service.VideoUrl, cancellationToken))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Invalid);
        if (serviceId is null) context.ServiceDefinitions.Add(service);
        var beforeName = service.Name;
        var beforePublic = service.IsPublic;
        var beforeActive = service.IsActive;
        service.Code = input.Code.Trim().ToUpperInvariant();
        service.Name = input.Name.Trim();
        service.Description = input.Description.Trim();
        service.DefaultBillingUnit = input.BillingUnit.Trim();
        service.ImageUrl = EmptyToNull(input.ImageUrl);
        service.VideoUrl = EmptyToNull(input.VideoUrl);
        service.DisplayOrder = input.DisplayOrder;
        service.IsPublic = input.IsPublic;
        service.IsActive = input.IsActive;
        service.UpdatedAt = DateTimeOffset.UtcNow;
        try
        {
            var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            CommercialAuditWriter.Add(context, actorDatabaseId,
                serviceId is null ? "commercial.catalog.created" : "commercial.catalog.updated",
                "ref.service_definitions", service.PublicId, null,
                new AuditFieldChangeData("service.name", serviceId is null ? null : beforeName, service.Name),
                new AuditFieldChangeData("service.public", serviceId is null ? null : beforePublic.ToString(), service.IsPublic.ToString()),
                new AuditFieldChangeData("service.active", serviceId is null ? null : beforeActive.ToString(), service.IsActive.ToString()));
            await NotifyInternalAsync(service.PublicId, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return CatalogMutationResult.Success(Map(service));
        }
        catch (DbUpdateConcurrencyException)
        {
            return CatalogMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
        catch (DbUpdateException exception) when (exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return CatalogMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
    }

    public async Task<CatalogMutationResult> DeleteAsync(Guid actorId, Guid serviceId,
        string version, CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAsync(actorId, "finance.catalog.manage", cancellationToken))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Forbidden);
        var service = await context.ServiceDefinitions.SingleOrDefaultAsync(
            item => item.PublicId == serviceId, cancellationToken);
        if (service is null) return CatalogMutationResult.Failed(CatalogMutationFailure.NotFound);
        if (!Convert.ToBase64String(service.RowVersion).Equals(version, StringComparison.Ordinal))
            return CatalogMutationResult.Failed(CatalogMutationFailure.Conflict);
        service.IsActive = false;
        service.IsPublic = false;
        service.UpdatedAt = DateTimeOffset.UtcNow;
        try
        {
            var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            CommercialAuditWriter.Add(context, actorDatabaseId,
                "commercial.catalog.retired", "ref.service_definitions", service.PublicId,
                null, new AuditFieldChangeData("service.active", true.ToString(), false.ToString()),
                new AuditFieldChangeData("service.public", true.ToString(), false.ToString()));
            await NotifyInternalAsync(service.PublicId, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return CatalogMutationResult.Success(Map(service));
        }
        catch (DbUpdateConcurrencyException)
        {
            return CatalogMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
    }

    private static ManagedServiceData Map(ServiceDefinition item) => new(
        item.PublicId, item.Code, item.Name, item.Description ?? string.Empty,
        item.DefaultBillingUnit, CommercialServiceMediaDefaults.Resolve(item.Code, item.ImageUrl), item.VideoUrl, item.DisplayOrder,
        item.IsPublic, item.IsActive, Convert.ToBase64String(item.RowVersion));

    private async Task NotifyInternalAsync(Guid serviceId, CancellationToken cancellationToken)
    {
        var recipients = await CommercialNotificationRecipients.WithAnyPermissionAsync(context,
            ["contracts.catalog.read", "finance.catalog.read"], cancellationToken);
        var closureRecipients = await CommercialNotificationRecipients.WithAnyPermissionAsync(context,
            ["contracts.service_closures.read", "operations.service_closures.read"], cancellationToken);
        foreach (var recipient in recipients.Concat(closureRecipients).Distinct())
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "commercial_catalog", serviceId, DateTimeOffset.UtcNow);
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
