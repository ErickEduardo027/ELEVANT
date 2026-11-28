using System.Globalization;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Infrastructure.Integrations.AviationWeather;

/// <summary>
/// Reads the international SIGMETs the Data API of aviationweather.gov answers to <c>isigmet?format=json</c> (plan M6):
/// a list of every SIGMET in force worldwide, each with its FIR (<c>firId</c>, <c>icaoId</c>), series (<c>seriesId</c>),
/// <c>hazard</c>, <c>qualifier</c>, validity in Unix seconds (<c>validTimeFrom</c>, <c>validTimeTo</c>), levels in feet
/// (<c>base</c>, <c>top</c>), raw text (<c>rawSigmet</c>) and area (<c>coords</c>: one ring of <c>{lon, lat}</c> for
/// <c>geom</c> <c>AREA</c>, a list of rings for <c>AREAS</c>). Pure: it never calls anything. Only the SIGMETs whose area
/// touches the region's box are kept, one per ring. A SIGMET without its hazard, its validity, its raw text or a ring of
/// at least three points cannot be read and is left out; a value out of its range is null.
/// </summary>
public static class AviationWeatherSigmetParser
{
    /// <summary>The most SIGMETs kept of one answer: far more than a region ever has in force.</summary>
    public const int MaxSigmets = 200;

    /// <summary>The most points a ring may have; a longer one cannot be read.</summary>
    public const int MaxPolygonPoints = 1000;

    /// <summary>The longest raw SIGMET read; a longer one cannot be read.</summary>
    public const int MaxRawLength = 8000;

    /// <summary>The highest level read, in feet; above it a level is null.</summary>
    public const int MaxLevelFeet = 100_000;

