using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
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

    /// <summary>
    /// 4-N08: a charter never has a contract (ADR-0033). An airline whose contract is still a draft sees its charter invoice
    /// and the PREPAGO receipt in the portal, and pays the rest by card; the charter of another airline opens nothing.
    /// </summary>
    [Fact]
    public async Task CharterAirlineWithoutContractSeesItsInvoiceAndPaysTheRestByCard()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var db = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(db, ct);
        await using var setup = CreateContext(db.ConnectionString);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var turnaround = await setup.Turnarounds.AsNoTracking().SingleAsync(item => item.OperationCode == "DEV-TAT-0001", ct);
        var station = await setup.Stations.AsNoTracking().SingleAsync(item => item.Id == turnaround.StationId, ct);
        var financeId = await setup.Users.Where(item => item.PublicId == FinanceAccount).Select(item => item.Id).SingleAsync(ct);
        var now = DateTimeOffset.UtcNow;
        setup.Set<Elevant.Domain.Entities.Operations.CharterAgreement>().Add(new Elevant.Domain.Entities.Operations.CharterAgreement
        {
            PublicId = Guid.NewGuid(), TurnaroundId = turnaround.Id, AirlineId = turnaround.AirlineId, CurrencyCode = "USD",
            PrepaymentStatus = CharterPrepaymentStatus.Confirmed, PrepaymentAmount = 10m,
            PrepaymentReference = "TRF-QA-CHARTER", PrepaymentConfirmedAt = now, PrepaymentConfirmedByAccountId = financeId,
            CreatedByAccountId = financeId, CreatedAt = now, UpdatedAt = now,
        });
        await setup.SaveChangesAsync(ct);
        Elevant.Application.Finance.IssueInvoiceResult issued;
        await using (var scope = provider.CreateAsyncScope())
            issued = await Handler(scope.ServiceProvider).HandleAsync(
                new Elevant.Application.Finance.IssueInvoiceRequest(FinanceAccount, station.PublicId, [operation], Guid.NewGuid()), ct);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        // The airline has no approved contract: only its charter can open the station.
        var contracts = await setup.Contracts.Where(item => item.AirlineId == turnaround.AirlineId).Select(item => item.Id).ToArrayAsync(ct);
        await setup.ContractVersions.Where(item => contracts.Contains(item.ContractId))
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.Status, ContractVersionStatus.Draft), ct);

        // A charter of another airline at another station opens nothing for this one.
        var other = new Elevant.Domain.Entities.Reference.Station { PublicId = Guid.CreateVersion7(),
            AirportId = (await setup.Airports.SingleAsync(item => item.IataCode == "MIA", ct)).Id, Code = "MIA",
            Name = "AVIAM MIA Test", IanaTimeZone = "America/New_York", IsActive = true, CreatedAt = now, UpdatedAt = now };
        setup.Stations.Add(other); await setup.SaveChangesAsync(ct);
        var foreignOrganization = new Organization { PublicId = Guid.NewGuid(), Code = "QA-CHARTER-OTHER", LegalName = "Other charter airline",
            DisplayName = "Other charter airline", Type = OrganizationType.AirlineCustomer, Status = OrganizationStatus.Active };
        setup.Organizations.Add(foreignOrganization); await setup.SaveChangesAsync(ct);
        var foreign = new Elevant.Domain.Entities.Reference.Airline { PublicId = Guid.NewGuid(), OrganizationId = foreignOrganization.Id,
            Name = "Other charter airline", IataCode = "QY", IcaoCode = "QYT", IsActive = true };
        setup.Airlines.Add(foreign); await setup.SaveChangesAsync(ct);
        var foreignTurnaround = new Elevant.Domain.Entities.Operations.Turnaround { PublicId = Guid.NewGuid(), OperationCode = "DEV-TAT-QY",
            AirlineId = foreign.Id, StationId = other.Id, OperationDate = turnaround.OperationDate, AircraftTypeId = turnaround.AircraftTypeId,
            AircraftRegistration = "HI-QY", CurrentStatus = turnaround.CurrentStatus, Source = turnaround.Source, CreatedAt = now, UpdatedAt = now };
        setup.Turnarounds.Add(foreignTurnaround); await setup.SaveChangesAsync(ct);
        setup.Set<Elevant.Domain.Entities.Operations.CharterAgreement>().Add(new Elevant.Domain.Entities.Operations.CharterAgreement
        {
            PublicId = Guid.NewGuid(), TurnaroundId = foreignTurnaround.Id, AirlineId = foreign.Id, CurrencyCode = "USD",
            PrepaymentStatus = CharterPrepaymentStatus.Pending, CreatedByAccountId = financeId,
            CreatedAt = now, UpdatedAt = now,
        });
        await setup.SaveChangesAsync(ct);

        var airlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");
        var today = Elevant.Application.Common.BusinessCalendar.Today(now);
        await using var context = CreateContext(db.ConnectionString);
        var store = new FinanceTreasuryStore(context, new EfActorContextResolver(context, TimeProvider.System), TimeProvider.System);
        var statement = await store.PortalStatementAsync(airlineAccount, today, null, ct);
        Assert.True(statement.IsSuccess);
        var invoice = Assert.Single(statement.Data!.Invoices);
        Assert.Equal((issued.InvoiceId!.Value, station.Code, issued.Total!.Value - 10m), (invoice.Id, invoice.StationCode, invoice.Balance));
        Assert.Equal("PREPAGO TRF-QA-CHARTER", Assert.Single(statement.Data.Receipts).Reference);
        Assert.True((await store.PortalInvoiceAsync(airlineAccount, invoice.Id, ct)).IsSuccess);
        Assert.True((await store.PortalStatementAsync(airlineAccount, today, station.PublicId, ct)).IsSuccess);
        Assert.Equal(FinanceTreasuryFailure.NotFound, (await store.PortalStatementAsync(airlineAccount, today, other.PublicId, ct)).Failure);

        // The rest is paid by card, always the whole balance.
        await using (var cardContext = CreateContext(db.ConnectionString))
        {
            var cards = new EfCardPaymentStore(cardContext, TimeProvider.System, new Elevant.Infrastructure.Finance.SimulatedCardGateway());
            var paid = await cards.PayAsync(new Elevant.Application.Finance.PayInvoiceByCardRequest(airlineAccount, invoice.Id,
                Guid.NewGuid(), "Casey Airline", "4111111111111111", 12, 2030, "123", invoice.Balance), ct);
            Assert.Equal(("Approved", 0m), (paid.Attempt!.Status, paid.InvoiceBalance));
        }
        context.ChangeTracker.Clear();
        Assert.Equal(0m, Assert.Single((await store.PortalStatementAsync(airlineAccount, today, null, ct)).Data!.Invoices).Balance);
    }
}
