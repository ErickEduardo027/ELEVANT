namespace Elevant.Application.Abstractions.Identity;

/// <summary>What one sweep of ramp agents' documents announced (2-N25).</summary>
/// <param name="ExpiryNotices">Gestión Humana alerts about a document or qualification about to expire.</param>
/// <param name="AssignmentNotices">OCC alerts about an assigned operation a current document does not cover.</param>
public sealed record HumanResourcesDocumentSweepResult(int ExpiryNotices, int AssignmentNotices);

public interface IHumanResourcesDocumentSweepStore
{
    /// <summary>
    /// Tells Gestión Humana, once per document cycle, that a current airport permit, ramp licence or
    /// qualification of an active agent expires within the configured notice days; and tells OCC, once per
    /// assignment, that an assigned operation falls after the end of the agent's current document. No email is
    /// sent and nothing is released. Idempotent: a missed run catches up.
    /// </summary>
    Task<HumanResourcesDocumentSweepResult> SweepAsync(CancellationToken cancellationToken = default);
}
