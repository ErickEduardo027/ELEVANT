using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Elevant.IntegrationTests.Persistence;

public sealed class FinancePayablesModelTests
{
    [Fact]
    public void FinancePayablesModelDiscoversMappingsWithUniqueReferencesAndFixedPrecision()
    {
        using var db = new ElevantDbContext(new DbContextOptionsBuilder<ElevantDbContext>().UseSqlServer("Server=(localdb)\\ElevantFinanceTests;Database=unused;Integrated Security=True;TrustServerCertificate=True").Options);
        var invoice = db.Model.FindEntityType(typeof(SupplierInvoice))!;
        Assert.Equal("supplier_invoices", invoice.GetTableName());
        Assert.Contains(invoice.GetIndexes(), x => x.IsUnique && x.Properties.Select(p => p.Name).SequenceEqual(new[] { "SupplierId", "DocumentReference" }));
        Assert.Equal(19, invoice.FindProperty("Total")!.GetPrecision()); Assert.Equal(4, invoice.FindProperty("Total")!.GetScale());
        Assert.True(invoice.FindProperty("RowVersion")!.IsConcurrencyToken);
        var line = db.Model.FindEntityType(typeof(SupplierInvoiceLine))!;
        Assert.Equal(18, line.FindProperty("Quantity")!.GetPrecision()); Assert.Equal(4, line.FindProperty("Quantity")!.GetScale());
        Assert.Equal(Microsoft.EntityFrameworkCore.Metadata.PropertySaveBehavior.Throw, line.FindProperty("Total")!.GetAfterSaveBehavior());
        foreach (var type in new[] { typeof(SupplierInvoice), typeof(EmployeeExpenseClaim), typeof(FinancePayablesApplication), typeof(FinancePayablesAttachment) })
            Assert.All(db.Model.FindEntityType(type)!.GetForeignKeys(), fk => Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior));
        var command = db.Model.FindEntityType(typeof(FinancePayablesCommand))!;
        Assert.Contains(command.GetIndexes(), x => x.IsUnique && x.Properties.Select(p => p.Name).SequenceEqual(new[] { "ActorAccountId", "RequestId" }));
    }

}
