using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed record AirlinePaymentResult(
    NonFiscalPaymentLookupData? Lookup, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Lookup is not null && Failure is null;
    public static AirlinePaymentResult Success(NonFiscalPaymentLookupData lookup) =>
        new(lookup, null);
    public static AirlinePaymentResult Failed(AirlinePortalFailure failure) =>
        new(null, failure);
}

public sealed class GetNonFiscalPaymentHandler(
    IActorContextResolver actors, INonFiscalPaymentReadStore store)
{
    public async Task<NonFiscalPaymentLookupData?> GetForFinanceAsync(
        Guid accountId, Guid invoiceId, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || invoiceId == Guid.Empty) return null;
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId) ||
            !actor!.HasPermission("finance.reconciliation.read") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;
        var lookup = await store.GetForFinanceAsync(accountId, invoiceId, cancellationToken);
        return lookup;
    }

    public async Task<AirlinePaymentResult> GetForAirlineAsync(
        Guid accountId, Guid invoiceId, CancellationToken cancellationToken = default)
    {
        if (invoiceId == Guid.Empty)
            return AirlinePaymentResult.Failed(AirlinePortalFailure.NotFound);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null) return AirlinePaymentResult.Failed(failure.Value);
        var lookup = await store.GetForAirlineAsync(
            organizationId!.Value, invoiceId, cancellationToken);
        return lookup is null
            ? AirlinePaymentResult.Failed(AirlinePortalFailure.NotFound)
            : AirlinePaymentResult.Success(lookup);
    }
}
