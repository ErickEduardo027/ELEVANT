using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;
namespace Elevant.IntegrationTests.Persistence;
public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task AirlineTreasuryReadsOnlyItsOwnInvoicesReceiptsAndNotes()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var db = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(db, ct);
        await using var setup = CreateContext(db.ConnectionString);
        var airlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");
        var actor = await new EfActorContextResolver(setup, TimeProvider.System).ResolveAsync(airlineAccount, ct);
        var organizationId = Assert.Single(actor!.Memberships, m => m.Kind == MembershipKind.AirlineClient).OrganizationId;
        var own = await (from a in setup.Airlines join o in setup.Organizations on a.OrganizationId equals o.Id
            where o.PublicId == organizationId select a).SingleAsync(ct);
        var station = await setup.Stations.SingleAsync(s => s.Code == "PUJ", ct);
        var account = await setup.Users.SingleAsync(u => u.PublicId == FinanceAccount, ct);
        var now = DateTimeOffset.UtcNow; var today = Elevant.Application.Common.BusinessCalendar.Today(now);
        var foreignOrganization = new Organization { PublicId = Guid.NewGuid(), Code = "QA-TREASURY-OTHER", LegalName = "Other synthetic airline", DisplayName = "Other synthetic airline",
            Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active };
        setup.Organizations.Add(foreignOrganization); await setup.SaveChangesAsync(ct);
        var foreign = new Elevant.Domain.Entities.Reference.Airline { PublicId = Guid.NewGuid(), OrganizationId = foreignOrganization.Id,
            Name = "Other synthetic airline", IataCode = "QZ", IcaoCode = "QZT", IsActive = true };
        setup.Airlines.Add(foreign); await setup.SaveChangesAsync(ct);
        async Task<NonFiscalInvoice> InvoiceAsync(long airlineId)
        {
            var pre = new Preinvoice { PublicId = Guid.NewGuid(), AirlineId = airlineId, StationId = station.Id,
                CreatedByAccountId = account.Id, RequestId = Guid.NewGuid(), PayloadHash = new string('a', 64), From = today,
                To = today, CurrencyCode = "USD", Total = 1000m, Status = PreinvoiceStatus.Invoiced, CreatedAt = now, UpdatedAt = now };
            setup.Preinvoices.Add(pre); await setup.SaveChangesAsync(ct); var id = Guid.NewGuid();
            var invoice = new NonFiscalInvoice { PublicId = id, AirlineId = airlineId, StationId = station.Id,
                PreinvoiceId = pre.Id, IssuedByAccountId = account.Id, RequestId = Guid.NewGuid(), Number = $"NF-{id:N}",
                CurrencyCode = "USD", Total = 1000m, CreatedAt = now, UpdatedAt = now };
            setup.NonFiscalInvoices.Add(invoice); await setup.SaveChangesAsync(ct); return invoice;
        }
        var invoice = await InvoiceAsync(own.Id); var foreignInvoice = await InvoiceAsync(foreign.Id);
        FinanceTreasuryReceipt Receipt(long airline, string reference) => new() { PublicId = Guid.NewGuid(), AirlineId = airline,
            StationId = station.Id, ActorAccountId = account.Id, RequestId = Guid.NewGuid(), Reference = reference, CurrencyCode = "USD",
            Amount = 1000m, Method = PaymentMethod.Transfer, ReceivedOn = today, Reason = "Synthetic receipt", CreatedAt = now, UpdatedAt = now };
        var receipt = Receipt(own.Id, "QA-OWN-RECEIPT"); var otherReceipt = Receipt(foreign.Id, "QA-FOREIGN-RECEIPT");
        setup.AddRange(receipt, otherReceipt); await setup.SaveChangesAsync(ct);
        var preLine = new PreinvoiceLine { PublicId = Guid.NewGuid(), PreinvoiceId = invoice.PreinvoiceId,
            LineNumber = 1, Kind = PreinvoiceLineKind.Adjustment, OperationCode = "QA", OperationDate = today,
            ServiceCode = "RAMP", ServiceName = "Synthetic ramp service", ExecutedQuantity = 10m, BillingUnit = "unit",
            UnitPrice = 100m, Amount = 1000m, CurrencyCode = "USD", AdjustmentReason = "Synthetic fixture", CreatedAt = now, UpdatedAt = now };
        setup.PreinvoiceLines.Add(preLine); await setup.SaveChangesAsync(ct);
        var invoiceLine = new NonFiscalInvoiceLine { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, PreinvoiceLineId = preLine.Id,
            LineNumber = 1, Kind = PreinvoiceLineKind.Adjustment, OperationCode = "QA", OperationDate = today, ServiceCode = "RAMP",
            ServiceName = "Synthetic ramp service", ExecutedQuantity = 10m, BillingUnit = "unit", UnitPrice = 100m,
            Amount = 1000m, CurrencyCode = "USD", CreatedAt = now, UpdatedAt = now };
        setup.NonFiscalInvoiceLines.Add(invoiceLine); await setup.SaveChangesAsync(ct);
        setup.Add(new FinanceTreasuryMovement { PublicId = Guid.NewGuid(), ReceiptId = receipt.Id, InvoiceId = invoice.Id,
            ActorAccountId = account.Id, RequestId = Guid.NewGuid(), Kind = FinanceTreasuryMovementKind.Application,
            EffectiveOn = today, ReceiptAmount = 300m, InvoiceAmount = 300m, ReceiptCurrency = "USD", InvoiceCurrency = "USD",
            ExchangeRate = 1m, ExchangeRateOn = today, Reason = "Partial allocation", CreatedAt = now, UpdatedAt = now });
        var note = new FinanceTreasuryAdjustmentNote { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, ActorAccountId = account.Id,
            RequestId = Guid.NewGuid(), Number = "TC-PORTAL-OWN", Kind = FinanceTreasuryAdjustmentKind.Credit,
            EffectiveOn = today, CurrencyCode = "USD", Amount = 100m, Reason = "Service correction", CreatedAt = now, UpdatedAt = now };
        setup.Add(note); await setup.SaveChangesAsync(ct);
        setup.Add(new FinanceTreasuryAdjustmentLine { PublicId = Guid.NewGuid(), NoteId = note.Id, InvoiceLineId = invoiceLine.Id, Quantity = 1m, Amount = 100m, CreatedAt = now, UpdatedAt = now });
        setup.NonFiscalPayments.Add(new NonFiscalPayment { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, RecordedByAccountId = account.Id,
            RequestId = Guid.NewGuid(), Reference = "QA-PORTAL-LEGACY", CurrencyCode = "USD", Amount = 50m, PaidOn = today, CreatedAt = now, UpdatedAt = now });
        await setup.SaveChangesAsync(ct);
        await using var context = CreateContext(db.ConnectionString);
        var store = new FinanceTreasuryStore(context, new EfActorContextResolver(context, TimeProvider.System), TimeProvider.System);
        var statement = await store.PortalStatementAsync(airlineAccount, today, null, ct);
        Assert.True(statement.IsSuccess); var ownSummary = Assert.Single(statement.Data!.Invoices);
        Assert.Equal(invoice.PublicId, ownSummary.Id); Assert.Equal(550m, ownSummary.Balance);
        Assert.Equal(50m, ownSummary.LegacyPaid); Assert.Equal(300m, ownSummary.Applied); Assert.Equal(100m, ownSummary.Credited);
        Assert.Equal(receipt.PublicId, Assert.Single(statement.Data.Receipts).Id);
        var detail = (await store.PortalInvoiceAsync(airlineAccount, invoice.PublicId, ct)).Data!;
        Assert.Equal(invoiceLine.PublicId, Assert.Single(detail.Lines).Id);
        Assert.Equal(invoiceLine.PublicId, Assert.Single(Assert.Single(detail.Notes).Lines).InvoiceLineId);
        Assert.True((await store.PortalReceiptAsync(airlineAccount, receipt.PublicId, ct)).IsSuccess);
        Assert.Equal("TC-PORTAL-OWN", Assert.Single((await store.PortalAdjustmentsAsync(airlineAccount, invoice.PublicId, ct)).Data!.Notes).Number);
        Assert.Equal(FinanceTreasuryFailure.NotFound, (await store.PortalInvoiceAsync(airlineAccount, foreignInvoice.PublicId, ct)).Failure);
        Assert.Equal(FinanceTreasuryFailure.NotFound, (await store.PortalReceiptAsync(airlineAccount, otherReceipt.PublicId, ct)).Failure);
        Assert.Equal(FinanceTreasuryFailure.NotFound, (await store.PortalAdjustmentsAsync(airlineAccount, foreignInvoice.PublicId, ct)).Failure);
        Assert.Equal(FinanceTreasuryFailure.NotFound, (await store.PortalStatementAsync(airlineAccount, today, Guid.NewGuid(), ct)).Failure);
        Assert.Equal(FinanceTreasuryFailure.Forbidden, (await store.PortalStatementAsync(FinanceAccount, today, null, ct)).Failure);
        var invoiceCount = await setup.NonFiscalInvoices.CountAsync(ct); var receiptCount = await setup.Set<FinanceTreasuryReceipt>().CountAsync(ct);
        Assert.Equal(invoiceCount, await context.NonFiscalInvoices.CountAsync(ct)); Assert.Equal(receiptCount, await context.Set<FinanceTreasuryReceipt>().CountAsync(ct));
    }
}
