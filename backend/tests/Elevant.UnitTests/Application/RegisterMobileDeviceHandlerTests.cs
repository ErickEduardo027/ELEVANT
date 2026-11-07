using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Identity;
using Elevant.Application.Integration;
using Elevant.Application.Integration.RegisterMobileDevice;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class RegisterMobileDeviceHandlerTests
{
    private static readonly Guid AccountId =
        Guid.Parse("40000000-0000-7000-8000-000000000002");
    private static readonly Guid InstallationId =
        Guid.Parse("81000000-0000-7000-8000-000000000001");
    private static readonly Guid DeviceId =
        Guid.Parse("81000000-0000-7000-8000-000000000002");
    private static readonly DateTimeOffset LastSeenAt =
        new(2026, 9, 17, 12, 0, 0, TimeSpan.Zero);

    [Fact]
    public async Task ValidCommandNormalizesMetadataAndUsesAuthenticatedAccount()
    {
        var device = new MobileDeviceRegistrationData(
            InstallationId,
            "Android",
            "1.2.3",
            LastSeenAt);
        var store = new StubStore(MobileDeviceRegistrationWriteResult.Success(device, DeviceId));
        var handler = new RegisterMobileDeviceHandler(
            new StubActorContextResolver(CreateActor()),
            store);

        var result = await handler.HandleAsync(
            new RegisterMobileDeviceCommand(
                AccountId,
                InstallationId,
                MobilePlatform.Android,
                " 1.2.3 ",
                " Ramp tablet ",
                " Android 16 "),
            TestContext.Current.CancellationToken);

        Assert.True(result.IsSuccess);
        Assert.Same(device, result.Device);
        Assert.NotNull(store.Request);
        Assert.Equal(AccountId, store.Request.ActorAccountId);
        Assert.Equal(InstallationId, store.Request.InstallationId);
        Assert.Equal("1.2.3", store.Request.AppVersion);
        Assert.Equal("Ramp tablet", store.Request.DeviceName);
        Assert.Equal("Android 16", store.Request.OperatingSystemVersion);
    }

    [Theory]
    [InlineData(true, "1.2.3")]
    [InlineData(false, "")]
    [InlineData(false, "   ")]
    [InlineData(false, "123456789012345678901234567890123")]
    public async Task InvalidInputIsRejectedBeforeResolvingActor(
        bool emptyInstallation,
        string appVersion)
    {
        var resolver = new StubActorContextResolver(CreateActor());
        var store = new StubStore(MobileDeviceRegistrationWriteResult.Success(
            new MobileDeviceRegistrationData(InstallationId, "Android", "1", LastSeenAt),
            DeviceId));
        var handler = new RegisterMobileDeviceHandler(resolver, store);

        var result = await handler.HandleAsync(
            new RegisterMobileDeviceCommand(
                AccountId,
                emptyInstallation ? Guid.Empty : InstallationId,
                MobilePlatform.Android,
                appVersion,
                null,
                null),
            TestContext.Current.CancellationToken);

        Assert.Equal(RegisterMobileDeviceFailure.InvalidRequest, result.Failure);
        Assert.Equal(0, resolver.CallCount);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task MissingActorIsUnauthorized()
    {
        var store = new StubStore(MobileDeviceRegistrationWriteResult.Failed(
            MobileDeviceRegistrationWriteFailure.Forbidden));
        var handler = new RegisterMobileDeviceHandler(
            new StubActorContextResolver(null),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(RegisterMobileDeviceFailure.Unauthorized, result.Failure);
        Assert.Null(store.Request);
    }

    [Fact]
    public async Task ActorWithoutRampRoleIsForbidden()
    {
        var actor = CreateActor() with
        {
            Roles = [CreateActor().Roles[0] with { Code = "ADMIN_OCC" }],
        };
        var store = new StubStore(MobileDeviceRegistrationWriteResult.Failed(
            MobileDeviceRegistrationWriteFailure.Forbidden));
        var handler = new RegisterMobileDeviceHandler(
            new StubActorContextResolver(actor),
            store);

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(RegisterMobileDeviceFailure.Forbidden, result.Failure);
        Assert.Null(store.Request);
    }

    [Theory]
    [InlineData(
        MobileDeviceRegistrationWriteFailure.Forbidden,
        RegisterMobileDeviceFailure.Forbidden)]
    [InlineData(
        MobileDeviceRegistrationWriteFailure.Conflict,
        RegisterMobileDeviceFailure.Conflict)]
    public async Task StoreFailuresAreMapped(
        MobileDeviceRegistrationWriteFailure storeFailure,
        RegisterMobileDeviceFailure expectedFailure)
    {
        var handler = new RegisterMobileDeviceHandler(
            new StubActorContextResolver(CreateActor()),
            new StubStore(MobileDeviceRegistrationWriteResult.Failed(storeFailure)));

        var result = await handler.HandleAsync(
            CreateCommand(),
            TestContext.Current.CancellationToken);

        Assert.Equal(expectedFailure, result.Failure);
        Assert.Null(result.Device);
    }

    [Fact]
    public async Task CancellationIsObservedBeforeResolvingActor()
    {
        using var source = new CancellationTokenSource();
        await source.CancelAsync();
        var resolver = new StubActorContextResolver(CreateActor());
        var handler = new RegisterMobileDeviceHandler(
            resolver,
            new StubStore(MobileDeviceRegistrationWriteResult.Failed(
                MobileDeviceRegistrationWriteFailure.Conflict)));

        await Assert.ThrowsAsync<OperationCanceledException>(() =>
            handler.HandleAsync(CreateCommand(), source.Token));
        Assert.Equal(0, resolver.CallCount);
    }

    private static RegisterMobileDeviceCommand CreateCommand() => new(
        AccountId,
        InstallationId,
        MobilePlatform.Android,
        "1.2.3",
        "Ramp tablet",
        "Android 16");

    private static ActorContext CreateActor() => new(
        AccountId,
        "ramp.agent@dev.elevant.test",
        "Riley Ramp",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000002"),
                "RAMP_AGENT",
                "Ramp Agent",
                PortalKind.RampMobileApp,
                "ramp_agent"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000002"),
                Guid.Parse("10000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM Development",
                OrganizationType.AviamOperator,
                MembershipKind.InternalStaff),
        ],
        [new ActorStationScope(
            Guid.Parse("20000000-0000-7000-8000-000000000003"),
            "PUJ")]);

    private sealed class StubActorContextResolver(ActorContext? actor) : IActorContextResolver
    {
        public int CallCount { get; private set; }

        public Task<ActorContext?> ResolveAsync(
            Guid accountId,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            CallCount++;
            return Task.FromResult(actor);
        }
    }

    private sealed class StubStore(MobileDeviceRegistrationWriteResult result)
        : IMobileDeviceCommandStore
    {
        public MobileDeviceRegistrationWriteRequest? Request { get; private set; }

        public Task<MobileDeviceRegistrationWriteResult> RegisterAsync(
            MobileDeviceRegistrationWriteRequest request,
            CancellationToken cancellationToken = default)
        {
            cancellationToken.ThrowIfCancellationRequested();
            Request = request;
            return Task.FromResult(result);
        }

        public Task<MobileDeviceReleaseWriteResult> ReleaseAsync(
            MobileDeviceReleaseWriteRequest request,
            CancellationToken cancellationToken = default) =>
            throw new NotSupportedException("The registration handler never releases a tablet.");
    }
}
