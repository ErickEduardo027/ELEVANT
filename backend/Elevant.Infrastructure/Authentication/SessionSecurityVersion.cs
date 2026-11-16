using System.Security.Cryptography;
using System.Text;
using Microsoft.IdentityModel.Tokens;

namespace Elevant.Infrastructure.Authentication;

/// <summary>Opaque fingerprint of the server-side security stamp, never the stamp itself.</summary>
public static class SessionSecurityVersion
{
    public const string ClaimType = "elevant:credential-version";

    public static string Fingerprint(string securityStamp) =>
        Base64UrlEncoder.Encode(SHA256.HashData(Encoding.UTF8.GetBytes(securityStamp)));

    public static bool Matches(string claim, string currentSecurityStamp)
    {
        var expected = Encoding.UTF8.GetBytes(Fingerprint(currentSecurityStamp));
        var actual = Encoding.UTF8.GetBytes(claim);
        return expected.Length == actual.Length &&
            CryptographicOperations.FixedTimeEquals(expected, actual);
    }
}
