using System.Globalization;

namespace Elevant.Application.Operations;

/// <summary>
/// The readable operation code of a flight entered by OCC or imported from the feed (3-N27):
/// <c>{station}-{yyyyMMdd}-{NNN}</c>, for example <c>PUJ-20261105-001</c>, numbered per station and local day. The
/// invoice, the portal and the tablet show it. Codes already issued (MAN-, EXT-, DEV-) keep their value.
/// </summary>
public static class OperationCodeFormat
{
    /// <summary>The longest code the unique index of <c>ops.turnarounds.operation_code</c> keeps.</summary>
    public const int MaxLength = 40;

    /// <summary>What every code of the station and day starts with.</summary>
    public static string Prefix(string stationCode, DateOnly localDate)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(stationCode);
        return $"{stationCode.Trim().ToUpperInvariant()}-{localDate.ToString("yyyyMMdd", CultureInfo.InvariantCulture)}-";
    }

    /// <summary>The code of the <paramref name="sequence"/>-th flight of the day, padded to three digits.</summary>
    public static string Format(string stationCode, DateOnly localDate, int sequence)
    {
        ArgumentOutOfRangeException.ThrowIfLessThan(sequence, 1);
        var code = Prefix(stationCode, localDate) + sequence.ToString("000", CultureInfo.InvariantCulture);
        return code.Length <= MaxLength ? code : throw new ArgumentOutOfRangeException(nameof(sequence));
    }

    /// <summary>The number of an issued code with this prefix; null when the code is not one of these.</summary>
    public static int? Sequence(string? code, string prefix)
    {
        if (code is null || !code.StartsWith(prefix, StringComparison.Ordinal)) return null;
        var digits = code[prefix.Length..];
        return digits.Length >= 3 && digits.All(char.IsAsciiDigit) &&
               int.TryParse(digits, NumberStyles.None, CultureInfo.InvariantCulture, out var value) && value > 0
            ? value
            : null;
    }

    /// <summary>The next code after the highest one already issued with the prefix.</summary>
    public static string Next(string stationCode, DateOnly localDate, IEnumerable<string> issued)
    {
        var prefix = Prefix(stationCode, localDate);
        var highest = issued.Select(code => Sequence(code, prefix) ?? 0).DefaultIfEmpty(0).Max();
        return Format(stationCode, localDate, checked(highest + 1));
    }
}
