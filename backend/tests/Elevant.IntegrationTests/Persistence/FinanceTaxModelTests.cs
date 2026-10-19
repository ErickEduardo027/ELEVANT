using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata;

namespace Elevant.IntegrationTests.Persistence;

public sealed class FinanceTaxModelTests
{
    [Fact]
    public void FinanceTaxMappingsAreDiscoveredHaveFixedPrecisionAndFreezeIssuedSnapshots()
    {
        using var db = new ElevantDbContext(new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer("Server=(localdb)\\ElevantFinanceTests;Database=unused;Integrated Security=True", ElevantSqlServerOptions.Configure).Options);
        Assert.Equal("finance_tax_policies", db.Model.FindEntityType(typeof(FinanceTaxPolicy))!.GetTableName());
        foreach (var type in new[] { typeof(PreinvoiceLine), typeof(NonFiscalInvoiceLine) })
        {
            var entity = db.Model.FindEntityType(type)!;
            Assert.Equal(FinanceTaxTreatment.Unconfigured, entity.FindProperty("TaxTreatment")!
                .FindAnnotation(RelationalAnnotationNames.DefaultValue)?.Value);
            foreach (var name in new[] { "NetAmount", "DiscountAmount", "TaxAmount", "GrossAmount" })
            {
                Assert.Equal(19, entity.FindProperty(name)!.GetPrecision()); Assert.Equal(4, entity.FindProperty(name)!.GetScale());
            }
        }
        Assert.Equal(PropertySaveBehavior.Throw, db.Model.FindEntityType(typeof(NonFiscalInvoice))!
            .FindProperty(nameof(NonFiscalInvoice.CommercialSnapshotJson))!.GetAfterSaveBehavior());
        Assert.Equal(PropertySaveBehavior.Throw, db.Model.FindEntityType(typeof(FinanceTaxPolicy))!
            .FindProperty(nameof(FinanceTaxPolicy.Rate))!.GetAfterSaveBehavior());
        Assert.All(db.Model.FindEntityType(typeof(FinanceTaxPolicy))!.GetForeignKeys(), fk => Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior));
    }
}
