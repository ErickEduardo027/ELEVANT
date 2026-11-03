using System.Buffers.Binary;
using System.Globalization;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>
/// Rules of the validity step and of drawn signatures (ADR-0025). Contratos fixes the validity,
/// renewal and termination terms after Finance approval and before anyone signs; the airline signs
/// first and AVIAM countersigns.
/// </summary>
public static class ContractValidity
{
    public const int MaximumRenewalMonths = 60;
    public const int MaximumNoticeDays = 180;
    public const int MaximumTerminationTermsLength = 4000;
    public const int MaximumSignatureBytes = 256 * 1024;
    public const int MaximumSignatureWidth = 1200;
    public const int MaximumSignatureHeight = 400;

    private static readonly byte[] PngMagic = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];

    /// <summary>
    /// Null when the terms are valid, otherwise a machine-readable code. <paramref name="previousFrom"/>
    /// is the start of the contract's previous approved version, when this is a renewal.
    /// </summary>
    public static string? Check(DateOnly validFrom, DateOnly? validTo, string? renewalMode, int? renewalTermMonths,
        int renewalNoticeDays, int terminationNoticeDays, string? terminationTerms, DateOnly today, DateOnly? previousFrom)
    {
        if (!Enum.TryParse<ContractRenewalMode>(renewalMode, false, out var mode) || !Enum.IsDefined(mode))
            return "renewal_mode_invalid";
        if (validTo is not { } end) return "valid_to_required";
        if (end <= validFrom) return "dates_invalid";
        // A first contract starts today or later; a renewal may start earlier than today only after the version it renews.
        if (validFrom < today && (previousFrom is not { } previous || validFrom <= previous)) return "valid_from_past";
        if (renewalTermMonths is { } months && months is < 1 or > MaximumRenewalMonths) return "renewal_term_invalid";
        if (mode == ContractRenewalMode.Automatic && renewalTermMonths is null) return "renewal_term_required";
        var length = end.DayNumber - validFrom.DayNumber;
        if (renewalNoticeDays is < 0 or > MaximumNoticeDays || renewalNoticeDays >= length) return "renewal_notice_invalid";
        if (terminationNoticeDays is < 0 or > MaximumNoticeDays || terminationNoticeDays >= length)
            return "termination_notice_invalid";
        if (terminationTerms?.Trim().Length > MaximumTerminationTermsLength) return "termination_terms_too_long";
        return null;
    }

    /// <summary>
    /// Decodes a drawn signature and checks it is a real PNG within the size limits; null when it is not.
    /// Accepts plain base64 or a <c>data:image/png;base64,</c> URL as produced by a canvas.
    /// </summary>
    public static byte[]? DecodeSignature(string? base64Png)
    {
        if (string.IsNullOrWhiteSpace(base64Png)) return null;
        var value = base64Png.Trim();
        const string prefix = "data:image/png;base64,";
        if (value.StartsWith(prefix, StringComparison.OrdinalIgnoreCase)) value = value[prefix.Length..];
        if (value.Length > (MaximumSignatureBytes + 2) / 3 * 4) return null;
        var bytes = new byte[value.Length];
        if (!Convert.TryFromBase64String(value, bytes, out var length)) return null;
        bytes = bytes[..length];
        // PNG magic, then the IHDR chunk with width and height as big-endian 32-bit integers.
        if (length < 24 || length > MaximumSignatureBytes || !bytes.AsSpan(0, 8).SequenceEqual(PngMagic) ||
            !bytes.AsSpan(12, 4).SequenceEqual("IHDR"u8)) return null;
        var width = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(16, 4));
        var height = BinaryPrimitives.ReadInt32BigEndian(bytes.AsSpan(20, 4));
        return width is > 0 and <= MaximumSignatureWidth && height is > 0 and <= MaximumSignatureHeight ? bytes : null;
    }

    /// <summary>Final contract code assigned when the validity is confirmed, e.g. <c>CTR-2026-0007</c>.</summary>
    public static string FinalCode(int year, long sequence) =>
        string.Create(CultureInfo.InvariantCulture, $"CTR-{year}-{sequence:0000}");

    public static bool IsDraftCode(string code) => code.StartsWith("DRAFT-", StringComparison.Ordinal);
}
