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

/// <summary>
/// A surcharge as it applies to a version: the value Finance froze at approval (negotiated or inherited
/// from the base charge tariff), the exemption and the frozen policy. <see cref="Value"/> is an amount
/// per unit, or the percentage for <c>PercentOfService</c>.
/// </summary>
public sealed record ContractDocumentCharge(string ChargeCode, string ChargeName, string Method, string? BillingUnit,
    string QuantityRule, int GraceMinutes, decimal RoundingIncrement, bool IsExcluded, decimal? Value,
    decimal? MinimumAmount);

/// <summary>One service a package covers and how its excess is billed.</summary>
public sealed record ContractDocumentPackageComponent(string ServiceCode, string ServiceName, string BillingUnit,
    decimal IncludedQuantity, decimal ExcessBlockSize, decimal ExcessBlockPrice);

/// <summary>A published package version linked to the contract version.</summary>
public sealed record ContractDocumentPackage(string Code, string Name, int VersionNumber, string Scope,
    string? FlightDirection, int? PeriodDays, decimal BasePrice, string CurrencyCode,
    IReadOnlyList<ContractDocumentPackageComponent> Components);

/// <summary>
/// Surcharges and packages of a version (2-N04). They join the signed content only for versions with
/// pricing policy 2: approved after this change, or with a frozen policy and nobody's signature when
/// Contratos confirmed the validity. The hashes already signed never change.
/// </summary>
public sealed record ContractPricingTerms(IReadOnlyList<ContractDocumentCharge> Charges,
    IReadOnlyList<ContractDocumentPackage> Packages);

/// <summary>
/// Formal content of one approved contract version, as printed and signed. <see cref="SignedOn"/> is the
/// business day of this version's second signature (2-N05), null until both parties signed it.
/// </summary>
public sealed record ContractDocumentData(Guid ContractId, Guid VersionId, string ContractCode, string ContractStatus,
    string AirlineName, string AirlineCode, string? AirlineLegalName, int VersionNumber, string VersionStatus,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode, IReadOnlyList<string> Stations,
    IReadOnlyList<ContractDocumentRate> Rates, string? Terms, DateOnly? SignedOn,
    IReadOnlyList<ContractDocumentSignature> Signatures, ContractValidityTerms? Validity = null,
    ContractPricingTerms? Pricing = null)
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
        // 2-N04: surcharges and packages join the signed content only when the version carries them
        // (pricing policy 2), so versions signed before keep exactly the hash they were signed with.
        if (document.Pricing is { } pricing)
            canonical = canonical[..^1] + "," + JsonSerializer.Serialize(new
            {
                pricing = new
                {
                    charges = pricing.Charges.OrderBy(charge => charge.ChargeCode, StringComparer.Ordinal)
                        .Select(charge => new[]
                        {
                            charge.ChargeCode, charge.Method, charge.BillingUnit ?? string.Empty, charge.QuantityRule,
                            charge.GraceMinutes.ToString(CultureInfo.InvariantCulture),
                            charge.RoundingIncrement.ToString("0.####", CultureInfo.InvariantCulture),
                            charge.IsExcluded ? "excluded" : "applies", Amount(charge.Value), Amount(charge.MinimumAmount),
                        }).ToArray(),
                    packages = pricing.Packages.OrderBy(package => package.Code, StringComparer.Ordinal)
                        .ThenBy(package => package.VersionNumber)
                        .Select(package => new
                        {
                            code = package.Code,
                            version = package.VersionNumber,
                            scope = package.Scope,
                            direction = package.FlightDirection ?? string.Empty,
                            periodDays = package.PeriodDays,
                            basePrice = Amount(package.BasePrice),
                            currency = package.CurrencyCode,
                            components = package.Components.OrderBy(component => component.ServiceCode, StringComparer.Ordinal)
                                .ThenBy(component => component.BillingUnit, StringComparer.Ordinal)
                                .Select(component => new[]
                                {
                                    component.ServiceCode, component.BillingUnit, Amount(component.IncludedQuantity),
                                    Amount(component.ExcessBlockSize), Amount(component.ExcessBlockPrice),
                                }).ToArray(),
                        }).ToArray(),
                },
            })[1..];
        return Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(canonical)));
    }

    private static string Amount(decimal? value) =>
        value?.ToString("0.0000", CultureInfo.InvariantCulture) ?? string.Empty;
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

/// <summary>
/// Contratos withdraws an approved version that both parties have not signed yet (2-N10), with a reason
/// and the content hash it saw.
/// </summary>
public sealed record WithdrawContractVersionInput(string Reason, string ExpectedDocumentSha256);

/// <summary>
/// The withdrawn version, now <c>Rejected</c>, and the status of its contract. A contract left without
/// any live version (it never activated) gets a new draft with the same content to correct.
/// </summary>
public sealed record ContractWithdrawalData(Guid VersionId, string VersionStatus, string ContractStatus,
    Guid? DraftVersionId);

public sealed record ContractWithdrawalResult(ContractWithdrawalData? Withdrawal, ContractDocumentFailure? Failure,
    string? Code = null)
{
    public static ContractWithdrawalResult Failed(ContractDocumentFailure failure, string code) => new(null, failure, code);
}

/// <summary>
/// The surcharges and packages that apply to an approved or superseded version (2-N04).
/// <see cref="InDocument"/>: they are part of the version's signed content (pricing policy 2).
/// <see cref="Signed"/>: they are, and both parties signed that content.
/// </summary>
public sealed record ContractPricingTermsData(Guid VersionId, string CurrencyCode, bool InDocument, bool Signed,
    IReadOnlyList<ContractDocumentCharge> Charges, IReadOnlyList<ContractDocumentPackage> Packages);

public sealed record ContractPricingTermsResult(ContractPricingTermsData? Terms, ContractDocumentFailure? Failure);

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
    /// current content so nobody signs a stale view, and AVIAM only countersigns the content the airline
    /// signed (2-N28). The second signature makes the version govern: the version it replaces ends the
    /// day before it starts and the flights not executed yet move to it (2-C).
    /// </summary>
    Task<ContractDocumentResult> SignAsync(Guid actorId, Guid versionId, SignContractInput input,
        CancellationToken cancellationToken = default);

    /// <summary>
    /// Contratos («Fijar vigencia y renovación») confirms validity, renewal and termination terms of
    /// an approved version nobody signed yet, and gives the contract its final code. Signatures are
    /// accepted only afterwards. The Idempotency-Key is optional while older clients exist (expand).
    /// </summary>
    Task<ContractDocumentResult> SetValidityAsync(Guid actorId, Guid versionId, ContractValidityInput input,
        Guid? idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>
    /// Contratos («contracts.agreements.lifecycle») withdraws an approved version both parties have not
    /// signed (2-N10): it becomes Rejected and keeps its approval; a one-party signature is voided in the
    /// audit trail, never deleted.
    /// </summary>
    Task<ContractWithdrawalResult> WithdrawAsync(Guid actorId, Guid versionId, WithdrawContractVersionInput input,
        Guid idempotencyKey, CancellationToken cancellationToken = default);

    /// <summary>Surcharges and packages of a version, for the same readers as the document (2-N04).</summary>
    Task<ContractPricingTermsResult> ReadPricingTermsAsync(Guid actorId, Guid versionId,
        CancellationToken cancellationToken = default);
}

public interface IContractPdfRenderer
{
    byte[] Render(ContractDocumentData document);
}
