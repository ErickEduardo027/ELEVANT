namespace Elevant.Contracts.Operations;

public sealed record OccReportDefinitionResponse(string Key, string Title, string Description,
    IReadOnlyList<string> Columns);

public sealed record OccReportCatalogResponse(IReadOnlyList<OccReportDefinitionResponse> Reports, int MaxRangeDays);

public sealed record OccReportCellResponse(string Value, string Type);

public sealed record OccReportPageResponse(string Key, string Title, Guid StationId, string StationCode,
    DateOnly From, DateOnly To, DateTimeOffset AsOf, IReadOnlyList<string> Columns,
    IReadOnlyList<IReadOnlyList<OccReportCellResponse>> Rows, int Page, int Limit, bool HasMore);
