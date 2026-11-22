using System.Security.Cryptography;
using System.Text;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Deterministic public identifiers of the history: SHA-256 of <c>elevant-development-history-v1:{suffix}</c> shaped
/// as a version-7 GUID, the algorithm of <see cref="DevelopmentScenarioSeeder"/>. A suffix names what the row is
/// (<c>contract:AA</c>, <c>operation:2026-06-03:07</c>); the same suffix always yields the same id, so a rerun finds
/// what an earlier run inserted and two clean databases get the same ids.
/// </summary>
internal static class HistoryKeys
{
    public const string Namespace = "elevant-development-history-v1:";

    public static Guid Key(string suffix)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(suffix);
        var hash = SHA256.HashData(Encoding.UTF8.GetBytes(Namespace + suffix));
        Span<byte> bytes = stackalloc byte[16];
        hash.AsSpan(0, 16).CopyTo(bytes);
        bytes[6] = (byte)((bytes[6] & 0x0f) | 0x70);
        bytes[8] = (byte)((bytes[8] & 0x3f) | 0x80);
        return new Guid(bytes);
    }

    /// <summary>Lowercase SHA-256 hex of a text (64 characters), for stamps and payload hashes.</summary>
    public static string Sha256(string value) =>
        Convert.ToHexStringLower(SHA256.HashData(Encoding.UTF8.GetBytes(value)));
}
