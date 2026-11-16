using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.UnitTests.Application;

internal static class IdentityTestData
{
    public static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");

    public static ActorContext CreateActor(Guid? accountId = null) => new(
        accountId ?? AccountId,
        "admin.occ@dev.elevant.test",
        "Avery Operations",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000001"),
                "ADMIN_OCC",
                "Admin OCC",
                PortalKind.BackOffice,
                "admin_occ"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000001"),
                Guid.Parse("43000000-0000-7000-8000-000000000001"),
                "AVIAM",
                "AVIAM",
                OrganizationType.AviamOperator,
                MembershipKind.InternalStaff),
        ],
        [
            new ActorStationScope(
                Guid.Parse("44000000-0000-7000-8000-000000000001"),
                "SDQ"),
        ]);

    public static ActorContext CreateAirlineActor() => new(
        AccountId,
        "airline.client@dev.elevant.test",
        "Casey Airline",
        [
            new ActorRole(
                Guid.Parse("41000000-0000-7000-8000-000000000003"),
                "AIRLINE_CLIENT",
                "Airline Client",
                PortalKind.AirlinePortal,
                "airline_client"),
        ],
        [
            new ActorMembership(
                Guid.Parse("42000000-0000-7000-8000-000000000003"),
                Guid.Parse("43000000-0000-7000-8000-000000000003"),
                "SYNTH-AIR",
                "Synthetic Airline",
                OrganizationType.AirlineCustomer,
                MembershipKind.AirlineClient),
        ],
        []);
}
