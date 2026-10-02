using Elevant.Api.Realtime;

namespace Elevant.IntegrationTests.Api;

public sealed class AccountChangeCursorCodecTests
{
    private static readonly Guid AccountId = Guid.Parse("40000000-0000-7000-8000-000000000001");

    [Fact]
    public void CursorIsSignedAccountBoundAndRejectsTampering()
    {
        var codec = new AccountChangeCursorCodec(
            Convert.FromBase64String(ElevantApiFactory.AuthenticationSigningKeyBase64));
        var cursor = codec.Encode(AccountId, 42);

        Assert.NotEqual("42", cursor);
        Assert.DoesNotContain(AccountId.ToString("D"), cursor, StringComparison.Ordinal);
        Assert.True(codec.TryDecode(cursor, AccountId, out var sequence));
        Assert.Equal(42, sequence);
        Assert.False(codec.TryDecode(cursor, Guid.NewGuid(), out _));
        var tampered = (cursor[0] == 'A' ? "B" : "A") + cursor[1..];
        Assert.False(codec.TryDecode(tampered, AccountId, out _));
        Assert.False(codec.TryDecode("not-a-cursor", AccountId, out _));
        Assert.False(codec.TryDecode(string.Empty, AccountId, out _));
    }
}
