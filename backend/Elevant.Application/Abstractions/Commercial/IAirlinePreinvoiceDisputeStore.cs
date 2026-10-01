using Elevant.Application.Commercial;

namespace Elevant.Application.Abstractions.Commercial;

public interface IAirlinePreinvoiceDisputeStore
{
    Task<DisputeAirlinePreinvoiceResult> DisputeAsync(
        DisputeAirlinePreinvoiceCommand command,
        CancellationToken cancellationToken = default);
}
