using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Entities.Identity;

public sealed class Organization : AuditableEntity
{
    public string Code { get; set; } = string.Empty;

    public string LegalName { get; set; } = string.Empty;

    public string DisplayName { get; set; } = string.Empty;

    public OrganizationType Type { get; set; }

    public OrganizationStatus Status { get; set; }

    /// <summary>
    /// Tax identifier of an airline customer (an RNC in the Dominican Republic), copied from its approved
    /// commercial request; printed on its contracts and invoices.
    /// </summary>
    public string? TaxRegistration { get; set; }

    /// <summary>ISO 3166-1 alpha-2 country that issued <see cref="TaxRegistration"/>.</summary>
    public string? TaxRegistrationCountryCode { get; set; }
}
