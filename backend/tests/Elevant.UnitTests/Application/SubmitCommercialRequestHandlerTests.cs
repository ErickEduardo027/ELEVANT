using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Domain.Validation;

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
        Assert.Equal(command with { RepresentativePhone = "+18095550100" }, store.Written);
        Assert.Equal("REQ-2026-0001", result.Reference);
    }

    [Theory]
    [InlineData(null, null)]
    [InlineData("Other", "LIC-12345")]
    public async Task RequiresACedulaOrPassportAndNoLongerAcceptsOther(string? type, string? number)
    {
        var store = new RecordingStore();
        var result = await new SubmitCommercialRequestHandler(store).HandleAsync(ValidCommand() with
        {
            RepresentativeDocumentType = type,
            RepresentativeDocumentNumber = number,
        }, TestContext.Current.CancellationToken);

        Assert.Equal(CommercialSubmissionFailure.InvalidRequest, result.Failure);
        Assert.Null(store.Written);
    }

    [Theory]
    [InlineData("Passport", "RD1234567", null)]
    [InlineData("NationalId", "00112345673", "ES")]
    public async Task APassportNeedsItsNationalityAndACedulaIsDominican(string type, string number, string? nationality)
    {
        var store = new RecordingStore();
        var result = await new SubmitCommercialRequestHandler(store).HandleAsync(ValidCommand() with
        {
            RepresentativeDocumentType = type,
            RepresentativeDocumentNumber = number,
            RepresentativeNationalityCode = nationality,
        }, TestContext.Current.CancellationToken);

        Assert.Equal(CommercialSubmissionFailure.InvalidRequest, result.Failure);
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
    [InlineData("Passport", "AB1234567", "DO")]
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

    [Fact]
    public async Task AnAirlineOutsideTheCatalogIsProposedWithItsIcaoCodeAndNoIata()
    {
        var store = new RecordingStore();
        var command = ValidCommand() with
        {
            AirlineProfileId = Guid.Empty,
            ProposedAirline = new CommercialAirlineProposal("  Caribe Cargo Express ", "do", " ", "ccx",
                " https://caribecargo.example.com/ "),
        };

        var result = await new SubmitCommercialRequestHandler(store)
            .HandleAsync(command, TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Equal(new CommercialAirlineProposal("Caribe Cargo Express", "DO", null, "CCX",
            "https://caribecargo.example.com/"), store.Written!.ProposedAirline);
        Assert.Equal(Guid.Empty, store.Written.AirlineProfileId);
    }

    [Theory]
    [InlineData(true, "Caribe Cargo", "DO", null, "CCX", null)]
    [InlineData(false, "Caribe Cargo", "DO", null, "CC", null)]
    [InlineData(false, "Caribe Cargo", "DO", "ZZ", "CCX", null)]
    [InlineData(false, "Caribe Cargo", "D", null, "CCX", null)]
    [InlineData(false, "C", "DO", null, "CCX", null)]
    [InlineData(false, "Caribe Cargo", "DO", null, "CCX", "http://caribecargo.example.com")]
    [InlineData(false, "Caribe Cargo", "DO", null, "CCX", "https://user:secret@caribecargo.example.com")]
    public async Task AProposalNeedsAValidIcaoCountryAndHttpsSiteAndNeverACatalogProfileToo(bool withProfile,
        string name, string country, string? iata, string icao, string? website)
    {
        var store = new RecordingStore();
        var result = await new SubmitCommercialRequestHandler(store).HandleAsync(ValidCommand() with
        {
            AirlineProfileId = withProfile ? Guid.NewGuid() : Guid.Empty,
            ProposedAirline = new CommercialAirlineProposal(name, country, iata, icao, website),
        }, TestContext.Current.CancellationToken);

        Assert.Equal(CommercialSubmissionFailure.InvalidRequest, result.Failure);
        Assert.Null(store.Written);
    }

    [Fact]
    public async Task WithoutAProfileTheApplicationMustProposeTheAirline()
    {
        var store = new RecordingStore();
        var result = await new SubmitCommercialRequestHandler(store).HandleAsync(
            ValidCommand() with { AirlineProfileId = Guid.Empty }, TestContext.Current.CancellationToken);

        Assert.Equal(CommercialSubmissionFailure.InvalidRequest, result.Failure);
        Assert.Null(store.Written);
    }

    private static SubmitCommercialRequestCommand ValidCommand() => new(
        Guid.NewGuid(), Guid.NewGuid(), [Guid.NewGuid()],
        "María Pérez", "Representante legal", "maria@example.test", "+1 809 555 0100", true,
        RepresentativeDocumentType: "NationalId", RepresentativeDocumentNumber: "00112345673",
        TaxRegistration: "131234569", TaxRegistrationCountryCode: "DO");

    [Fact]
    public async Task TheTaxIdentifierIsRequiredAndADominicanAirlineGivesAValidRnc()
    {
        foreach (var (tax, country) in new[] { ((string?)null, (string?)null), ("131234569", (string?)null),
                     ("131234568", "DO"), ("12", "US"), (new string('9', 33), "US") })
        {
            var store = new RecordingStore();
            var result = await new SubmitCommercialRequestHandler(store).HandleAsync(ValidCommand() with
                { TaxRegistration = tax, TaxRegistrationCountryCode = country }, TestContext.Current.CancellationToken);
            Assert.Equal(CommercialSubmissionFailure.InvalidTaxRegistration, result.Failure);
            Assert.Null(store.Written);
        }

        var formatted = new RecordingStore();
        Assert.True((await new SubmitCommercialRequestHandler(formatted).HandleAsync(ValidCommand() with
            { TaxRegistration = " 1-31-23456-9 ", TaxRegistrationCountryCode = "do" },
            TestContext.Current.CancellationToken)).IsSuccess);
        Assert.Equal(("131234569", "DO"), (formatted.Written!.TaxRegistration, formatted.Written.TaxRegistrationCountryCode));

        // A proposed Dominican airline cannot give a foreign identifier; a foreign one keeps its own as written.
        var proposal = new CommercialAirlineProposal("Caribe Cargo Express", "DO", null, "CCX");
        var dominican = await new SubmitCommercialRequestHandler(new RecordingStore()).HandleAsync(ValidCommand() with
        {
            AirlineProfileId = Guid.Empty, ProposedAirline = proposal, TaxRegistration = "EIN 12-3456789",
            TaxRegistrationCountryCode = "US",
        }, TestContext.Current.CancellationToken);
        Assert.Equal(CommercialSubmissionFailure.InvalidTaxRegistration, dominican.Failure);
        var foreign = new RecordingStore();
        Assert.True((await new SubmitCommercialRequestHandler(foreign).HandleAsync(ValidCommand() with
        {
            AirlineProfileId = Guid.Empty, ProposedAirline = proposal with { CountryCode = "US" },
            TaxRegistration = " EIN 12-3456789 ", TaxRegistrationCountryCode = "US",
        }, TestContext.Current.CancellationToken)).IsSuccess);
        Assert.Equal("EIN 12-3456789", foreign.Written!.TaxRegistration);
        Assert.Null(foreign.Written.RegistryCheck);
    }

    [Fact]
    public async Task AProposedAirlineIsCheckedAgainstTheRegistriesWithoutFailingTheSubmission()
    {
        var store = new RecordingStore();
        var proposal = new CommercialAirlineProposal("Caribe Cargo Express", "DO", null, "CCX");
        var result = await new SubmitCommercialRequestHandler(store, new ThrowingRegistry()).HandleAsync(ValidCommand() with
            { AirlineProfileId = Guid.Empty, ProposedAirline = proposal }, TestContext.Current.CancellationToken);
        Assert.True(result.IsSuccess);
        // A registry that fails is «Unavailable», never an error of the public form.
        Assert.Equal(AirlineRegistryCheck.Unavailable, store.Written!.RegistryCheck?.Status);
    }

    [Theory]
    [InlineData("131234569", "DO", "RNC 1-31-23456-9")]
    [InlineData("B85850394", "ES", "Id. fiscal B85850394 (ES)")]
    public void TheTaxIdentifierIsPrintedAsRncOrForeignId(string number, string country, string expected) =>
        Assert.Equal(expected, TaxRegistrations.Display(number, country));

    private sealed class ThrowingRegistry : IAirlineRegistryLookup
    {
        public Task<AirlineRegistryCheck> CheckAsync(string name, string? iataCode, string? icaoCode,
            CancellationToken cancellationToken = default) => throw new HttpRequestException("offline");
    }

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
