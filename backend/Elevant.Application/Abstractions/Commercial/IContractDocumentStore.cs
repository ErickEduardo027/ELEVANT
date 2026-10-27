using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace Elevant.Application.Abstractions.Commercial;

public sealed record ContractDocumentRate(string ServiceCode, string ServiceName, string BillingUnit,
    decimal UnitPrice, decimal MinimumQuantity);

public sealed record ContractDocumentSignature(string Party, string SignerName, string SignerTitle,
    DateTimeOffset SignedAt, string DocumentSha256);

/// <summary>Formal content of one approved contract version, as printed and signed.</summary>
public sealed record ContractDocumentData(Guid ContractId, Guid VersionId, string ContractCode, string ContractStatus,
    string AirlineName, string AirlineCode, string? AirlineLegalName, int VersionNumber, string VersionStatus,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode, IReadOnlyList<string> Stations,
    IReadOnlyList<ContractDocumentRate> Rates, string? Terms, DateOnly? SignedOn,
    IReadOnlyList<ContractDocumentSignature> Signatures)
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
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }
}

public sealed record SignContractInput(Guid RequestId, string? SignerName, string? SignerTitle,
    string? DocumentSha256, bool Accepted);

public enum ContractDocumentFailure { Forbidden, NotFound, Invalid, Conflict, AlreadySigned }

public sealed record ContractDocumentResult(ContractDocumentData? Document, ContractDocumentFailure? Failure,
    bool Replayed = false);

public interface IContractDocumentStore
{
    /// <summary>
    /// Internal readers need Contratos «Ver» (or Finance contract approvals); an airline user only
    /// reads versions of its own airline. Only approved or superseded versions have a document.
    /// </summary>
    Task<ContractDocumentResult> ReadAsync(Guid actorId, Guid versionId, CancellationToken cancellationToken = default);

    /// <summary>
    /// Records the reader's party acceptance: AVIAM with Contratos «Firmar por AVIAM», the airline
    /// through its portal account. <see cref="SignContractInput.DocumentSha256"/> must match the
    /// current content so nobody signs a stale view.
    /// </summary>
    Task<ContractDocumentResult> SignAsync(Guid actorId, Guid versionId, SignContractInput input,
        CancellationToken cancellationToken = default);
}

public interface IContractPdfRenderer
{
    byte[] Render(ContractDocumentData document);
}
