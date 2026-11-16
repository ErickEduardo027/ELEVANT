namespace Elevant.Domain.Entities.Audit;

public sealed class AuditChange : Entity<long>
{
    public long AuditEntryId { get; set; }

    public string PropertyName { get; set; } = string.Empty;

    public string? OldValue { get; set; }

    public string? NewValue { get; set; }
}
