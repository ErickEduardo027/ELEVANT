using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Identity;

public sealed class Organization : AuditableEntity
{
    public string Code { get; set; } = string.Empty;

    public string LegalName { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public OrganizationType Type { get; set; }

    public OrganizationStatus Status { get; set; }
}
