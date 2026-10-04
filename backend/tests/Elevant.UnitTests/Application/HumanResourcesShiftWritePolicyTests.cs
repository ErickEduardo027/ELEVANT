using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

public sealed class HumanResourcesShiftWritePolicyTests
{
    [Theory]
    [InlineData("ADMIN_OCC", true, true)]
    [InlineData("GESTION_HUMANA", true, false)]
    [InlineData("SUPERADMIN", true, false)]
    [InlineData("ADMIN_OCC", false, false)]
    public void OnlyInternalOccMayRecordRampShifts(string roleCode,
        bool hasInternalMembership, bool expected)
    {
        var actor = new ActorContext(Guid.NewGuid(), "synthetic@example.test", "Synthetic User",
            [new ActorRole(Guid.NewGuid(), roleCode, roleCode, PortalKind.BackOffice, "Internal")],
            hasInternalMembership
                ? [new ActorMembership(Guid.NewGuid(), Guid.NewGuid(), "AVIAM", "AVIAM",
                    OrganizationType.AviamOperator, MembershipKind.InternalStaff)]
                : [],
            []);

        Assert.Equal(expected, HumanResourcesShiftWritePolicy.CanRecord(actor));
    }

    [Fact]
    public void MissingActorCannotRecordRampShifts() =>
        Assert.False(HumanResourcesShiftWritePolicy.CanRecord(null));
}
