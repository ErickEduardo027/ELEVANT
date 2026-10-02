using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class CreatePreinvoiceDraftHandlerTests
{
    private static readonly Guid AccountId = Guid.NewGuid();
    private static readonly Guid StationId = Guid.NewGuid();
    private static readonly DateOnly Today = new(2026, 9, 26);

    [Fact]
    public async Task FinanceCanSendAValidatedScopedSelection()
    {
        var store = new StubStore();
        var request = new CreatePreinvoiceDraftCommand(AccountId, StationId, Today, Today,
            Guid.NewGuid(), [Guid.NewGuid()]);

        var result = await new CreatePreinvoiceDraftHandler(new Resolver(FinanceActor()), store)
            .HandleAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(request, store.Request);
        Assert.True(result.IsSuccess);
    }

    [Theory]
    [InlineData("other-role", PreinvoiceDraftFailure.Forbidden)]
    [InlineData("other-station", PreinvoiceDraftFailure.NotFound)]
    [InlineData("duplicate", PreinvoiceDraftFailure.InvalidRequest)]
    [InlineData("long-window", PreinvoiceDraftFailure.InvalidRequest)]
    [InlineData("default-date", PreinvoiceDraftFailure.InvalidRequest)]
    public async Task InvalidCallerOrSelectionNeverReachesWriter(
        string scenario, PreinvoiceDraftFailure failure)
    {
        var actor = FinanceActor();
        var lineId = Guid.NewGuid();
        var request = new CreatePreinvoiceDraftCommand(AccountId, StationId, Today, Today,
            Guid.NewGuid(), [lineId]);
        if (scenario == "other-role")
            actor = actor with { Roles = [actor.Roles[0] with { Code = "ADMIN_OCC" }] };
        if (scenario == "other-station")
            request = request with { StationId = Guid.NewGuid() };
        if (scenario == "duplicate")
            request = request with { ServiceIds = [lineId, lineId] };
        if (scenario == "long-window")
            request = request with { To = Today.AddDays(31) };
        if (scenario == "default-date")
            request = request with { From = default, To = default };
        var store = new StubStore();

        var result = await new CreatePreinvoiceDraftHandler(new Resolver(actor), store)
            .HandleAsync(request, TestContext.Current.CancellationToken);

        Assert.Equal(failure, result.Failure);
        Assert.Null(store.Request);
    }

    private static ActorContext FinanceActor() => new(AccountId, "finance@dev.elevant.test", "Finance",
        [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
        [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
            OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
        [new ActorStationScope(StationId, "PUJ")]);

    private sealed class Resolver(ActorContext? actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId,
            CancellationToken cancellationToken = default) => Task.FromResult(actor);
    }

    private sealed class StubStore : IPreinvoiceDraftStore
    {
        public CreatePreinvoiceDraftCommand? Request { get; private set; }

        public Task<PreinvoiceDraftResult> CreateAsync(CreatePreinvoiceDraftCommand request,
            CancellationToken cancellationToken = default)
        {
            Request = request;
            return Task.FromResult(PreinvoiceDraftResult.Success(Guid.NewGuid(), false));
        }

        public Task<PreinvoiceDraftDetail?> GetAsync(Guid accountId, Guid draftId,
            CancellationToken cancellationToken = default) => throw new NotImplementedException();

        public Task<IReadOnlyList<Elevant.Application.Commercial.PreinvoiceDisputeData>?> GetDisputesAsync(
            Guid accountId, Guid draftId, CancellationToken cancellationToken = default) =>
            throw new NotImplementedException();
    }
}
