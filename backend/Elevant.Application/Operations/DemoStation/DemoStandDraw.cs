using System.Buffers.Binary;
using System.Security.Cryptography;

namespace Elevant.Application.Operations.DemoStation;

/// <summary>
/// The stand «Al azar» gives a demo flight (ADR-0041, owner decision 22): one of the eligible stands, drawn with the
/// command's Idempotency-Key as the seed, so a retry of the same command draws the same stand. The draw depends on
/// nothing else: not on the order the candidates come in, the process or the machine.
/// </summary>
public static class DemoStandDraw
{
    /// <summary>
    /// The candidate at this index of the candidates, each once and sorted by their text: the first eight bytes of the
    /// SHA-256 of the key (its bytes in big-endian order), read as a big-endian unsigned number, modulo how many there
    /// are. Null when there is no candidate.
    /// </summary>
    public static Guid? Pick(IReadOnlyCollection<Guid> eligible, Guid idempotencyKey)
    {
        ArgumentNullException.ThrowIfNull(eligible);
        var candidates = eligible.Distinct().OrderBy(id => id.ToString("D"), StringComparer.Ordinal).ToArray();
        if (candidates.Length == 0) return null;
        Span<byte> hash = stackalloc byte[SHA256.HashSizeInBytes];
        SHA256.HashData(idempotencyKey.ToByteArray(bigEndian: true), hash);
        return candidates[(int)(BinaryPrimitives.ReadUInt64BigEndian(hash) % (ulong)candidates.Length)];
    }
}
