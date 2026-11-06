using Elevant.Domain.Enumerations;
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
            var beforeVerifier = profile.VerifiedByAccountId;
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
            else if (AviamAirlineReference.Verified.TryGetValue(profile.SourceName, out identity) &&
                profile.VerifiedAt is not null && profile.VerifiedByAccountId is null &&
                profile.LegalName == identity.Legal && profile.IataCode == identity.Iata &&
                profile.IcaoCode == identity.Icao && profile.VerificationSourceUrl == identity.Source)
                profile.VerifiedByAccountId = actorDatabaseId;
            if (AviamAirlineReference.Archived.Contains(profile.SourceName))
                profile.IsPublished = false;
            if (beforeCountry == profile.CountryCode && beforeLogo == profile.LogoObjectKey && beforeIata == profile.IataCode &&
                beforeIcao == profile.IcaoCode && beforePublished == profile.IsPublished &&
                beforeVerified == (profile.VerifiedAt is not null) &&
                beforeVerifier == profile.VerifiedByAccountId &&
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
        if (input.LogoUrl is not null && input.LogoUrl.StartsWith("/api/v1/media/", StringComparison.Ordinal))
        {
            if (!Guid.TryParse(input.LogoUrl["/api/v1/media/".Length..], out var logoId))
                return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);
            var cutoff = CommercialMediaLinkPolicy.LinkCutoff(DateTimeOffset.UtcNow);
            if (!await context.MediaAssets.AnyAsync(asset => asset.PublicId == logoId &&
                asset.Purpose == "airline-logo" &&
                (asset.CreatedAt >= cutoff || input.LogoUrl == profile.LogoObjectKey), cancellationToken))
                return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);
        }
        if (profileId is null) context.CommercialAirlineProfiles.Add(profile);

        var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        var beforeCountry = profile.CountryCode;
        var beforeIata = profile.IataCode;
        var beforeIcao = profile.IcaoCode;
        var beforeLogo = profile.LogoObjectKey;
        var beforePublished = profile.IsPublished;
        var beforeVerified = profile.VerifiedAt is not null;
        // A registry check is about the name and codes it saw; changing them makes it stale.
        if (profile.DisplayName != input.DisplayName.Trim() || profile.IataCode != Optional(input.IataCode) ||
            profile.IcaoCode != Optional(input.IcaoCode))
            ClearRegistry(profile);
        // Publishing (step 2 of the public wizard) needs a green registry check or a manual
        // verification with its source.
        if (input.IsPublished && !input.IsVerified && profile.RegistryStatus != AirlineRegistryStatus.Found)
            return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid, "registry_check_required");
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
            // Another profile already uses this source name or verified designator.
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict, "airline_profile_conflict");
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
            "contracts.catalog.read", cancellationToken);
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, null,
                "commercial_airlines", profileId, DateTimeOffset.UtcNow);
    }

    public async Task<(AirlineRegistryKey? Key, CatalogMutationFailure? Failure)> RegistryKeyAsync(Guid actorId,
        Guid profileId, CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return (null, CatalogMutationFailure.Forbidden);
        var key = await context.CommercialAirlineProfiles.AsNoTracking().Where(item => item.PublicId == profileId)
            .Select(item => new AirlineRegistryKey(item.PublicId, item.DisplayName, item.IataCode, item.IcaoCode))
            .SingleOrDefaultAsync(cancellationToken);
        return key is null ? (null, CatalogMutationFailure.NotFound) : (key, null);
    }

    public async Task<AirlineMutationResult> RecordRegistryCheckAsync(Guid actorId, AirlineRegistryKey key,
        AirlineRegistryCheck check, CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Forbidden);
        var profile = await context.CommercialAirlineProfiles.SingleOrDefaultAsync(item => item.PublicId == key.Id,
            cancellationToken);
        if (profile is null) return AirlineMutationResult.Failed(CatalogMutationFailure.NotFound);
        if (profile.DisplayName != key.Name || profile.IataCode != key.IataCode || profile.IcaoCode != key.IcaoCode)
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
        // «Unavailable» is not a verdict: the previous check stays as it was.
        if (!Enum.TryParse<AirlineRegistryStatus>(check.Status, out var status)) return AirlineMutationResult.Success(Map(profile));
        var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        var before = profile.RegistryStatus?.ToString();
        profile.RegistryStatus = status;
        profile.RegistrySource = check.Source;
        profile.RegistryCheckedAt = check.CheckedAt;
        profile.RegistryEntityUrl = check.EntityUrl is { Length: <= 300 } url &&
            url.StartsWith("https://www.wikidata.org/wiki/Q", StringComparison.Ordinal) ? url : null;
        profile.UpdatedAt = DateTimeOffset.UtcNow;
        CommercialAuditWriter.Add(context, actorDatabaseId, "commercial.airline.registry_checked",
            "commercial.airline_profiles", profile.PublicId, null,
            new AuditFieldChangeData("airline.registry_status", before, status.ToString()),
            new AuditFieldChangeData("airline.registry_source", null, check.Source));
        await NotifyInternalAsync(profile.PublicId, cancellationToken);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
        return AirlineMutationResult.Success(Map(profile));
    }

    private static void ClearRegistry(CommercialAirlineProfile profile)
    {
        profile.RegistryStatus = null;
        profile.RegistrySource = null;
        profile.RegistryCheckedAt = null;
        profile.RegistryEntityUrl = null;
    }

    private static ManagedAirlineData Map(CommercialAirlineProfile profile) => new(
        profile.PublicId, profile.SourceName, profile.DisplayName, profile.LegalName,
        profile.Region, profile.CountryCode, profile.IataCode, profile.IcaoCode,
        profile.LogoObjectKey ?? AviamAirlineReference.LogoPaths.GetValueOrDefault(profile.SourceName), profile.SourceUrl, profile.VerificationSourceUrl,
        profile.VerifiedAt is not null && profile.VerifiedByAccountId is not null, profile.IsPublished,
        Convert.ToBase64String(profile.RowVersion), profile.RegistryStatus?.ToString(), profile.RegistrySource,
        profile.RegistryCheckedAt, profile.RegistryEntityUrl);

    private static bool ValidVersion(string? version)
    {
        try { return Convert.FromBase64String(version ?? string.Empty).Length == 8; }
        catch (FormatException) { return false; }
    }

    private static string? Optional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
