namespace Elevant.Application.Abstractions.Identity;

public enum HumanResourcesReportFailure
{
    ForbiddenRole,
    ForbiddenStation,
    TooLarge,
}

public enum HumanResourcesReportKind
{
    Expirations,
    AccountMovements,
    StaffDistribution,
    QualificationCoverage,
}

public enum HumanResourcesReportCellType
{
    Text,
    Number,
    Date,
    DateTime,
}

public sealed record HumanResourcesReportCell(
    string Value, HumanResourcesReportCellType Type);

/// <summary>
/// The complete rows of an export (3-N16): the cells are Spanish and the times local to the station, while
/// <see cref="DocumentKind"/> and <see cref="Validity"/> keep the filter codes the audit records.
/// </summary>
public sealed record HumanResourcesReportSnapshot(
    HumanResourcesReportKind Kind, Guid StationId, DateOnly From, DateOnly To,
    DateTimeOffset AsOf, IReadOnlyList<string> Columns,
    IReadOnlyList<IReadOnlyList<HumanResourcesReportCell>> Rows)
{
    public int RowCount => Rows.Count;
    public string StationCode { get; init; } = string.Empty;
    public string? DocumentKind { get; init; }
    public string? Validity { get; init; }

    /// <summary>The station's IANA zone: «Generado» is written in its local time. Null is AVIAM's calendar.</summary>
    public string? TimeZone { get; init; }
}

public sealed record HumanResourcesReportSnapshotResult(
    HumanResourcesReportSnapshot? Snapshot, HumanResourcesReportFailure? Failure);

public interface IHumanResourcesReportPdfRenderer
{
    byte[] Render(HumanResourcesReportSnapshot snapshot, string stationCode);
}

public interface IHumanResourcesReportXlsxRenderer
{
    byte[] Render(HumanResourcesReportSnapshot snapshot, string stationCode);
}

public sealed record HumanResourcesExpirationRow(
    Guid Id, Guid RampProfileId, string AgentName, string EmployeeNumber,
    string Kind, string Code, DateOnly ExpiresOn);

public sealed record HumanResourcesStaffDistributionRow(
    Guid Id, Guid RampProfileId, string AgentName, string EmployeeNumber,
    Guid TerminalId, string TerminalCode, string? PositionCode,
    DateOnly WorkDate, TimeOnly StartsAtLocal, TimeOnly EndsAtLocal);

public sealed record HumanResourcesQualificationCoverageRow(
    Guid EquipmentTypeId, string EquipmentCode, string EquipmentName,
    int EligibleAgents, int QualifiedAgents);

public sealed record HumanResourcesAccountMovementRow(
    Guid Id, Guid AccountId, Guid RampProfileId,
    string AgentName, string EmployeeNumber,
    string Kind, DateTimeOffset OccurredAt);

public sealed record HumanResourcesReportPage<T>(
    Guid StationId, DateOnly From, DateOnly To, int Page, int Limit,
    bool HasMore, DateTimeOffset AsOf, IReadOnlyList<T> Rows);

public sealed record HumanResourcesReportReadResult<T>(
    HumanResourcesReportPage<T>? Page, HumanResourcesReportFailure? Failure);

public interface IHumanResourcesReportStore
{
    Task<HumanResourcesReportReadResult<HumanResourcesExpirationRow>> ListExpirationsAsync(
        Guid actorId, Guid stationId, DateOnly startDate, DateOnly endDate,
        int page, int limit, string? documentKind = null, string? validity = null,
        CancellationToken cancellationToken = default);

    Task<HumanResourcesReportReadResult<HumanResourcesStaffDistributionRow>>
        ListStaffDistributionAsync(Guid actorId, Guid stationId,
            DateOnly startDate, DateOnly endDate, int page, int limit,
            CancellationToken cancellationToken = default);

    Task<HumanResourcesReportReadResult<HumanResourcesQualificationCoverageRow>>
        ListQualificationCoverageAsync(Guid actorId, Guid stationId,
            DateOnly startDate, DateOnly reportDate, int page, int limit,
            CancellationToken cancellationToken = default);

    Task<HumanResourcesReportReadResult<HumanResourcesAccountMovementRow>>
        ListAccountMovementsAsync(Guid actorId, Guid stationId,
            DateOnly startDate, DateOnly endDate, int page, int limit,
            CancellationToken cancellationToken = default);

    Task<HumanResourcesReportSnapshotResult> ReadSnapshotAsync(
        Guid actorId, Guid stationId, HumanResourcesReportKind kind,
        DateOnly startDate, DateOnly endDate, int maxRows,
        string? documentKind = null, string? validity = null,
        CancellationToken cancellationToken = default);

    Task<HumanResourcesReportFailure?> RecordExportAsync(
        Guid actorId, Guid stationId, HumanResourcesReportKind kind,
        DateOnly startDate, DateOnly endDate, string format, int rowCount,
        string? documentKind = null, string? validity = null,
        CancellationToken cancellationToken = default);
}
