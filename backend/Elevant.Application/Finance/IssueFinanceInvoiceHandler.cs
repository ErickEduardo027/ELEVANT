using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

public sealed record IssueFinanceInvoiceCommand(Guid AccountId, Guid PreinvoiceId, Guid RequestId);

public enum IssueFinanceInvoiceFailure
{
    Unauthorized,
    Forbidden,
    InvalidRequest,
    NotFound,
    Conflict,
}

public sealed record IssueFinanceInvoiceResult(
    Guid? InvoiceId, string? Number, bool Replayed, IssueFinanceInvoiceFailure? Failure)
{
    public bool IsSuccess => InvoiceId.HasValue && Number is not null && Failure is null;
    public static IssueFinanceInvoiceResult Success(Guid id, string number, bool replayed) =>
        new(id, number, replayed, null);
    public static IssueFinanceInvoiceResult Failed(IssueFinanceInvoiceFailure failure) =>
        new(null, null, false, failure);
}

public sealed class IssueFinanceInvoiceHandler(
    IActorContextResolver actors, IFinanceInvoiceIssueStore store)
{
    public async Task<IssueFinanceInvoiceResult> HandleAsync(
        Guid accountId, Guid preinvoiceId, Guid requestId,
        CancellationToken cancellationToken = default)
    {
        if (accountId == Guid.Empty)
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Unauthorized);
        if (preinvoiceId == Guid.Empty || requestId == Guid.Empty)
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.InvalidRequest);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId))
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Unauthorized);
        if (!actor!.HasPermission("finance.preinvoices.issue") ||
            !actor.Memberships.Any(membership =>
                membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff))
            return IssueFinanceInvoiceResult.Failed(IssueFinanceInvoiceFailure.Forbidden);
        return await store.IssueAsync(new IssueFinanceInvoiceCommand(
            accountId, preinvoiceId, requestId), cancellationToken);
    }
}
