using Elevant.Domain.Entities;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Workforce;
using Elevant.Infrastructure.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Metadata.Builders;
using Microsoft.EntityFrameworkCore.Metadata;
namespace Elevant.Infrastructure.Persistence.Configurations;

internal static class FinancePayablesMapping
{
    internal static void Identity<T>(EntityTypeBuilder<T> b) where T : Entity<long>
    {
        b.HasKey("Id"); b.Property<long>("Id").ValueGeneratedOnAdd();
        b.Ignore("DomainEvents");
        foreach (var p in typeof(T).GetProperties().Where(p => p.PropertyType == typeof(DateTimeOffset) || p.PropertyType == typeof(DateTimeOffset?)))
            b.Property(p.Name).HasPrecision(3);
    }
    internal static void Mutable<T>(EntityTypeBuilder<T> b) where T : AuditableEntity
    {
        Identity(b); b.HasIndex(x => x.PublicId).IsUnique(); b.Property(x => x.RowVersion).IsRowVersion();
    }
    internal static void Reference<T, TTarget>(EntityTypeBuilder<T> b, string property) where T : class where TTarget : class =>
        b.HasOne<TTarget>().WithMany().HasForeignKey(property).OnDelete(DeleteBehavior.NoAction);
    internal static void Fx<T>(EntityTypeBuilder<T> b) where T : class
    {
        b.Property<string>("CurrencyCode").HasColumnType("char(3)").IsRequired();
        b.Property<decimal>("FxToDop").HasPrecision(19, 8);
        b.Property<string>("FxSource").HasMaxLength(160).IsRequired();
        b.Property<DateOnly>("FxDate").HasColumnType("date");
    }
    internal static void Document<T>(EntityTypeBuilder<T> b) where T : AuditableEntity
    {
        Mutable(b); Fx(b);
        b.Property<decimal>("Total").HasPrecision(19, 4); b.Property<decimal>("TotalDop").HasPrecision(19, 4);
        Reference<T, Station>(b, "ScopeStationId"); Reference<T, Station>(b, "StationId");
        Reference<T, Airline>(b, "AirlineId"); Reference<T, Turnaround>(b, "TurnaroundId");
        Reference<T, ServiceDefinition>(b, "ServiceDefinitionId"); Reference<T, ApplicationUser>(b, "CreatedByAccountId");
        b.HasIndex("ScopeStationId", "Status");
    }
    internal static void Line<T, TDocument>(EntityTypeBuilder<T> b, string table) where T : Entity<long> where TDocument : class
    {
        Identity(b); b.ToTable(table, "commercial", t => {
            t.HasCheckConstraint("ck_" + table + "_amounts", "[quantity] > 0 AND [unit_price] >= 0 AND [tax_amount] >= 0 AND [total] >= 0");
        });
        b.HasIndex("PublicId").IsUnique(); b.HasIndex("DocumentId", "LineNumber").IsUnique();
        b.Property<string>("Description").HasMaxLength(500).IsRequired();
        b.Property<decimal>("Quantity").HasPrecision(18, 4);
        foreach (var field in new[] { "UnitPrice", "TaxAmount", "Total" }) b.Property<decimal>(field).HasPrecision(19, 4);
        Reference<T, TDocument>(b, "DocumentId");
        foreach (var property in b.Metadata.GetProperties()) property.SetAfterSaveBehavior(PropertySaveBehavior.Throw);
    }
    internal static void Review<T, TDocument>(EntityTypeBuilder<T> b, string table) where T : Entity<long> where TDocument : class
    {
        Identity(b); b.ToTable(table, "commercial"); b.Property<string>("Stage").HasMaxLength(32).IsRequired();
        b.Property<string>("Decision").HasMaxLength(32).IsRequired(); b.Property<string?>("Reason").HasMaxLength(500);
        Reference<T, TDocument>(b, "DocumentId"); Reference<T, ApplicationUser>(b, "ActorAccountId"); b.HasIndex("DocumentId");
    }
}

