namespace Elevant.Application.Finance;

/// <summary>
/// 4-N07: Finance closes approved operations whose valuation is zero without an invoice (no e-NCF is used and no
/// email is sent). The Idempotency-Key replays the first result; each operation carries the version Finance saw.
/// </summary>
public sealed record NoChargeClosureCommand(Guid AccountId, Guid StationId,
    IReadOnlyList<InvoiceOperationVersion> Operations, string Reason, Guid IdempotencyKey);

/// <summary>The closure (the internal draft kept as NoCharge) and the operations it closed.</summary>
public sealed record NoChargeClosureData(Guid ClosureId, IReadOnlyList<Guid> OperationIds);

public sealed record NoChargeClosureResult(NoChargeClosureData? Closure, bool Replayed, IssueInvoiceFailure? Failure,
    string? Code)
{
    public bool IsSuccess => Closure is not null && Failure is null;

    public static NoChargeClosureResult Success(NoChargeClosureData closure, bool replayed) =>
        new(closure, replayed, null, null);

    public static NoChargeClosureResult Failed(IssueInvoiceFailure failure, string code) => new(null, false, failure, code);
}

/// <summary>
/// Validates the closure before the store: a key, one to 100 operations with their version, and a reason of 5 to 500
/// characters. «Emitir facturas» in the station is required, as for an invoice.
/// </summary>
public sealed class CloseOperationsWithoutChargeHandler(
    Abstractions.Identity.IActorContextResolver actors, IInvoiceIssuanceStore store)
{
    public const int MinReasonLength = 5;
    public const int MaxReasonLength = 500;

    public async Task<NoChargeClosureResult> HandleAsync(NoChargeClosureCommand request,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        if (request.AccountId == Guid.Empty)
            return NoChargeClosureResult.Failed(IssueInvoiceFailure.Unauthorized, "unauthorized");
        if (request.IdempotencyKey == Guid.Empty)
            return NoChargeClosureResult.Failed(IssueInvoiceFailure.InvalidRequest, InvoicingCodes.IdempotencyKeyRequired);
        if (request.StationId == Guid.Empty || request.Operations is not { Count: > 0 } ||
            request.Operations.Any(item => item is null || item.OperationId == Guid.Empty) ||
            request.Operations.Select(item => item.OperationId).Distinct().Count() != request.Operations.Count)
            return NoChargeClosureResult.Failed(IssueInvoiceFailure.InvalidRequest, InvoicingCodes.InvalidRequest);
        if (request.Operations.Count > FinanceInvoicePolicy.MaxOperations)
            return NoChargeClosureResult.Failed(IssueInvoiceFailure.InvalidRequest, InvoicingCodes.TooManyOperations);
        if (request.Operations.Any(item => string.IsNullOrWhiteSpace(item.Version) || item.Version.Length > 64))
            return NoChargeClosureResult.Failed(IssueInvoiceFailure.InvalidRequest, InvoicingCodes.ExpectedVersionRequired);
        var reason = request.Reason?.Trim() ?? string.Empty;
        if (reason.Length is < MinReasonLength or > MaxReasonLength)
            return NoChargeClosureResult.Failed(IssueInvoiceFailure.InvalidRequest, InvoicingCodes.ReasonRequired);

        var actor = await actors.ResolveAsync(request.AccountId, cancellationToken);
        if (!Identity.ActorContextValidator.IsValid(actor, request.AccountId))
            return NoChargeClosureResult.Failed(IssueInvoiceFailure.Unauthorized, "unauthorized");
        if (!actor!.HasPermission(IssueInvoiceHandler.IssuePermission) ||
            !actor.StationScopes.Any(scope => scope.StationId == request.StationId))
            return NoChargeClosureResult.Failed(IssueInvoiceFailure.Forbidden, InvoicingCodes.Forbidden);
        return await store.CloseWithoutChargeAsync(request with { Reason = reason }, cancellationToken);
    }
}
