using System.Data;
using Elevant.Domain.Enumerations;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Validation;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Elevant.Infrastructure.Persistence.Seed;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialAirlineManagementStore(
    ElevantDbContext context, CommercialPermissionGuard permissions,
    AirlineCatalogEnrichmentSettings? enrichment = null)
    : ICommercialAirlineManagementStore
{
    private readonly AirlineCatalogEnrichmentSettings enrichmentSettings = enrichment ?? AirlineCatalogEnrichmentSettings.Default;

    private static readonly DateTimeOffset FixtureInstant =
        new(2026, 8, 17, 12, 0, 0, TimeSpan.Zero);
    private const string UpdateAction = "commercial.airline.update";
    private const string ProfileEntity = "commercial.airline_profiles";
    private const string EnrichedAction = "commercial.airline.enriched";
    private const string RegistryCheckedAction = "commercial.airline.registry_checked";

    public async Task<AirlineEnrichmentResult> EnrichHistoricalCatalogAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return new AirlineEnrichmentResult(0, CatalogMutationFailure.Forbidden);
        var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        // A profile no person edited: as the seed left it, or changed since only by this enrichment or by a
        // registry check (neither writes what a person typed). A second run then completes the identities added
        // to the reference after the first one, and never touches a profile Superadministración or Contratos
        // saved, verified or created, nor one that already operates with AVIAM.
        var edited = context.AuditEntries.Where(entry => entry.EntityType == ProfileEntity &&
                entry.Action != EnrichedAction && entry.Action != RegistryCheckedAction)
            .Select(entry => entry.EntityPublicId);
        var profiles = await context.CommercialAirlineProfiles
            .Where(item => item.UpdatedAt == FixtureInstant ||
                item.CanonicalAirlineId == null && !edited.Contains((Guid?)item.PublicId) &&
                context.AuditEntries.Any(entry => entry.EntityType == ProfileEntity && entry.EntityPublicId == item.PublicId))
            .ToArrayAsync(cancellationToken);
        // A verified designator belongs to one airline (ux_airline_profiles_verified_iata/icao).
        var verifiedCodes = await context.CommercialAirlineProfiles.AsNoTracking().Where(item => item.VerifiedAt != null)
            .Select(item => new { item.IataCode, item.IcaoCode }).ToArrayAsync(cancellationToken);
        var takenIata = verifiedCodes.Select(item => item.IataCode).OfType<string>().ToHashSet(StringComparer.Ordinal);
        var takenIcao = verifiedCodes.Select(item => item.IcaoCode).OfType<string>().ToHashSet(StringComparer.Ordinal);
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
            var beforeTax = TaxDisplay(profile);
            profile.CountryCode ??= lead.Country;
            // Development only: a FICTITIOUS demo RNC for a profile without identifier (never a real one).
            if (enrichmentSettings.IncludeDevelopmentTaxRegistrations && profile.TaxRegistration is null &&
                AviamAirlineReference.DevelopmentTaxRegistrations.TryGetValue(profile.SourceName, out var demoRnc))
            {
                profile.TaxRegistration = demoRnc;
                profile.TaxRegistrationCountryCode = TaxRegistrations.DominicanRepublic;
            }
            profile.LogoObjectKey ??= AviamAirlineReference.LogoPaths.GetValueOrDefault(profile.SourceName);
            if (profile.SourceUrl == AviamAirlineReference.AviamClients && lead.Site is not null)
                profile.SourceUrl = lead.Site;
            if (AviamAirlineReference.Verified.TryGetValue(profile.SourceName, out var identity) &&
                profile.LegalName is null && profile.IataCode is null && profile.IcaoCode is null &&
                (identity.Iata is null || !takenIata.Contains(identity.Iata)) && !takenIcao.Contains(identity.Icao))
            {
                profile.LegalName = identity.Legal;
                profile.IataCode = identity.Iata;
                profile.IcaoCode = identity.Icao;
                profile.VerificationSourceUrl = identity.Source;
                profile.VerifiedAt = DateTimeOffset.UtcNow;
                profile.VerifiedByAccountId = actorDatabaseId;
                if (identity.Iata is not null) takenIata.Add(identity.Iata);
                takenIcao.Add(identity.Icao);
                // A registry check was about the codes it saw (none); the new ones need their own.
                ClearRegistry(profile);
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
                beforeSource == profile.SourceUrl && beforeTax == TaxDisplay(profile))
                continue;
            profile.UpdatedAt = DateTimeOffset.UtcNow;
            CommercialAuditWriter.Add(context, actorDatabaseId,
                EnrichedAction, ProfileEntity, profile.PublicId, null,
                new AuditFieldChangeData("airline.country", beforeCountry, profile.CountryCode),
                new AuditFieldChangeData("airline.iata", beforeIata, profile.IataCode),
                new AuditFieldChangeData("airline.icao", beforeIcao, profile.IcaoCode),
                new AuditFieldChangeData("airline.logo", beforeLogo, profile.LogoObjectKey),
                new AuditFieldChangeData("airline.published", beforePublished.ToString(), profile.IsPublished.ToString()),
                new AuditFieldChangeData("airline.verified", beforeVerified.ToString(),
                    (profile.VerifiedAt is not null).ToString()),
                new AuditFieldChangeData("airline.tax_registration", beforeTax, TaxDisplay(profile)));
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
        var locked = await LockedProfilesAsync(cancellationToken);
        return profiles.Select(profile => Map(profile, locked.Contains(profile.Id))).ToArray();
    }

    public async Task<AirlineMutationResult> SaveAsync(Guid actorId, Guid? profileId,
        ManagedAirlineInput input, Guid? idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (!await permissions.IsSuperAdministratorAsync(actorId, cancellationToken))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Forbidden);
        // Expand phase: the update takes an optional Idempotency-Key; when sent it is a real UUID.
        if (idempotencyKey == Guid.Empty)
            return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid, "idempotency_key_required");
        if (idempotencyKey is not null && profileId is not null && string.IsNullOrWhiteSpace(input?.Version))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid, "expected_version_required");
        if (input is null || !input.IsValid() ||
            profileId is not null && !ValidVersion(input.Version))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);
        var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        if (profileId is not { } id) return await CreateAsync(actorDatabaseId, input, cancellationToken);
        var hash = CommercialCommandReceipts.Hash(new { profileId = id, input });
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
                    var prior = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, UpdateAction,
                        hash, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Replay)
                        return await CurrentAsync(prior.ResultId, cancellationToken);
                    if (prior.Outcome == CommercialCommandReceipts.Outcome.Conflict)
                        return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict, "idempotency_conflict");
                }
                var result = await UpdateAsync(actorDatabaseId, id, input, cancellationToken);
                if (result.Failure is not null)
                {
                    await transaction.RollbackAsync(cancellationToken);
                    context.ChangeTracker.Clear();
                    return result;
                }
                if (idempotencyKey is { } receipt)
                    CommercialCommandReceipts.Add(context, receipt, actorDatabaseId, UpdateAction, hash, id,
                        DateTimeOffset.UtcNow);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                // The answer carries the rowversion the save produced.
                return await CurrentAsync(id, cancellationToken);
            });
        }
        catch (DbUpdateConcurrencyException)
        {
            context.ChangeTracker.Clear();
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
        catch (DbUpdateException exception) when (idempotencyKey is { } key &&
            CommercialCommandReceipts.IsDuplicateKey(exception))
        {
            // A concurrent save with the same key committed first.
            context.ChangeTracker.Clear();
            var concurrent = await CommercialCommandReceipts.FindAsync(context, key, actorDatabaseId, UpdateAction, hash,
                cancellationToken);
            return concurrent.Outcome == CommercialCommandReceipts.Outcome.Replay
                ? await CurrentAsync(concurrent.ResultId, cancellationToken)
                : AirlineMutationResult.Failed(CatalogMutationFailure.Conflict, "idempotency_conflict");
        }
        catch (DbUpdateException exception) when (
            exception.InnerException is SqlException { Number: 2601 or 2627 })
        {
            // Another profile already uses this source name or verified designator.
            context.ChangeTracker.Clear();
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict, "airline_profile_conflict");
        }
    }

    private async Task<AirlineMutationResult> CreateAsync(long actorDatabaseId, ManagedAirlineInput input,
        CancellationToken cancellationToken)
    {
        var profile = new CommercialAirlineProfile
        {
            PublicId = Guid.CreateVersion7(),
            SourceName = input.SourceName.Trim().ToUpperInvariant(),
            CreatedAt = DateTimeOffset.UtcNow,
        };
        if (await LogoFailureAsync(input, profile, cancellationToken) is { } logoFailure) return logoFailure;
        context.CommercialAirlineProfiles.Add(profile);
        if (Apply(actorDatabaseId, profile, input, created: true) is { } failure) return failure;
        try
        {
            await NotifyInternalAsync(profile.PublicId, cancellationToken);
            await context.SaveChangesAsync(cancellationToken);
            return AirlineMutationResult.Success(Map(profile, false));
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

    /// <summary>The update inside its transaction; the caller saves and writes the receipt.</summary>
    private async Task<AirlineMutationResult> UpdateAsync(long actorDatabaseId, Guid profileId, ManagedAirlineInput input,
        CancellationToken cancellationToken)
    {
        var profile = await context.CommercialAirlineProfiles.SingleOrDefaultAsync(
            item => item.PublicId == profileId, cancellationToken);
        if (profile is null)
            return AirlineMutationResult.Failed(CatalogMutationFailure.NotFound);
        if (!Convert.ToBase64String(profile.RowVersion).Equals(input.Version, StringComparison.Ordinal))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
        if (!profile.SourceName.Equals(input.SourceName.Trim(), StringComparison.OrdinalIgnoreCase))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);
        // 1-N20: an operating airline keeps its legal name, codes and verification.
        if (await IsLockedAsync(profile, cancellationToken) &&
            ManagedAirlineIdentityRules.ChangesIdentity(Identity(profile), input))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict, GovernanceAccountIssues.AirlineIdentityLocked);
        if (await LogoFailureAsync(input, profile, cancellationToken) is { } logoFailure) return logoFailure;
        // ADR-0023: a superadministrator who confirms a verification Contratos stamped takes it over, so the
        // profile counts as verified by hand by Superadministración (the exception to the registry rule).
        var claim = input.IsVerified && profile.VerifiedByAccountId is long verifier && verifier != actorDatabaseId &&
            !await IsSuperAdministratorAccountAsync(verifier, cancellationToken);
        if (Apply(actorDatabaseId, profile, input, created: false, claim) is { } failure) return failure;
        await NotifyInternalAsync(profile.PublicId, cancellationToken);
        return AirlineMutationResult.Success(Map(profile, false));
    }

    /// <summary>Copies the form into the profile with its audit; a refused publication returns its failure.</summary>
    private AirlineMutationResult? Apply(long actorDatabaseId, CommercialAirlineProfile profile, ManagedAirlineInput input,
        bool created, bool claimVerification = false)
    {
        var beforeCountry = profile.CountryCode;
        var beforeIata = profile.IataCode;
        var beforeIcao = profile.IcaoCode;
        var beforeLogo = profile.LogoObjectKey;
        var beforePublished = profile.IsPublished;
        var beforeVerified = profile.VerifiedAt is not null;
        var beforeTax = TaxDisplay(profile);
        var stored = Identity(profile);
        // A registry check is about the name and codes it saw; changing them makes it stale.
        if (profile.DisplayName != input.DisplayName.Trim() || profile.IataCode != Optional(input.IataCode) ||
            profile.IcaoCode != Optional(input.IcaoCode))
            ClearRegistry(profile);
        // Publishing (step 2 of the public wizard) needs a green registry check or a manual
        // verification with its source.
        if (input.IsPublished && !input.IsVerified && profile.RegistryStatus != AirlineRegistryStatus.Found)
            return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid, "registry_check_required");
        // The verification is stamped again only when it starts or its evidence changes (1-N20).
        var restamp = ManagedAirlineIdentityRules.RestampsVerification(stored, input) || claimVerification;
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
        // The tax identifier is not evidence of the identity: it never clears the registry check or restamps.
        var tax = input.TaxRegistrationOrNull();
        profile.TaxRegistration = tax?.Number;
        profile.TaxRegistrationCountryCode = tax?.CountryCode;
        if (!input.IsVerified)
        {
            profile.VerifiedAt = null;
            profile.VerifiedByAccountId = null;
        }
        else if (restamp)
        {
            profile.VerifiedAt = DateTimeOffset.UtcNow;
            profile.VerifiedByAccountId = actorDatabaseId;
        }
        profile.UpdatedAt = DateTimeOffset.UtcNow;
        CommercialAuditWriter.Add(context, actorDatabaseId,
            created ? "commercial.airline.created" : "commercial.airline.updated",
            "commercial.airline_profiles", profile.PublicId, null,
            new AuditFieldChangeData("airline.country", beforeCountry, profile.CountryCode),
            new AuditFieldChangeData("airline.iata", beforeIata, profile.IataCode),
            new AuditFieldChangeData("airline.icao", beforeIcao, profile.IcaoCode),
            new AuditFieldChangeData("airline.logo", beforeLogo, profile.LogoObjectKey),
            new AuditFieldChangeData("airline.published", beforePublished.ToString(), profile.IsPublished.ToString()),
            new AuditFieldChangeData("airline.verified", beforeVerified.ToString(),
                (profile.VerifiedAt is not null).ToString()),
            new AuditFieldChangeData("airline.tax_registration", beforeTax, TaxDisplay(profile)));
        return null;
    }

    /// <summary>The identifier as the audit shows it («RNC 1-31-23456-9»); a company's, never a person's document.</summary>
    private static string? TaxDisplay(CommercialAirlineProfile profile) =>
        profile is { TaxRegistration: { } number, TaxRegistrationCountryCode: { } country }
            ? TaxRegistrations.Display(number, country) : null;

    private async Task<AirlineMutationResult?> LogoFailureAsync(ManagedAirlineInput input, CommercialAirlineProfile profile,
        CancellationToken cancellationToken)
    {
        if (input.LogoUrl is null || !input.LogoUrl.StartsWith("/api/v1/media/", StringComparison.Ordinal)) return null;
        if (!Guid.TryParse(input.LogoUrl["/api/v1/media/".Length..], out var logoId))
            return AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);
        var cutoff = CommercialMediaLinkPolicy.LinkCutoff(DateTimeOffset.UtcNow);
        return await context.MediaAssets.AnyAsync(asset => asset.PublicId == logoId &&
                asset.Purpose == "airline-logo" &&
                (asset.CreatedAt >= cutoff || input.LogoUrl == profile.LogoObjectKey), cancellationToken)
            ? null : AirlineMutationResult.Failed(CatalogMutationFailure.Invalid);
    }

    /// <summary>The profile as stored now, with its lock; used for the answer and for a replay.</summary>
    private async Task<AirlineMutationResult> CurrentAsync(Guid profileId, CancellationToken cancellationToken)
    {
        var profile = await context.CommercialAirlineProfiles.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == profileId, cancellationToken);
        return profile is null
            ? AirlineMutationResult.Failed(CatalogMutationFailure.NotFound)
            : AirlineMutationResult.Success(Map(profile, await IsLockedAsync(profile, cancellationToken)));
    }

    /// <summary>
    /// 1-N20: the profile is the operating airline once it has its <c>ref.airlines</c> row or an
    /// approved request; from then on its identity is in contracts, invoices and flights.
    /// </summary>
    private async Task<bool> IsLockedAsync(CommercialAirlineProfile profile, CancellationToken cancellationToken) =>
        profile.CanonicalAirlineId is not null || await context.ServiceRequests.AnyAsync(request =>
            request.AirlineProfileId == profile.Id && request.Status == CommercialRequestStatus.Approved, cancellationToken);

    private async Task<HashSet<long>> LockedProfilesAsync(CancellationToken cancellationToken) =>
        (await context.CommercialAirlineProfiles.AsNoTracking()
            .Where(profile => profile.CanonicalAirlineId != null || context.ServiceRequests.Any(request =>
                request.AirlineProfileId == profile.Id && request.Status == CommercialRequestStatus.Approved))
            .Select(profile => profile.Id).ToArrayAsync(cancellationToken)).ToHashSet();

    private static ManagedAirlineIdentity Identity(CommercialAirlineProfile profile) => new(profile.LegalName,
        profile.IataCode, profile.IcaoCode, profile.VerificationSourceUrl, IsVerified(profile));

    private static bool IsVerified(CommercialAirlineProfile profile) =>
        profile.VerifiedAt is not null && profile.VerifiedByAccountId is not null;

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
            return AirlineMutationResult.Success(Map(profile, await IsLockedAsync(profile, cancellationToken)));
        }
        catch (DbUpdateConcurrencyException)
        {
            return AirlineMutationResult.Failed(CatalogMutationFailure.Conflict);
        }
    }

    private async Task<bool> IsSuperAdministratorAccountAsync(long accountId, CancellationToken cancellationToken)
    {
        var publicId = await context.Users.AsNoTracking().Where(user => user.Id == accountId)
            .Select(user => (Guid?)user.PublicId).SingleOrDefaultAsync(cancellationToken);
        return publicId is { } id && await permissions.IsSuperAdministratorAsync(id, cancellationToken);
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
        if (!Enum.TryParse<AirlineRegistryStatus>(check.Status, out var status))
            return AirlineMutationResult.Success(Map(profile, await IsLockedAsync(profile, cancellationToken)));
        var actorDatabaseId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        var before = profile.RegistryStatus?.ToString();
        profile.RegistryStatus = status;
        profile.RegistrySource = check.Source;
        profile.RegistryCheckedAt = check.CheckedAt;
        profile.RegistryEntityUrl = check.EntityUrl is { Length: <= 300 } url &&
            url.StartsWith("https://www.wikidata.org/wiki/Q", StringComparison.Ordinal) ? url : null;
        profile.UpdatedAt = DateTimeOffset.UtcNow;
        CommercialAuditWriter.Add(context, actorDatabaseId, RegistryCheckedAction,
            ProfileEntity, profile.PublicId, null,
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
        return AirlineMutationResult.Success(Map(profile, await IsLockedAsync(profile, cancellationToken)));
    }

    private static void ClearRegistry(CommercialAirlineProfile profile)
    {
        profile.RegistryStatus = null;
        profile.RegistrySource = null;
        profile.RegistryCheckedAt = null;
        profile.RegistryEntityUrl = null;
    }

    private static ManagedAirlineData Map(CommercialAirlineProfile profile, bool identityLocked) => new(
        profile.PublicId, profile.SourceName, profile.DisplayName, profile.LegalName,
        profile.Region, profile.CountryCode, profile.IataCode, profile.IcaoCode,
        profile.LogoObjectKey ?? AviamAirlineReference.LogoPaths.GetValueOrDefault(profile.SourceName), profile.SourceUrl, profile.VerificationSourceUrl,
        IsVerified(profile), profile.IsPublished,
        Convert.ToBase64String(profile.RowVersion), profile.RegistryStatus?.ToString(), profile.RegistrySource,
        profile.RegistryCheckedAt, profile.RegistryEntityUrl, identityLocked,
        profile.TaxRegistration, profile.TaxRegistrationCountryCode);

    private static bool ValidVersion(string? version)
    {
        try { return Convert.FromBase64String(version ?? string.Empty).Length == 8; }
        catch (FormatException) { return false; }
    }

    private static string? Optional(string? value) =>
        string.IsNullOrWhiteSpace(value) ? null : value.Trim();
}
