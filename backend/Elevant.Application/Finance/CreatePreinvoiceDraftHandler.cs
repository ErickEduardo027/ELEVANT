using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed record CreatePreinvoiceDraftCommand(
    Guid AccountId, Guid StationId, DateOnly From, DateOnly To,
    Guid RequestId, IReadOnlyList<Guid> ServiceIds);

public enum PreinvoiceDraftFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
    Unprocessable,
}

public sealed record PreinvoiceDraftResult(
    Guid? DraftId, bool Replayed, PreinvoiceDraftFailure? Failure, string? Reason)
{
    public bool IsSuccess => DraftId.HasValue && Failure is null;
    public static PreinvoiceDraftResult Success(Guid draftId, bool replayed) =>
        new(draftId, replayed, null, null);
    public static PreinvoiceDraftResult Failed(PreinvoiceDraftFailure failure, string? reason = null) =>
        new(null, false, failure, reason);
}

public sealed class CreatePreinvoiceDraftHandler(
    IActorContextResolver actorContextResolver,
    IPreinvoiceDraftStore store)
{
    public async Task<PreinvoiceDraftResult> HandleAsync(
        CreatePreinvoiceDraftCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        if (command.AccountId == Guid.Empty)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unauthorized);
        if (command.StationId == Guid.Empty || command.RequestId == Guid.Empty ||
            !FinanceApprovedServicePolicy.IsValidWindow(command.From, command.To) ||
            command.ServiceIds is null or { Count: < 1 or > 100 } ||
            command.ServiceIds.Any(id => id == Guid.Empty) ||
            command.ServiceIds.Distinct().Count() != command.ServiceIds.Count)
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.InvalidRequest);

        var actor = await actorContextResolver.ResolveAsync(command.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Unauthorized);
        if (!actor!.HasPermission("finance.approved_services.create") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Forbidden);
        if (!actor.StationScopes.Any(scope => scope.StationId == command.StationId))
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.NotFound);

        return await store.CreateAsync(command, cancellationToken);
    }
}