    /// <summary>
    /// The SIGMETs of one answer that touch <paramref name="area"/>. Not a list: unreadable. A list whose SIGMETs none can
    /// be read: unreadable. Otherwise a report, empty when none touches the box (an empty list is a list without SIGMETs).
    /// </summary>
    public static (AviationWeatherReadKind Kind, IReadOnlyList<RegionSigmet>? Sigmets) Parse(JsonElement root,
        RegionWeatherArea area)
    {
        ArgumentNullException.ThrowIfNull(area);
        if (root.ValueKind != JsonValueKind.Array) return (AviationWeatherReadKind.Unreadable, null);
        var any = false;
        var readable = false;
        var kept = new List<RegionSigmet>();
        var ids = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in root.EnumerateArray())
        {
            if (item.ValueKind != JsonValueKind.Object) continue;
            any = true;
            if (Read(item) is not { } sigmet) continue;
            readable = true;
            for (var index = 0; index < sigmet.Rings.Count; index++)
            {
                var ring = sigmet.Rings[index];
                if (kept.Count == MaxSigmets) break;
                if (!area.Overlaps(ring.Min(point => point.Longitude), ring.Max(point => point.Longitude),
                        ring.Min(point => point.Latitude), ring.Max(point => point.Latitude)))
                    continue;
                var id = sigmet.Rings.Count > 1 ? $"{sigmet.Id}-{index + 1}" : sigmet.Id;
                // The service may publish the same SIGMET twice: each keeps an id of its own.
                for (var copy = 2; !ids.Add(id); copy++) id = $"{sigmet.Id}-{index + 1}.{copy}";
                kept.Add(new RegionSigmet(id, sigmet.FirId, sigmet.Hazard, sigmet.Qualifier, sigmet.ValidFrom, sigmet.ValidTo,
                    sigmet.BaseFeet, sigmet.TopFeet, sigmet.Raw, ring));
            }
        }
        return any && !readable ? (AviationWeatherReadKind.Unreadable, null) : (AviationWeatherReadKind.Report, [.. kept]);
    }

    private static Sigmet? Read(JsonElement item)
    {
        if (Code(AviationWeatherParser.Text(item, "hazard"), 2, 8, letters: true) is not { } hazard ||
            AviationWeatherParser.Instant(item, "validTimeFrom") is not { } from ||
            AviationWeatherParser.Instant(item, "validTimeTo") is not { } to || to <= from ||
            AviationWeatherParser.Text(item, "rawSigmet") is not { Length: <= MaxRawLength } raw ||
            Rings(item) is not { Count: > 0 } rings)
            return null;
        var firId = Code(AviationWeatherParser.Text(item, "firId"), 4, 8, letters: false);
        var issuer = firId ?? Code(AviationWeatherParser.Text(item, "icaoId"), 4, 8, letters: false) ?? "SIGMET";
        var series = Code(AviationWeatherParser.Text(item, "seriesId"), 1, 8, letters: false) ?? "0";
        var qualifier = AviationWeatherParser.Text(item, "qualifier") is { Length: <= 64 } text ? text.ToUpperInvariant() : null;
        var id = string.Create(CultureInfo.InvariantCulture, $"{issuer}-{series}-{from.UtcDateTime:yyyyMMddHHmm}");
        return new Sigmet(id, firId, hazard, qualifier, from, to,
            AviationWeatherParser.Whole(AviationWeatherParser.Number(item, "base"), 0, MaxLevelFeet),
            AviationWeatherParser.Whole(AviationWeatherParser.Number(item, "top"), 0, MaxLevelFeet), raw, rings);
    }

    /// <summary>
    /// The rings of <c>coords</c>: one when it is a list of points, several when it is a list of lists. A ring that cannot
    /// be read is left out; each is closed (its last point is its first).
    /// </summary>
    private static List<IReadOnlyList<RegionPoint>> Rings(JsonElement item)
    {
        var rings = new List<IReadOnlyList<RegionPoint>>();
        if (!item.TryGetProperty("coords", out var coords) || coords.ValueKind != JsonValueKind.Array) return rings;
        var first = coords.EnumerateArray().FirstOrDefault();
        if (first.ValueKind == JsonValueKind.Array)
        {
            foreach (var part in coords.EnumerateArray())
                if (Ring(part) is { } ring) rings.Add(ring);
        }
        else if (Ring(coords) is { } ring)
        {
            rings.Add(ring);
        }
        return rings;
    }

    private static IReadOnlyList<RegionPoint>? Ring(JsonElement points)
    {
        if (points.ValueKind != JsonValueKind.Array || points.GetArrayLength() > MaxPolygonPoints) return null;
        var ring = new List<RegionPoint>();
        foreach (var point in points.EnumerateArray())
        {
            if (point.ValueKind != JsonValueKind.Object ||
                AviationWeatherParser.Number(point, "lon") is not { } longitude || longitude is < -180 or > 180 ||
                AviationWeatherParser.Number(point, "lat") is not { } latitude || latitude is < -90 or > 90)
                return null;
            ring.Add(new RegionPoint(longitude, latitude));
        }
        if (ring.Distinct().Count() < 3) return null;
        if (ring[0] != ring[^1]) ring.Add(ring[0]);
        return [.. ring];
    }

    /// <summary>A code in upper case of <paramref name="minimum"/> to <paramref name="maximum"/> letters (or, unless <paramref name="letters"/>, digits and «/»).</summary>
    private static string? Code(string? text, int minimum, int maximum, bool letters)
    {
        if (text?.ToUpperInvariant() is not { } code || code.Length < minimum || code.Length > maximum) return null;
        return code.All(character => char.IsAsciiLetterUpper(character) ||
            (!letters && (char.IsAsciiDigit(character) || character == '/')))
            ? code
            : null;
    }

    private sealed record Sigmet(string Id, string? FirId, string Hazard, string? Qualifier, DateTimeOffset ValidFrom,
        DateTimeOffset ValidTo, int? BaseFeet, int? TopFeet, string Raw, List<IReadOnlyList<RegionPoint>> Rings);
}
