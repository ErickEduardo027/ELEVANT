using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.IntegrationTests.Persistence;

public sealed class DatabaseModelTests
{
    private static ElevantDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer("Server=localhost;Initial Catalog=ElevantDevelopmentDb;Integrated Security=true;")
            .Options;

        return new ElevantDbContext(options);
    }

    [Theory]
    [InlineData(typeof(ApplicationUser), "iam", "accounts")]
    [InlineData(typeof(Organization), "iam", "organizations")]
    [InlineData(typeof(Airline), "ref", "airlines")]
    [InlineData(typeof(Station), "ref", "stations")]
    [InlineData(typeof(ServiceDefinition), "ref", "service_definitions")]
    [InlineData(typeof(RampAgent), "hr", "ramp_agents")]
    [InlineData(typeof(QualificationCycle), "hr", "qualification_cycles")]
    [InlineData(typeof(Contract), "commercial", "contracts")]
    [InlineData(typeof(ContractServiceRate), "commercial", "contract_service_rates")]
    [InlineData(typeof(Turnaround), "ops", "turnarounds")]
    [InlineData(typeof(FlightLeg), "ops", "flight_legs")]
    [InlineData(typeof(OperationAgentAssignment), "ops", "operation_agent_assignments")]
    [InlineData(typeof(OperationChecklist), "ops", "operation_checklists")]
    public void CanonicalEntitiesUseExpectedSchemaAndTable(Type entityType, string schema, string table)
    {
        using var context = CreateContext();
        var metadata = context.Model.FindEntityType(entityType);

        Assert.NotNull(metadata);
        Assert.Equal(schema, metadata.GetSchema());
        Assert.Equal(table, metadata.GetTableName());
    }

    [Fact]
    public void BusinessForeignKeysNeverCascadeDeleteHistory()
    {
        using var context = CreateContext();
        var cascadingForeignKeys = context.Model.GetEntityTypes()
            .SelectMany(entity => entity.GetForeignKeys())
            .Where(foreignKey => foreignKey.DeleteBehavior is DeleteBehavior.Cascade or DeleteBehavior.ClientCascade)
            .Select(foreignKey => $"{foreignKey.DeclaringEntityType.DisplayName()}->{foreignKey.PrincipalEntityType.DisplayName()}")
            .ToArray();

        Assert.Empty(cascadingForeignKeys);
    }

    [Fact]
    public void AccountIsOneToOneWithPerson()
    {
        using var context = CreateContext();
        var account = context.Model.FindEntityType(typeof(ApplicationUser));

        Assert.NotNull(account);
        Assert.Contains(
            account.GetIndexes(),
            index => index.IsUnique && index.Properties.Select(property => property.Name).SequenceEqual([nameof(ApplicationUser.PersonId)]));
    }

    [Fact]
    public void OnlyOneCurrentQualificationExistsPerAgentAndEquipment()
    {
        using var context = CreateContext();
        var qualification = context.Model.FindEntityType(typeof(QualificationCycle));

        Assert.NotNull(qualification);
        Assert.Contains(
            qualification.GetIndexes(),
            index => index.IsUnique &&
                     string.Equals(index.GetFilter(), "[is_current] = 1", StringComparison.Ordinal) &&
                     index.Properties.Select(property => property.Name).SequenceEqual(
                         [nameof(QualificationCycle.RampAgentId), nameof(QualificationCycle.EquipmentTypeId)]));
    }

    [Fact]
    public void ContractMoneyUsesFixedPointPrecision()
    {
        using var context = CreateContext();
        var rate = context.Model.FindEntityType(typeof(ContractServiceRate));
        var unitPrice = rate?.FindProperty(nameof(ContractServiceRate.UnitPrice));

        Assert.NotNull(unitPrice);
        Assert.Equal(19, unitPrice.GetPrecision());
        Assert.Equal(4, unitPrice.GetScale());
    }

    [Fact]
    public void TurnaroundHasAtMostOneLegInEachDirection()
    {
        using var context = CreateContext();
        var leg = context.Model.FindEntityType(typeof(FlightLeg));

        Assert.NotNull(leg);
        Assert.Contains(
            leg.GetIndexes(),
            index => index.IsUnique && index.Properties.Select(property => property.Name).SequenceEqual(
                [nameof(FlightLeg.TurnaroundId), nameof(FlightLeg.Direction)]));
    }

    [Fact]
    public void ExecutedServiceKeepsHistoricalPriceAndCurrencySnapshot()
    {
        using var context = CreateContext();
        var service = context.Model.FindEntityType(typeof(OperationService));
        var unitPrice = service?.FindProperty(nameof(OperationService.UnitPriceSnapshot));
        var currency = service?.FindProperty(nameof(OperationService.CurrencyCodeSnapshot));

        Assert.NotNull(unitPrice);
        Assert.Equal(19, unitPrice.GetPrecision());
        Assert.Equal(4, unitPrice.GetScale());
        Assert.NotNull(currency);
        Assert.Equal("char(3)", currency.GetColumnType());
    }
}
