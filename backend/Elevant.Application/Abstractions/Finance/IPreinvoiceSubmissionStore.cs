using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface IPreinvoiceSubmissionStore
{
    Task<SubmitPreinvoiceResult> SubmitAsync(
        SubmitPreinvoiceCommand command,
        CancellationToken cancellationToken = default);
}
