using System.Text.RegularExpressions;

namespace Elevant.Application.Operations;

/// <summary>
/// One rule to compare stand codes, shared with the web (ADR-0041): the database pads the number («A01») and the
/// airport's plan does not («A1»). <c>StandCodes.vectors.json</c>, next to this file, holds the cases both test suites
/// read; the JavaScript side is <c>normalizeStandCode</c>.
/// </summary>
public static partial class StandCodes
{
    /// <summary>
    /// The code in capitals without spaces, dots or hyphens and without the zero padding of its number: «A01», «a-1»
    /// and «A 1» are the stand «A1». Nothing else is inferred: «1», «9A» and «23A» stay as they are, and a code that
    /// is not letters, a number and letters is only cleaned.
    /// </summary>
    public static string Normalize(string? code)
    {
        var text = string.Concat((code ?? string.Empty).Where(character =>
            !char.IsWhiteSpace(character) && character is not ('.' or '-'))).ToUpperInvariant();
        var match = Padded().Match(text);
        return match.Success ? string.Concat(match.Groups[1].Value, match.Groups[2].Value, match.Groups[3].Value) : text;
    }

    [GeneratedRegex("^([A-Z]*)0*([0-9]+)([A-Z]*)$")]
    private static partial Regex Padded();
}
