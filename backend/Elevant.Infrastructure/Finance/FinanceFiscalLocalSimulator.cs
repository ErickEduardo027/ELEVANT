using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Enumerations;
namespace Elevant.Infrastructure.Finance;

/// <summary>Pure deterministic local simulation. No transport, certificate, official numbering or QR.</summary>
public sealed class FinanceFiscalLocalSimulator : IFiscalProvider
{
    public Task<FiscalProviderReply> SubmitAsync(FiscalProviderRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        cancellationToken.ThrowIfCancellationRequested();
        if (request.Environment is not ("Development" or "Test") || !Enum.IsDefined(request.Outcome))
            throw new ArgumentException("Simulation requires Development or Test and a known outcome.");
        var state = request.Outcome switch
        {
            FiscalSimulationOutcome.Accepted => FiscalState.Accepted,
            FiscalSimulationOutcome.Rejected => FiscalState.Rejected,
            FiscalSimulationOutcome.Conditional => FiscalState.Conditional,
            FiscalSimulationOutcome.Pending => FiscalState.Pending,
            _ => FiscalState.Unknown,
        };
        var providerId = $"SIM-{request.DocumentId:N}";
        var bytes = Encoding.UTF8.GetBytes(JsonSerializer.Serialize(new
        {
            disclaimer = FinanceFiscalPolicy.Disclaimer, documentId = request.DocumentId,
            environment = request.Environment, providerDocumentId = providerId, state = state.ToString(),
            outcome = request.Outcome.ToString(), sequence = 1, dgiiResponseId = (string?)null, encf = (string?)null,
        }));
        return Task.FromResult(new FiscalProviderReply(state, providerId, null, null, 1, bytes));
    }
}
public sealed class FinanceFiscalRejectCallbacks : IFiscalCallbackAuthenticator
{
    public Task<FiscalAuthenticatedCallback?> AuthenticateAsync(string environment, string credential, byte[] bytes,
        CancellationToken cancellationToken = default) => Task.FromResult<FiscalAuthenticatedCallback?>(null);
}
