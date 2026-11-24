using Elevant.Persistence.Finance;
namespace Elevant.IntegrationTests.Persistence;

public sealed class FinanceTreasuryAirlineOptionsTests
{
    [Fact]
    public void AirlinesSharingANameReadApartByTheirCodeAndUniqueNamesStayAsTheyAre()
    {
        Guid american = Guid.NewGuid(), americanRegional = Guid.NewGuid(), delta = Guid.NewGuid(),
            deltaNoIata = Guid.NewGuid(), copa = Guid.NewGuid();

        var options = FinanceTreasuryStore.AirlineOptions([
            (american, "AMERICAN AIRLINES", "AA", "AAL"),
            (americanRegional, "American Airlines ", "MQ", "ENY"),
            (delta, "DELTA AIR LINES", "DL", "DAL"),
            (deltaNoIata, "DELTA AIR LINES", null, "DXX"),
            (copa, "COPA AIRLINES", "CM", "CMP"),
        ]);

        Assert.Equal(
            [(american, "AMERICAN AIRLINES (AA)"), (americanRegional, "American Airlines (MQ)"),
                (delta, "DELTA AIR LINES (DL)"), (deltaNoIata, "DELTA AIR LINES (DXX)"), (copa, "COPA AIRLINES")],
            options.Select(option => (option.Id, option.Name)).ToArray());
    }
}
