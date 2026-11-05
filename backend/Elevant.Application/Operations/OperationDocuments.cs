using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Identity;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Operations;

/// <summary>
/// Flight data every form prints, read from the single operation record (ADR-0031/0032): nothing
/// here is typed again on paper.
/// </summary>
public sealed record DocumentFlightHeader(
    string StationCode, string StationName, string StationTimeZone, string OperationCode, DateOnly OperationDate,
    string AirlineName, string? AirlineIataCode,
    string? FlightIn, string? Origin, DateTimeOffset? ArrivalAt,
    string? FlightOut, string? Destination, DateTimeOffset? DepartureAt,
    string? AircraftType, string? Registration, string? Position,
    int? PassengersIn, int? PassengersOut, int? MtowKg, string AgentName);

public sealed record DocumentServiceLine(int Line, string Code, string Name, decimal Quantity, string Unit,
    decimal? UnitPrice, decimal? Amount);

public sealed record DocumentSurcharge(string Code, string Name, string ServiceCode);

/// <param name="Value">Ok, NotApplicable or NotOk; null while unanswered.</param>
public sealed record DocumentChecklistAnswer(string ItemCode, string Section, string Label, string? Value, string? Note);

public sealed record DocumentMilestone(string Code, string Label, DateTimeOffset At);

public sealed record DocumentDamage(Guid Id, decimal X, decimal Y, string Note);

public sealed record DocumentDelay(string Code, string Description);

/// <summary>
/// The full content of one AVIAM form for one operation. Its canonical JSON is what is hashed,
/// signed and drawn; sections that do not belong to a form stay empty.
/// </summary>
public sealed record OperationDocumentContent(
    int SchemaVersion, OperationDocumentKind Kind, string FormCode, string FormRevision, string Title, string Number,
    DocumentFlightHeader Flight,
    IReadOnlyList<DocumentServiceLine> Services, IReadOnlyList<DocumentSurcharge> Surcharges,
    string? CurrencyCode, decimal? TotalAmount, string BillingType,
    IReadOnlyList<DocumentChecklistAnswer> Checklist, IReadOnlyList<DocumentMilestone> Milestones,
    IReadOnlyList<DocumentDamage> Damages, IReadOnlyList<DocumentDelay> Delays, IReadOnlyList<string> Observations,
    DocumentCharter? Charter = null);

/// <summary>
/// What only a charter carries (ADR-0033): the station as the form prints it («MDPC/PUJ»), the
/// carrier's address and who pays, as the representative gives them on the ramp.
/// </summary>
public sealed record DocumentCharter(string StationLabel, string? CarrierAddress, string? ChargesPayableBy);

/// <summary>A signature drawn on the tablet: strokes of normalized points [x0, y0, x1, y1, …].</summary>
/// <param name="SignerIdentification">ID or passport number, required by the charter request (ADR-0033).</param>
public sealed record OperationDocumentSignatureData(OperationSignatureRole Role, string SignerName, DateTimeOffset SignedAt,
    string DocumentSha256, IReadOnlyList<IReadOnlyList<decimal>> Strokes, string? SignerIdentification = null);

/// <param name="Signatures">Signatures on the current content.</param>
/// <param name="StaleRoles">Roles that signed an earlier content and must sign again.</param>
public sealed record OperationDocumentData(OperationDocumentContent Content, string ContentSha256,
    IReadOnlyList<OperationSignatureRole> RequiredRoles, IReadOnlyList<OperationDocumentSignatureData> Signatures,
    IReadOnlyList<OperationSignatureRole> StaleRoles)
{
    public bool IsFullySigned => RequiredRoles.All(role => Signatures.Any(signature => signature.Role == role));
}

public sealed record DamageMarkData(Guid Id, decimal X, decimal Y, string Note, DateTimeOffset ReportedAt, bool HasPhoto);

public sealed record OperationDocumentsView(Guid OperationId, IReadOnlyList<OperationDocumentData> Documents,
    IReadOnlyList<DamageMarkData> DamageMarks);

/// <summary>A form drawn from a stored, signed snapshot (what the airline sees).</summary>
public sealed record SignedOperationDocument(OperationDocumentContent Content, string ContentSha256,
    IReadOnlyList<OperationDocumentSignatureData> Signatures);

public sealed record DamagePhoto(byte[] Content, string ContentType);

