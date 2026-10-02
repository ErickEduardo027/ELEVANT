using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class ResolvePreinvoiceDisputeHandlerTests
{
    [Theory]
    [InlineData("Maintain")]
    [InlineData("Void")]
    public async Task RequiresFinanceAuthorityAndAReasonBeforeResolving(string decision)
    {
        var accountId = Guid.NewGuid();
        var preinvoiceId = Guid.NewGuid();
        var requestId = Guid.NewGuid();
        var store = new Stub();
        var anonymous = new ResolvePreinvoiceDisputeHandler(new Resolver(null), store);
        Assert.Equal(ResolvePreinvoiceDisputeFailure.Unauthorized,
            (await anonymous.HandleAsync(new(accountId, preinvoiceId, requestId,
                decision, "Reviewed line evidence"), TestContext.Current.CancellationToken)).Failure);
        Assert.Null(store.Command);

        var actor = new ActorContext(accountId, "finance@dev.elevant.test", "Finance",
            [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
            [new ActorStationScope(Guid.NewGuid(), "PUJ")]);
        var handler = new ResolvePreinvoiceDisputeHandler(new Resolver(actor), store);
        Assert.Equal(ResolvePreinvoiceDisputeFailure.InvalidRequest,
            (await handler.HandleAsync(new(accountId, preinvoiceId, requestId,
                decision, " "), TestContext.Current.CancellationToken)).Failure);
        Assert.Equal(ResolvePreinvoiceDisputeFailure.InvalidRequest,
            (await handler.HandleAsync(new(accountId, preinvoiceId, requestId,
                "Accept", "Reviewed line evidence"), TestContext.Current.CancellationToken)).Failure);
        Assert.Null(store.Command);
        var result = await handler.HandleAsync(new(accountId, preinvoiceId, requestId,
            decision, "Reviewed line evidence"), TestContext.Current.CancellationToken);
        Assert.True(result.IsSuccess);
        Assert.Equal(decision, store.Command?.Decision);
    }

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId,
            CancellationToken cancellationToken = default) => Task.FromResult(actor);
    }

    private sealed class Stub : IPreinvoiceDisputeResolutionStore
    {
        public ResolvePreinvoiceDisputeCommand? Command { get; private set; }
        public Task<ResolvePreinvoiceDisputeResult> ResolveAsync(
            ResolvePreinvoiceDisputeCommand command, CancellationToken cancellationToken = default)
        {
            Command = command;
            return Task.FromResult(ResolvePreinvoiceDisputeResult.Success(
                Guid.NewGuid(), command.PreinvoiceId,
                command.Decision == "Void" ? "Voided" : "Submitted", false));
        }
    }
}
