using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

internal static class RampExecutionTestData
{
    public static readonly Guid AccountId =
        Guid.Parse("40000000-0000-7000-8000-000000000002");
    public static readonly Guid StationId =
        Guid.Parse("20000000-0000-7000-8000-000000000003");
    public static readonly Guid SecondStationId =
        Guid.Parse("20000000-0000-7000-8000-000000000013");
    public static readonly Guid OperationId =
        Guid.Parse("70000000-0000-7000-8000-000000000005");
    public static readonly Guid ChecklistId =
        Guid.Parse("70000000-0000-7000-8000-000000000011");
    public static readonly Guid ServiceId =
        Guid.Parse("70000000-0000-7000-8000-000000000007");
    public static readonly Guid ItemId =
        Guid.Parse("70000000-0000-7000-8000-000000000010");
    public static readonly Guid InstallationId =
        Guid.Parse("81000000-0000-7000-8000-000000000001");
    public static readonly Guid IdempotencyKey =
        Guid.Parse("82000000-0000-7000-8000-000000000001");
    public static readonly Guid ReceiptId =
        Guid.Parse("83000000-0000-7000-8000-000000000001");

    public static ActorContext CreateActor() => new(
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
        [new ActorStationScope(StationId, "PUJ")]);
}

internal sealed class RampExecutionActorResolver(ActorContext? actor) : IActorContextResolver
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
