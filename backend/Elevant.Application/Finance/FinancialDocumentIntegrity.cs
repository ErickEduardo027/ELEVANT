using System.Security.Cryptography;

namespace Elevant.Application.Finance;

/// <summary>Rejects missing, altered or unexpectedly large private PDF objects.</summary>
public static class FinancialDocumentIntegrity
{
    public const int MaxBytes = 8 * 1024 * 1024;

    public static bool Matches(ReadOnlySpan<byte> content, long length, string sha256) =>
        content.Length >= 5 && content.Length <= MaxBytes && content.Length == length &&
        content[..5].SequenceEqual("%PDF-"u8) && sha256 is { Length: 64 } &&
        string.Equals(Convert.ToHexString(SHA256.HashData(content)).ToLowerInvariant(),
            sha256, StringComparison.Ordinal);
}
