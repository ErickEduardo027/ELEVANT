using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed record AirlineInvoiceResult(
    NonFiscalInvoiceData? Invoice, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Invoice is not null && Failure is null;
    public static AirlineInvoiceResult Success(NonFiscalInvoiceData invoice) => new(invoice, null);
    public static AirlineInvoiceResult Failed(AirlinePortalFailure failure) => new(null, failure);
}

public sealed class GetNonFiscalInvoiceHandler(
    IActorContextResolver actors, INonFiscalInvoiceReadStore store)
{
    public async Task<NonFiscalInvoiceData?> GetForFinanceAsync(
        Guid accountId, Guid preinvoiceId, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty || preinvoiceId == Guid.Empty) return null;
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        // 4-N02: «Por facturar» opens the invoice it just issued; «Facturas» reads every invoice.
        if (!ActorContextValidator.IsValid(actor, accountId) ||
            !FinanceInvoicePolicy.CanReadInvoice(actor!) ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff)) return null;
        var invoice = await store.GetForFinanceAsync(accountId, preinvoiceId, cancellationToken);
        return invoice is not null && actor.StationScopes.Any(scope => scope.StationId == invoice.StationId)
            ? invoice : null;
    }

    public async Task<AirlineInvoiceResult> GetForAirlineAsync(
        Guid accountId, Guid preinvoiceId, CancellationToken cancellationToken = default)
    {
        if (preinvoiceId == Guid.Empty)
            return AirlineInvoiceResult.Failed(AirlinePortalFailure.NotFound);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null) return AirlineInvoiceResult.Failed(failure.Value);
        var invoice = await store.GetForAirlineAsync(
            organizationId!.Value, preinvoiceId, cancellationToken);
        return invoice is null
            ? AirlineInvoiceResult.Failed(AirlinePortalFailure.NotFound)
            : AirlineInvoiceResult.Success(invoice);
    }
}