public sealed record OperationDocumentSignRequest(Guid ActorAccountId, IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId, OperationDocumentKind Kind, OperationSignatureRole Role, string SignerName, string DocumentSha256,
    IReadOnlyList<IReadOnlyList<decimal>> Strokes, DateTimeOffset SignedAt, Guid InstallationId, Guid IdempotencyKey,
    string? RequestId, string? SignerIdentification = null);

public sealed record DamageMarkWriteRequest(Guid ActorAccountId, IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId, Guid MarkId, decimal X, decimal Y, string Note, DateTimeOffset ReportedAt, Guid InstallationId,
    Guid IdempotencyKey, string? RequestId);

public sealed record DamagePhotoWriteRequest(Guid ActorAccountId, IReadOnlyCollection<Guid> AllowedStationIds,
    Guid OperationId, Guid MarkId, byte[] Content, string ContentType, Guid InstallationId, string? RequestId);

public sealed record OperationDocumentWriteResult(OperationDocumentsView? Data, RampExecutionWriteFailure? Failure,
    Guid? CommitReceiptId)
{
    public bool IsSuccess => Data is not null;

    public static OperationDocumentWriteResult Success(OperationDocumentsView data, Guid? receiptId) => new(data, null, receiptId);

    public static OperationDocumentWriteResult Failed(RampExecutionWriteFailure failure, Guid? receiptId = null) =>
        new(null, failure, receiptId);
}

/// <summary>The private object storage for walk-around photos is not configured or failed.</summary>
public sealed class OperationalEvidenceUnavailableException(Exception? inner = null)
    : Exception("Walk-around photo storage is unavailable.", inner);

public interface IOperationDocumentStore
{
    /// <summary>The assigned agent's view of the forms of its operation.</summary>
    Task<OperationDocumentsView?> ReadForAgentAsync(Guid accountId, IReadOnlyCollection<Guid> stations, Guid operationId,
        CancellationToken cancellationToken = default);

    Task<OperationDocumentWriteResult> SignAsync(OperationDocumentSignRequest request,
        CancellationToken cancellationToken = default);

    Task<OperationDocumentWriteResult> RecordDamageMarkAsync(DamageMarkWriteRequest request,
        CancellationToken cancellationToken = default);

    Task<OperationDocumentWriteResult> AttachDamagePhotoAsync(DamagePhotoWriteRequest request,
        CancellationToken cancellationToken = default);

    /// <summary>OCC's view of the forms of an operation of one of its stations.</summary>
    Task<OperationDocumentsView?> ReadForOccAsync(IReadOnlyCollection<Guid> stations, Guid operationId,
        CancellationToken cancellationToken = default);

    Task<DamagePhoto?> ReadDamagePhotoForOccAsync(IReadOnlyCollection<Guid> stations, Guid operationId, Guid markId,
        CancellationToken cancellationToken = default);

    /// <summary>The latest fully signed Service Order of an operation of the airline's organization.</summary>
    Task<SignedOperationDocument?> ReadSignedServiceOrderForAirlineAsync(Guid organizationId, Guid operationId,
        CancellationToken cancellationToken = default);
}

public interface IOperationDocumentPdfRenderer
{
    /// <param name="signatures">Signatures valid for this exact content.</param>
    /// <param name="damagePhotos">Photos to append, keyed by damage mark id (may be empty).</param>
    byte[] Render(OperationDocumentContent content, string contentSha256,
        IReadOnlyList<OperationDocumentSignatureData> signatures, IReadOnlyDictionary<Guid, DamagePhoto> damagePhotos);
}

/// <summary>Which form exists for an operation, who signs it, and how its content is hashed (ADR-0032).</summary>
public static class OperationDocumentRules
{
    public const int SchemaVersion = 1;
    public const int MaxStrokes = 64;
    public const int MaxPoints = 2_000;
    public const int MaxPhotoBytes = 6 * 1024 * 1024;
    private static readonly JsonSerializerOptions Json = new(JsonSerializerDefaults.Web);

    public static IReadOnlyList<OperationSignatureRole> RolesFor(OperationDocumentKind kind) => kind switch
    {
        OperationDocumentKind.ServiceOrder => [OperationSignatureRole.AirlineRepresentative, OperationSignatureRole.AviamAgent],
        OperationDocumentKind.FlightReport => [OperationSignatureRole.Coordinator],
        OperationDocumentKind.CharterServiceRequest =>
            [OperationSignatureRole.AirlineRepresentative, OperationSignatureRole.AviamAgent],
        _ => [OperationSignatureRole.BridgeOperator],
    };

