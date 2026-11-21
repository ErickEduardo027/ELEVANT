using Elevant.Domain.Enumerations;

namespace Elevant.Application.Abstractions.Commercial;

/// <summary>A station a contract of the airline covers.</summary>
public sealed record AirlinePortalReportStation(Guid Id, string Code, string Name);

/// <summary>The airline of the session and the stations its contracts cover (the scope of the portal's reports).</summary>
public sealed record AirlinePortalReportProfile(string AirlineName, IReadOnlyList<AirlinePortalReportStation> Stations);

/// <summary>A service AVIAM approved on an operation: its code, name, execution, quantity and unit.</summary>
public sealed record AirlinePortalReportService(string Code, string Name, string Status, decimal Quantity, string Unit);

/// <summary>
/// An operation of the airline in a covered station; <see cref="Services"/> are those of its approved evidence (empty
/// until OCC approves it).
/// </summary>
public sealed record AirlinePortalReportOperation(DateOnly OperationDate, string OperationCode, string? ArrivalFlight,
    string? DepartureFlight, string StationCode, GroundOperationStatus Status, DateTimeOffset? ApprovedAt,
    IReadOnlyList<AirlinePortalReportService> Services);

/// <summary>
/// The reads of the airline portal's reports (ADR-0048, «Reportes nuevos»), always for one airline organization and the
/// stations its contracts cover; null when the organization is not an active airline.
/// </summary>
public interface IAirlinePortalReportStore
{
    Task<AirlinePortalReportProfile?> ProfileAsync(Guid organizationId, CancellationToken cancellationToken = default);

    Task<IReadOnlyList<AirlinePortalReportOperation>?> OperationsAsync(Guid organizationId, DateOnly firstDay, DateOnly lastDay,
        Guid? stationId, GroundOperationStatus? status, CancellationToken cancellationToken = default);
}
