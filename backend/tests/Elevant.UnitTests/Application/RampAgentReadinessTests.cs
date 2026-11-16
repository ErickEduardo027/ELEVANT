using Elevant.Application.Identity;

namespace Elevant.UnitTests.Application;

/// <summary>«¿Puede operar?» per ramp agent (ADR-0026).</summary>
public sealed class RampAgentReadinessTests
{
    private static readonly DateOnly Today = new(2026, 11, 3);

    private static RampAgentReadinessFacts Ready() => new(
        AgentActive: true, HasAccount: true, AccountActive: true, HasMobileRole: true, HasActiveMembership: true,
        AgentStations: ["PUJ"], AccountStations: ["PUJ"], TerminalScopes: 1,
        AirportIdExpiresOn: Today.AddYears(1), RampDriverLicenseExpiresOn: Today.AddYears(1),
        Qualifications: [("TUG", Today.AddMonths(6))], ShiftsNextTwoWeeks: 5, NextAbsenceStartsOn: null);

    private static Dictionary<string, string> Statuses(RampAgentReadinessFacts facts) =>
        RampAgentReadiness.Evaluate(Guid.NewGuid(), "Ana Ramp", "E-1", facts, Today).Items
            .ToDictionary(item => item.Key, item => item.Status);

    [Fact]
    public void AnAgentWithEverythingInPlaceCanOperate()
    {
        var result = RampAgentReadiness.Evaluate(Guid.NewGuid(), "Ana Ramp", "E-1", Ready(), Today);
        Assert.True(result.Ready);
        Assert.Equal("5 turnos en los próximos 14 días.", result.Items.Single(item => item.Key == "upcoming_shifts").Detail);
    }

    [Fact]
    public void EachMissingPieceBlocksAndExplainsItself()
    {
        Assert.Equal("Missing", Statuses(Ready() with { HasAccount = false, AccountActive = false })["mobile_account"]);
        Assert.Equal("Missing", Statuses(Ready() with { HasMobileRole = false })["mobile_role"]);
        Assert.Equal("Missing", Statuses(Ready() with { HasActiveMembership = false })["membership"]);
        Assert.Equal("Missing", Statuses(Ready() with { AccountStations = ["SDQ"] })["station_scope"]);
        Assert.Equal("Missing", Statuses(Ready() with { TerminalScopes = 0 })["terminal_scope"]);
        Assert.Equal("Missing", Statuses(Ready() with { AirportIdExpiresOn = Today.AddDays(-1) })["airport_id"]);
        Assert.Equal("Missing", Statuses(Ready() with { RampDriverLicenseExpiresOn = null })["ramp_driver_license"]);
        Assert.Equal("Missing", Statuses(Ready() with { Qualifications = [("TUG", Today.AddDays(-3))] })["qualifications"]);
        Assert.False(RampAgentReadiness.Evaluate(Guid.NewGuid(), "x", "E", Ready() with { TerminalScopes = 0 }, Today).Ready);

        var station = RampAgentReadiness.Evaluate(Guid.NewGuid(), "x", "E",
            Ready() with { AgentStations = ["PUJ", "SDQ"], AccountStations = ["PUJ"] }, Today)
            .Items.Single(item => item.Key == "station_scope");
        Assert.Equal(("Ok", "Estaciones: PUJ · sin acceso en la cuenta: SDQ"), (station.Status, station.Detail));
    }

    [Fact]
    public void ExpiringDocumentsWarnWithoutBlockingAndShiftsOnlyInform()
    {
        var facts = Ready() with { AirportIdExpiresOn = Today.AddDays(10), ShiftsNextTwoWeeks = 0,
            NextAbsenceStartsOn = Today.AddDays(2) };
        var result = RampAgentReadiness.Evaluate(Guid.NewGuid(), "x", "E", facts, Today);
        Assert.True(result.Ready);
        Assert.Equal("Expiring", result.Items.Single(item => item.Key == "airport_id").Status);
        Assert.Equal("Info", result.Items.Single(item => item.Key == "upcoming_shifts").Status);
        Assert.Contains(result.Items, item => item.Key == "approved_absence" && item.Status == "Info");
    }

    [Theory]
    [InlineData(-1, "Expired")]
    [InlineData(0, "Expiring")]
    [InlineData(30, "Expiring")]
    [InlineData(31, "Current")]
    public void DocumentValidityUsesThirtyDays(int days, string expected) =>
        Assert.Equal(expected, RampAgentReadiness.Validity(Today.AddDays(days), Today));
}
