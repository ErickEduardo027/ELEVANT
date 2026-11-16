namespace Elevant.Domain.Entities.Commercial;
/// <summary>One immutable command receipt per authenticated account and request UUID.</summary>
public sealed class FinancePayablesCommand : Entity<long>
{
    public Guid RequestId { get; init; }
    public long ActorAccountId { get; init; }
    public string ContentHash { get; init; } = string.Empty;
    public Guid ResourceId { get; init; }
    public string Operation { get; init; } = string.Empty;
    public DateTimeOffset CreatedAt { get; init; }
}
