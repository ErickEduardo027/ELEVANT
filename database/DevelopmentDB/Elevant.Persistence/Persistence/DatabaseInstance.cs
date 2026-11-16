namespace Elevant.Infrastructure.Persistence;

/// <summary>
/// Immutable deployment marker provisioned before EF migrations run. The table is deliberately
/// excluded from migrations so a release can validate its target before changing any schema.
/// </summary>
public sealed class DatabaseInstance
{
    public byte Id { get; init; }

    public Guid InstanceId { get; init; }

    public string EnvironmentName { get; init; } = string.Empty;

    public DateTimeOffset CreatedAt { get; init; }
}
