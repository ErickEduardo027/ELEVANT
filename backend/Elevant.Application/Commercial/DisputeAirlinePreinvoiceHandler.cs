using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Commercial;

public sealed record DisputeAirlinePreinvoiceCommand(
    Guid AccountId, Guid OrganizationId, Guid PreinvoiceId, Guid RequestId,
    string Subject, string Description, IReadOnlyList<Guid> LineIds, string PayloadHash);

public enum DisputeAirlinePreinvoiceFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
}

public sealed record DisputeAirlinePreinvoiceResult(
    Guid? PreinvoiceId, Guid? DisputeId, bool Replayed,
    DisputeAirlinePreinvoiceFailure? Failure)
{
    public bool IsSuccess => PreinvoiceId.HasValue && DisputeId.HasValue && Failure is null;
    public static DisputeAirlinePreinvoiceResult Success(Guid id, Guid disputeId, bool replayed) =>
        new(id, disputeId, replayed, null);
    public static DisputeAirlinePreinvoiceResult Failed(DisputeAirlinePreinvoiceFailure failure) =>
        new(null, null, false, failure);
}

public sealed class DisputeAirlinePreinvoiceHandler(
    IActorContextResolver actors, IAirlinePreinvoiceDisputeStore store)
{
    public async Task<DisputeAirlinePreinvoiceResult> HandleAsync(
        Guid accountId, Guid preinvoiceId, Guid requestId,
        string? subject, string? description, IReadOnlyList<Guid>? lineIds,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty)
            return DisputeAirlinePreinvoiceResult.Failed(
                DisputeAirlinePreinvoiceFailure.Unauthorized);
        var normalizedSubject = subject?.Trim() ?? string.Empty;
        var normalizedDescription = description?.Trim() ?? string.Empty;
        if (preinvoiceId == Guid.Empty || requestId == Guid.Empty ||
            normalizedSubject.Length is < 1 or > 160 ||
            normalizedDescription.Length is < 1 or > 1000 ||
            lineIds is null || lineIds.Count is < 1 or > 50 ||
            lineIds.Any(id => id == Guid.Empty) || lineIds.Distinct().Count() != lineIds.Count)
            return DisputeAirlinePreinvoiceResult.Failed(
                DisputeAirlinePreinvoiceFailure.InvalidRequest);

        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null)
            return DisputeAirlinePreinvoiceResult.Failed(failure.Value switch
            {
                AirlinePortalFailure.Unauthorized => DisputeAirlinePreinvoiceFailure.Unauthorized,
                _ => DisputeAirlinePreinvoiceFailure.Forbidden,
            });

        var canonicalLines = lineIds.OrderBy(id => id).ToArray();
        var payload = JsonSerializer.Serialize(new
        {
            subject = normalizedSubject, description = normalizedDescription,
            lineIds = canonicalLines,
        });
        var hash = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(payload)));
        return await store.DisputeAsync(new DisputeAirlinePreinvoiceCommand(
            accountId, organizationId!.Value, preinvoiceId, requestId,
            normalizedSubject, normalizedDescription, canonicalLines, hash), cancellationToken);
    }
}
