namespace Elevant.Domain.Entities.Commercial;

/// <summary>
/// 4-N04: an immutable row that reverses one application of a supplier payment (<see cref="ApplicationId"/>) or, without
/// it, voids the whole payment once nothing of it remains applied. The payment and its applications are never changed
/// nor deleted: the projections stop counting what a reversal names from its instant on.
/// </summary>
public sealed class FinancePayablesReversal : Entity<long>
{
    public Guid PublicId { get; init; }
    public long PaymentId { get; init; }
    public long? ApplicationId { get; init; }
    public string Reason { get; init; } = string.Empty;
    public long ActorAccountId { get; init; }
    public DateTimeOffset ReversedAt { get; init; }
}
