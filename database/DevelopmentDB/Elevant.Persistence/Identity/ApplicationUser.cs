using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Identity;

namespace Elevant.Infrastructure.Identity;

public sealed class ApplicationUser : IdentityUser<long>
{
    public Guid PublicId { get; set; }

    public long PersonId { get; set; }

    public AccountLifecycleStatus Status { get; set; }

    public InvitationStatus InvitationStatus { get; set; }

    public bool MustChangePassword { get; set; }

    public DateTimeOffset? InvitationSentAt { get; set; }

    public DateTimeOffset? LastLoginAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }

    public DateTimeOffset UpdatedAt { get; set; }

    public byte[] RowVersion { get; set; } = [];

    public Person? Person { get; set; }
}
