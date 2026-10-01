using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface IPreinvoiceDisputeResolutionStore
{
    Task<ResolvePreinvoiceDisputeResult> ResolveAsync(
        ResolvePreinvoiceDisputeCommand command,
        CancellationToken cancellationToken = default);
}
