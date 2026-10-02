using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface IFinanceInvoiceIssueStore
{
    Task<IssueFinanceInvoiceResult> IssueAsync(
        IssueFinanceInvoiceCommand command, CancellationToken cancellationToken = default);
}
