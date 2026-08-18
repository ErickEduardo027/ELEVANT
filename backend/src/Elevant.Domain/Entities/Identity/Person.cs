namespace Elevant.Domain.Entities.Identity;

public sealed class Person : AuditableEntity
{
    public string FirstName { get; set; } = string.Empty;

    public string LastName { get; set; } = string.Empty;

    public string? PrimaryEmail { get; set; }

    public string? PhoneNumber { get; set; }

    public string IdentificationType { get; set; } = string.Empty;

    public string IdentificationNumber { get; set; } = string.Empty;
}
