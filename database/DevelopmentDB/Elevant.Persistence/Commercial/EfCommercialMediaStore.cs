using System.Data;
using System.Security.Cryptography;
using Amazon;
using Amazon.Runtime;
using Amazon.S3;
using Amazon.S3.Model;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.Configuration;

namespace Elevant.Persistence.Commercial;

internal sealed class EfCommercialMediaStore(
    ElevantDbContext context, CommercialPermissionGuard permissions,
    IActorContextResolver actors, IConfiguration configuration)
    : ICommercialMediaStore
{
    private const long MaxImageBytes = 8 * 1024 * 1024;
    private const long MaxVideoBytes = 24 * 1024 * 1024;
    private const long MaxDailyActorBytes = 250 * 1024 * 1024;
    private const int MaxDailyActorUploads = 100;

    public async Task<MediaAssetData?> UploadAsync(Guid actorId, string purpose, string contentType,
        Stream content, long length, CancellationToken cancellationToken = default)
    {
        var image = purpose is "service-image" or "airline-logo" or "avatar";
        var video = purpose == "service-video";
        if (!image && !video || length <= 0 || length > (video ? MaxVideoBytes : MaxImageBytes))
            return null;
        var authorized = purpose switch
        {
            "service-image" or "service-video" =>
                await permissions.HasAsync(actorId, "commercial.catalog.edit", cancellationToken) ||
                await permissions.HasAsync(actorId, "commercial.catalog.create", cancellationToken),
            "airline-logo" => await permissions.IsSuperAdministratorAsync(actorId, cancellationToken),
            "avatar" => await CanManageAvatarsAsync(actorId, cancellationToken),
            _ => false,
        };
        if (!authorized) return null;

        using var buffer = new MemoryStream();
        await content.CopyToAsync(buffer, cancellationToken);
        var bytes = buffer.ToArray();
        if (bytes.LongLength != length || !MatchesSignature(bytes, contentType, video)) return null;

        var accountId = await context.Users.Where(user => user.PublicId == actorId)
            .Select(user => user.Id).SingleAsync(cancellationToken);
        var id = Guid.CreateVersion7();
        var key = $"{purpose}/{id:N}";
        var strategy = context.Database.CreateExecutionStrategy();
        var reserved = await strategy.ExecuteAsync(async () =>
        {
            await using var transaction = await context.Database.BeginTransactionAsync(
                IsolationLevel.Serializable, cancellationToken);
            var resource = $"elevant-media-quota-{accountId}";
            await context.Database.ExecuteSqlInterpolatedAsync($"""
                DECLARE @lockResult int;
                EXEC @lockResult = sys.sp_getapplock @Resource={resource},
                    @LockMode='Exclusive', @LockOwner='Transaction', @LockTimeout=10000;
                IF @lockResult < 0 THROW 51000, 'Media quota lock unavailable', 1;
                """, cancellationToken);
            // A lost commit response may retry this delegate. The same public ID
            // lets the retry recognize a reservation that was already committed.
            if (await context.MediaAssets.AsNoTracking().AnyAsync(
                asset => asset.PublicId == id, cancellationToken))
                return true;
            var since = DateTimeOffset.UtcNow.AddDays(-1);
            var recent = context.MediaAssets.AsNoTracking().Where(asset =>
                asset.UploadedByAccountId == accountId && asset.CreatedAt >= since);
            if (await recent.CountAsync(cancellationToken) >= MaxDailyActorUploads ||
                (await recent.SumAsync(asset => (long?)asset.Length, cancellationToken) ?? 0) + length > MaxDailyActorBytes)
                return false;

            var asset = new MediaAsset
            {
                PublicId = id, ObjectKey = key, Purpose = purpose, ContentType = contentType,
                Length = length, Sha256 = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant(),
                UploadedByAccountId = accountId, CreatedAt = DateTimeOffset.UtcNow,
            };
            context.MediaAssets.Add(asset);
            try
            {
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
            }
            catch
            {
                context.Entry(asset).State = EntityState.Detached;
                throw;
            }
            return true;
        });
        if (!reserved) return null;

        // An uncertain S3 outcome leaves an unlinked SQL reservation for the
        // orphan worker. It must never delete bytes after an ambiguous response.
        using var client = CreateClient();
        buffer.Position = 0;
        await client.PutObjectAsync(new PutObjectRequest
        {
            BucketName = Bucket(), Key = key, InputStream = buffer, ContentType = contentType,
            UseChunkEncoding = false,
        }, cancellationToken);
        return new MediaAssetData(id, $"/api/v1/media/{id}", purpose, contentType, length);
    }

    public async Task<MediaContentData?> GetReadableAsync(Guid id, Guid? actorId = null,
        CancellationToken cancellationToken = default)
    {
        var asset = await context.MediaAssets.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == id, cancellationToken);
        if (asset is null) return null;
        var url = $"/api/v1/media/{id}";
        var linked = asset.Purpose switch
        {
            "service-image" => await context.ServiceDefinitions.AsNoTracking()
                .AnyAsync(item => item.IsActive && item.IsPublic && item.ImageUrl == url, cancellationToken) ||
                actorId.HasValue && await permissions.HasAsync(actorId.Value, "commercial.catalog.read", cancellationToken) &&
                await context.ServiceDefinitions.AsNoTracking().AnyAsync(item => item.ImageUrl == url, cancellationToken),
            "service-video" => await context.ServiceDefinitions.AsNoTracking()
                .AnyAsync(item => item.IsActive && item.IsPublic && item.VideoUrl == url, cancellationToken) ||
                actorId.HasValue && await permissions.HasAsync(actorId.Value, "commercial.catalog.read", cancellationToken) &&
                await context.ServiceDefinitions.AsNoTracking().AnyAsync(item => item.VideoUrl == url, cancellationToken),
            "airline-logo" => await context.CommercialAirlineProfiles.AsNoTracking()
                .AnyAsync(item => item.IsPublished && item.LogoObjectKey == url, cancellationToken) ||
                actorId.HasValue && await permissions.IsSuperAdministratorAsync(actorId.Value, cancellationToken) &&
                await context.CommercialAirlineProfiles.AsNoTracking().AnyAsync(item => item.LogoObjectKey == url, cancellationToken),
            "avatar" => actorId.HasValue &&
                await CanManageAvatarsAsync(actorId.Value, cancellationToken) &&
                await context.Persons.AsNoTracking().AnyAsync(item => item.AvatarMediaUrl == url, cancellationToken),
            _ => false,
        };
        return linked ? new MediaContentData(asset.ObjectKey, asset.ContentType, asset.Length) : null;
    }

    public async Task<Stream> OpenAsync(string key, long? start = null, long? last = null,
        CancellationToken cancellationToken = default)
    {
        using var client = CreateClient();
        using var response = await client.GetObjectAsync(new GetObjectRequest
        {
            BucketName = Bucket(), Key = key,
            ByteRange = start is not null && last is not null ? new ByteRange(start.Value, last.Value) : null,
        }, cancellationToken);
        var buffer = new MemoryStream();
        await response.ResponseStream.CopyToAsync(buffer, cancellationToken);
        buffer.Position = 0;
        return buffer;
    }

    public async Task<int> CleanupOrphansAsync(CancellationToken cancellationToken = default)
    {
        var cutoff = CommercialMediaLinkPolicy.CleanupCutoff(DateTimeOffset.UtcNow);
        using var client = CreateClient();
        var removed = 0;
        long afterId = 0;
        while (removed < 100)
        {
            var candidates = await context.MediaAssets
                .Where(asset => asset.CreatedAt < cutoff && asset.Id > afterId)
                .OrderBy(asset => asset.Id).Take(100).ToArrayAsync(cancellationToken);
            if (candidates.Length == 0) break;
            afterId = candidates[^1].Id;
            foreach (var asset in candidates)
            {
                var url = $"/api/v1/media/{asset.PublicId}";
                var linked = await context.ServiceDefinitions.AsNoTracking().AnyAsync(
                    item => item.ImageUrl == url || item.VideoUrl == url, cancellationToken) ||
                    await context.CommercialAirlineProfiles.AsNoTracking().AnyAsync(
                        item => item.LogoObjectKey == url, cancellationToken) ||
                    await context.Persons.AsNoTracking().AnyAsync(
                        item => item.AvatarMediaUrl == url, cancellationToken);
                if (linked) continue;
                await client.DeleteObjectAsync(Bucket(), asset.ObjectKey, cancellationToken);
                context.MediaAssets.Remove(asset);
                await context.SaveChangesAsync(cancellationToken);
                removed++;
                if (removed == 100) break;
            }
        }
        return removed;
    }

    internal static bool MatchesSignature(byte[] bytes, string contentType, bool video) =>
        !video && contentType == "image/png" && bytes.Length >= 8 &&
            bytes.AsSpan(0, 8).SequenceEqual(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }) ||
        !video && contentType == "image/jpeg" && bytes.Length >= 3 &&
            bytes[0] == 0xff && bytes[1] == 0xd8 && bytes[2] == 0xff ||
        !video && contentType == "image/webp" && bytes.Length >= 12 &&
            bytes.AsSpan(0, 4).SequenceEqual("RIFF"u8) && bytes.AsSpan(8, 4).SequenceEqual("WEBP"u8) ||
        video && contentType == "video/mp4" && bytes.Length >= 12 &&
            bytes.AsSpan(4, 4).SequenceEqual("ftyp"u8) ||
        video && contentType == "video/webm" && bytes.Length >= 4 &&
            bytes.AsSpan(0, 4).SequenceEqual(new byte[] { 0x1a, 0x45, 0xdf, 0xa3 });

    private string Bucket() => configuration["MediaStorage:Bucket"] is { Length: > 0 } bucket
        ? bucket : throw new InvalidOperationException("Private media bucket is not configured.");

    private async Task<bool> CanManageAvatarsAsync(Guid actorId, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        return actor?.Roles.Any(role => role.Portal == PortalKind.BackOffice &&
            role.Code is "SUPERADMIN" or "GESTION_HUMANA") == true &&
            actor.Memberships.Any(membership => membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator);
    }

    private AmazonS3Client CreateClient()
    {
        var endpoint = configuration["MediaStorage:Endpoint"];
        var accessKey = configuration["MediaStorage:AccessKey"];
        var privateCredential = configuration["MediaStorage:SecretKey"];
        if (string.IsNullOrWhiteSpace(endpoint) || string.IsNullOrWhiteSpace(accessKey) ||
            string.IsNullOrWhiteSpace(privateCredential))
            throw new InvalidOperationException("Private media storage is not configured.");
        return new AmazonS3Client(new BasicAWSCredentials(accessKey, privateCredential), new AmazonS3Config
        {
            ServiceURL = endpoint,
            ForcePathStyle = true,
            AuthenticationRegion = configuration["MediaStorage:Region"] ?? "garage",
            RequestChecksumCalculation = RequestChecksumCalculation.WHEN_REQUIRED,
        });
    }

}
