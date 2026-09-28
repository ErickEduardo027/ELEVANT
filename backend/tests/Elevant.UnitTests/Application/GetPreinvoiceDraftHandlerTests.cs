using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class GetPreinvoiceDraftHandlerTests
{
    [Fact]
    public async Task FinanceReadsOneScopedDraft()
    {
        var account = Guid.NewGuid();
        var station = Guid.NewGuid();
        var draft = Guid.NewGuid();
        var detail = new PreinvoiceDraftDetail(draft, Guid.NewGuid(), "Test Airline",
            station, new DateOnly(2026, 9, 1), new DateOnly(2026, 9, 26),
            "USD", 100m, "Draft", []);
        var store = new StubStore(detail);
        var actor = new ActorContext(account, "finance@dev.elevant.test", "Finance",
            [new ActorRole(Guid.NewGuid(), "FINANZAS", "Finance", PortalKind.BackOffice, "finance")],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
            [new ActorStationScope(station, "PUJ")]);

        var result = await new GetPreinvoiceDraftHandler(new Resolver(actor), store)
            .HandleAsync(account, draft, TestContext.Current.CancellationToken);

        Assert.Equal(detail, result);
        Assert.Equal((account, draft), store.Request);
    }

    private sealed class Resolver(ActorContext actor) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid accountId,
            CancellationToken cancellationToken = default) => Task.FromResult<ActorContext?>(actor);
    }

    private sealed class StubStore(PreinvoiceDraftDetail detail) : IPreinvoiceDraftStore
    {
        public (Guid Account, Guid Draft)? Request { get; private set; }
        public Task<PreinvoiceDraftResult> CreateAsync(CreatePreinvoiceDraftCommand request,
            CancellationToken cancellationToken = default) => throw new NotImplementedException();
        public Task<PreinvoiceDraftDetail?> GetAsync(Guid accountId, Guid draftId,
            CancellationToken cancellationToken = default)
        {
            Request = (accountId, draftId);
            return Task.FromResult<PreinvoiceDraftDetail?>(detail);
        }

        public Task<IReadOnlyList<Elevant.Application.Commercial.PreinvoiceDisputeData>?> GetDisputesAsync(
            Guid accountId, Guid draftId, CancellationToken cancellationToken = default) =>
            Task.FromResult<IReadOnlyList<Elevant.Application.Commercial.PreinvoiceDisputeData>?>([]);
    }
}
