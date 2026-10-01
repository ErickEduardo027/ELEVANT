using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed record SubmitPreinvoiceCommand(Guid AccountId, Guid PreinvoiceId, Guid RequestId);

public enum SubmitPreinvoiceFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
}

public sealed record SubmitPreinvoiceResult(
    Guid? PreinvoiceId, bool Replayed, SubmitPreinvoiceFailure? Failure)
{
    public bool IsSuccess => PreinvoiceId.HasValue && Failure is null;
    public static SubmitPreinvoiceResult Success(Guid id, bool replayed) =>
        new(id, replayed, null);
    public static SubmitPreinvoiceResult Failed(SubmitPreinvoiceFailure failure) =>
        new(null, false, failure);
}

public sealed class SubmitPreinvoiceHandler(
    IActorContextResolver actors, IPreinvoiceSubmissionStore store)
{
    public async Task<SubmitPreinvoiceResult> HandleAsync(
        SubmitPreinvoiceCommand command, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (command.AccountId == Guid.Empty)
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Unauthorized);
        if (command.PreinvoiceId == Guid.Empty || command.RequestId == Guid.Empty)
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.InvalidRequest);
        var actor = await actors.ResolveAsync(command.AccountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, command.AccountId))
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Unauthorized);
        if (!actor!.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return SubmitPreinvoiceResult.Failed(SubmitPreinvoiceFailure.Forbidden);
        return await store.SubmitAsync(command, cancellationToken);
    }
}
