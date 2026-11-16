namespace Elevant.Application.Identity;

internal static class ActorContextValidator
{
    public static bool IsValid(ActorContext? actor, Guid expectedAccountId)
    {
        if (actor is null ||
            expectedAccountId == Guid.Empty ||
            actor.AccountId != expectedAccountId ||
            string.IsNullOrWhiteSpace(actor.Email) ||
            string.IsNullOrWhiteSpace(actor.DisplayName) ||
            actor.Roles is null ||
            actor.Roles.Count == 0 ||
            actor.Memberships is null ||
            actor.Memberships.Count == 0 ||
            actor.StationScopes is null)
        {
            return false;
        }

        if (actor.Roles.Any(role =>
                role is null ||
                role.RoleId == Guid.Empty ||
                string.IsNullOrWhiteSpace(role.Code) ||
                string.IsNullOrWhiteSpace(role.Name) ||
                !Enum.IsDefined(role.Portal) ||
                string.IsNullOrWhiteSpace(role.UserType)))
        {
            return false;
        }

        if (actor.Memberships.Any(membership =>
                membership is null ||
                membership.MembershipId == Guid.Empty ||
                membership.OrganizationId == Guid.Empty ||
                string.IsNullOrWhiteSpace(membership.OrganizationCode) ||
                string.IsNullOrWhiteSpace(membership.OrganizationName) ||
                !Enum.IsDefined(membership.OrganizationType) ||
                !Enum.IsDefined(membership.Kind)))
        {
            return false;
        }

        return !actor.StationScopes.Any(scope =>
            scope is null ||
            scope.StationId == Guid.Empty ||
            string.IsNullOrWhiteSpace(scope.StationCode));
    }
}
