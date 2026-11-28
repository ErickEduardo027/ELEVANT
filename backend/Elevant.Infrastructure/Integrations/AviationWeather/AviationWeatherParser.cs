using System.Collections.ObjectModel;
using System.Globalization;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Infrastructure.Integrations.AviationWeather;

/// <summary>What one answer of the Data API holds for the airport it was asked about.</summary>
public enum AviationWeatherReadKind
{
    /// <summary>A report of the airport that could be read.</summary>
    Report,

    /// <summary>A list without a report of the airport: the service has none for it now.</summary>
    NoReport,

    /// <summary>The answer is not a list, or none of the airport's reports in it can be read.</summary>
    Unreadable,
}

/// <summary>
/// Reads the JSON of the Data API of aviationweather.gov (ADR-0043, contracts 1.4): the list of reports that
/// <c>metar?ids=…&amp;format=json</c> and <c>taf?ids=…&amp;format=json</c> answer, each with its <c>icaoId</c>. Pure: it never
/// calls anything. Of the airport's reports it takes the latest one that can be read. Every instant may come as Unix
/// seconds or as an ISO 8601 text, and a value that is missing or out of its range is left out (null) instead of failing
/// the report; only a report without its raw text or its time cannot be read.
/// </summary>
public static class AviationWeatherParser
{
    /// <summary>The longest raw METAR read; a longer one makes the report unreadable.</summary>
    public const int MaxMetarLength = 1_000;

    /// <summary>The longest raw TAF read; a longer one makes the report unreadable.</summary>
    public const int MaxTafLength = 4_000;

    /// <summary>The cloud layers kept of a report or a period: the first ones that can be read.</summary>
    public const int MaxCloudLayers = 8;

    /// <summary>The periods kept of a TAF: the first ones that can be read.</summary>
    public const int MaxTafPeriods = 30;

    /// <summary>The strongest wind or gust read, in knots.</summary>
    public const int MaxWindKnots = 300;

    /// <summary>The longest visibility read, in statute miles.</summary>
    public const double MaxVisibilityStatuteMiles = 100;

    /// <summary>The coldest and the hottest temperature or dewpoint read, in degrees Celsius.</summary>
    public const double MinCelsius = -100;

    /// <inheritdoc cref="MinCelsius"/>
    public const double MaxCelsius = 100;

    /// <summary>The lowest and the highest altimeter setting read, in hectopascals.</summary>
    public const double MinHectopascals = 800;

    /// <inheritdoc cref="MinHectopascals"/>
    public const double MaxHectopascals = 1_100;

    /// <summary>The highest cloud base read, in feet.</summary>
    public const int MaxCloudBaseFeet = 100_000;

    /// <summary>The longest present weather read (for example <c>-SHRA BR</c>).</summary>
    public const int MaxWeatherLength = 64;

    /// <summary>The flight categories a METAR may carry; any other value is left out.</summary>
    public static IReadOnlyList<string> FlightCategories { get; } = ["VFR", "MVFR", "IFR", "LIFR"];

    /// <summary>How a TAF period may start; any other value is left out.</summary>
    public static IReadOnlyList<string> Changes { get; } = ["FM", "BECMG", "TEMPO", "PROB"];

    // An altimeter from 25 to 35 can only be inches of mercury: the Data API gives hectopascals.
    private const double MinInchesOfMercury = 25;
    private const double MaxInchesOfMercury = 35;
    private const double HectopascalsPerInchOfMercury = 33.8639;
    // 9999-12-31T23:59:59Z, the last second a DateTimeOffset holds.
    private const double MaxUnixSeconds = 253_402_300_799;

    // ISO 8601 with a «T» or a space, optional fraction and optional zone (none is UTC).
    private static readonly string[] IsoFormats = ["yyyy-MM-dd'T'HH:mm:ss.FFFFFFFK", "yyyy-MM-dd' 'HH:mm:ss.FFFFFFFK"];

    /// <summary>
    /// The latest METAR of <paramref name="icao"/> in an answer of <c>metar?…&amp;format=json</c>. Its time is
    /// <c>obsTime</c>, else <c>reportTime</c>; without <c>rawOb</c> or a time a report cannot be read.
    /// </summary>
    public static (AviationWeatherReadKind Kind, AerodromeMetar? Report) ParseMetar(JsonElement root, string icao) =>
        Latest(root, icao, Metar, metar => metar.ObservedAt);

