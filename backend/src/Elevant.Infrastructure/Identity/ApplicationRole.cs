using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Identity;

namespace Elevant.Infrastructure.Identity;

public sealed class ApplicationRole : IdentityRole<long>
{
    public Guid PublicId { get; set; }

    public PortalKind Portal { get; set; }

    public string UserType { get; set; } = string.Empty;

    public string? Description { get; set; }
}
