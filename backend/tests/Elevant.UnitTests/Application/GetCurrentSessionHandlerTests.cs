using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Application.Identity.GetCurrentSession;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class GetCurrentSessionHandlerTests
{
    [Fact]
    public async Task CurrentSessionReResolvesEffectiveActor()
    {
        var actor = IdentityTestData.CreateActor();
        var resolver = new StubActorContextResolver(actor);
        var handler = new GetCurrentSessionHandler(resolver);

        var result = await handler.HandleAsync(
            new GetCurrentSessionQuery(IdentityTestData.AccountId),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(actor, result.Actor);
        Assert.Equal(IdentityTestData.AccountId, resolver.ResolvedAccountId);
        Assert.Equal(1, resolver.CallCount);
    }

    [Fact]
    public async Task EmptyAccountIdentityIsRejectedWithoutResolution()
    {
        var resolver = new StubActorContextResolver(IdentityTestData.CreateActor());
        var handler = new GetCurrentSessionHandler(resolver);

        var result = await handler.HandleAsync(
            new GetCurrentSessionQuery(Guid.Empty),
            TestContext.Current.CancellationToken);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Actor);
        Assert.Equal(0, resolver.CallCount);
    }

    [Fact]
    public async Task MissingActorInvalidatesSession()
    {
        var resolver = new StubActorContextResolver(null);
        var handler = new GetCurrentSessionHandler(resolver);

        var result = await handler.HandleAsync(
            new GetCurrentSessionQuery(IdentityTestData.AccountId),
            TestContext.Current.CancellationToken);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Actor);
    }

    [Fact]
    public async Task ActorForDifferentAccountInvalidatesSession()
    {
        var resolver = new StubActorContextResolver(IdentityTestData.CreateActor(Guid.NewGuid()));
        var handler = new GetCurrentSessionHandler(resolver);

        var result = await handler.HandleAsync(
            new GetCurrentSessionQuery(IdentityTestData.AccountId),
            TestContext.Current.CancellationToken);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Actor);
    }

    [Fact]
    public async Task ActorWithoutEffectiveScopeInvalidatesSession()
    {
        var actor = IdentityTestData.CreateActor() with { Memberships = [] };
        var resolver = new StubActorContextResolver(actor);
        var handler = new GetCurrentSessionHandler(resolver);

        var result = await handler.HandleAsync(
            new GetCurrentSessionQuery(IdentityTestData.AccountId),
            TestContext.Current.CancellationToken);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Actor);
    }

    [Fact]
    public async Task ActorWithUnknownPortalInvalidatesSession()
    {
        var actor = IdentityTestData.CreateActor();
        var invalidRole = actor.Roles[0] with { Portal = (PortalKind)int.MaxValue };
        var resolver = new StubActorContextResolver(actor with { Roles = [invalidRole] });
        var handler = new GetCurrentSessionHandler(resolver);

        var result = await handler.HandleAsync(
            new GetCurrentSessionQuery(IdentityTestData.AccountId),
            TestContext.Current.CancellationToken);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Actor);
    }

    [Theory]
    [MemberData(nameof(MalformedActors))]
    public async Task MalformedActorInvalidatesSession(ActorContext actor)
    {
        var resolver = new StubActorContextResolver(actor);
        var handler = new GetCurrentSessionHandler(resolver);

        var result = await handler.HandleAsync(
            new GetCurrentSessionQuery(IdentityTestData.AccountId),
            TestContext.Current.CancellationToken);

        Assert.False(result.IsSuccess);
        Assert.Null(result.Actor);
        Assert.Equal(1, resolver.CallCount);
    }

    public static TheoryData<ActorContext> MalformedActors
    {
        get
        {
            var actor = IdentityTestData.CreateActor();
            var role = actor.Roles[0];
            var membership = actor.Memberships[0];
            var station = actor.StationScopes[0];

            return new TheoryData<ActorContext>
            {
                actor with { Email = " " },
                actor with { DisplayName = "" },
                actor with { Roles = null! },
                actor with { Roles = [null!] },
                actor with { Roles = [role with { RoleId = Guid.Empty }] },
                actor with { Roles = [role with { Code = "" }] },
                actor with { Roles = [role with { Name = " " }] },
                actor with { Roles = [role with { UserType = "" }] },
                actor with { Memberships = null! },
                actor with { Memberships = [null!] },
                actor with { Memberships = [membership with { MembershipId = Guid.Empty }] },
                actor with { Memberships = [membership with { OrganizationId = Guid.Empty }] },
                actor with { Memberships = [membership with { OrganizationCode = "" }] },
                actor with { Memberships = [membership with { OrganizationName = " " }] },
                actor with
                {
                    Memberships =
                    [
                        membership with
                        {
                            OrganizationType = (OrganizationType)int.MaxValue,
                        },
                    ],
                },
                actor with
                {
                    Memberships = [membership with { Kind = (MembershipKind)int.MaxValue }],
                },
                actor with { StationScopes = null! },
                actor with { StationScopes = [null!] },
                actor with { StationScopes = [station with { StationId = Guid.Empty }] },
                actor with { StationScopes = [station with { StationCode = "" }] },
            };
        }
    }

    private sealed class StubActorContextResolver(ActorContext? actor) : IActorContextResolver
    {
        public int CallCount { get; private set; }

        public Guid? ResolvedAccountId { get; private set; }

        public Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            CallCount++;
            ResolvedAccountId = accountId;
            return Task.FromResult(actor);
        }
    }
}
