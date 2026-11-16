namespace Elevant.Domain.Entities.Infrastructure;

/// <summary>A committed, recipient-specific change hint ordered by the dispatcher's feed sequence.</summary>
public sealed class AccountChange : Entity<long>
{
    public Guid PublicId { get; set; }

    public Guid OutboxPublicId { get; set; }

    public long RecipientAccountId { get; set; }

    public long? StationId { get; set; }

    public string Resource { get; set; } = string.Empty;

    public Guid ResourceId { get; set; }

    public DateTimeOffset OccurredAt { get; set; }

    public DateTimeOffset CreatedAt { get; set; }
}
