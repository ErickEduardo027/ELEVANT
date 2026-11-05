using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class FinanceInvoicePolicyTests
{
    [Theory]
    [InlineData(null, "E310000000001")]
    [InlineData("E310000000001", "E310000000002")]
    [InlineData("E310000009999", "E310000010000")]
    [InlineData("B0100000001", "E310000000001")]
    public void FiscalNumberSequenceContinuesFromTheHighestIssued(string? highest, string expected)
    {
        Assert.Equal(expected, FinanceInvoicePolicy.NextFiscalNumber(highest));
        Assert.True(FinanceInvoicePolicy.IsFiscalNumber(expected));
    }

    [Theory]
    [InlineData("E31000000001")]
    [InlineData("E32000000000 1")]
    [InlineData("e310000000001")]
    [InlineData("E31000000000A")]
    public void RejectsMalformedFiscalNumbers(string value) => Assert.False(FinanceInvoicePolicy.IsFiscalNumber(value));

    [Fact]
    public void FiscalNumberOutsideTheTenDigitRangeIsRejected()
    {
        Assert.Throws<ArgumentOutOfRangeException>(() => FinanceInvoicePolicy.FormatFiscalNumber(0));
        Assert.Throws<ArgumentOutOfRangeException>(() => FinanceInvoicePolicy.FormatFiscalNumber(10_000_000_000));
    }

    [Theory]
    [InlineData("100", "18.00")]
    [InlineData("0.03", "0.01")]
    [InlineData("12.345", "2.22")]
    [InlineData("0", "0.00")]
    public void ItbisIsEighteenPercentRoundedToCents(string net, string tax) =>
        Assert.Equal(decimal.Parse(tax, System.Globalization.CultureInfo.InvariantCulture),
            FinanceInvoicePolicy.Tax(decimal.Parse(net, System.Globalization.CultureInfo.InvariantCulture)));

    [Fact]
    public void SecurityCodeIsDeterministicAndDependsOnTheCertifiedContent()
    {
        var at = new DateTimeOffset(2026, 11, 5, 14, 0, 0, TimeSpan.Zero);
        var code = FinanceInvoicePolicy.SecurityCode("E310000000001", 118m, at, "AAL");
        Assert.Equal(6, code.Length);
        Assert.All(code, character => Assert.Contains(character, "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"));
        Assert.Equal(code, FinanceInvoicePolicy.SecurityCode("E310000000001", 118m, at, "AAL"));
        Assert.NotEqual(code, FinanceInvoicePolicy.SecurityCode("E310000000002", 118m, at, "AAL"));
        Assert.NotEqual(code, FinanceInvoicePolicy.SecurityCode("E310000000001", 118.01m, at, "AAL"));
    }

    [Fact]
    public void ApplyItbisTaxesTheComputedNetAndExcludedLinesAddNothing()
    {
        var now = new DateTimeOffset(2026, 11, 5, 14, 0, 0, TimeSpan.Zero);
        var line = new PreinvoiceLine { Amount = 999m, ComputedAmount = 250m };
        FinanceInvoicePolicy.ApplyItbis(line, now);
        Assert.Equal(250m, line.NetAmount);
        Assert.Equal(45m, line.TaxAmount);
        Assert.Equal(295m, line.GrossAmount);
        Assert.Equal(295m, line.Amount);
        Assert.Equal(FinanceTaxTreatment.Taxable, line.TaxTreatment);
        Assert.Equal(FinanceInvoicePolicy.ItbisPolicyId, line.TaxPolicyPublicId);
        Assert.Equal(now, line.TaxCapturedAt);

        var excluded = new PreinvoiceLine { Amount = 80m, IsExcluded = true };
        FinanceInvoicePolicy.ApplyItbis(excluded, now);
        Assert.Equal(0m, excluded.NetAmount);
        Assert.Equal(0m, excluded.Amount);
    }

    [Fact]
    public async Task HandlerValidatesTheRequestAndRequiresIssuePermissionInTheStation()
    {
        var accountId = Guid.NewGuid();
        var station = Guid.NewGuid();
        var store = new Store();
        IssueInvoiceRequest Request(params Guid[] operations) => new(accountId, station, operations, Guid.NewGuid());
        var finance = Actor(accountId, "FINANZAS", station);
        var handler = new IssueInvoiceHandler(new Resolver(finance), store);
        var ct = TestContext.Current.CancellationToken;

        Assert.Equal(IssueInvoiceFailure.InvalidRequest, (await handler.HandleAsync(Request(), ct)).Failure);
        var duplicated = Guid.NewGuid();
        Assert.Equal(IssueInvoiceFailure.InvalidRequest, (await handler.HandleAsync(Request(duplicated, duplicated), ct)).Failure);
        Assert.Equal(IssueInvoiceFailure.InvalidRequest, (await handler.HandleAsync(
            Request(Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToArray()), ct)).Failure);
        Assert.Equal(IssueInvoiceFailure.Unauthorized, (await new IssueInvoiceHandler(new Resolver(null), store)
            .HandleAsync(Request(Guid.NewGuid()), ct)).Failure);
        Assert.Equal(IssueInvoiceFailure.Forbidden, (await new IssueInvoiceHandler(
            new Resolver(Actor(accountId, "FINANZAS", Guid.NewGuid())), store).HandleAsync(Request(Guid.NewGuid()), ct)).Failure);
        Assert.Equal(IssueInvoiceFailure.Forbidden, (await new IssueInvoiceHandler(
            new Resolver(Actor(accountId, "OCC", station)), store).HandleAsync(Request(Guid.NewGuid()), ct)).Failure);
        Assert.Null(store.Request);

        var valid = Request(Guid.NewGuid(), Guid.NewGuid());
        Assert.True((await handler.HandleAsync(valid, ct)).IsSuccess);
        Assert.Equal(valid, store.Request);
    }

    private static ActorContext Actor(Guid accountId, string role, Guid station) =>
        new(accountId, "finance@dev.elevant.test", "Finance",
            [new ActorRole(Guid.NewGuid(), role, role, PortalKind.BackOffice, "staff")],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
            [new ActorStationScope(station, "PUJ")]);

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId, CancellationToken cancellationToken = default) =>
            Task.FromResult(actor);
    }

    private sealed class Store : IInvoiceIssuanceStore
    {
        public IssueInvoiceRequest? Request { get; private set; }

        public Task<IssueInvoiceResult> IssueAsync(IssueInvoiceRequest request, CancellationToken cancellationToken = default)
        {
            Request = request;
            return Task.FromResult(IssueInvoiceResult.Success(Guid.NewGuid(), "DEV-NF-TEST", "E310000000001", 118m, "USD", false));
        }
    }
}
