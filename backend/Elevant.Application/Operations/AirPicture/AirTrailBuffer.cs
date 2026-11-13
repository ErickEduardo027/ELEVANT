using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Operations.AirPicture;

/// <summary>
/// The trails of the aircraft the reads saw, kept in memory only (ADR-0042, contracts 1.3). Per aircraft it keeps one
/// segment: a point is added when a read places the aircraft later than the last point and it moved at least 50 metres or
/// ten seconds passed; a gap of more than five minutes between two positions starts a new segment and drops the old one,
/// so a trail is never drawn across a gap. Points older than the retention are cut and an aircraft not seen for fifteen
/// minutes is forgotten. Not thread-safe: <see cref="AirPictureService"/> guards it.
/// </summary>
internal sealed class AirTrailBuffer(TimeSpan retention)
{
    /// <summary>The points of a short trail.</summary>
    public const int ShortTrailPoints = 8;

    /// <summary>The points of a track at most.</summary>
    public const int MaxTrackPoints = 600;

    /// <summary>A position this far from the last point is a new point, however soon it came.</summary>
    public const double MinimumStepMetres = 50;

    /// <summary>A position this much later than the last point is a new point, however little it moved.</summary>
    public static TimeSpan MinimumStep { get; } = TimeSpan.FromSeconds(10);

    /// <summary>More than this between two positions starts a new segment.</summary>
    public static TimeSpan SegmentGap { get; } = TimeSpan.FromSeconds(300);

    /// <summary>An aircraft no read saw for this long is forgotten with its trail.</summary>
    public static TimeSpan ForgetAfter { get; } = TimeSpan.FromMinutes(15);

    private const double EarthRadiusMetres = 6_371_008.8;
    private readonly Dictionary<string, Trail> _trails = new(StringComparer.Ordinal);

    /// <summary>Adds what one successful read saw at <paramref name="seenAt"/> (the server's clock).</summary>
    public void Record(IEnumerable<AirTrafficAircraft> aircraft, DateTimeOffset seenAt)
    {
        foreach (var item in aircraft)
        {
            if (!_trails.TryGetValue(item.Hex, out var trail))
            {
                trail = new Trail();
                _trails[item.Hex] = trail;
            }
            trail.LastSeenAt = seenAt;
            var point = new AirTrailPoint(item.PositionAt, item.Latitude, item.Longitude, item.AltitudeFeet, item.OnGround);
            var points = trail.Points;
            if (points.Count == 0)
            {
                points.Add(point);
                continue;
            }
            var last = points[^1];
            // The same position again, or an older one: nothing new.
            if (point.At <= last.At) continue;
            if (point.At - last.At > SegmentGap)
            {
                points.Clear();
                points.Add(point);
            }
            else if (point.At - last.At >= MinimumStep || DistanceMetres(last, point) >= MinimumStepMetres)
            {
                points.Add(point);
            }
        }
    }

    /// <summary>Forgets the aircraft not seen for fifteen minutes and cuts the points older than the retention.</summary>
    public void Prune(DateTimeOffset now)
    {
        var cutoff = now - retention;
        foreach (var hex in _trails.Keys.ToArray())
        {
            var trail = _trails[hex];
            if (now - trail.LastSeenAt >= ForgetAfter)
            {
                _trails.Remove(hex);
                continue;
            }
            var old = 0;
            while (old < trail.Points.Count && trail.Points[old].At < cutoff) old++;
            if (old > 0) trail.Points.RemoveRange(0, old);
        }
    }

    /// <summary>The last points of the aircraft's segment, oldest first, at most <see cref="ShortTrailPoints"/>.</summary>
    public IReadOnlyList<AirTrailPoint> Short(string hex)
    {
        if (!_trails.TryGetValue(hex, out var trail)) return [];
        var count = Math.Min(ShortTrailPoints, trail.Points.Count);
        var last = new AirTrailPoint[count];
        trail.Points.CopyTo(trail.Points.Count - count, last, 0, count);
        return last;
    }

    /// <summary>
    /// The aircraft's segment at <paramref name="now"/>, oldest first, thinned evenly to at most
    /// <see cref="MaxTrackPoints"/> points (the first and the last always stay); null when the aircraft is not known or was
    /// not seen for fifteen minutes.
    /// </summary>
    public IReadOnlyList<AirTrailPoint>? Track(string hex, DateTimeOffset now)
    {
        if (!_trails.TryGetValue(hex, out var trail) || now - trail.LastSeenAt >= ForgetAfter) return null;
        var cutoff = now - retention;
        var segment = trail.Points.Where(point => point.At >= cutoff).ToArray();
        if (segment.Length <= MaxTrackPoints) return segment;
        var thinned = new AirTrailPoint[MaxTrackPoints];
        for (var index = 0; index < MaxTrackPoints; index++)
            thinned[index] = segment[(int)((long)index * (segment.Length - 1) / (MaxTrackPoints - 1))];
        return thinned;
    }

    /// <summary>The great-circle distance between two points, in metres.</summary>
    internal static double DistanceMetres(AirTrailPoint from, AirTrailPoint to)
    {
        static double Radians(double degrees) => degrees * Math.PI / 180;
        var latitudeFrom = Radians(from.Latitude);
        var latitudeTo = Radians(to.Latitude);
        var halfLatitude = Math.Sin((latitudeTo - latitudeFrom) / 2);
        var halfLongitude = Math.Sin(Radians(to.Longitude - from.Longitude) / 2);
        var chord = halfLatitude * halfLatitude + Math.Cos(latitudeFrom) * Math.Cos(latitudeTo) * halfLongitude * halfLongitude;
        return 2 * EarthRadiusMetres * Math.Asin(Math.Min(1, Math.Sqrt(chord)));
    }

    private sealed class Trail
    {
        public List<AirTrailPoint> Points { get; } = [];

        public DateTimeOffset LastSeenAt { get; set; }
    }
}
