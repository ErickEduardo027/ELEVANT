using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;

namespace Elevant.UnitTests.Application;

public sealed class SubmitCommercialRequestHandlerTests
{
    [Fact]
    public async Task AdditionalRequestRequiresActorAndValidServices()
    {
        var store = new RecordingStore();
        var command = new SubmitAdditionalServiceRequestCommand(Guid.NewGuid(),
            [Guid.NewGuid()], "María Pérez", "Representante legal",
            "maria@example.test", "+1 809 555 0100", true);
        var handler = new SubmitCommercialRequestHandler(store);

        Assert.Equal(CommercialSubmissionFailure.InvalidRequest,
            (await handler.HandleAdditionalAsync(Guid.Empty, command,
                TestContext.Current.CancellationToken)).Failure);
        Assert.Equal(CommercialSubmissionFailure.InvalidRequest,
            (await handler.HandleAdditionalAsync(Guid.NewGuid(),
                command with { ServiceIds = [] },
                TestContext.Current.CancellationToken)).Failure);
        Assert.True((await handler.HandleAdditionalAsync(Guid.NewGuid(), command,
            TestContext.Current.CancellationToken)).IsSuccess);
        Assert.True((await handler.HandleAdditionalAsync(Guid.NewGuid(), command with
        {
            ServiceIds = [], PackageVersionIds = [Guid.NewGuid()],
        }, TestContext.Current.CancellationToken)).IsSuccess);
    }
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
    public async Task AcceptsPackageOnlyRequestAndForwardsVersionIds()
    {
        var store = new RecordingStore();
        var packageId = Guid.NewGuid();
        var command = ValidCommand() with
        {
            ServiceIds = [], PackageVersionIds = [packageId],
        };

        var result = await new SubmitCommercialRequestHandler(store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(command with { RepresentativePhone = "+18095550100" }, store.Written);
    }

    [Fact]
    public async Task RejectsDuplicatePackageVersionsBeforeWriting()
    {
        var store = new RecordingStore();
        var packageId = Guid.NewGuid();
        var command = ValidCommand() with { PackageVersionIds = [packageId, packageId] };

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
        Assert.Equal(command with { RepresentativePhone = "+18095550100" }, store.Written);
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
        Assert.Equal(command with { RepresentativePhone = "+18095550100" }, store.LookedUp);
        Assert.Equal(CommercialSubmissionFailure.InvalidRequest,
            (await handler.LookupReceiptAsync(command with { AuthorityDeclared = false },
                TestContext.Current.CancellationToken)).Failure);
        Assert.Equal(command with { RepresentativePhone = "+18095550100" }, store.LookedUp);
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
            RepresentativeDocumentNumber = "rd 123 4567",
        };

        var result = await new SubmitCommercialRequestHandler(store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(command with
        {
            RepresentativePhone = "+18095550100",
            RepresentativeDocumentNumber = "RD1234567",
        }, store.Written);
    }

    [Theory]
    [InlineData("849-246-3371", "+18492463371")]
    [InlineData("8492463371", "+18492463371")]
    [InlineData("1 (849) 246-3371", "+18492463371")]
    [InlineData("+34 600 123 456", "+34600123456")]
    public async Task AcceptsDominicanPhonesWithoutThePlusSignAndStoresThemInternationally(string phone, string stored)
    {
        var store = new RecordingStore();
        var result = await new SubmitCommercialRequestHandler(store)
            .HandleAsync(ValidCommand() with { RepresentativePhone = phone }, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(stored, store.Written!.RepresentativePhone);
    }

    [Theory]
    [InlineData("Passport", "5050505050RD", "DO")]
    [InlineData("Passport", "AAAAAA", "ES")]
    [InlineData("NationalId", "001-1234567-8", null)]
    [InlineData("NationalId", "ABC123", null)]
    public async Task RejectsDocumentsThatDoNotMatchTheirRealFormat(string type, string number, string? nationality)
    {
        var store = new RecordingStore();
        var result = await new SubmitCommercialRequestHandler(store).HandleAsync(ValidCommand() with
        {
            RepresentativeDocumentType = type,
            RepresentativeDocumentNumber = number,
            RepresentativeNationalityCode = nationality,
        }, TestContext.Current.CancellationToken);

        Assert.Equal(CommercialSubmissionFailure.InvalidRequest, result.Failure);
        Assert.Null(store.Written);
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

        public Task<CommercialSubmissionResult> SubmitAdditionalAsync(Guid actorId,
            SubmitAdditionalServiceRequestCommand command,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(CommercialSubmissionResult.Success("REQ-2026-0002", false));

        public Task<IReadOnlyList<AirlineCommercialRequestData>?> ListOwnAsync(Guid actorId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<AirlineCommercialRequestData>?>([]);

        public Task<string?> LookupReceiptAsync(SubmitCommercialRequestCommand command,
            CancellationToken cancellationToken = default)
        {
            LookedUp = command;
            return Task.FromResult<string?>(null);
        }
    }
}
