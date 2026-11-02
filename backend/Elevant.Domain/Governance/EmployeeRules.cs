using System.Text;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Validation;

namespace Elevant.Domain.Governance;

/// <summary>Identification documents Human Resources records for an employee.</summary>
public static class IdentificationTypes
{
    public const string Cedula = "CEDULA";
    public const string Pasaporte = "PASAPORTE";
    public const string Residencia = "RESIDENCIA";

    public static IReadOnlyList<string> All { get; } = [Cedula, Pasaporte, Residencia];

    /// <summary>Placeholder types written before employees existed; registering a record replaces them.</summary>
    private static readonly HashSet<string> Synthetic =
        new(["GOVERNANCE_ACCOUNT", "RAMP_EMPLOYEE", "Synthetic"], StringComparer.Ordinal);

    public static bool IsValid(string? type) => type is not null && All.Contains(type);

    /// <summary>
    /// Canonical number when it has the real format of its type: a cédula or residence card
    /// with its check digit, or a passport number. Null when the format is wrong.
    /// </summary>
    public static string? Normalize(string? type, string? number) => Check(type, number).Number;

    /// <summary>
    /// Validates every character in its position and says which one is wrong (ADR-0020). The
    /// record keeps no nationality, so a passport that starts with «RD» is held to the Dominican
    /// rule (RD and 7 digits) and any other to ICAO 9303.
    /// </summary>
    public static IdentityDocumentCheck Check(string? type, string? number) => type switch
    {
        Cedula => IdentityDocuments.Check(IdentityDocumentKind.Cedula, number),
        Residencia => IdentityDocuments.Check(IdentityDocumentKind.Residence, number),
        Pasaporte => IdentityDocuments.Check(IdentityDocumentKind.Passport, number,
            NormalizeNumber(number)?.StartsWith(IdentityDocuments.DominicanPassportPrefix, StringComparison.Ordinal) == true
                ? "DO" : null),
        _ => new IdentityDocumentCheck(null, "Elige cédula, residencia o pasaporte."),
    };

    public static bool IsSynthetic(string? type) => type is not null && Synthetic.Contains(type);

    /// <summary>
    /// Canonical form used for uniqueness: upper-case letters and digits only, so
    /// "001-1234567-8" and "00112345678" are the same cédula. Null when nothing usable remains.
    /// </summary>
    public static string? NormalizeNumber(string? number)
    {
        if (string.IsNullOrWhiteSpace(number)) return null;
        var builder = new StringBuilder(number.Length);
        foreach (var character in number.Trim())
        {
            if (character is ' ' or '-' or '.') continue;
            if (!char.IsAsciiLetterOrDigit(character)) return null;
            builder.Append(char.ToUpperInvariant(character));
        }
        return builder.Length is >= 4 and <= 32 ? builder.ToString() : null;
    }
}

/// <summary>Allowed moves of a personnel requisition.</summary>
public static class RequisitionTransitions
{
    public static bool IsClosed(RequisitionStatus status) =>
        status is RequisitionStatus.Fulfilled or RequisitionStatus.Rejected or RequisitionStatus.Cancelled;

    public static bool CanMove(RequisitionStatus from, RequisitionStatus to) => (from, to) switch
    {
        (RequisitionStatus.Open, RequisitionStatus.InProgress) => true,
        (RequisitionStatus.Open or RequisitionStatus.InProgress, RequisitionStatus.Fulfilled) => true,
        (RequisitionStatus.Open or RequisitionStatus.InProgress, RequisitionStatus.Rejected) => true,
        (RequisitionStatus.Open or RequisitionStatus.InProgress, RequisitionStatus.Cancelled) => true,
        _ => false,
    };

    /// <summary>Rejecting or cancelling must say why.</summary>
    public static bool RequiresReason(RequisitionStatus to) =>
        to is RequisitionStatus.Rejected or RequisitionStatus.Cancelled;
}
