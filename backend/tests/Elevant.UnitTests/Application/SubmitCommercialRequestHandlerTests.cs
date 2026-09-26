using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;

namespace Elevant.UnitTests.Application;

public sealed class SubmitCommercialRequestHandlerTests
{
    [Fact]
    public async Task RejectsDuplicateServicesBeforeWriting()
    {
        var serviceId = Guid.NewGuid();
        var store = new RecordingStore();
        var command = ValidCommand() with { ServiceIds = [serviceId, serviceId] };

        var result = await new SubmitCommercialRequestHandler(store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.Equal(CommercialSubmissionFailure.InvalidRequest, result.Failure);
        Assert.Null(store.Written);
    }

    [Fact]
    public async Task RequiresRepresentativeAuthorityDeclaration()
    {
        var store = new RecordingStore();
        var command = ValidCommand() with { AuthorityDeclared = false };

        var result = await new SubmitCommercialRequestHandler(store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.Equal(CommercialSubmissionFailure.InvalidRequest, result.Failure);
        Assert.Null(store.Written);
    }

    [Fact]
    public async Task SendsValidApplicationWithTheSelectedAirlineAndServices()
    {
        var store = new RecordingStore();
        var command = ValidCommand();

        var result = await new SubmitCommercialRequestHandler(store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(command, store.Written);
        Assert.Equal("REQ-2026-0001", result.Reference);
    }

    private static SubmitCommercialRequestCommand ValidCommand() => new(
        Guid.NewGuid(), Guid.NewGuid(), [Guid.NewGuid()],
        "María Pérez", "Representante legal", "maria@example.test", "+1 809 555 0100", true);

    private sealed class RecordingStore : ICommercialIntakeStore
    {
        public SubmitCommercialRequestCommand? Written { get; private set; }

        public Task<CommercialSubmissionResult> SubmitAsync(
            SubmitCommercialRequestCommand command, CancellationToken cancellationToken = default)
        {
            Written = command;
            return Task.FromResult(CommercialSubmissionResult.Success("REQ-2026-0001", false));
        }
    }
}
