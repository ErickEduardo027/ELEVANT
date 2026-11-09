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

    private static readonly string[] SupplierReference = ["SupplierId", "DocumentReference"];

    /// <summary>
    /// Phase 4, block D: a voided invoice frees its reference (4-N03); reversals are linked, immutable rows, one per
    /// application and one void per payment (4-N04); a removed receipt keeps who removed it (4-N13).
    /// </summary>
    [Fact]
    public void PayablesCorrectionsAreFilteredIndexesAndLinkedRows()
    {
        using var db = new ElevantDbContext(new DbContextOptionsBuilder<ElevantDbContext>().UseSqlServer("Server=(localdb)\\ElevantFinanceTests;Database=unused;Integrated Security=True;TrustServerCertificate=True").Options);
        var invoice = db.Model.FindEntityType(typeof(SupplierInvoice))!;
        var reference = Assert.Single(invoice.GetIndexes(), x => x.Properties.Select(p => p.Name).SequenceEqual(SupplierReference));
        Assert.True(reference.IsUnique);
        Assert.Equal("[status] <> N'Voided'", reference.GetFilter());
        Assert.Equal("IX_supplier_invoices_supplier_id_document_reference", reference.GetDatabaseName());

        var reversal = db.Model.FindEntityType(typeof(FinancePayablesReversal))!;
        Assert.Equal(("payable_payment_reversals", "commercial"), (reversal.GetTableName(), reversal.GetSchema()));
        Assert.All(reversal.GetForeignKeys(), fk => Assert.Equal(DeleteBehavior.NoAction, fk.DeleteBehavior));
        Assert.Equal(["ActorAccountId", "ApplicationId", "PaymentId"], reversal.GetForeignKeys().Select(fk => fk.Properties.Single().Name).Order().ToArray());
        string? FilterOf(string property) => Assert.Single(reversal.GetIndexes(), x => x.IsUnique && x.Properties.Single().Name == property).GetFilter();
        Assert.Equal("[application_id] IS NOT NULL", FilterOf("ApplicationId"));
        Assert.Equal("[application_id] IS NULL", FilterOf("PaymentId"));
        Assert.Null(FilterOf("PublicId"));
        Assert.Equal(500, reversal.FindProperty("Reason")!.GetMaxLength());
        Assert.Equal(3, reversal.FindProperty("ReversedAt")!.GetPrecision());
        Assert.All(reversal.GetProperties(), property => Assert.Equal(Microsoft.EntityFrameworkCore.Metadata.PropertySaveBehavior.Throw, property.GetAfterSaveBehavior()));

        var attachment = db.Model.FindEntityType(typeof(FinancePayablesAttachment))!;
        Assert.True(attachment.FindProperty("RemovedAt")!.IsNullable);
        Assert.Equal(3, attachment.FindProperty("RemovedAt")!.GetPrecision());
        Assert.Contains(attachment.GetForeignKeys(), fk => fk.Properties.Single().Name == "RemovedByAccountId" && fk.DeleteBehavior == DeleteBehavior.NoAction);
    }
}
