using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class IssueFinanceInvoiceHandlerTests
{
    [Fact]
    public async Task RequiresValidIdentifiersAndFinanceAuthorityBeforeWriting()
    {
        var accountId = Guid.NewGuid();
        var preinvoiceId = Guid.NewGuid();
        var requestId = Guid.NewGuid();
        var store = new Stub();
        var unauthorized = new IssueFinanceInvoiceHandler(new Resolver(null), store);
        Assert.Equal(IssueFinanceInvoiceFailure.Unauthorized,
            (await unauthorized.HandleAsync(accountId, preinvoiceId, requestId,
                TestContext.Current.CancellationToken)).Failure);
        Assert.Equal(IssueFinanceInvoiceFailure.InvalidRequest,
            (await unauthorized.HandleAsync(accountId, Guid.Empty, requestId,
                TestContext.Current.CancellationToken)).Failure);
        Assert.Null(store.Command);

        var actor = new ActorContext(accountId, "finance@dev.elevant.test", "Finance",
            [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
            [new ActorStationScope(Guid.NewGuid(), "PUJ")]);
        var handler = new IssueFinanceInvoiceHandler(new Resolver(actor), store);
        var result = await handler.HandleAsync(accountId, preinvoiceId, requestId,
            TestContext.Current.CancellationToken);
        Assert.True(result.IsSuccess);
        Assert.Equal(new IssueFinanceInvoiceCommand(accountId, preinvoiceId, requestId), store.Command);
    }

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId,
            CancellationToken cancellationToken = default) => Task.FromResult(actor);
    }

    private sealed class Stub : IFinanceInvoiceIssueStore
    {
        public IssueFinanceInvoiceCommand? Command { get; private set; }
        public Task<IssueFinanceInvoiceResult> IssueAsync(IssueFinanceInvoiceCommand command,
            CancellationToken cancellationToken = default)
        {
            Command = command;
            return Task.FromResult(IssueFinanceInvoiceResult.Success(
                Guid.NewGuid(), "DEV-NF-TEST", false));
        }
    }
}
