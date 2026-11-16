using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Realtime;
using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Finance;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// 4-N11: «Por facturar» and «Facturas» hear the invoices of their station. An issuance announces each invoiced
    /// operation and the invoice; a card payment and an adjustment note announce the invoice again. The invoice hint
    /// reaches who reads invoicing or «Facturas»; the operation hint only who reads invoicing; an airline never.
    /// </summary>
    [Fact]
    public async Task FinanceInvoiceHintsReachInvoicingAndInvoicesUnderTheirPermissions()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        var airlineAccount = Guid.Parse("40000000-0000-7000-8000-000000000003");

        async Task<IReadOnlyList<AccountChangeData>> FeedAsync(Guid account, params string[] permissions)
        {
            await using (var dispatch = provider.CreateAsyncScope())
                await dispatch.ServiceProvider.GetRequiredService<IAccountChangeDispatcherStore>().DispatchPendingAsync(100, ct);
            await using var context = CreateContext(database.ConnectionString);
            IActorContextResolver resolver = new EfActorContextResolver(context, TimeProvider.System);
            if (permissions.Length > 0) resolver = new FinanceMemberActors(resolver, permissions);
            var page = await new EfAccountChangeReadStore(context, resolver).ReadAsync(account, 0, 100, ct);
            return page?.Changes ?? [];
        }
        int Count(IReadOnlyList<AccountChangeData> changes, string resource, Guid id) =>
            changes.Count(change => change.Resource == resource && change.ResourceId == id);

        IssueInvoiceResult issued;
        await using (var scope = provider.CreateAsyncScope())
            issued = await Handler(scope.ServiceProvider)
                .HandleAsync(new IssueInvoiceRequest(FinanceAccount, station, [operation], Guid.NewGuid()), ct);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        var invoiceId = issued.InvoiceId!.Value;

        // The issuance: «Por facturar» hears the operation by its own id, «Facturas» the invoice.
        var invoicing = await FeedAsync(FinanceAccount, "finance.invoicing.read");
        Assert.Equal(1, Count(invoicing, "finance_invoices", invoiceId));
        Assert.Equal(1, Count(invoicing, "finance_approved_services", operation));
        Assert.Equal(0, Count(invoicing, "finance_approved_services", invoiceId));
        var reconciliation = await FeedAsync(FinanceAccount, "finance.reconciliation.read");
        Assert.Equal(1, Count(reconciliation, "finance_invoices", invoiceId));
        Assert.Equal(0, Count(reconciliation, "finance_approved_services", operation));
        var receipts = await FeedAsync(FinanceAccount, "finance.receipts.read");
        Assert.Equal(0, Count(receipts, "finance_invoices", invoiceId));
        Assert.Equal(1, Count(receipts, "finance_receipts", invoiceId));

        // The card payment of the portal announces the invoice again.
        await using (var cardContext = CreateContext(database.ConnectionString))
        {
            var paid = await new EfCardPaymentStore(cardContext, TimeProvider.System, new SimulatedCardGateway())
                .PayAsync(new PayInvoiceByCardRequest(airlineAccount, invoiceId, Guid.NewGuid(), "Casey Airline",
                    "4111111111111111", 12, 2030, "123", issued.Total!.Value), ct);
            Assert.Equal("Approved", paid.Attempt!.Status);
        }
        Assert.Equal(2, Count(await FeedAsync(FinanceAccount, "finance.reconciliation.read"), "finance_invoices", invoiceId));

        // So does an adjustment note.
        await using (var scope = provider.CreateAsyncScope())
        {
            var treasury = scope.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>();
            var limits = (await treasury.AdjustmentsAsync(FinanceAccount, invoiceId, ct))!;
            var line = limits.Lines[0];
            var note = await treasury.IssueAdjustmentAsync(FinanceAccount, invoiceId, new FinanceTreasuryAdjustmentInput(
                Guid.NewGuid(), limits.Version, BusinessCalendar.Today(DateTimeOffset.UtcNow), "Servicio cobrado de más",
                "Credit", [new FinanceTreasuryAdjustmentLineInput(line.InvoiceLineId, Math.Min(1m, line.CreditQuantityRemaining), 1m)]), ct);
            Assert.True(note.IsSuccess, $"{note.Failure} {note.Code}");
        }
        Assert.Equal(3, Count(await FeedAsync(FinanceAccount, "finance.invoicing.read"), "finance_invoices", invoiceId));

        // The airline reads its own treasury hints, never Finance's.
        var airline = await FeedAsync(airlineAccount);
        Assert.DoesNotContain(airline, change => change.Resource is "finance_invoices" or "finance_approved_services");
        Assert.Contains(airline, change => change.Resource == "airline_treasury");
    }

    /// <summary>The seeded Finance account as a Finance member with only <paramref name="permissions"/>.</summary>
    private sealed class FinanceMemberActors(IActorContextResolver inner, string[] permissions) : IActorContextResolver
    {
        public async Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default)
        {
            var actor = await inner.ResolveAsync(accountId, cancellationToken);
            return actor is null ? null : actor with
            {
                Access = new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance,
                    new HashSet<string>(permissions, StringComparer.Ordinal)),
            };
        }
    }
}
