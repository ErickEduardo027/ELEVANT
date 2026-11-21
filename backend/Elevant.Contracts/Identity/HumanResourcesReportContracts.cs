namespace Elevant.Contracts.Identity;

public sealed record HumanResourcesReportPageResponse<T>(
    Guid StationId, DateOnly From, DateOnly To, int Page, int Limit,
    bool HasMore, DateTimeOffset AsOf, IReadOnlyList<T> Rows)
{
    public string? DocumentKind { get; init; }
    public string? Validity { get; init; }
}

public sealed record HumanResourcesExpirationResponse(
    Guid Id, Guid RampProfileId, string AgentName, string EmployeeNumber,
    string Kind, string Code, DateOnly ExpiresOn);

public sealed record HumanResourcesAccountMovementResponse(
    Guid Id, Guid AccountId, Guid RampProfileId, string AgentName,
    string EmployeeNumber, string Kind, DateTimeOffset OccurredAt);

public sealed record HumanResourcesStaffDistributionResponse(
    Guid Id, Guid RampProfileId, string AgentName, string EmployeeNumber,
    Guid TerminalId, string TerminalCode, string? PositionCode,
    DateOnly WorkDate, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal);

public sealed record HumanResourcesQualificationCoverageResponse(
    Guid EquipmentTypeId, string EquipmentCode, string EquipmentName,
    int EligibleAgents, int QualifiedAgents)
{
    /// <summary>Active agents of the station at the cut-off date, the context of «Elegibles» and «Habilitados».</summary>
    public int StationAgents { get; init; }
}

/// <summary>
/// A Gestión Humana report (ADR-0048): its route key, Spanish title, columns with their types (text, number, percent,
/// date, datetime, time) and whether it is «a una fecha de corte» (only <c>to</c> matters; the screen hides «Desde»).
/// </summary>
public sealed record HumanResourcesReportDefinitionResponse(string Key, string Title, string Description,
    IReadOnlyList<string> Columns, IReadOnlyList<string> ColumnTypes, bool AsOfDate);

public sealed record HumanResourcesReportCatalogResponse(IReadOnlyList<HumanResourcesReportDefinitionResponse> Reports,
    int MaxRangeDays);
