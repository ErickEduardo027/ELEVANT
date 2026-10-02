using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Entities.Integration;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.IntegrationTests.Persistence;

public sealed class DatabaseModelTests
{
    [Fact]
    public void PublicAirlineProfilesDoNotCreateTenantsBeforeApproval()
    {
        using var context = CreateContext();
        var profile = context.Model.FindEntityType(typeof(CommercialAirlineProfile));

        Assert.NotNull(profile);
        Assert.Equal("commercial", profile.GetSchema());
        Assert.Equal("airline_profiles", profile.GetTableName());
        Assert.Null(profile.FindProperty("OrganizationId"));
        Assert.Contains(profile.GetIndexes(), index => index.IsUnique &&
            index.Properties.Select(property => property.Name).SequenceEqual(
                [nameof(CommercialAirlineProfile.SourceName)]));
    }

    [Fact]
    public void PublicApplicationSnapshotsTheSelectedProfileAndRepresentative()
    {
        using var context = CreateContext();
        var request = context.Model.FindEntityType(typeof(ServiceRequest));

        Assert.NotNull(request);
        Assert.NotNull(request.FindProperty(nameof(ServiceRequest.AirlineProfileId)));
        Assert.NotNull(request.FindProperty(nameof(ServiceRequest.ContactTitle)));
        Assert.NotNull(request.FindProperty(nameof(ServiceRequest.AirlineLegalNameSnapshot)));
        Assert.NotNull(request.FindProperty(nameof(ServiceRequest.SubmissionHash)));
        Assert.Contains(request.GetForeignKeys(), foreignKey =>
            foreignKey.PrincipalEntityType.ClrType == typeof(CommercialAirlineProfile) &&
            foreignKey.DeleteBehavior == DeleteBehavior.NoAction);
    }

    [Fact]
    public void AccountChangeFeedHasStableRecipientAndOutboxIdentity()
    {
        using var context = CreateContext();
        var change = context.Model.FindEntityType(typeof(AccountChange));

        Assert.NotNull(change);
        Assert.Equal("infra", change.GetSchema());
        Assert.Equal("account_changes", change.GetTableName());
        Assert.Equal(3, change.FindProperty(nameof(AccountChange.OccurredAt))?.GetPrecision());
        Assert.Equal(3, change.FindProperty(nameof(AccountChange.CreatedAt))?.GetPrecision());
        Assert.Contains(change.GetIndexes(), index => index.IsUnique &&
            index.Properties.Select(property => property.Name).SequenceEqual(
                [nameof(AccountChange.OutboxPublicId), nameof(AccountChange.RecipientAccountId)]));
        Assert.Contains(change.GetIndexes(), index =>
            index.Properties.Select(property => property.Name).SequenceEqual(
                [nameof(AccountChange.RecipientAccountId), nameof(AccountChange.Id)]));
        Assert.Equal(2, change.GetForeignKeys().Count());
        Assert.All(change.GetForeignKeys(), foreignKey =>
            Assert.Equal(DeleteBehavior.NoAction, foreignKey.DeleteBehavior));
    }

    [Fact]
    public void FinancialDocumentsKeepPrivateHashMetadataSeparateFromCommercialMedia()
    {
        using var context = CreateContext();
        var document = context.Model.FindEntityType(typeof(FinancialDocument));

        Assert.NotNull(document);
        Assert.Equal("commercial", document.GetSchema());
        Assert.Equal("financial_documents", document.GetTableName());
        Assert.Equal(3, document.FindProperty(nameof(FinancialDocument.CreatedAt))?.GetPrecision());
        Assert.Contains(document.GetIndexes(), index => index.IsUnique &&
            index.Properties.Select(property => property.Name).SequenceEqual(
                [nameof(FinancialDocument.InvoiceId), nameof(FinancialDocument.Kind)]));
        Assert.Contains(document.GetIndexes(), index => index.IsUnique &&
            index.Properties.Select(property => property.Name).SequenceEqual(
                [nameof(FinancialDocument.ObjectKey)]));
        Assert.All(document.GetForeignKeys(), foreignKey =>
            Assert.Equal(DeleteBehavior.NoAction, foreignKey.DeleteBehavior));
    }

    private static ElevantDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(
                "Server=localhost;Initial Catalog=ElevantDevelopmentDb;Integrated Security=true;",
                ElevantSqlServerOptions.Configure)
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
    [InlineData(typeof(MobileDevice), "integration", "mobile_devices")]
    [InlineData(typeof(MobileCommandReceipt), "integration", "mobile_command_receipts")]
    [InlineData(typeof(AuditEntry), "audit", "audit_entries")]
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

    [Fact]
    public void MobileIdempotencyIsScopedToTheDevice()
    {
        using var context = CreateContext();
        var receipt = context.Model.FindEntityType(typeof(MobileCommandReceipt));

        Assert.NotNull(receipt);
        Assert.Contains(
            receipt.GetIndexes(),
            index => index.IsUnique && index.Properties.Select(property => property.Name).SequenceEqual(
                [nameof(MobileCommandReceipt.MobileDeviceId), nameof(MobileCommandReceipt.IdempotencyKey)]));
    }

    [Fact]
    public void AuditEntryCarriesTenantStationEntityAndCorrelationContext()
    {
        using var context = CreateContext();
        var auditEntry = context.Model.FindEntityType(typeof(AuditEntry));

        Assert.NotNull(auditEntry);
        Assert.NotNull(auditEntry.FindProperty(nameof(AuditEntry.OrganizationId)));
        Assert.NotNull(auditEntry.FindProperty(nameof(AuditEntry.StationId)));
        Assert.NotNull(auditEntry.FindProperty(nameof(AuditEntry.EntityPublicId)));
        Assert.NotNull(auditEntry.FindProperty(nameof(AuditEntry.CorrelationId)));
    }
}
