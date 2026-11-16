using System.ComponentModel.DataAnnotations;
using System.Text.Json;
using Elevant.Application.Identity.CreateSession;
using Elevant.Contracts.Identity;

namespace Elevant.ArchitectureTests.Architecture;

public sealed class SessionContractSafetyTests
{
    [Fact]
    public void SecretBearingContractsRedactDiagnosticStrings()
    {
        const string email = "secret.user@dev.elevant.test";
        const string password = "not-for-logs";
        const string accessToken = "secret.jwt.value";
        var request = new CreateSessionRequest(email, password);
        var response = new SessionResponse(
            accessToken,
            "Bearer",
            DateTimeOffset.UtcNow.AddMinutes(15),
            CreateActor(email));

        var diagnosticText = string.Join('|', request, response);

        Assert.DoesNotContain(email, diagnosticText, StringComparison.Ordinal);
        Assert.DoesNotContain(password, diagnosticText, StringComparison.Ordinal);
        Assert.DoesNotContain(accessToken, diagnosticText, StringComparison.Ordinal);
        Assert.Contains("[REDACTED]", diagnosticText, StringComparison.Ordinal);
    }

    [Theory]
    [InlineData(SessionPortal.BackOffice, "\"back_office\"")]
    [InlineData(SessionPortal.RampMobileApp, "\"ramp_mobile_app\"")]
    [InlineData(SessionPortal.AirlinePortal, "\"airline_portal\"")]
    public void PortalUsesStableWireValue(SessionPortal portal, string expectedJson) =>
        Assert.Equal(expectedJson, JsonSerializer.Serialize(portal));

    [Theory]
    [InlineData(SessionOrganizationType.AviamOperator, "\"aviam_operator\"")]
    [InlineData(SessionOrganizationType.AirlineCustomer, "\"airline_customer\"")]
    public void OrganizationTypeUsesStableWireValue(
        SessionOrganizationType organizationType,
        string expectedJson) =>
        Assert.Equal(expectedJson, JsonSerializer.Serialize(organizationType));

    [Theory]
    [InlineData(SessionMembershipKind.InternalStaff, "\"internal_staff\"")]
    [InlineData(SessionMembershipKind.AirlineClient, "\"airline_client\"")]
    public void MembershipKindUsesStableWireValue(
        SessionMembershipKind membershipKind,
        string expectedJson) =>
        Assert.Equal(expectedJson, JsonSerializer.Serialize(membershipKind));

    [Fact]
    public void OversizedCredentialsFailContractValidation()
    {
        var oversizedEmail = new CreateSessionRequest(
            new string('a', SessionContractLimits.MaximumEmailLength + 1),
            "password");
        var oversizedPassword = new CreateSessionRequest(
            "user@dev.elevant.test",
            new string('p', SessionContractLimits.MaximumPasswordLength + 1));

        Assert.False(IsValid(oversizedEmail));
        Assert.False(IsValid(oversizedPassword));
    }

    [Fact]
    public void HttpAndApplicationCredentialLimitsRemainAligned()
    {
        Assert.Equal(
            CreateSessionCommand.MaximumEmailLength,
            SessionContractLimits.MaximumEmailLength);
        Assert.Equal(
            CreateSessionCommand.MaximumPasswordLength,
            SessionContractLimits.MaximumPasswordLength);
    }

    private static bool IsValid(CreateSessionRequest request) => Validator.TryValidateObject(
        request,
        new ValidationContext(request),
        [],
        validateAllProperties: true);

    private static SessionActorResponse CreateActor(string email) => new(
        Guid.Parse("40000000-0000-7000-8000-000000000001"),
        email,
        "Secret User",
        [
            new SessionRoleResponse(
                Guid.Parse("41000000-0000-7000-8000-000000000001"),
                "ADMIN_OCC",
                "Admin OCC",
                SessionPortal.BackOffice,
                "admin_occ"),
        ],
        [
            new SessionMembershipResponse(
                Guid.Parse("42000000-0000-7000-8000-000000000001"),
                Guid.Parse("43000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM",
                SessionOrganizationType.AviamOperator,
                SessionMembershipKind.InternalStaff),
        ],
        [
            new SessionStationScopeResponse(
                Guid.Parse("44000000-0000-7000-8000-000000000001"),
                "SDQ"),
        ]);
}
