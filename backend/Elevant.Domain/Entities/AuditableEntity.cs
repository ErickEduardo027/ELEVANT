namespace Elevant.Domain.Entities;

/// <summary>Base for mutable persisted records with a public, non-sequential identifier.</summary>
public abstract class AuditableEntity : Entity<long>
{
    /// <summary>Stable identifier exposed outside the database boundary.</summary>
    public Guid PublicId { get; set; }

    /// <summary>UTC instant at which the record was created.</summary>
    public DateTimeOffset CreatedAt { get; set; }

    /// <summary>UTC instant at which the record was last changed.</summary>
    public DateTimeOffset UpdatedAt { get; set; }

    /// <summary>Optimistic concurrency token maintained by SQL Server.</summary>
    public byte[] RowVersion { get; set; } = [];
}
