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

    /// <summary>4-N06 and 4-N29: the refusals name their code; versions, when sent, cover every operation once.</summary>
    [Fact]
    public async Task HandlerNamesItsCodesAndRequiresVersionsForEveryOperation()
    {
        var accountId = Guid.NewGuid();
        var station = Guid.NewGuid();
        var store = new Store();
        var handler = new IssueInvoiceHandler(new Resolver(Actor(accountId, "FINANZAS", station)), store);
        var ct = TestContext.Current.CancellationToken;
        var (first, second) = (Guid.NewGuid(), Guid.NewGuid());
        IssueInvoiceRequest Request(IReadOnlyList<InvoiceOperationVersion>? versions, params Guid[] operations) =>
            new(accountId, station, operations, Guid.NewGuid(), versions);

        var tooMany = await handler.HandleAsync(Request(null, Enumerable.Range(0, 101).Select(_ => Guid.NewGuid()).ToArray()), ct);
        Assert.Equal((IssueInvoiceFailure.InvalidRequest, "too_many_operations"), (tooMany.Failure!.Value, tooMany.Reason));
        Assert.Equal("invalid_invoice_request", (await handler.HandleAsync(Request(null), ct)).Reason);
        foreach (var versions in new IReadOnlyList<InvoiceOperationVersion>[]
                 {
                     [new(first, "AAAAAAAAB9E=")],
                     [new(first, "AAAAAAAAB9E="), new(second, " ")],
                     [new(first, "AAAAAAAAB9E="), new(first, "AAAAAAAAB9E=")],
                     [new(first, "AAAAAAAAB9E="), new(Guid.NewGuid(), "AAAAAAAAB9E=")],
                     [new(first, "AAAAAAAAB9E="), new(second, new string('A', 65))],
                 })
        {
            var refused = await handler.HandleAsync(Request(versions, first, second), ct);
            Assert.Equal((IssueInvoiceFailure.InvalidRequest, "invalid_invoice_request"), (refused.Failure!.Value, refused.Reason));
        }
        Assert.Null(store.Request);
        var forbidden = await new IssueInvoiceHandler(new Resolver(Actor(accountId, "OCC", station)), store)
            .HandleAsync(Request(null, first), ct);
        Assert.Equal((IssueInvoiceFailure.Forbidden, "forbidden"), (forbidden.Failure!.Value, forbidden.Reason));

        var versioned = Request([new(second, "AAAAAAAAB9E="), new(first, "AAAAAAAAB9F=")], first, second);
        Assert.True((await handler.HandleAsync(versioned, ct)).IsSuccess);
        Assert.Equal(versioned.OperationVersions, store.Request!.OperationVersions);
    }

    [Theory]
    [InlineData("2026-11-01", "2026-11-01", true)]
    [InlineData("2026-11-01", "2026-12-01", true)]
    [InlineData("2026-11-01", "2026-12-02", false)]
    [InlineData("2026-11-02", "2026-11-01", false)]
    public void AnInvoiceSpansAtMostThirtyOneDays(string from, string to, bool fits) =>
        Assert.Equal(fits, FinanceInvoicePolicy.FitsWindow(
            DateOnly.Parse(from, System.Globalization.CultureInfo.InvariantCulture),
            DateOnly.Parse(to, System.Globalization.CultureInfo.InvariantCulture)));

    /// <summary>4-N07: the closure needs its key, the versions and a reason of 5 to 500 characters.</summary>
    [Fact]
    public async Task NoChargeClosureValidatesKeyVersionsAndReason()
    {
        var accountId = Guid.NewGuid();
        var station = Guid.NewGuid();
        var store = new Store();
        var handler = new CloseOperationsWithoutChargeHandler(new Resolver(Actor(accountId, "FINANZAS", station)), store);
        var ct = TestContext.Current.CancellationToken;
        var operation = Guid.NewGuid();
        NoChargeClosureCommand Command(string reason = "Tarifa cero acordada", Guid? key = null,
            params InvoiceOperationVersion[] operations) =>
            new(accountId, station, operations.Length == 0 ? [new(operation, "AAAAAAAAB9E=")] : operations, reason,
                key ?? Guid.NewGuid());

        Assert.Equal("idempotency_key_required", (await handler.HandleAsync(Command(key: Guid.Empty), ct)).Code);
        Assert.Equal("expected_version_required",
            (await handler.HandleAsync(Command(operations: new InvoiceOperationVersion(operation, "")), ct)).Code);
        Assert.Equal("invalid_invoice_request", (await handler.HandleAsync(Command(operations:
            [new InvoiceOperationVersion(operation, "AAAAAAAAB9E="), new InvoiceOperationVersion(operation, "AAAAAAAAB9E=")]), ct)).Code);
        Assert.Equal("too_many_operations", (await handler.HandleAsync(Command(operations: Enumerable.Range(0, 101)
            .Select(_ => new InvoiceOperationVersion(Guid.NewGuid(), "AAAAAAAAB9E=")).ToArray()), ct)).Code);
        foreach (var reason in new[] { "", "   ", "Cero", new string('x', 501) })
            Assert.Equal("reason_required", (await handler.HandleAsync(Command(reason), ct)).Code);
        Assert.Null(store.Closure);
        Assert.Equal("forbidden", (await new CloseOperationsWithoutChargeHandler(
            new Resolver(Actor(accountId, "OCC", station)), store).HandleAsync(Command(), ct)).Code);

        Assert.True((await handler.HandleAsync(Command("  Paquete ya cobrado  "), ct)).IsSuccess);
        Assert.Equal("Paquete ya cobrado", store.Closure!.Reason);
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

        public NoChargeClosureCommand? Closure { get; private set; }

        public Task<IssueInvoiceResult> IssueAsync(IssueInvoiceRequest request, CancellationToken cancellationToken = default)
        {
            Request = request;
            return Task.FromResult(IssueInvoiceResult.Success(Guid.NewGuid(), "DEV-NF-TEST", "E310000000001", 118m, "USD", false));
        }

        public Task<NoChargeClosureResult> CloseWithoutChargeAsync(NoChargeClosureCommand request,
            CancellationToken cancellationToken = default)
        {
            Closure = request;
            return Task.FromResult(NoChargeClosureResult.Success(
                new NoChargeClosureData(Guid.NewGuid(), request.Operations.Select(item => item.OperationId).ToArray()), false));
        }
    }
}
