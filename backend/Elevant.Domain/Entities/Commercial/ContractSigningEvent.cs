namespace Elevant.Domain.Entities.Commercial;

/// <summary>Append-only lifecycle evidence without tokens or document bytes.</summary>
public sealed class ContractSigningEvent
{
    public long Id { get; set; }
    public long EnvelopeId { get; set; }
    public string Kind { get; set; } = string.Empty;
    public DateTimeOffset OccurredAt { get; set; }
    public long? ActorAccountId { get; set; }
    public Guid? RequestId { get; set; }
    public string? DocumentSha256 { get; set; }
    public string? ProviderEventId { get; set; }
}
