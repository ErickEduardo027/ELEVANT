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

    [Fact]
    public async Task ReceiptLookupDoesNotSubmitAndRequiresValidOriginalPayload()
    {
        var store = new RecordingStore();
        var handler = new SubmitCommercialRequestHandler(store);
        var command = ValidCommand();

        Assert.Equal(CommercialSubmissionFailure.ReceiptNotFound,
            (await handler.LookupReceiptAsync(command, TestContext.Current.CancellationToken)).Failure);
        Assert.Null(store.Written);
        Assert.Equal(command, store.LookedUp);
        Assert.Equal(CommercialSubmissionFailure.InvalidRequest,
            (await handler.LookupReceiptAsync(command with { AuthorityDeclared = false },
                TestContext.Current.CancellationToken)).Failure);
        Assert.Equal(command, store.LookedUp);
    }

    [Theory]
    [InlineData("Passport", null)]
    [InlineData(null, "AB123456")]
    public async Task RequiresDocumentTypeAndNumberTogether(string? type, string? number)
    {
        var store = new RecordingStore();
        var command = ValidCommand() with
        {
            RepresentativeDocumentType = type,
            RepresentativeDocumentNumber = number,
        };

        var result = await new SubmitCommercialRequestHandler(store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.Equal(CommercialSubmissionFailure.InvalidRequest, result.Failure);
        Assert.Null(store.Written);
    }

    [Fact]
    public async Task PreservesValidOptionalRepresentativeDetails()
    {
        var store = new RecordingStore();
        var command = ValidCommand() with
        {
            RepresentativeNationalityCode = "DO",
            RepresentativeAddress = "Avenida Principal 10",
            RepresentativeCountry = "República Dominicana",
            RepresentativeProvince = "Santo Domingo",
            RepresentativeMunicipality = "Boca Chica",
            RepresentativeDocumentType = "Passport",
            RepresentativeDocumentNumber = "AB123456",
        };

        var result = await new SubmitCommercialRequestHandler(store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(command, store.Written);
    }

    private static SubmitCommercialRequestCommand ValidCommand() => new(
        Guid.NewGuid(), Guid.NewGuid(), [Guid.NewGuid()],
        "María Pérez", "Representante legal", "maria@example.test", "+1 809 555 0100", true);

    private sealed class RecordingStore : ICommercialIntakeStore
    {
        public SubmitCommercialRequestCommand? Written { get; private set; }
        public SubmitCommercialRequestCommand? LookedUp { get; private set; }

        public Task<CommercialSubmissionResult> SubmitAsync(
            SubmitCommercialRequestCommand command, CancellationToken cancellationToken = default)
        {
            Written = command;
            return Task.FromResult(CommercialSubmissionResult.Success("REQ-2026-0001", false));
        }

        public Task<string?> LookupReceiptAsync(SubmitCommercialRequestCommand command,
            CancellationToken cancellationToken = default)
        {
            LookedUp = command;
            return Task.FromResult<string?>(null);
        }
    }
}
