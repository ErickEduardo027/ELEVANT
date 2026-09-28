using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed record ResolvePreinvoiceDisputeCommand(
    Guid AccountId, Guid PreinvoiceId, Guid RequestId, string Decision, string Reason);

public enum ResolvePreinvoiceDisputeFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
}

public sealed record ResolvePreinvoiceDisputeResult(
    Guid? ResolutionId, Guid? PreinvoiceId, string? Status, bool Replayed,
    ResolvePreinvoiceDisputeFailure? Failure)
{
    public bool IsSuccess => ResolutionId.HasValue && PreinvoiceId.HasValue &&
        Status is not null && Failure is null;

    public static ResolvePreinvoiceDisputeResult Success(
        Guid resolutionId, Guid preinvoiceId, string status, bool replayed) =>
        new(resolutionId, preinvoiceId, status, replayed, null);

    public static ResolvePreinvoiceDisputeResult Failed(ResolvePreinvoiceDisputeFailure failure) =>
        new(null, null, null, false, failure);
}

public sealed class ResolvePreinvoiceDisputeHandler(
    IActorContextResolver actors, IPreinvoiceDisputeResolutionStore store)
{
    public async Task<ResolvePreinvoiceDisputeResult> HandleAsync(
        ResolvePreinvoiceDisputeCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.AccountId == Guid.Empty)
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.Unauthorized);
        if (command.PreinvoiceId == Guid.Empty || command.RequestId == Guid.Empty ||
            command.Decision is not ("Maintain" or "Void") ||
            string.IsNullOrWhiteSpace(command.Reason) || command.Reason.Trim() != command.Reason ||
            command.Reason.Length > 1000)
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.InvalidRequest);
        var actor = await actors.ResolveAsync(command.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.Unauthorized);
        if (!actor!.Roles.Any(role => role.Code == "FINANZAS" &&
                role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return ResolvePreinvoiceDisputeResult.Failed(
                ResolvePreinvoiceDisputeFailure.Forbidden);
        return await store.ResolveAsync(command, cancellationToken);
    }
}