    /// <summary>One number per operation, shared by its forms: station code + 9-digit sequence.</summary>
    public static string NumberFor(string stationCode, long operationInternalId) =>
        $"{stationCode.ToUpperInvariant()}{operationInternalId:D9}";

    public static string CanonicalJson(OperationDocumentContent content) => JsonSerializer.Serialize(content, Json);

    public static OperationDocumentContent Parse(string json) =>
        JsonSerializer.Deserialize<OperationDocumentContent>(json, Json)
        ?? throw new InvalidOperationException("The stored document content is invalid.");

    public static string Sha256Of(string canonical) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));

    /// <summary>Normalizes the drawn strokes; null when they are not a plausible signature.</summary>
    public static IReadOnlyList<IReadOnlyList<decimal>>? NormalizeStrokes(IReadOnlyList<IReadOnlyList<decimal>>? strokes)
    {
        if (strokes is null || strokes.Count is 0 or > MaxStrokes) return null;
        var points = 0;
        var result = new List<IReadOnlyList<decimal>>(strokes.Count);
        foreach (var stroke in strokes)
        {
            if (stroke is null || stroke.Count < 2 || stroke.Count % 2 != 0) return null;
            points += stroke.Count / 2;
            if (points > MaxPoints) return null;
            if (stroke.Any(value => value is < 0 or > 1)) return null;
            result.Add(stroke.Select(value => decimal.Round(value, 3, MidpointRounding.AwayFromZero)).ToArray());
        }
        return points >= 2 ? result : null;
    }

    public static string StrokesJson(IReadOnlyList<IReadOnlyList<decimal>> strokes) => JsonSerializer.Serialize(strokes, Json);

    public static IReadOnlyList<IReadOnlyList<decimal>> ParseStrokes(string json) =>
        JsonSerializer.Deserialize<decimal[][]>(json, Json) ?? [];

    public static string? NormalizeSignerName(string? name)
    {
        var value = string.Join(' ', (name ?? string.Empty).Split(' ', StringSplitOptions.RemoveEmptyEntries));
        return value.Length is >= 2 and <= 120 ? value : null;
    }

    public static bool IsSha256(string? value) =>
        value is { Length: 64 } && value.All(character => character is (>= '0' and <= '9') or (>= 'a' and <= 'f'));

    /// <summary>Forms are signed once the operation started and until OCC approves or it is cancelled.</summary>
    public static bool CanSign(GroundOperationStatus status, DateTimeOffset? actualStartAt) =>
        actualStartAt is not null &&
        status is GroundOperationStatus.InProgress or GroundOperationStatus.PendingReview or GroundOperationStatus.Returned;

    /// <summary>JPEG or PNG by magic bytes; anything else is refused.</summary>
    public static string? SniffPhoto(byte[] content) => content switch
    {
        [0xFF, 0xD8, 0xFF, ..] => "image/jpeg",
        [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ..] => "image/png",
        _ => null,
    };
}

