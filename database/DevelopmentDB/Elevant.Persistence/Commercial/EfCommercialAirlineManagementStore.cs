using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Elevant.Infrastructure.Persistence.Seed;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialAirlineManagementStore(
    ElevantDbContext context, CommercialPermissionGuard permissions)
    : ICommercialAirlineManagementStore
{
    private static readonly DateTimeOffset FixtureInstant =
        new(2026, 8, 17, 12, 0, 0, TimeSpan.Zero);

    public async Task<AirlineEnrichmentResult> EnrichHistoricalCatalogAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return new AirlineEnrichmentResult(0, CatalogMutationFailure.Forbidden);
        var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        var profiles = await context.CommercialAirlineProfiles
            .Where(item => item.UpdatedAt == FixtureInstant).ToArrayAsync(cancellationToken);
        var changed = 0;
        foreach (var profile in profiles)
        {
            if (!AviamAirlineReference.Research.TryGetValue(profile.SourceName, out var lead))
                continue;
            var beforeCountry = profile.CountryCode;
            var beforeSource = profile.SourceUrl;
            var beforeIata = profile.IataCode;
            var beforeIcao = profile.IcaoCode;
            var beforeLogo = profile.LogoObjectKey;
            var beforePublished = profile.IsPublished;
            var beforeVerified = profile.VerifiedAt is not null;
            profile.CountryCode ??= lead.Country;
            profile.LogoObjectKey ??= AviamAirlineReference.LogoPaths.GetValueOrDefault(profile.SourceName);
            if (profile.SourceUrl == AviamAirlineReference.AviamClients && lead.Site is not null)
                profile.SourceUrl = lead.Site;
            if (AviamAirlineReference.Verified.TryGetValue(profile.SourceName, out var identity) &&
                profile.LegalName is null && profile.IataCode is null && profile.IcaoCode is null)
            {
                profile.LegalName = identity.Legal;
                profile.IataCode = identity.Iata;
                profile.IcaoCode = identity.Icao;
                profile.VerificationSourceUrl = identity.Source;
                profile.VerifiedAt = DateTimeOffset.UtcNow;
                profile.VerifiedByAccountId = actorDatabaseId;
            }
            if (AviamAirlineReference.Archived.Contains(profile.SourceName))
                profile.IsPublished = false;
            if (beforeCountry == profile.CountryCode && beforeLogo == profile.LogoObjectKey && beforeIata == profile.IataCode &&
                beforeIcao == profile.IcaoCode && beforePublished == profile.IsPublished &&
                beforeVerified == (profile.VerifiedAt is not null) &&
                beforeSource == profile.SourceUrl)
                continue;
            profile.UpdatedAt = DateTimeOffset.UtcNow;
            CommercialAuditWriter.Add(context, actorDatabaseId,
                "commercial.airline.enriched", "commercial.airline_profiles", profile.PublicId, null,
                new AuditFieldChangeData("airline.country", beforeCountry, profile.CountryCode),
                new AuditFieldChangeData("airline.iata", beforeIata, profile.IataCode),
                new AuditFieldChangeData("airline.icao", beforeIcao, profile.IcaoCode),
                new AuditFieldChangeData("airline.logo", beforeLogo, profile.LogoObjectKey),
                new AuditFieldChangeData("airline.published", beforePublished.ToString(), profile.IsPublished.ToString()),
                new AuditFieldChangeData("airline.verified", beforeVerified.ToString(),
                    (profile.VerifiedAt is not null).ToString()));
            await NotifyInternalAsync(profile.PublicId, cancellationToken);
            changed++;
        }
        try { await context.SaveChangesAsync(cancellationToken); }
        catch (DbUpdateConcurrencyException)
        { return new AirlineEnrichmentResult(0, CatalogMutationFailure.Conflict); }
        return new AirlineEnrichmentResult(changed, null);
    }
    public async Task<IReadOnlyList<ManagedAirlineData>?> ListAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return null;
        var profiles = await context.CommercialAirlineProfiles.AsNoTracking()
            .OrderBy(profile => profile.DisplayName).ToArrayAsync(cancellationToken);
        return profiles.Select(Map).ToArray();
    }

    public async Task<AirlineMutationResult> SaveAsync(Guid actorId, Guid? profileId,
        ManagedAirlineInput input, CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Forbidden);
        if (input is null || !input.IsValid() ||
            profileId is not null && !ValidVersion(input.Version))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);

        CommercialAirlineProfile profile;
        if (profileId is null)
        {
            profile = new CommercialAirlineProfile
            {
                PublicId = Guid.CreateVersion7(),
                SourceName = input.SourceName.Trim().ToUpperInvariant(),
                CreatedAt = DateTimeOffset.UtcNow,
            };
            context.CommercialAirlineProfiles.Add(profile);
        }
        else
        {
            profile = await context.CommercialAirlineProfiles.SingleOrDefaultAsync(
                item => item.PublicId == profileId, cancellationToken) ?? null!;
            if (profile is null)
                return AirlineMutationResult.Failed(CatalogMutationFailure.NotFound);
            if (!Convert.ToBase64String(profile.RowVersion).Equals(input.Version,
                    StringComparison.Ordinal))
                return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
            if (!profile.SourceName.Equals(input.SourceName.Trim(),
                    StringComparison.OrdinalIgnoreCase))
                return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);
        }

        var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        var beforeCountry = profile.CountryCode;
        var beforeIata = profile.IataCode;
        var beforeIcao = profile.IcaoCode;
        var beforeLogo = profile.LogoObjectKey;
        var beforePublished = profile.IsPublished;
        var beforeVerified = profile.VerifiedAt is not null;
        profile.DisplayName = input.DisplayName.Trim();
        profile.LegalName = Optional(input.LegalName);
        profile.Region = input.Region.Trim();
        profile.CountryCode = Optional(input.CountryCode);
        profile.IataCode = Optional(input.IataCode);
        profile.IcaoCode = Optional(input.IcaoCode);
        profile.LogoObjectKey = Optional(input.LogoUrl);
        profile.SourceUrl = input.SourceUrl.Trim();
        profile.VerificationSourceUrl = Optional(input.VerificationSourceUrl);
        profile.IsPublished = input.IsPublished;
        profile.VerifiedAt = input.IsVerified ? DateTimeOffset.UtcNow : null;
        profile.VerifiedByAccountId = input.IsVerified ? actorDatabaseId : null;
        profile.UpdatedAt = DateTimeOffset.UtcNow;
        try
        {
            CommercialAuditWriter.Add(context, actorDatabaseId,
                profileId is null ? "commercial.airline.created" : "commercial.airline.updated",
                "commercial.airline_profiles", profile.PublicId, null,
                new AuditFieldChangeData("airline.country", beforeCountry, profile.CountryCode),
                new AuditFieldChangeData("airline.iata", beforeIata, profile.IataCode),
                new AuditFieldChangeData("airline.icao", beforeIcao, profile.IcaoCode),
                new AuditFieldChangeData("airline.logo", beforeLogo, profile.LogoObjectKey),
                new AuditFieldChangeData("airline.published", beforePublished.ToString(), profile.IsPublished.ToString()),
                new AuditFieldChangeData("airline.verified", beforeVerified.ToString(),
                    (profile.VerifiedAt is not null).ToString()));
            await NotifyInternalAsync(profile.PublicId, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return AirlineMutationResult.Success(Map(profile));
        }
        catch (DbUpdateConcurrencyException)
        {
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
    }

    public async Task<AirlineMutationResult> ArchiveAsync(Guid actorId, Guid profileId,
        string version, CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Forbidden);
        if (!ValidVersion(version))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);
        var profile = await context.CommercialAirlineProfiles.SingleOrDefaultAsync(
            item => item.PublicId == profileId, cancellationToken);
        if (profile is null)
            return AirlineMutationResult.Failed(CatalogMutationFailure.NotFound);
        if (!Convert.ToBase64String(profile.RowVersion).Equals(version, StringComparison.Ordinal))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
        profile.IsPublished = false;
        profile.UpdatedAt = DateTimeOffset.UtcNow;
        try
        {
            var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
                .Select(user => user.Id).SingleAsync(cancellationToken);
            CommercialAuditWriter.Add(context, actorDatabaseId,
                "commercial.airline.archived", "commercial.airline_profiles", profile.PublicId,
                null, new AuditFieldChangeData("airline.published", true.ToString(), false.ToString()));
            await NotifyInternalAsync(profile.PublicId, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return AirlineMutationResult.Success(Map(profile));
        }
        catch (DbUpdateConcurrencyException)
        {
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
    }

    private async Task NotifyInternalAsync(Guid profileId, CancellationToken cancellationToken)
    {
        var recipients = await CommercialNotificationRecipients.WithPermissionAsync(context,
            "commercial.catalog.read", cancellationToken);
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "commercial_airlines", profileId, DateTimeOffset.UtcNow);
    }

    private static ManagedAirlineData Map(CommercialAirlineProfile profile) => new(
        profile.PublicId, profile.SourceName, profile.DisplayName, profile.LegalName,
        profile.Region, profile.CountryCode, profile.IataCode, profile.IcaoCode,
        profile.LogoObjectKey, profile.SourceUrl, profile.VerificationSourceUrl,
        profile.VerifiedAt is not null, profile.IsPublished,
        Convert.ToBase64String(profile.RowVersion));

    private static bool ValidVersion(string? version)
    {
        try { return Convert.FromBase64String(version ?? string.Empty).Length == 8; }
        catch (FormatException) { return false; }
    }

    private static string? Optional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
