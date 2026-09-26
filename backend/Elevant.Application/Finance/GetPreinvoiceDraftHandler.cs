using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed record PreinvoiceDraftLineDetail(
    Guid Id, Guid OperationServiceId, Guid ApprovedSubmissionId,
    int LineNumber, string OperationCode, DateOnly OperationDate,
    string ServiceCode, string ServiceName, decimal ExecutedQuantity,
    string BillingUnit, decimal UnitPrice, string CurrencyCode, decimal Amount);

public sealed record PreinvoiceDraftDetail(
    Guid Id, Guid AirlineId, string AirlineName, Guid StationId,
    DateOnly From, DateOnly To, string CurrencyCode,
    decimal Total, string Status, IReadOnlyList<PreinvoiceDraftLineDetail> Lines);

public sealed class GetPreinvoiceDraftHandler(
    IActorContextResolver actors, IPreinvoiceDraftStore store)
{
    public async Task<PreinvoiceDraftDetail?> HandleAsync(
        Guid accountId, Guid draftId, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || draftId == Guid.Empty) return null;
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId) ||
            !actor!.Roles.Any(role => role.Code == "FINANZAS" && role.Portal == PortalKind.BackOffice) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return null;
        var detail = await store.GetAsync(accountId, draftId, cancellationToken);
        return detail is not null && actor.StationScopes.Any(scope => scope.StationId == detail.StationId)
            ? detail : null;
    }
}
