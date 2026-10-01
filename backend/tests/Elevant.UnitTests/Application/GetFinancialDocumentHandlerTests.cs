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
        var reader = new GetNonFiscalInvoiceHandler(resolver, new InvoiceStore(invoice));
        var paymentReader = new GetNonFiscalPaymentHandler(resolver, new PaymentStore());
        var objects = new DocumentStore();
        var handler = new GetFinancialDocumentHandler(reader, paymentReader, objects);

        var result = await handler.GetAirlineInvoiceAsync(accountId, invoice.PreinvoiceId,
            TestContext.Current.CancellationToken);

        Assert.False(result.IsSuccess);
        Assert.Equal(AirlinePortalFailure.Unauthorized, result.Failure);
        Assert.True(objects.Opened);
        Assert.Null(result.Document);
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
