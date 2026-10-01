using Elevant.Application.Finance;

namespace Elevant.Application.Abstractions.Finance;

public interface INonFiscalPaymentStore
{
    Task<RecordNonFiscalPaymentResult> RecordAsync(
        RecordNonFiscalPaymentCommand command, CancellationToken cancellationToken = default);
}
