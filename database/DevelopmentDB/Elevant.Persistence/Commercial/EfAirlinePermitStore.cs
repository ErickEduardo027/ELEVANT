using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Application.Common;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Permit dossier of each airline (ADR-0024): the airline submits from its portal, Contratos
/// verifies or rejects with a note. A verified, current operating permit is what lets a signed
/// contract become active; verifying one re-evaluates the airline's pending contracts at once.
/// </summary>
internal sealed class EfAirlinePermitStore(ElevantDbContext context, CommercialPermissionGuard permissions,
    TimeProvider timeProvider) : IAirlinePermitStore
{
    private const string ReadPermission = "contracts.permits.read";
    private const string VerifyPermission = "contracts.permits.verify";

    public async Task<IReadOnlyList<AirlinePermitData>?> ListForAirlineAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        if (await AirlinePortalTenant.AirlineIdAsync(context, actorId, cancellationToken) is not { } airline) return null;
        return await ListAsync(context.AirlinePermits.AsNoTracking().Where(item => item.AirlineId == airline), cancellationToken);
    }

    public async Task<IReadOnlyList<AirlinePermitData>?> ListForContractsAsync(Guid actorId, string? review,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAnyAsync(actorId, [ReadPermission], cancellationToken)) return null;
        var query = context.AirlinePermits.AsNoTracking();
        if (review is not null)
        {
            if (!Enum.TryParse<AirlinePermitReview>(review, out var parsed)) return [];
            query = query.Where(item => item.Review == parsed);
        }
        return await ListAsync(query, cancellationToken);
    }

    public async Task<AirlinePermitResult> SubmitAsync(Guid actorId, SubmitAirlinePermitInput input,
        CancellationToken cancellationToken = default)
    {
        if (await AirlinePortalTenant.AirlineIdAsync(context, actorId, cancellationToken) is not { } airline)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Forbidden);
        var today = Today();
        if (input is null || !Enum.TryParse<AirlinePermitKind>(input.Kind, out var kind) || !Enum.IsDefined(kind) ||
            Text(input.Number, 60) is not { } number || Text(input.Issuer, 120) is not { } issuer)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid);
        if (input.IssuedOn > today || input.ExpiresOn < input.IssuedOn)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "permit_dates_invalid");
        if (input.ExpiresOn < today)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "permit_expired");
        var document = string.IsNullOrWhiteSpace(input.DocumentUrl) ? null : input.DocumentUrl.Trim();
        if (document is not null && !await OwnUploadAsync(actorId, document, cancellationToken))
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "document_invalid");

        var now = timeProvider.GetUtcNow();
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        var permit = new AirlinePermit
        {
            PublicId = Guid.CreateVersion7(), AirlineId = airline, Kind = kind, Number = number, Issuer = issuer,
            IssuedOn = input.IssuedOn, ExpiresOn = input.ExpiresOn, DocumentUrl = document,
            Review = AirlinePermitReview.Submitted, SubmittedByAccountId = accountId, CreatedAt = now, UpdatedAt = now,
        };
        context.AirlinePermits.Add(permit);
        var airlineName = await context.Airlines.Where(item => item.Id == airline).Select(item => item.Name)
            .SingleAsync(cancellationToken);
        CommercialAuditWriter.Add(context, accountId, "commercial.permit.submitted", "commercial.airline_permits",
            permit.PublicId, $"{kind} {number}");
        await DepartmentNotificationWriter.NotifyAsync(context, Department.Contracts, ReadPermission,
            "permit_submitted", permit.PublicId, airlineName, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return AirlinePermitResult.Success(Single(await ListAsync(
            context.AirlinePermits.AsNoTracking().Where(item => item.Id == permit.Id), cancellationToken)));
    }

    public async Task<AirlinePermitResult> ReviewAsync(Guid actorId, Guid permitId, ReviewAirlinePermitInput input,
        CancellationToken cancellationToken = default)
    {
        if (!await permissions.HasAnyAsync(actorId, [VerifyPermission], cancellationToken))
            return AirlinePermitResult.Failed(AirlinePermitFailure.Forbidden);
        var note = string.IsNullOrWhiteSpace(input?.Note) ? null : input.Note.Trim();
        if (input is null || note?.Length > 500 || !input.Verified && note is not { Length: >= 5 })
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "review_note_required");
        var permit = await context.AirlinePermits.SingleOrDefaultAsync(item => item.PublicId == permitId, cancellationToken);
        if (permit is null) return AirlinePermitResult.Failed(AirlinePermitFailure.NotFound);
        if (Convert.ToBase64String(permit.RowVersion) != input.ExpectedVersion)
            return AirlinePermitResult.Failed(AirlinePermitFailure.Conflict);
        if (input.Verified && permit.ExpiresOn < Today())
            return AirlinePermitResult.Failed(AirlinePermitFailure.Invalid, "permit_expired");

        var now = timeProvider.GetUtcNow();
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        permit.Review = input.Verified ? AirlinePermitReview.Verified : AirlinePermitReview.Rejected;
        permit.ReviewNote = note;
        permit.ReviewedAt = now;
        permit.ReviewedByAccountId = accountId;
        permit.UpdatedAt = now;
        CommercialAuditWriter.Add(context, accountId, input.Verified ? "commercial.permit.verified" : "commercial.permit.rejected",
            "commercial.airline_permits", permit.PublicId, note);
        foreach (var recipient in await AirlineAccountsAsync(permit.AirlineId, cancellationToken))
            AccountChangeOutboxWriter.Add(context, recipient, null, "airline_contracts", permit.PublicId, now);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
        }
        catch (DbUpdateConcurrencyException)
        {
            return AirlinePermitResult.Failed(AirlinePermitFailure.Conflict);
        }
        // A newly usable operating permit may complete the conditions of a signed contract.
        if (input.Verified && permit.Kind == AirlinePermitKind.OperatingPermit)
            await ContractActivation.ActivateReadyAsync(context, permit.AirlineId, accountId, now, cancellationToken);
        return AirlinePermitResult.Success(Single(await ListAsync(
            context.AirlinePermits.AsNoTracking().Where(item => item.Id == permit.Id), cancellationToken)));
    }

    private async Task<IReadOnlyList<AirlinePermitData>> ListAsync(IQueryable<AirlinePermit> permits,
        CancellationToken cancellationToken)
    {
        var today = Today();
        var rows = await (from permit in permits
                          join airline in context.Airlines.AsNoTracking() on permit.AirlineId equals airline.Id
                          orderby permit.ExpiresOn, permit.Id
                          select new { Permit = permit, AirlinePublicId = airline.PublicId, airline.Name })
            .ToArrayAsync(cancellationToken);
        return rows.Select(row => new AirlinePermitData(row.Permit.PublicId, row.AirlinePublicId, row.Name,
            row.Permit.Kind.ToString(), row.Permit.Number, row.Permit.Issuer, row.Permit.IssuedOn, row.Permit.ExpiresOn,
            ContractLifecycle.Validity(row.Permit.ExpiresOn, today).ToString(), row.Permit.Review.ToString(),
            row.Permit.ReviewNote, row.Permit.DocumentUrl, row.Permit.CreatedAt, row.Permit.ReviewedAt,
            Convert.ToBase64String(row.Permit.RowVersion))).ToArray();
    }

    private async Task<bool> OwnUploadAsync(Guid actorId, string url, CancellationToken cancellationToken)
    {
        const string prefix = "/api/v1/media/";
        if (!url.StartsWith(prefix, StringComparison.Ordinal) || !Guid.TryParse(url[prefix.Length..], out var id)) return false;
        var accountId = await AccountIdAsync(actorId, cancellationToken);
        return await context.MediaAssets.AsNoTracking().AnyAsync(asset => asset.PublicId == id &&
            asset.Purpose == "airline-permit" && asset.UploadedByAccountId == accountId, cancellationToken);
    }

    private Task<long[]> AirlineAccountsAsync(long airlineId, CancellationToken cancellationToken) =>
        (from airline in context.Airlines.AsNoTracking()
         join membership in context.OrganizationMemberships.AsNoTracking() on airline.OrganizationId equals membership.OrganizationId
         where airline.Id == airlineId && membership.Kind == MembershipKind.AirlineClient &&
               membership.Status == MembershipStatus.Active
         select membership.AccountId).Distinct().ToArrayAsync(cancellationToken);

    private Task<long> AccountIdAsync(Guid actorId, CancellationToken cancellationToken) =>
        context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id).SingleAsync(cancellationToken);

    /// <summary>2-F: permits expire by AVIAM's business day (America/Santo_Domingo), not the UTC day.</summary>
    private DateOnly Today() => BusinessCalendar.Today(timeProvider.GetUtcNow());

    private static string? Text(string? value, int max) =>
        value?.Trim() is { Length: > 0 } text && text.Length <= max ? text : null;

    private static AirlinePermitData Single(IReadOnlyList<AirlinePermitData> rows) => rows.Single();
}
