using System.Text.Json;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Infrastructure.Integrations.AirTraffic;

/// <summary>
/// Reads an answer in readsb's v2 JSON (ADR-0042, contracts 1.3), the shape adsb.fi and adsb.lol both use: the aircraft
/// under <c>ac</c> or <c>aircraft</c>, and <c>now</c> in seconds or in milliseconds. Pure: it never calls anything.
/// </summary>
public static class ReadsbV2Parser
{
    /// <summary>A position older than this when the network answered is not shown.</summary>
    public static TimeSpan MaxPositionAge { get; } = TimeSpan.FromSeconds(120);

    // A «now» from this value up is in milliseconds (10^11 seconds is about the year 5138).
    private const double MillisecondsThreshold = 1e11;
    private const double MaxUnixMilliseconds = 253_402_300_799_999;
    private const int MaxAltitudeFeet = 200_000;
    private const int MaxVerticalRateFeetPerMinute = 100_000;

    /// <summary>
    /// The instant the answer describes (its <c>now</c>, else <paramref name="receivedAt"/>) and its aircraft, one per
    /// address (the freshest position wins), sorted by address; null when the answer has neither <c>ac</c> nor
    /// <c>aircraft</c> as a list. An aircraft is skipped when its address is not six hexadecimal digits (a leading
    /// <c>~</c> marks a non-ICAO address), when it has no valid latitude and longitude, or when its position is older
    /// than <see cref="MaxPositionAge"/>.
    /// </summary>
    public static (DateTimeOffset ObservedAt, IReadOnlyList<AirTrafficAircraft> Aircraft)? Parse(JsonElement root,
        DateTimeOffset receivedAt)
    {
        if (root.ValueKind != JsonValueKind.Object) return null;
        JsonElement list;
        if (root.TryGetProperty("ac", out var ac) && ac.ValueKind == JsonValueKind.Array) list = ac;
        else if (root.TryGetProperty("aircraft", out var aircraft) && aircraft.ValueKind == JsonValueKind.Array) list = aircraft;
        else return null;

        var observedAt = Now(root) ?? receivedAt;
        var freshest = new Dictionary<string, AirTrafficAircraft>(StringComparer.Ordinal);
        foreach (var item in list.EnumerateArray())
        {
            if (item.ValueKind == JsonValueKind.Object && Aircraft(item, observedAt) is { } parsed &&
                (!freshest.TryGetValue(parsed.Hex, out var known) || parsed.PositionAt > known.PositionAt))
                freshest[parsed.Hex] = parsed;
        }
        return (observedAt, freshest.Values.OrderBy(item => item.Hex, StringComparer.Ordinal).ToArray());
    }

    private static AirTrafficAircraft? Aircraft(JsonElement item, DateTimeOffset observedAt)
    {
        if (Hex(item) is not { } hex) return null;
        if (Number(item, "lat") is not { } latitude || latitude is < -90 or > 90) return null;
        if (Number(item, "lon") is not { } longitude || longitude is < -180 or > 180) return null;
        // How long before «now» the position was last updated; without it, the last message of any kind.
        var age = Math.Max(0, Number(item, "seen_pos") ?? Number(item, "seen") ?? 0);
        if (age > MaxPositionAge.TotalSeconds) return null;
        var positionAt = observedAt -
            TimeSpan.FromTicks((long)Math.Round(age * 1000, MidpointRounding.AwayFromZero) * TimeSpan.TicksPerMillisecond);

        var onGround = item.TryGetProperty("alt_baro", out var barometric) && barometric.ValueKind == JsonValueKind.String &&
            string.Equals(barometric.GetString()?.Trim(), "ground", StringComparison.OrdinalIgnoreCase);
        var altitude = onGround ? null : Whole(Number(item, "alt_baro") ?? Number(item, "alt_geom"), MaxAltitudeFeet);
        var track = Number(item, "track") ?? (onGround ? Number(item, "true_heading") : null);
        return new AirTrafficAircraft(hex, Text(item, "flight"), Text(item, "r"), Text(item, "t"),
            Category(Text(item, "category")), latitude, longitude, altitude, onGround,
            Number(item, "gs") is { } speed && speed >= 0 ? speed : null,
            track is { } degrees ? Degrees(degrees) : null,
            Whole(Number(item, "baro_rate") ?? Number(item, "geom_rate"), MaxVerticalRateFeetPerMinute),
            Squawk(Text(item, "squawk")), positionAt);
    }

    private static DateTimeOffset? Now(JsonElement root)
    {
        if (Number(root, "now") is not { } now || now <= 0) return null;
        var milliseconds = Math.Round(now >= MillisecondsThreshold ? now : now * 1000, MidpointRounding.AwayFromZero);
        return milliseconds <= MaxUnixMilliseconds ? DateTimeOffset.FromUnixTimeMilliseconds((long)milliseconds) : null;
    }

    /// <summary>Six hexadecimal digits in lower case; a non-ICAO address (<c>~</c>) or anything else is null.</summary>
    private static string? Hex(JsonElement item) =>
        Text(item, "hex")?.ToLowerInvariant() is { Length: 6 } hex && hex.All(char.IsAsciiHexDigit) ? hex : null;

    /// <summary>The emitter category: a letter from A to D and a digit from 0 to 7.</summary>
    private static string? Category(string? value) =>
        value is [>= 'A' and <= 'D', >= '0' and <= '7'] ? value : null;

    /// <summary>The transponder code: four octal digits.</summary>
    private static string? Squawk(string? value) =>
        value is { Length: 4 } && value.All(digit => digit is >= '0' and <= '7') ? value : null;

    /// <summary>A direction from 0 up to 360 degrees (360 itself is 0).</summary>
    private static double Degrees(double value) => value is >= 0 and < 360 ? value : (value % 360 + 360) % 360;

    /// <summary>The text of a property, trimmed and in upper case; null when it is missing, not a text or blank.</summary>
    private static string? Text(JsonElement item, string property) =>
        item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.String &&
        value.GetString()?.Trim() is { Length: > 0 } text
            ? text.ToUpperInvariant()
            : null;

    /// <summary>A finite number; null when the property is missing or holds anything else.</summary>
    private static double? Number(JsonElement item, string property) =>
        item.TryGetProperty(property, out var value) && value.ValueKind == JsonValueKind.Number &&
        value.TryGetDouble(out var number) && double.IsFinite(number)
            ? number
            : null;

    /// <summary>A whole number when it is within ±<paramref name="limit"/>; null otherwise.</summary>
    private static int? Whole(double? value, int limit) =>
        value is { } number && Math.Abs(number) <= limit ? (int)Math.Round(number, MidpointRounding.AwayFromZero) : null;
}
