using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

/// <summary>A null amount pays the remaining balance; partial payments never exceed it.</summary>
public sealed record RecordNonFiscalPaymentCommand(
    Guid AccountId, Guid InvoiceId, Guid RequestId, string Reference,
    decimal? Amount = null, PaymentMethod Method = PaymentMethod.Transfer, DateOnly? PaidOn = null);

public enum RecordNonFiscalPaymentFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
}

public sealed record RecordNonFiscalPaymentResult(
    Guid? PaymentId, string? Reference, decimal? Amount, string? CurrencyCode,
    bool Replayed, RecordNonFiscalPaymentFailure? Failure)
{
    public bool IsSuccess => PaymentId.HasValue && Reference is not null &&
        Amount.HasValue && CurrencyCode is not null && Failure is null;

    public static RecordNonFiscalPaymentResult Success(
        Guid id, string reference, decimal amount, string currencyCode, bool replayed) =>
        new(id, reference, amount, currencyCode, replayed, null);

    public static RecordNonFiscalPaymentResult Failed(RecordNonFiscalPaymentFailure failure) =>
        new(null, null, null, null, false, failure);
}

public sealed class RecordNonFiscalPaymentHandler(
    IActorContextResolver actors, INonFiscalPaymentStore store)
{
    public Task<RecordNonFiscalPaymentResult> HandleAsync(
        Guid accountId, Guid invoiceId, Guid requestId, string? reference,
        CancellationToken cancellationToken = default) =>
        HandleAsync(accountId, invoiceId, requestId, reference, null, PaymentMethod.Transfer, null, cancellationToken);

    public async Task<RecordNonFiscalPaymentResult> HandleAsync(
        Guid accountId, Guid invoiceId, Guid requestId, string? reference, decimal? amount,
        PaymentMethod method, DateOnly? paidOn, CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty)
            return RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.Unauthorized);
        if (invoiceId == Guid.Empty || requestId == Guid.Empty ||
            !ValidReference(reference) || amount is <= 0 or > 900_000_000_000m ||
            amount is { } value && decimal.Round(value, 4) != value || !Enum.IsDefined(method) ||
            paidOn is { } date && date > DateOnly.FromDateTime(DateTime.UtcNow.AddDays(1)))
            return RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.InvalidRequest);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
            return RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.Unauthorized);
        if (!actor!.HasPermission("finance.reconciliation.create") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return RecordNonFiscalPaymentResult.Failed(RecordNonFiscalPaymentFailure.Forbidden);
        return await store.RecordAsync(new RecordNonFiscalPaymentCommand(
            accountId, invoiceId, requestId, reference!, amount, method, paidOn), cancellationToken);
    }

    private static bool ValidReference(string? reference) =>
        reference is { Length: >= 8 and <= 80 } && reference.All(character =>
            character is >= 'A' and <= 'Z' or >= 'a' and <= 'z' or
                >= '0' and <= '9' or '-');
}
