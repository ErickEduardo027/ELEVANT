using System.Buffers.Binary;
using System.Security.Cryptography;
using System.Text;
using Microsoft.AspNetCore.WebUtilities;

namespace Elevant.Api.Realtime;

/// <summary>Signs a versioned, account-bound feed position; it is never a resource authority.</summary>
public sealed class AccountChangeCursorCodec
{
    private const byte Version = 1;
    private const int PayloadLength = 25;
    private const int MacLength = 32;
    private readonly byte[] _cursorKey;

    public AccountChangeCursorCodec(byte[] jwtSigningKey)
    {
        ArgumentNullException.ThrowIfNull(jwtSigningKey);
        if (jwtSigningKey.Length < 32)
            throw new ArgumentException("The signing key is too short.", nameof(jwtSigningKey));
        _cursorKey = HMACSHA256.HashData(jwtSigningKey,
            Encoding.UTF8.GetBytes("Elevant/account-change-cursor/v1"));
    }

    public string Encode(Guid accountId, long sequence)
    {
        if (accountId == Guid.Empty || sequence <= 0)
            throw new ArgumentOutOfRangeException(nameof(sequence));

        var bytes = new byte[PayloadLength + MacLength];
        bytes[0] = Version;
        accountId.TryWriteBytes(bytes.AsSpan(1, 16));
        BinaryPrimitives.WriteInt64BigEndian(bytes.AsSpan(17, 8), sequence);
        HMACSHA256.HashData(_cursorKey, bytes.AsSpan(0, PayloadLength))
            .CopyTo(bytes.AsSpan(PayloadLength));
        return WebEncoders.Base64UrlEncode(bytes);
    }

    public bool TryDecode(string cursor, Guid accountId, out long sequence)
    {
        sequence = 0;
        if (string.IsNullOrWhiteSpace(cursor) || accountId == Guid.Empty || cursor.Length > 128)
            return false;

        byte[] bytes;
        try
        {
            bytes = WebEncoders.Base64UrlDecode(cursor);
        }
        catch (FormatException)
        {
            return false;
        }

        if (bytes.Length != PayloadLength + MacLength || bytes[0] != Version ||
            new Guid(bytes.AsSpan(1, 16)) != accountId)
            return false;
        var expected = HMACSHA256.HashData(_cursorKey, bytes.AsSpan(0, PayloadLength));
        if (!CryptographicOperations.FixedTimeEquals(
                expected, bytes.AsSpan(PayloadLength, MacLength)))
            return false;
        sequence = BinaryPrimitives.ReadInt64BigEndian(bytes.AsSpan(17, 8));
        return sequence > 0;
    }
}
