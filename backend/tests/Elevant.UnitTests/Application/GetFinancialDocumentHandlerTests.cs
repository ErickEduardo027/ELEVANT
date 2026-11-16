using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class GetFinancialDocumentHandlerTests
{
    [Fact]
    public async Task RevokedAirlineSessionCannotReceiveBytesAfterObjectRead()
    {
        var accountId = Guid.NewGuid();
        var organizationId = Guid.NewGuid();
        var invoice = new NonFiscalInvoiceData(Guid.NewGuid(), Guid.NewGuid(),
            Guid.NewGuid(), Guid.NewGuid(), "DEV-NF-001", "USD", 10m,
            DateTimeOffset.UtcNow, []);
        var actor = new ActorContext(accountId, "airline@dev.elevant.test", "Airline",
            [new ActorRole(Guid.NewGuid(), "AIRLINE_CLIENT", "Airline",
                PortalKind.AirlinePortal, "airline")],
            [new ActorMembership(Guid.NewGuid(), organizationId, "Airline", "AIRLINE",
                OrganizationType.AirlineCustomer, MembershipKind.AirlineClient)], []);
        var resolver = new SequencedResolver(actor, null);
        var store = new InvoiceStore(invoice);
        var reader = new GetNonFiscalInvoiceHandler(resolver, store);
        var paymentReader = new GetNonFiscalPaymentHandler(resolver, new PaymentStore());
        var objects = new DocumentStore();
        var handler = new GetFinancialDocumentHandler(reader, paymentReader, objects, store);

        var result = await handler.GetAirlineInvoiceByIdAsync(accountId, invoice.Id,
            TestContext.Current.CancellationToken);

        Assert.False(result.IsSuccess);
        Assert.Equal(AirlinePortalFailure.Unauthorized, result.Failure);
        Assert.True(objects.Opened);
        Assert.Null(result.Document);
    }

    /// <summary>
    /// 4-N02: «Por facturar» opens the PDF of the invoice it just issued with the issuance of Facturación alone (the store
    /// keeps it to the invoices its account issued), and «Facturas» opens every invoice. Reading «Por facturar» alone
    /// opens no PDF, with its lines and amounts, though it still reads the delivery state of the invoice's emails
    /// (1-N08). An account that reads neither gets nothing and the private object is never read.
    /// </summary>
    [Theory]
    [InlineData("finance.invoicing.issue", true, false, true)]
    [InlineData("finance.invoicing.read", false, false, true)]
    [InlineData("finance.reconciliation.read", true, true, true)]
    [InlineData("finance.home.read", false, false, false)]
    [InlineData("finance.charters.read", false, false, false)]
    public async Task FinanceInvoicePdfFollowsThePermissionsOfInvoicing(string permission, bool readable, bool every,
        bool emails)
    {
        var accountId = Guid.NewGuid();
        var stationId = Guid.NewGuid();
        var invoice = new NonFiscalInvoiceData(Guid.NewGuid(), Guid.NewGuid(), Guid.NewGuid(), stationId,
            "NF-001", "USD", 118m, DateTimeOffset.UtcNow, []);
        var actor = new ActorContext(accountId, "finance@dev.elevant.test", "Finance",
            [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
            [new ActorStationScope(stationId, "PUJ")],
            new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance,
                new HashSet<string>(StringComparer.Ordinal) { permission }));
        var resolver = new SequencedResolver(actor, actor);
        var store = new InvoiceStore(invoice);
        var objects = new DocumentStore();
        var handler = new GetFinancialDocumentHandler(new GetNonFiscalInvoiceHandler(resolver, store),
            new GetNonFiscalPaymentHandler(resolver, new PaymentStore()), objects, store);

        var document = await handler.GetFinanceInvoiceByIdAsync(accountId, invoice.Id,
            TestContext.Current.CancellationToken);

        Assert.Equal(readable, document is not null);
        Assert.Equal(readable, objects.Opened);
        Assert.Equal(readable, FinanceInvoicePolicy.CanReadInvoice(actor));
        Assert.Equal(every, FinanceInvoicePolicy.ReadsEveryInvoice(actor));
        Assert.Equal(emails, FinanceInvoicePolicy.CanReadInvoiceEmails(actor));
    }

    [Fact]
    public async Task MissingPaymentDoesNotCreateAReceipt()
    {
        var accountId = Guid.NewGuid();
        var organizationId = Guid.NewGuid();
        var actor = new ActorContext(accountId, "airline@dev.elevant.test", "Airline",
            [new ActorRole(Guid.NewGuid(), "AIRLINE_CLIENT", "Airline",
                PortalKind.AirlinePortal, "airline")],
            [new ActorMembership(Guid.NewGuid(), organizationId, "Airline", "AIRLINE",
                OrganizationType.AirlineCustomer, MembershipKind.AirlineClient)], []);
        var resolver = new SequencedResolver(actor, actor);
        var objects = new DocumentStore();
        var handler = new GetFinancialDocumentHandler(
            new GetNonFiscalInvoiceHandler(resolver, new InvoiceStore(null)),
            new GetNonFiscalPaymentHandler(resolver, new PaymentStore()), objects);

        var result = await handler.GetAirlineReceiptAsync(accountId, Guid.NewGuid(),
            TestContext.Current.CancellationToken);

        Assert.Equal(AirlinePortalFailure.NotFound, result.Failure);
        Assert.False(objects.Opened);
    }

    private sealed class SequencedResolver(params ActorContext?[] actors) : IActorContextResolver
    {
        private int index;
        public Task<ActorContext?> ResolveAsync(Guid accountId,
            CancellationToken cancellationToken = default) =>
            Task.FromResult(actors[Math.Min(index++, actors.Length - 1)]);
    }

    private sealed class InvoiceStore(NonFiscalInvoiceData? invoice) : INonFiscalInvoiceReadStore
    {
        public Task<NonFiscalInvoiceData?> GetForFinanceAsync(Guid accountId, Guid preinvoiceId,
            CancellationToken cancellationToken = default) => Task.FromResult(invoice);
        public Task<NonFiscalInvoiceData?> GetForAirlineAsync(Guid organizationId, Guid preinvoiceId,
            CancellationToken cancellationToken = default) => Task.FromResult(invoice);
        public Task<Guid?> PreinvoiceOfInvoiceAsync(Guid invoiceId, CancellationToken cancellationToken = default) =>
            Task.FromResult(invoice?.Id == invoiceId ? (Guid?)invoice.PreinvoiceId : null);
    }

    private sealed class PaymentStore : INonFiscalPaymentReadStore
    {
        public Task<NonFiscalPaymentLookupData?> GetForFinanceAsync(Guid accountId, Guid invoiceId,
            CancellationToken cancellationToken = default) => Task.FromResult<NonFiscalPaymentLookupData?>(null);
        public Task<NonFiscalPaymentLookupData?> GetForAirlineAsync(Guid organizationId, Guid invoiceId,
            CancellationToken cancellationToken = default) => Task.FromResult<NonFiscalPaymentLookupData?>(
                new NonFiscalPaymentLookupData(invoiceId, null));
    }

    private sealed class DocumentStore : IFinancialDocumentStore
    {
        public bool Opened { get; private set; }
        public Task<FinancialDocumentData> OpenInvoiceAsync(NonFiscalInvoiceData invoice,
            CancellationToken cancellationToken = default)
        {
            Opened = true;
            return Task.FromResult(new FinancialDocumentData(Guid.NewGuid(), "Invoice",
                "invoice.pdf", "%PDF-"u8.ToArray(), new string('0', 64)));
        }
        public Task<FinancialDocumentData> OpenReceiptAsync(NonFiscalPaymentData payment,
            string invoiceNumber, CancellationToken cancellationToken = default)
        {
            Opened = true;
            return Task.FromResult(new FinancialDocumentData(Guid.NewGuid(), "Receipt",
                "receipt.pdf", "%PDF-"u8.ToArray(), new string('0', 64)));
        }
    }
}