    /// <summary>
    /// The latest TAF of <paramref name="icao"/> in an answer of <c>taf?…&amp;format=json</c>, by its <c>issueTime</c>;
    /// without <c>rawTAF</c>, its issue time or a validity that ends after it starts a report cannot be read. A period
    /// without its start or its end, or that ends before it starts, is left out.
    /// </summary>
    public static (AviationWeatherReadKind Kind, AerodromeTaf? Report) ParseTaf(JsonElement root, string icao) =>
        Latest(root, icao, Taf, taf => taf.IssuedAt);

    /// <summary>
    /// The latest METAR of each airport of <paramref name="icaoCodes"/> in one answer of <c>metar?ids=A,B,…&amp;format=json</c>
    /// (plan M6), by ICAO code in upper case, read as <see cref="ParseMetar"/> reads one airport's. An airport without a
    /// readable report is left out and the others are kept; the answer cannot be read only when it is not a list, or when
    /// it has reports of those airports and none of them can be read. Reports of other airports are ignored.
    /// </summary>
    public static (AviationWeatherReadKind Kind, IReadOnlyDictionary<string, AerodromeMetar>? Reports) ParseMetars(
        JsonElement root, IReadOnlyCollection<string> icaoCodes) =>
        LatestOfEach(root, icaoCodes, Metar, metar => metar.ObservedAt);

    /// <summary>
    /// The latest TAF of each airport of <paramref name="icaoCodes"/> in one answer of <c>taf?ids=A,B,…&amp;format=json</c>
    /// (plan M6), by ICAO code in upper case, read as <see cref="ParseTaf"/> reads one airport's and with the rules of
    /// <see cref="ParseMetars"/> for the airports without one.
    /// </summary>
    public static (AviationWeatherReadKind Kind, IReadOnlyDictionary<string, AerodromeTaf>? Reports) ParseTafs(
        JsonElement root, IReadOnlyCollection<string> icaoCodes) =>
        LatestOfEach(root, icaoCodes, Taf, taf => taf.IssuedAt);

