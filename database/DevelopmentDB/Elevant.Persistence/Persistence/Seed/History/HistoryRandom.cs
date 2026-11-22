using System.Security.Cryptography;
using System.Text;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// SplitMix64 seeded by a stream key (<c>ops:2026-06-03</c>, <c>commercial:AA:rates</c>). Every decision of the
/// history draws from a stream named after what it decides, so adding a row elsewhere never shifts it. Never use
/// <see cref="Random"/>, <see cref="Guid.NewGuid"/> or the clock in a generator.
/// </summary>
internal sealed class HistoryRandom
{
    private ulong _state;

    private HistoryRandom(ulong seed) => _state = seed;

    /// <summary>A new stream for the key; the same key always replays the same sequence.</summary>
    public static HistoryRandom For(string stream)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(stream);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(HistoryKeys.Namespace + "random:" + stream));
        return new HistoryRandom(BitConverter.ToUInt64(hash, 0));
    }

    public ulong NextUInt64()
    {
        var z = _state += 0x9E3779B97F4A7C15UL;
        z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9UL;
        z = (z ^ (z >> 27)) * 0x94D049BB133111EBUL;
        return z ^ (z >> 31);
    }

    /// <summary>Uniform in [0, 1).</summary>
    public double NextDouble() => (NextUInt64() >> 11) * (1.0 / (1UL << 53));

    /// <summary>Uniform integer in [0, <paramref name="maxExclusive"/>).</summary>
    public int Next(int maxExclusive)
    {
        ArgumentOutOfRangeException.ThrowIfNegativeOrZero(maxExclusive);
        return (int)(NextUInt64() % (ulong)maxExclusive);
    }

    /// <summary>Uniform integer in [<paramref name="minInclusive"/>, <paramref name="maxInclusive"/>].</summary>
    public int Between(int minInclusive, int maxInclusive)
    {
        if (maxInclusive < minInclusive) throw new ArgumentOutOfRangeException(nameof(maxInclusive));
        return minInclusive + Next(maxInclusive - minInclusive + 1);
    }

    /// <summary>Uniform decimal in [<paramref name="min"/>, <paramref name="max"/>] rounded to <paramref name="decimals"/>.</summary>
    public decimal Decimal(decimal min, decimal max, int decimals = 2)
    {
        if (max < min) throw new ArgumentOutOfRangeException(nameof(max));
        return Math.Round(min + (max - min) * (decimal)NextDouble(), decimals, MidpointRounding.AwayFromZero);
    }

    /// <summary>True with probability <paramref name="probability"/> (0–1).</summary>
    public bool Chance(double probability) => NextDouble() < probability;

    public T Pick<T>(IReadOnlyList<T> items)
    {
        ArgumentNullException.ThrowIfNull(items);
        if (items.Count == 0) throw new ArgumentException("Nothing to pick from.", nameof(items));
        return items[Next(items.Count)];
    }

    /// <summary>A shuffled copy (Fisher–Yates).</summary>
    public T[] Shuffle<T>(IEnumerable<T> items)
    {
        var copy = items.ToArray();
        for (var index = copy.Length - 1; index > 0; index--)
        {
            var other = Next(index + 1);
            (copy[index], copy[other]) = (copy[other], copy[index]);
        }
        return copy;
    }

    /// <summary>An index drawn by the relative weights (each ≥ 0, at least one positive).</summary>
    public int Weighted(IReadOnlyList<double> weights)
    {
        ArgumentNullException.ThrowIfNull(weights);
        var total = weights.Sum();
        if (total <= 0) throw new ArgumentException("At least one weight must be positive.", nameof(weights));
        var draw = NextDouble() * total;
        for (var index = 0; index < weights.Count; index++)
        {
            draw -= weights[index];
            if (draw < 0) return index;
        }
        return weights.Count - 1;
    }
}
