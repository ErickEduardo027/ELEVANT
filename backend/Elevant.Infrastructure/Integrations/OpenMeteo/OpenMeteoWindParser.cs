using System.Globalization;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Operations;
using Elevant.Infrastructure.Integrations.AviationWeather;

namespace Elevant.Infrastructure.Integrations.OpenMeteo;

/// <summary>
/// The wind grid of a region from the forecast API of Open-Meteo (plan M6): the points of the grid and the query that asks
/// for all of them at once, and the reading of its answer. Pure: it never calls anything.
/// </summary>
public static class OpenMeteoWindParser
{
    /// <summary>The strongest wind read, in knots; a faster one is left out.</summary>
    public const double MaxSpeedKnots = 300;

    /// <summary>
    /// The points of a grid of <paramref name="columns"/> by <paramref name="rows"/> over <paramref name="area"/>, evenly
    /// spread with the edges included, south to north and west to east within each row; rounded to thousandths of a
    /// degree.
    /// </summary>
    public static IReadOnlyList<RegionPoint> Points(RegionWeatherArea area, int columns, int rows)
    {
        ArgumentNullException.ThrowIfNull(area);
        ArgumentOutOfRangeException.ThrowIfLessThan(columns, 2);
        ArgumentOutOfRangeException.ThrowIfLessThan(rows, 2);
        var points = new List<RegionPoint>(columns * rows);
        for (var row = 0; row < rows; row++)
        {
            var latitude = Math.Round(area.LatitudeMin + row * (area.LatitudeMax - area.LatitudeMin) / (rows - 1), 3);
            for (var column = 0; column < columns; column++)
                points.Add(new RegionPoint(
                    Math.Round(area.LongitudeMin + column * (area.LongitudeMax - area.LongitudeMin) / (columns - 1), 3),
                    latitude));
        }
        return points;
    }

    /// <summary>
    /// The query of the current wind at <paramref name="points"/>, in one request:
    /// <c>{baseUrl}forecast?latitude=…&amp;longitude=…&amp;current=wind_speed_10m,wind_direction_10m&amp;wind_speed_unit=kn&amp;timeformat=unixtime</c>,
    /// the coordinates in the order of the points, joined by commas.
    /// </summary>
    public static Uri Query(Uri baseUrl, IReadOnlyList<RegionPoint> points)
    {
        ArgumentNullException.ThrowIfNull(baseUrl);
        ArgumentNullException.ThrowIfNull(points);
        var query = new StringBuilder("forecast?latitude=");
        query.AppendJoin(',', points.Select(point => point.Latitude.ToString("0.###", CultureInfo.InvariantCulture)));
        query.Append("&longitude=");
        query.AppendJoin(',', points.Select(point => point.Longitude.ToString("0.###", CultureInfo.InvariantCulture)));
        query.Append("&current=wind_speed_10m,wind_direction_10m&wind_speed_unit=kn&timeformat=unixtime");
        return new Uri(baseUrl, query.ToString());
    }

    /// <summary>
    /// The grid in one answer: a list with one location per point, in their order (one location alone may come as the
    /// object itself), each with <c>current.time</c> (Unix seconds), <c>current.wind_speed_10m</c> (knots) and
    /// <c>current.wind_direction_10m</c> (degrees). A point whose wind is missing or out of its range is left out, and the
    /// points keep the coordinates asked for (the service answers its own cell's). Another number of locations, or none
    /// with a wind, cannot be read. The grid is valid at the latest time of its points.
    /// </summary>
    public static (AviationWeatherReadKind Kind, RegionWindGrid? Grid) Parse(JsonElement root, RegionWeatherArea area,
        int columns, int rows)
    {
        var points = Points(area, columns, rows);
        JsonElement[] locations = root.ValueKind switch
        {
            JsonValueKind.Array => [.. root.EnumerateArray()],
            JsonValueKind.Object => [root],
            _ => [],
        };
        if (locations.Length != points.Count) return (AviationWeatherReadKind.Unreadable, null);

        var winds = new List<RegionWindPoint>(points.Count);
        DateTimeOffset? validAt = null;
        for (var index = 0; index < points.Count; index++)
        {
            if (locations[index].ValueKind != JsonValueKind.Object ||
                !locations[index].TryGetProperty("current", out var current) || current.ValueKind != JsonValueKind.Object ||
                AviationWeatherParser.Instant(current, "time") is not { } time ||
                AviationWeatherParser.Number(current, "wind_speed_10m") is not { } speed || speed is < 0 or > MaxSpeedKnots ||
                AviationWeatherParser.Whole(AviationWeatherParser.Number(current, "wind_direction_10m"), 0, 360) is not
                    { } direction)
                continue;
            winds.Add(new RegionWindPoint(points[index].Latitude, points[index].Longitude, Math.Round(speed, 1), direction));
            if (validAt is null || time > validAt) validAt = time;
        }
        return validAt is { } at
            ? (AviationWeatherReadKind.Report, new RegionWindGrid(at, area, columns, rows, [.. winds]))
            : (AviationWeatherReadKind.Unreadable, null);
    }
}