/// <summary>Forms, signatures and walk-around marks from the tablet; OCC reads and downloads them.</summary>
public sealed class OperationDocumentHandler(IActorContextResolver actors, IOperationDocumentStore store,
    IOperationDocumentPdfRenderer renderer)
{
    public async Task<(OperationDocumentsView? Data, RampOperationsFailure? Failure)> ReadForAgentAsync(Guid accountId,
        Guid operationId, CancellationToken cancellationToken = default)
    {
        if (operationId == Guid.Empty) return (null, RampOperationsFailure.InvalidRequest);
        var (stations, failure) = await RampStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure);
        var view = await store.ReadForAgentAsync(accountId, stations!, operationId, cancellationToken);
        return view is null ? (null, RampOperationsFailure.NotFound) : (view, null);
    }

    public async Task<(OperationDocumentsView? Data, RampOperationsFailure? Failure)> SignAsync(Guid accountId,
        Guid operationId, OperationDocumentKind kind, OperationSignatureRole role, string? signerName, string? documentSha256,
        IReadOnlyList<IReadOnlyList<decimal>>? strokes, DateTimeOffset signedAt, Guid installationId, Guid idempotencyKey,
        string? requestId, CancellationToken cancellationToken = default, string? signerIdentification = null)
    {
        var name = OperationDocumentRules.NormalizeSignerName(signerName);
        var normalized = OperationDocumentRules.NormalizeStrokes(strokes);
        var identification = CharterRules.NormalizeIdentification(signerIdentification);
        // The charter request prints the signer's ID or passport; the other forms do not ask for it.
        var identificationValid = kind == OperationDocumentKind.CharterServiceRequest
            ? identification is not null
            : string.IsNullOrWhiteSpace(signerIdentification);
        if (operationId == Guid.Empty || installationId == Guid.Empty || idempotencyKey == Guid.Empty || name is null ||
            !identificationValid ||
            normalized is null || !OperationDocumentRules.IsSha256(documentSha256) ||
            !Enum.IsDefined(kind) || !OperationDocumentRules.RolesFor(kind).Contains(role))
            return (null, RampOperationsFailure.InvalidRequest);
        var (stations, failure) = await RampStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure);
        return Map(await store.SignAsync(new OperationDocumentSignRequest(accountId, stations!, operationId, kind, role, name,
            documentSha256!, normalized, signedAt.ToUniversalTime(), installationId, idempotencyKey, requestId, identification),
            cancellationToken));
    }

    public async Task<(OperationDocumentsView? Data, RampOperationsFailure? Failure)> RecordDamageMarkAsync(Guid accountId,
        Guid operationId, Guid markId, decimal x, decimal y, string? note, DateTimeOffset reportedAt, Guid installationId,
        Guid idempotencyKey, string? requestId, CancellationToken cancellationToken = default)
    {
        var text = note?.Trim();
        if (operationId == Guid.Empty || markId == Guid.Empty || installationId == Guid.Empty ||
            idempotencyKey == Guid.Empty || x is < 0 or > 1 || y is < 0 or > 1 || text is not { Length: >= 3 and <= 500 })
            return (null, RampOperationsFailure.InvalidRequest);
        var (stations, failure) = await RampStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure);
        return Map(await store.RecordDamageMarkAsync(new DamageMarkWriteRequest(accountId, stations!, operationId, markId,
            decimal.Round(x, 4), decimal.Round(y, 4), text, reportedAt.ToUniversalTime(), installationId, idempotencyKey,
            requestId), cancellationToken));
    }

    public async Task<(OperationDocumentsView? Data, RampOperationsFailure? Failure)> AttachDamagePhotoAsync(Guid accountId,
        Guid operationId, Guid markId, byte[] content, Guid installationId, string? requestId,
        CancellationToken cancellationToken = default)
    {
        var contentType = content.Length is > 0 and <= OperationDocumentRules.MaxPhotoBytes
            ? OperationDocumentRules.SniffPhoto(content) : null;
        if (operationId == Guid.Empty || markId == Guid.Empty || installationId == Guid.Empty || contentType is null)
            return (null, RampOperationsFailure.InvalidRequest);
        var (stations, failure) = await RampStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure);
        return Map(await store.AttachDamagePhotoAsync(new DamagePhotoWriteRequest(accountId, stations!, operationId, markId,
            content, contentType, installationId, requestId), cancellationToken));
    }

    public async Task<(OperationDocumentsView? Data, OccReviewFailure? Failure)> ReadForOccAsync(Guid accountId,
        Guid operationId, CancellationToken cancellationToken = default)
    {
        var (stations, failure) = await OccStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure);
        var view = await store.ReadForOccAsync(stations!, operationId, cancellationToken);
        return view is null ? (null, OccReviewFailure.NotFound) : (view, null);
    }

    /// <summary>The current form as PDF for OCC, with walk-around photos appended to the Flight Report.</summary>
    public async Task<(byte[]? Pdf, string? FileName, OccReviewFailure? Failure)> RenderForOccAsync(Guid accountId,
        Guid operationId, OperationDocumentKind kind, CancellationToken cancellationToken = default)
    {
        var (stations, failure) = await OccStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, null, failure);
        var view = await store.ReadForOccAsync(stations!, operationId, cancellationToken);
        var document = view?.Documents.SingleOrDefault(item => item.Content.Kind == kind);
        if (view is null || document is null) return (null, null, OccReviewFailure.NotFound);
        var photos = new Dictionary<Guid, DamagePhoto>();
        if (kind == OperationDocumentKind.FlightReport)
            foreach (var mark in view.DamageMarks.Where(mark => mark.HasPhoto))
                if (await store.ReadDamagePhotoForOccAsync(stations!, operationId, mark.Id, cancellationToken) is { } photo)
                    photos[mark.Id] = photo;
        return (renderer.Render(document.Content, document.ContentSha256, document.Signatures, photos),
            FileName(document.Content), null);
    }

    public async Task<(DamagePhoto? Photo, OccReviewFailure? Failure)> ReadDamagePhotoForOccAsync(Guid accountId,
        Guid operationId, Guid markId, CancellationToken cancellationToken = default)
    {
        var (stations, failure) = await OccStationsAsync(accountId, cancellationToken);
        if (failure is not null) return (null, failure);
        var photo = await store.ReadDamagePhotoForOccAsync(stations!, operationId, markId, cancellationToken);
        return photo is null ? (null, OccReviewFailure.NotFound) : (photo, null);
    }

    public static string FileName(OperationDocumentContent content) => content.Kind switch
    {
        OperationDocumentKind.ServiceOrder => $"orden-de-servicio-{content.Number}.pdf",
        OperationDocumentKind.FlightReport => $"reporte-de-vuelo-{content.Number}.pdf",
        OperationDocumentKind.CharterServiceRequest => $"solicitud-de-servicio-{content.Number}.pdf",
        _ => $"checklist-puente-{content.Number}.pdf",
    };

    private async Task<(Guid[]? Stations, RampOperationsFailure? Failure)> RampStationsAsync(Guid accountId,
        CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return (null, RampOperationsFailure.Unauthorized);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId)) return (null, RampOperationsFailure.Unauthorized);
        if (!RampOperationsAccess.IsAuthorized(actor!)) return (null, RampOperationsFailure.Forbidden);
        var stations = actor!.StationScopes.Select(scope => scope.StationId).Where(id => id != Guid.Empty).Distinct().ToArray();
        return stations.Length == 0 ? (null, RampOperationsFailure.NotFound) : (stations, null);
    }

    private async Task<(Guid[]? Stations, OccReviewFailure? Failure)> OccStationsAsync(Guid accountId,
        CancellationToken cancellationToken)
    {
        if (accountId == Guid.Empty) return (null, OccReviewFailure.Unauthorized);
        var actor = await actors.ResolveAsync(accountId, cancellationToken);
        if (!ActorContextValidator.IsValid(actor, accountId)) return (null, OccReviewFailure.Unauthorized);
        if (!OccPlanningAccess.IsAuthorized(actor!, "operations.review.read")) return (null, OccReviewFailure.Forbidden);
        var stations = actor!.StationScopes.Select(scope => scope.StationId).Where(id => id != Guid.Empty).Distinct().ToArray();
        return stations.Length == 0 ? (null, OccReviewFailure.NotFound) : (stations, null);
    }

    private static (OperationDocumentsView?, RampOperationsFailure?) Map(OperationDocumentWriteResult result) => result.IsSuccess
        ? (result.Data, null)
        : (null, result.Failure switch
        {
            RampExecutionWriteFailure.Forbidden => RampOperationsFailure.Forbidden,
            RampExecutionWriteFailure.NotFound => RampOperationsFailure.NotFound,
            _ => RampOperationsFailure.Conflict,
        });
}

/// <summary>
/// Top view of an airliner, nose to the left as on the paper Flight Report, in a box whose width
/// is <see cref="AspectRatio"/> times its height. Damage marks are normalized to this same box, so
/// the tablet and the PDF place them identically.
/// </summary>
public static class AircraftSilhouette
{
    public const double AspectRatio = 1.6;

    public static readonly IReadOnlyList<(double X, double Y)> Outline =
    [
        (0.02, 0.50), (0.05, 0.465), (0.10, 0.45), (0.38, 0.45), (0.56, 0.04), (0.62, 0.04), (0.52, 0.45),
        (0.82, 0.45), (0.92, 0.24), (0.96, 0.24), (0.94, 0.47), (0.99, 0.48), (0.99, 0.52), (0.94, 0.53),
        (0.96, 0.76), (0.92, 0.76), (0.82, 0.55), (0.52, 0.55), (0.62, 0.96), (0.56, 0.96), (0.38, 0.55),
        (0.10, 0.55), (0.05, 0.535),
    ];
}
