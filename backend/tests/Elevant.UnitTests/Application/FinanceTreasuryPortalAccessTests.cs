using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;
namespace Elevant.UnitTests.Application;
public sealed class FinanceTreasuryPortalAccessTests
{
    [Fact]
    public void TenantComesFromTheSoleAirlinePortalMembership()
    {
        var id = Guid.NewGuid(); var organization = Guid.NewGuid(); var actor = Actor(id, organization);
        Assert.Equal(organization, FinanceTreasuryPortalAccess.OrganizationId(actor, id));
        Assert.Null(FinanceTreasuryPortalAccess.OrganizationId(actor, Guid.NewGuid()));
        Assert.Null(FinanceTreasuryPortalAccess.OrganizationId(null, id));
        Assert.Null(FinanceTreasuryPortalAccess.OrganizationId(actor with { Memberships = [] }, id));
        Assert.Null(FinanceTreasuryPortalAccess.OrganizationId(actor with { Memberships = [.. actor.Memberships,
            actor.Memberships[0] with { OrganizationId = Guid.NewGuid() }] }, id));
    }
    [Fact]
    public void InternalOrWrongPortalRolesCannotReadAirlineTreasury()
    {
        var id = Guid.NewGuid(); var actor = Actor(id, Guid.NewGuid());
        Assert.Null(FinanceTreasuryPortalAccess.OrganizationId(actor with { Roles = [actor.Roles[0] with { Portal = PortalKind.BackOffice }] }, id));
        Assert.Null(FinanceTreasuryPortalAccess.OrganizationId(actor with { Roles = [actor.Roles[0] with { Code = "FINANZAS" }] }, id));
        Assert.Null(FinanceTreasuryPortalAccess.OrganizationId(actor with { Memberships = [actor.Memberships[0] with { Kind = MembershipKind.InternalStaff }] }, id));
    }
    private static ActorContext Actor(Guid id, Guid organization) => new(id, "synthetic@airline.invalid", "Synthetic Airline User",
        [new(Guid.NewGuid(), "AIRLINE_CLIENT", "Airline", PortalKind.AirlinePortal, "airline_client")],
        [new(Guid.NewGuid(), organization, "QA", "QA Airline", OrganizationType.AirlineCustomer, MembershipKind.AirlineClient)], []);
}
