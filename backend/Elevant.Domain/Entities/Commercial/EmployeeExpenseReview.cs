namespace Elevant.Domain.Entities.Commercial;
public sealed class EmployeeExpenseReview : Entity<long>
{
    public long DocumentId { get; init; }
    public string Stage { get; init; } = string.Empty;
    public string Decision { get; init; } = string.Empty;
    public string? Reason { get; init; }
    public long ActorAccountId { get; init; }
    public DateTimeOffset DecidedAt { get; init; }
}
