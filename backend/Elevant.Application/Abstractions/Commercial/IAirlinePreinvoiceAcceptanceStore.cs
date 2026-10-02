using Elevant.Application.Commercial;

namespace Elevant.Application.Abstractions.Commercial;

public interface IAirlinePreinvoiceAcceptanceStore
{
    Task<AcceptAirlinePreinvoiceResult> AcceptAsync(
        AcceptAirlinePreinvoiceCommand command,
        CancellationToken cancellationToken = default);
}
