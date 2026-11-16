using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class HumanResourcesShiftWritePolicyTests
{
    [Theory]
    [InlineData(true, true)]
    [InlineData(false, false)]
    public void OccWriteRequiresTheRequestedStationGrant(bool matchingGrant,
        bool expected)
    {
        var stationId = Guid.NewGuid();
        var actor = new ActorContext(Guid.NewGuid(), "synthetic@example.test", "Synthetic User",
            [new ActorRole(Guid.NewGuid(), "ADMIN_OCC", "OCC", PortalKind.BackOffice, "Internal")],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                OrganizationType.AviamOperator, MembershipKind.InternalStaff)],
            [new ActorStationScope(matchingGrant ? stationId : Guid.NewGuid(), "PUJ")]);

        Assert.Equal(expected, HumanResourcesShiftWritePolicy.CanRecord(actor, stationId));
    }

    [Fact]
    public void OccWithoutAnyStationGrantCannotRecord()
    {
        var actor = new ActorContext(Guid.NewGuid(), "synthetic@example.test", "Synthetic User",
            [new ActorRole(Guid.NewGuid(), "ADMIN_OCC", "OCC", PortalKind.BackOffice, "Internal")],
            [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                OrganizationType.AviamOperator, MembershipKind.InternalStaff)], []);

        Assert.False(HumanResourcesShiftWritePolicy.CanRecord(actor, Guid.NewGuid()));
    }

    [Theory]
    [InlineData("ADMIN_OCC", true, true)]
    [InlineData("GESTION_HUMANA", true, true)]
    [InlineData("SUPERADMIN", true, true)]
    [InlineData("FINANZAS", true, false)]
    [InlineData("ADMIN_OCC", false, false)]
    public void OccAndHumanResourcesSchedulersMayRecordRampShifts(string roleCode,
        bool hasInternalMembership, bool expected)
    {
        var stationId = Guid.NewGuid();
        var actor = new ActorContext(Guid.NewGuid(), "synthetic@example.test", "Synthetic User",
            [new ActorRole(Guid.NewGuid(), roleCode, roleCode, PortalKind.BackOffice, "Internal")],
            hasInternalMembership
                ? [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                    OrganizationType.AviamOperator, MembershipKind.InternalStaff)]
                : [],
            [new ActorStationScope(stationId, "PUJ")]);

        Assert.Equal(expected, HumanResourcesShiftWritePolicy.CanRecord(actor, stationId));
    }

    [Fact]
    public void MissingActorCannotRecordRampShifts() =>
        Assert.False(HumanResourcesShiftWritePolicy.CanRecord(null, Guid.NewGuid()));
}
