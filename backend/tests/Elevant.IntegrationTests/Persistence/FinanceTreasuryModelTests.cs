using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Elevant.IntegrationTests.Persistence;
public sealed class FinanceTreasuryModelTests
{
    [Fact]
    public void TreasuryIsAutoDiscoveredWithoutDbSetsAndProtectsImmutableMovements()
    {
        using var context = new ElevantDbContext(new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer("Server=127.0.0.1,65535;Database=SyntheticModelOnly;Integrated Security=true;TrustServerCertificate=true", ElevantSqlServerOptions.Configure).Options);
        foreach (var type in new[] { typeof(FinanceTreasuryReceipt), typeof(FinanceTreasuryMovement), typeof(FinanceTreasuryRequest),
            typeof(FinanceTreasuryInvoiceAccount), typeof(FinanceTreasuryAdjustmentNote), typeof(FinanceTreasuryAdjustmentLine) })
        {
            var entity = context.Model.FindEntityType(type);
            Assert.NotNull(entity); Assert.Equal("commercial", entity.GetSchema());
            Assert.True(entity.FindProperty("RowVersion")!.IsConcurrencyToken);
            Assert.All(entity.GetForeignKeys(), fk => Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior));
        }
        var movement = context.Model.FindEntityType(typeof(FinanceTreasuryMovement))!;
        Assert.Equal(Microsoft.EntityFrameworkCore.Metadata.PropertySaveBehavior.Throw,
            movement.FindProperty(nameof(FinanceTreasuryMovement.InvoiceAmount))!.GetAfterSaveBehavior());
        var script = context.Database.GenerateCreateScript();
        Assert.Contains("[commercial].[finance_treasury_receipts]", script, StringComparison.Ordinal);
        Assert.Contains("[commercial].[finance_treasury_adjustment_lines]", script, StringComparison.Ordinal);
    }
}
