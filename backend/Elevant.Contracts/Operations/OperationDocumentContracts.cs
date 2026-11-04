using System.ComponentModel.DataAnnotations;

namespace Elevant.Contracts.Operations;

/// <summary>AVIAM forms of one operation with their signatures and walk-around marks (ADR-0032).</summary>
public sealed record OperationDocumentsResponse(Guid OperationId, IReadOnlyList<OperationDocumentResponse> Documents,
    IReadOnlyList<DamageMarkResponse> DamageMarks);

/// <param name="Kind">ServiceOrder, FlightReport or BridgeChecklist.</param>
/// <param name="ContentSha256">Hash of the current content; a signature is accepted only against it.</param>
/// <param name="StaleRoles">Roles that signed an earlier content and must sign again.</param>
public sealed record OperationDocumentResponse(string Kind, string Number, string Title, string FormCode,
    string ContentSha256, IReadOnlyList<string> RequiredRoles, IReadOnlyList<OperationDocumentSignatureResponse> Signatures,
    IReadOnlyList<string> StaleRoles, bool IsFullySigned, OperationDocumentSummaryResponse Summary);

public sealed record OperationDocumentSignatureResponse(string Role, string SignerName, DateTimeOffset SignedAt);

/// <summary>What the signer reads on the tablet before signing: the billable and flight data of the form.</summary>
public sealed record OperationDocumentSummaryResponse(string? FlightIn, string? FlightOut, string? Registration,
    string? AircraftType, string? Position, int? PassengersIn, int? PassengersOut, int? MtowKg,
    IReadOnlyList<OperationDocumentServiceLineResponse> Services, IReadOnlyList<string> Surcharges, string? CurrencyCode,
    decimal? TotalAmount, int MilestoneCount, int ChecklistAnswered, int ChecklistTotal, int DamageCount);

public sealed record OperationDocumentServiceLineResponse(string Code, string Name, decimal Quantity, string Unit,
    decimal? Amount);

public sealed record DamageMarkResponse(Guid Id, decimal X, decimal Y, string Note, DateTimeOffset ReportedAt, bool HasPhoto);

/// <param name="Strokes">Strokes drawn on a 3:1 pad, each a flat list of normalized points [x0, y0, x1, y1, …].</param>
public sealed record SignOperationDocumentRequest(
    [Required, StringLength(120, MinimumLength = 2)] string SignerName,
    [Required, RegularExpression("^[0-9a-f]{64}$")] string DocumentSha256,
    [Required, MinLength(1), MaxLength(64)] decimal[][] Strokes);

/// <param name="X">Horizontal position on the silhouette box, 0–1 (nose at the left).</param>
/// <param name="Y">Vertical position on the silhouette box, 0–1.</param>
public sealed record RecordDamageMarkRequest(
    [Range(0, 1)] decimal X,
    [Range(0, 1)] decimal Y,
    [Required, StringLength(500, MinimumLength = 3)] string Note,
    DateTimeOffset ReportedAt);

/// <summary>The latest Service Order the airline's representative signed, for the airline portal.</summary>
public sealed record AirlineServiceOrderResponse(Guid OperationId, string Number, string ContentSha256,
    IReadOnlyList<OperationDocumentSignatureResponse> Signatures, string? CurrencyCode, decimal? TotalAmount);