    private static (AviationWeatherReadKind Kind, IReadOnlyDictionary<string, T>? Reports) LatestOfEach<T>(JsonElement root,
        IReadOnlyCollection<string> icaoCodes, Func<JsonElement, T?> read, Func<T, DateTimeOffset> timeOf) where T : class
    {
        ArgumentNullException.ThrowIfNull(icaoCodes);
        if (root.ValueKind != JsonValueKind.Array) return (AviationWeatherReadKind.Unreadable, null);
        var wanted = icaoCodes.Select(code => code.Trim().ToUpperInvariant()).ToHashSet(StringComparer.Ordinal);
        var found = false;
        var latest = new Dictionary<string, T>(StringComparer.Ordinal);
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object || Text(item, "icaoId")?.ToUpperInvariant() is not { } icao ||
                !wanted.Contains(icao))
                continue;
            found = true;
            if (read(item) is { } report && (!latest.TryGetValue(icao, out var kept) || timeOf(report) > timeOf(kept)))
                latest[icao] = report;
        }
        if (latest.Count > 0) return (AviationWeatherReadKind.Report, new ReadOnlyDictionary<string, T>(latest));
        return (found ? AviationWeatherReadKind.Unreadable : AviationWeatherReadKind.NoReport, null);
    }

    private static (AviationWeatherReadKind Kind, T? Report) Latest<T>(JsonElement root, string icao,
        Func<JsonElement, T?> read, Func<T, DateTimeOffset> timeOf) where T : class
    {
        ArgumentNullException.ThrowIfNull(icao);
        if (root.ValueKind != JsonValueKind.Array) return (AviationWeatherReadKind.Unreadable, null);
        var wanted = icao.Trim();
        var found = false;
        T? latest = null;
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object ||
                !string.Equals(Text(item, "icaoId"), wanted, StringComparison.OrdinalIgnoreCase))
                continue;
            found = true;
            if (read(item) is { } report && (latest is null || timeOf(report) > timeOf(latest))) latest = report;
        }
        if (latest is not null) return (AviationWeatherReadKind.Report, latest);
        return (found ? AviationWeatherReadKind.Unreadable : AviationWeatherReadKind.NoReport, null);
    }

    private static AerodromeMetar? Metar(JsonElement item)
    {
        if (Raw(item, "rawOb", MaxMetarLength) is not { } raw) return null;
        if ((Instant(item, "obsTime") ?? Instant(item, "reportTime")) is not { } observedAt) return null;
        var (direction, variable) = Wind(item);
        return new AerodromeMetar(raw, observedAt, OneOf(Text(item, "fltCat"), FlightCategories), direction, variable,
            Knots(item, "wspd"), Knots(item, "wgst"), Visibility(item), Celsius(item, "temp"), Celsius(item, "dewp"),
            Altimeter(item), Weather(item), Clouds(item));
    }

    private static AerodromeTaf? Taf(JsonElement item)
    {
        if (Raw(item, "rawTAF", MaxTafLength) is not { } raw) return null;
        if (Instant(item, "issueTime") is not { } issuedAt || Instant(item, "validTimeFrom") is not { } validFrom ||
            Instant(item, "validTimeTo") is not { } validTo || validTo <= validFrom)
            return null;
        return new AerodromeTaf(raw, issuedAt, validFrom, validTo, Periods(item));
    }

    private static IReadOnlyList<AerodromeTafPeriod> Periods(JsonElement item)
    {
        if (!item.TryGetProperty("fcsts", out var forecasts) || forecasts.ValueKind != JsonValueKind.Array) return [];
        var periods = new List<AerodromeTafPeriod>();
        foreach (var forecast in forecasts.EnumerateArray())
        {
            if (periods.Count == MaxTafPeriods) break;
            if (forecast.ValueKind == JsonValueKind.Object && Period(forecast) is { } period) periods.Add(period);
        }
        return [.. periods];
    }

    private static AerodromeTafPeriod? Period(JsonElement forecast)
    {
        if (Instant(forecast, "timeFrom") is not { } from || Instant(forecast, "timeTo") is not { } to || to <= from)
            return null;
        var (direction, variable) = Wind(forecast);
        return new AerodromeTafPeriod(from, to, OneOf(Text(forecast, "fcstChange"), Changes),
            Whole(Number(forecast, "probability"), 0, 100), direction, variable, Knots(forecast, "wspd"),
            Knots(forecast, "wgst"), Visibility(forecast), Weather(forecast), Clouds(forecast));
    }

    /// <summary>
    /// The wind direction from 0 to 360 degrees, or «VRB»: a variable wind, without a direction. Any other value is no
    /// direction.
    /// </summary>
    private static (int? Direction, bool Variable) Wind(JsonElement item)
    {
        if (!item.TryGetProperty("wdir", out var value)) return (null, false);
        if (value.ValueKind == JsonValueKind.String)
            return (null, string.Equals(value.GetString()?.Trim(), "VRB", StringComparison.OrdinalIgnoreCase));
        return (Whole(Number(value), 0, 360), false);
    }

    private static int? Knots(JsonElement item, string property) => Whole(Number(item, property), 0, MaxWindKnots);

    private static double? Celsius(JsonElement item, string property) =>
        Number(item, property) is { } value and >= MinCelsius and <= MaxCelsius ? value : null;

    /// <summary>The visibility in statute miles: a number, or a text such as «10+», «6+», «3», «1/2» or «1 1/2».</summary>
    private static double? Visibility(JsonElement item)
    {
        if (!item.TryGetProperty("visib", out var value)) return null;
        var miles = value.ValueKind == JsonValueKind.String ? VisibilityText(value.GetString()) : Number(value);
        return miles is { } number and >= 0 and <= MaxVisibilityStatuteMiles ? number : null;
    }

    private static double? VisibilityText(string? text)
    {
        var value = text?.Trim() ?? string.Empty;
        // «10+» is ten miles or more: the miles are the number, and the raw text keeps the «+».
        if (value.EndsWith('+')) value = value[..^1].TrimEnd();
        var parts = value.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length == 1) return parts[0].Contains('/') ? Fraction(parts[0]) : Unsigned(parts[0]);
        if (parts.Length == 2 && int.TryParse(parts[0], NumberStyles.None, CultureInfo.InvariantCulture, out var whole) &&
            Fraction(parts[1]) is double part and < 1)
            return whole + part;
        return null;
    }

    private static double? Unsigned(string text) =>
        double.TryParse(text, NumberStyles.AllowDecimalPoint, CultureInfo.InvariantCulture, out var value) ? value : null;

    private static double? Fraction(string text)
    {
        var slash = text.IndexOf('/');
        return slash > 0 &&
            int.TryParse(text.AsSpan(0, slash), NumberStyles.None, CultureInfo.InvariantCulture, out var numerator) &&
            int.TryParse(text.AsSpan(slash + 1), NumberStyles.None, CultureInfo.InvariantCulture, out var denominator) &&
            denominator > 0
                ? (double)numerator / denominator
                : null;
    }

    /// <summary>The altimeter setting in hectopascals; inches of mercury are converted and rounded to a tenth.</summary>
    private static double? Altimeter(JsonElement item)
    {
        if (Number(item, "altim") is not { } value) return null;
        var hectopascals = value is >= MinInchesOfMercury and <= MaxInchesOfMercury
            ? Math.Round(value * HectopascalsPerInchOfMercury, 1, MidpointRounding.AwayFromZero)
            : value;
        return hectopascals is >= MinHectopascals and <= MaxHectopascals ? hectopascals : null;
    }

    private static string? Weather(JsonElement item) =>
        Text(item, "wxString") is { Length: <= MaxWeatherLength } weather ? weather : null;

    private static IReadOnlyList<AerodromeCloudLayer> Clouds(JsonElement item)
    {
        if (!item.TryGetProperty("clouds", out var clouds) || clouds.ValueKind != JsonValueKind.Array) return [];
        var layers = new List<AerodromeCloudLayer>();
        foreach (var cloud in clouds.EnumerateArray())
        {
            if (layers.Count == MaxCloudLayers) break;
            if (cloud.ValueKind != JsonValueKind.Object || Cover(Text(cloud, "cover")) is not { } cover) continue;
            layers.Add(new AerodromeCloudLayer(cover, Whole(Number(cloud, "base"), 0, MaxCloudBaseFeet)));
        }
        return [.. layers];
    }

    /// <summary>Two to five letters, in upper case (FEW, SCT, BKN, OVC, VV, CAVOK…); anything else is no layer.</summary>
    private static string? Cover(string? text) =>
        text?.ToUpperInvariant() is { Length: >= 2 and <= 5 } cover && cover.All(char.IsAsciiLetterUpper) ? cover : null;

    /// <summary>The value in upper case when it is one of <paramref name="allowed"/>; null otherwise.</summary>
    private static string? OneOf(string? text, IReadOnlyList<string> allowed) =>
        text?.ToUpperInvariant() is { } value && allowed.Contains(value, StringComparer.Ordinal) ? value : null;

    /// <summary>A raw report: its text, trimmed, when it is no longer than <paramref name="maxLength"/>.</summary>
    private static string? Raw(JsonElement item, string property, int maxLength) =>
        Text(item, property) is { } text && text.Length <= maxLength ? text : null;

    /// <summary>An instant given as Unix seconds or as an ISO 8601 text, in UTC; null when it is neither.</summary>
    private static DateTimeOffset? Instant(JsonElement item, string property)
    {
        if (!item.TryGetProperty(property, out var value)) return null;
        if (Number(value) is { } seconds)
            return seconds is > 0 and <= MaxUnixSeconds
                ? DateTimeOffset.FromUnixTimeMilliseconds((long)Math.Round(seconds * 1000, MidpointRounding.AwayFromZero))
                : null;
        return value.ValueKind == JsonValueKind.String &&
            DateTimeOffset.TryParseExact(value.GetString()?.Trim(), IsoFormats, CultureInfo.InvariantCulture,
                DateTimeStyles.AssumeUniversal, out var instant)
            ? instant.ToUniversalTime()
            : null;
    }

    /// <summary>The text of a property, trimmed; null when it is missing, not a text or blank.</summary>
    private static string? Text(JsonElement item, string property) =>
        item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String &&
        value.GetString()?.Trim() is { Length: > 0 } text
            ? text
            : null;

    private static double? Number(JsonElement item, string property) =>
        item.TryGetProperty(property, out var value) ? Number(value) : null;

    /// <summary>A finite number; null for anything else.</summary>
    private static double? Number(JsonElement value) =>
        value.ValueKind == JsonValueKind.Number && value.TryGetDouble(out var number) && double.IsFinite(number)
            ? number
            : null;

    /// <summary>The value rounded to a whole number when it is from <paramref name="minimum"/> to <paramref name="maximum"/>.</summary>
    private static int? Whole(double? value, int minimum, int maximum) =>
        value is { } number && number >= minimum && number <= maximum
            ? (int)Math.Round(number, MidpointRounding.AwayFromZero)
            : null;
}
