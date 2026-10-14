using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;

namespace Elevant.Application.Abstractions.Identity;

public sealed record HumanResourcesPermitData(Guid Id, Guid RampProfileId,
    string AgentName, string EmployeeNumber, string DocumentType, int CycleNumber,
    string DocumentNumber, DateOnly IssuedOn, DateOnly ExpiresOn,
    DateTimeOffset RecordedAt, string Validity);

public sealed record HumanResourcesPermitPage(int Page, int Limit, bool HasMore,
    IReadOnlyList<HumanResourcesPermitData> Permits);

/// <summary>Filters for current permit cycles; validity is evaluated on <paramref name="AsOf"/>.</summary>
public sealed record HumanResourcesPermitQuery(DateOnly AsOf, string? Search = null,
    Guid? RampProfileId = null, PermitDocumentType? DocumentType = null,
    DocumentValidity? Validity = null);

public sealed record HumanResourcesPermitCycle(Guid Id, int CycleNumber, bool IsCurrent,
    string DocumentNumber, DateOnly IssuedOn, DateOnly ExpiresOn, DateTimeOffset RecordedAt,
    string? RecordedByName);

public sealed record HumanResourcesPermitHistory(Guid RampProfileId, string AgentName,
    string EmployeeNumber, string DocumentType, IReadOnlyList<HumanResourcesPermitCycle> Cycles);

public interface IHumanResourcesPermitReadStore
{
    /// <summary>Returns null unless the actor has live internal HR or Superadmin access.</summary>
    Task<HumanResourcesPermitPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        CancellationToken cancellationToken = default);

    /// <summary>Finds the current cycle for one agent and document type before renewal.</summary>
    Task<HumanResourcesPermitPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        Guid rampProfileId, PermitDocumentType documentType,
        CancellationToken cancellationToken = default);

    /// <summary>Lists current cycles matching the query; null when the actor may not read them.</summary>
    Task<HumanResourcesPermitPage?> ListCurrentAsync(Guid actorId, int page, int limit,
        HumanResourcesPermitQuery query, CancellationToken cancellationToken = default);

    /// <summary>Counts current cycles by validity, ignoring the query's validity filter.</summary>
    Task<HumanResourcesDocumentSummary?> SummarizeAsync(Guid actorId,
        HumanResourcesPermitQuery query, CancellationToken cancellationToken = default);

    /// <summary>Returns every cycle of the agent/document-type lineage the given cycle belongs to.</summary>
    Task<HumanResourcesReadResult<HumanResourcesPermitHistory>> GetHistoryAsync(
        Guid actorId, Guid permitId, CancellationToken cancellationToken = default);
}
