using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;

namespace Elevant.Application.Finance;

public sealed record AirlineInvoiceStatementResult(AirlineInvoiceStatementData? Statement, AirlinePortalFailure? Failure)
{
    public bool IsSuccess => Statement is not null && Failure is null;
    public static AirlineInvoiceStatementResult Success(AirlineInvoiceStatementData statement) => new(statement, null);
    public static AirlineInvoiceStatementResult Failed(AirlinePortalFailure failure) => new(null, failure);
}

/// <summary>Balance, due date, payments, credit notes and charge lines of an invoice, for its own airline.</summary>
public sealed class GetAirlineInvoiceStatementHandler(IActorContextResolver actors, IFinanceInvoiceLedgerStore store)
{
    public async Task<AirlineInvoiceStatementResult> HandleAsync(Guid accountId, Guid invoiceId,
        CancellationToken cancellationToken = default)
    {
        if (invoiceId == Guid.Empty) return AirlineInvoiceStatementResult.Failed(AirlinePortalFailure.NotFound);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        var (organizationId, failure) = AirlinePortalAccess.Resolve(actor, accountId);
        if (failure is not null) return AirlineInvoiceStatementResult.Failed(failure.Value);
        var statement = await store.GetStatementForAirlineAsync(organizationId!.Value, invoiceId, cancellationToken);
        return statement is null
            ? AirlineInvoiceStatementResult.Failed(AirlinePortalFailure.NotFound)
            : AirlineInvoiceStatementResult.Success(statement);
    }
}