internal sealed class SupplierConfiguration : IEntityTypeConfiguration<Supplier>
{
    public void Configure(EntityTypeBuilder<Supplier> b)
    {
        FinancePayablesMapping.Mutable(b); b.ToTable("suppliers", "commercial");
        b.Property(x => x.Code).HasMaxLength(40).IsRequired(); b.Property(x => x.Name).HasMaxLength(200).IsRequired();
        b.Property(x => x.TaxReference).HasMaxLength(80); b.Property(x => x.ContactEmail).HasMaxLength(254);
        b.HasIndex(x => new { x.ScopeStationId, x.Code }).IsUnique();
        FinancePayablesMapping.Reference<Supplier, Station>(b, "ScopeStationId");
        FinancePayablesMapping.Reference<Supplier, ApplicationUser>(b, "CreatedByAccountId");
    }
}
internal sealed class SupplierInvoiceConfiguration : IEntityTypeConfiguration<SupplierInvoice>
{
    public void Configure(EntityTypeBuilder<SupplierInvoice> b)
    {
        FinancePayablesMapping.Document(b); b.ToTable("supplier_invoices", "commercial", t => {
            t.HasCheckConstraint("ck_supplier_invoice_money", "[total] > 0 AND [total_dop] > 0 AND [fx_to_dop] > 0 AND [due_date] >= [document_date]");
            t.HasCheckConstraint("ck_supplier_invoice_currency", "[currency_code] IN ('USD','DOP') AND ([currency_code] <> 'DOP' OR [fx_to_dop] = 1)");
        });
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.DocumentReference).HasMaxLength(100).IsRequired();
        b.HasIndex(x => new { x.SupplierId, x.DocumentReference }).IsUnique();
        FinancePayablesMapping.Reference<SupplierInvoice, Supplier>(b, "SupplierId");
    }
}
internal sealed class EmployeeExpenseClaimConfiguration : IEntityTypeConfiguration<EmployeeExpenseClaim>
{
    public void Configure(EntityTypeBuilder<EmployeeExpenseClaim> b)
    {
        FinancePayablesMapping.Document(b); b.ToTable("employee_expense_claims", "commercial", t => {
            t.HasCheckConstraint("ck_employee_expense_money", "[total] > 0 AND [total_dop] > 0 AND [fx_to_dop] > 0");
            t.HasCheckConstraint("ck_employee_expense_currency", "[currency_code] IN ('USD','DOP') AND ([currency_code] <> 'DOP' OR [fx_to_dop] = 1)");
        });
        b.Property(x => x.Status).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.Department).HasConversion<string>().HasMaxLength(32);
        b.Property(x => x.Description).HasMaxLength(500).IsRequired();
        FinancePayablesMapping.Reference<EmployeeExpenseClaim, Employee>(b, "EmployeeId");
        b.HasIndex(x => new { x.CreatedByAccountId, x.ExpenseDate });
    }
}
internal sealed class SupplierInvoiceLineConfiguration : IEntityTypeConfiguration<SupplierInvoiceLine>
{ public void Configure(EntityTypeBuilder<SupplierInvoiceLine> b) => FinancePayablesMapping.Line<SupplierInvoiceLine, SupplierInvoice>(b, "supplier_invoice_lines"); }
internal sealed class EmployeeExpenseLineConfiguration : IEntityTypeConfiguration<EmployeeExpenseLine>
{ public void Configure(EntityTypeBuilder<EmployeeExpenseLine> b) => FinancePayablesMapping.Line<EmployeeExpenseLine, EmployeeExpenseClaim>(b, "employee_expense_lines"); }
internal sealed class SupplierInvoiceReviewConfiguration : IEntityTypeConfiguration<SupplierInvoiceReview>
{ public void Configure(EntityTypeBuilder<SupplierInvoiceReview> b) => FinancePayablesMapping.Review<SupplierInvoiceReview, SupplierInvoice>(b, "supplier_invoice_reviews"); }
internal sealed class EmployeeExpenseReviewConfiguration : IEntityTypeConfiguration<EmployeeExpenseReview>
{ public void Configure(EntityTypeBuilder<EmployeeExpenseReview> b) => FinancePayablesMapping.Review<EmployeeExpenseReview, EmployeeExpenseClaim>(b, "employee_expense_reviews"); }
internal sealed class FinancePayablesCommandConfiguration : IEntityTypeConfiguration<FinancePayablesCommand>
{
    public void Configure(EntityTypeBuilder<FinancePayablesCommand> b)
    {
        FinancePayablesMapping.Identity(b); b.ToTable("finance_payables_commands", "commercial");
        b.HasIndex(x => new { x.ActorAccountId, x.RequestId }).IsUnique();
        b.Property(x => x.ContentHash).HasColumnType("char(64)").IsRequired(); b.Property(x => x.Operation).HasMaxLength(80).IsRequired();
        FinancePayablesMapping.Reference<FinancePayablesCommand, ApplicationUser>(b, "ActorAccountId");
    }
}
internal sealed class FinancePayablesPaymentConfiguration : IEntityTypeConfiguration<FinancePayablesPayment>
{
    public void Configure(EntityTypeBuilder<FinancePayablesPayment> b)
    {
        FinancePayablesMapping.Mutable(b); FinancePayablesMapping.Fx(b);
        b.ToTable("payable_payments", "commercial", t => {
            t.HasCheckConstraint("ck_payable_payment_money", "[amount] > 0 AND [amount_dop] > 0 AND [fx_to_dop] > 0");
            t.HasCheckConstraint("ck_payable_payment_currency", "[currency_code] IN ('USD','DOP') AND ([currency_code] <> 'DOP' OR [fx_to_dop] = 1)");
        });
        b.Property(x => x.Reference).HasMaxLength(100).IsRequired(); b.Property(x => x.Amount).HasPrecision(19, 4); b.Property(x => x.AmountDop).HasPrecision(19, 4);
        FinancePayablesMapping.Reference<FinancePayablesPayment, Supplier>(b, "SupplierId");
        FinancePayablesMapping.Reference<FinancePayablesPayment, Station>(b, "ScopeStationId");
        FinancePayablesMapping.Reference<FinancePayablesPayment, ApplicationUser>(b, "CreatedByAccountId"); b.HasIndex(x => new { x.ScopeStationId, x.PaidOn });
    }
}
internal sealed class FinancePayablesApplicationConfiguration : IEntityTypeConfiguration<FinancePayablesApplication>
{
    public void Configure(EntityTypeBuilder<FinancePayablesApplication> b)
    {
        FinancePayablesMapping.Identity(b); b.ToTable("payable_payment_applications", "commercial", t => t.HasCheckConstraint("ck_payable_application_money", "[payment_amount] > 0 AND [invoice_amount] > 0 AND [rate_to_invoice] > 0"));
        b.HasIndex(x => x.PublicId).IsUnique(); b.HasIndex(x => x.SupplierInvoiceId); b.HasIndex(x => x.PaymentId);
        b.Property(x => x.PaymentAmount).HasPrecision(19, 4); b.Property(x => x.InvoiceAmount).HasPrecision(19, 4); b.Property(x => x.RateToInvoice).HasPrecision(19, 8);
        FinancePayablesMapping.Reference<FinancePayablesApplication, FinancePayablesPayment>(b, "PaymentId");
        FinancePayablesMapping.Reference<FinancePayablesApplication, SupplierInvoice>(b, "SupplierInvoiceId");
        FinancePayablesMapping.Reference<FinancePayablesApplication, ApplicationUser>(b, "ActorAccountId");
    }
}
internal sealed class EmployeeExpensePaymentConfiguration : IEntityTypeConfiguration<EmployeeExpensePayment>
{
    public void Configure(EntityTypeBuilder<EmployeeExpensePayment> b)
    {
        FinancePayablesMapping.Identity(b); FinancePayablesMapping.Fx(b);
        b.ToTable("employee_expense_payments", "commercial", t => {
            t.HasCheckConstraint("ck_employee_expense_payment_money", "[amount] > 0 AND [amount_dop] > 0 AND [expense_amount] > 0 AND [rate_to_expense] > 0 AND [fx_to_dop] > 0");
            t.HasCheckConstraint("ck_employee_expense_payment_currency", "[currency_code] IN ('USD','DOP') AND ([currency_code] <> 'DOP' OR [fx_to_dop] = 1)");
        });
        b.HasIndex(x => x.PublicId).IsUnique(); b.HasIndex(x => x.ExpenseClaimId);
        b.Property(x => x.Reference).HasMaxLength(100).IsRequired();
        foreach (var field in new[] { "Amount", "AmountDop", "ExpenseAmount" }) b.Property<decimal>(field).HasPrecision(19, 4);
        b.Property(x => x.RateToExpense).HasPrecision(19, 8);
        FinancePayablesMapping.Reference<EmployeeExpensePayment, EmployeeExpenseClaim>(b, "ExpenseClaimId");
        FinancePayablesMapping.Reference<EmployeeExpensePayment, ApplicationUser>(b, "ActorAccountId");
    }
}
internal sealed class FinancePayablesAttachmentConfiguration : IEntityTypeConfiguration<FinancePayablesAttachment>
{
    public void Configure(EntityTypeBuilder<FinancePayablesAttachment> b)
    {
        FinancePayablesMapping.Identity(b); b.ToTable("finance_payables_attachments", "commercial", t => t.HasCheckConstraint("ck_finance_payables_attachment_owner", "([supplier_invoice_id] IS NOT NULL AND [expense_claim_id] IS NULL) OR ([supplier_invoice_id] IS NULL AND [expense_claim_id] IS NOT NULL)"));
        b.HasIndex(x => x.PublicId).IsUnique(); b.HasIndex(x => x.ObjectKey).IsUnique();
        b.Property(x => x.ObjectKey).HasMaxLength(200).IsRequired(); b.Property(x => x.ContentType).HasMaxLength(80).IsRequired(); b.Property(x => x.Sha256).HasColumnType("char(64)").IsRequired();
        FinancePayablesMapping.Reference<FinancePayablesAttachment, SupplierInvoice>(b, "SupplierInvoiceId");
        FinancePayablesMapping.Reference<FinancePayablesAttachment, EmployeeExpenseClaim>(b, "ExpenseClaimId");
        FinancePayablesMapping.Reference<FinancePayablesAttachment, ApplicationUser>(b, "UploadedByAccountId");
    }
}
