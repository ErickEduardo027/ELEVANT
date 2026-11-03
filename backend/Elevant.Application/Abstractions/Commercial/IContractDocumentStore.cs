using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Elevant.Application.Abstractions.Commercial;

/// <param name="PriceConfirmed">False only for a draft rate still «por definir»; not part of the signed hash.</param>
public sealed record ContractDocumentRate(string ServiceCode, string ServiceName, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity, bool PriceConfirmed = true);

/// <param name="Image">Drawn signature as PNG (ADR-0025); null for older, typed-only signatures.</param>
public sealed record ContractDocumentSignature(string Party, string SignerName, string SignerTitle,
    DateTimeOffset SignedAt, string DocumentSha256, byte[]? Image = null);

/// <summary>
/// Renewal and termination terms Contratos confirms after Finance approval (ADR-0025). Null on
/// versions confirmed before the step existed; those keep their original signed hash.
/// </summary>
public sealed record ContractValidityTerms(string RenewalMode, int? RenewalTermMonths, int RenewalNoticeDays,
    int TerminationNoticeDays, string? TerminationTerms, DateTimeOffset ConfirmedAt);

/// <summary>Formal content of one approved contract version, as printed and signed.</summary>
public sealed record ContractDocumentData(Guid ContractId, Guid VersionId, string ContractCode, string ContractStatus,
    string AirlineName, string AirlineCode, string? AirlineLegalName, int VersionNumber, string VersionStatus,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode, IReadOnlyList<string> Stations,
    IReadOnlyList<ContractDocumentRate> Rates, string? Terms, DateOnly? SignedOn,
    IReadOnlyList<ContractDocumentSignature> Signatures, ContractValidityTerms? Validity = null)
{
    /// <summary>SHA-256 of the canonical content; a signature proves acceptance of exactly this.</summary>
    public string ContentSha256 => ContractDocumentHash.Of(this);

    /// <summary>The party the reader may sign for, or null when it cannot sign this version.</summary>
    public string? SignableBy { get; init; }
}

public static class ContractDocumentHash
{
    public static string Of(ContractDocumentData document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var canonical = JsonSerializer.Serialize(new
        {
            contract = document.ContractCode,
            airline = document.AirlineName,
            airlineCode = document.AirlineCode,
            version = document.VersionNumber,
            validFrom = document.ValidFrom.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            validTo = document.ValidTo?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
            currency = document.CurrencyCode,
            stations = document.Stations.Order(StringComparer.Ordinal).ToArray(),
            rates = document.Rates.OrderBy(rate => rate.ServiceCode, StringComparer.Ordinal)
                .ThenBy(rate => rate.BillingUnit, StringComparer.Ordinal)
                .Select(rate => new[]
                {
                    rate.ServiceCode, rate.BillingUnit,
                    rate.UnitPrice.ToString("0.0000", CultureInfo.InvariantCulture),
                    rate.MinimumQuantity.ToString("0.####", CultureInfo.InvariantCulture),
                }).ToArray(),
            terms = document.Terms?.Trim() ?? string.Empty,
        });
        // Validity terms join the signed content only when present, so versions signed before
        // ADR-0025 keep exactly the hash they were signed with.
        if (document.Validity is { } validity)
            canonical = canonical[..^1] + "," + JsonSerializer.Serialize(new
            {
                renewal = validity.RenewalMode,
                renewalMonths = validity.RenewalTermMonths,
                renewalNoticeDays = validity.RenewalNoticeDays,
                terminationNoticeDays = validity.TerminationNoticeDays,
                termination = validity.TerminationTerms?.Trim() ?? string.Empty,
            })[1..];
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }
}

/// <param name="SignatureImagePng">Drawn signature as base64 PNG, at most 256 KB and 1200×400 px.</param>
public sealed record SignContractInput(Guid RequestId, string? SignerName, string? SignerTitle,
    string? DocumentSha256, bool Accepted, string? SignatureImagePng = null);

/// <summary>
/// <see cref="AirlineSignaturePending"/>: AVIAM countersigns only after the airline signed.
/// <see cref="ValidityPending"/>: Contratos has not confirmed validity and renewal yet.
/// </summary>
public enum ContractDocumentFailure
{
    Forbidden, NotFound, Invalid, Conflict, AlreadySigned, AirlineSignaturePending, ValidityPending,
}

public sealed record ContractDocumentResult(ContractDocumentData? Document, ContractDocumentFailure? Failure,
    bool Replayed = false, string? Code = null);

/// <summary>
/// Validity and renewal terms Contratos confirms (ADR-0025). <see cref="ExpectedDocumentSha256"/> is
/// the content hash the form was built from, so a concurrent change answers 409.
/// </summary>
public sealed record ContractValidityInput(DateOnly ValidFrom, DateOnly? ValidTo, string RenewalMode,
    int? RenewalTermMonths, int RenewalNoticeDays, int TerminationNoticeDays, string? TerminationTerms,
    string ExpectedDocumentSha256);

public interface IContractDocumentStore
{
    /// <summary>
    /// Internal readers need Contratos «Ver» (or Finance contract approvals); an airline user only
    /// reads versions of its own airline. Only approved or superseded versions have a document.
    /// </summary>
    Task<ContractDocumentResult> ReadAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Review copy of a version that is not approved yet (draft or awaiting Finance), for the same
    /// readers. It is never signable and prints with a watermark.
    /// </summary>
    Task<ContractDocumentResult> ReadDraftAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Records the reader's party acceptance: AVIAM with Contratos «Firmar por AVIAM», the airline
    /// through its portal account. <see cref="SignContractInput.DocumentSha256"/> must match the
    /// current content so nobody signs a stale view.
    /// </summary>
    Task<ContractDocumentResult> SignAsync(Guid actorId, Guid versionId, SignContractInput input,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Contratos («Fijar vigencia y renovación») confirms validity, renewal and termination terms of
    /// an approved version nobody signed yet, and gives the contract its final code. Signatures are
    /// accepted only afterwards.
    /// </summary>
    Task<ContractDocumentResult> SetValidityAsync(Guid actorId, Guid versionId, ContractValidityInput input,
        CancellationToken cancellationToken = default);
}

public interface IContractPdfRenderer
{
    byte[] Render(ContractDocumentData document);
}
