using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Identity;

public sealed class OrganizationMembership : AuditableEntity
{
    public long AccountId { get; set; }

    public long OrganizationId { get; set; }

    public MembershipKind Kind { get; set; }

    public MembershipStatus Status { get; set; }

    public string? JobTitle { get; set; }

    public DateOnly? ValidFrom { get; set; }

    public DateOnly? ValidTo { get; set; }
}
