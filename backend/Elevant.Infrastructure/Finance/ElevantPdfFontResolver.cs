using PdfSharp;
using PdfSharp.Fonts;

namespace Elevant.Infrastructure.Finance;

internal sealed class ElevantPdfFontResolver : IFontResolver
{
    internal const string Typeface = "Elevant Noto Sans";
    private const string RegularFace = "elevant-noto-sans-regular";
    private const string BoldFace = "elevant-noto-sans-bold";
    private static readonly object Gate = new();
    private static readonly Lazy<byte[]> RegularBytes = new(() => EmbeddedResources.Read("NotoSans-Regular.ttf"));
    private static readonly Lazy<byte[]> BoldBytes = new(() => EmbeddedResources.Read("NotoSans-Bold.ttf"));

    internal static void EnsureRegistered()
    {
        lock (Gate)
        {
            if (GlobalFontSettings.FontResolver is null)
                GlobalFontSettings.FontResolver = new ElevantPdfFontResolver();
            else if (GlobalFontSettings.FontResolver is not ElevantPdfFontResolver)
                throw new InvalidOperationException("An incompatible PDF font resolver is configured.");
        }
    }

    // Bold uses the real Noto Sans Bold face instead of a simulated stroke; italics are not used.
    public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic) =>
        familyName == Typeface ? new FontResolverInfo(bold ? BoldFace : RegularFace) : null;

    public byte[]? GetFont(string faceName) => faceName switch
    {
        RegularFace => RegularBytes.Value,
        BoldFace => BoldBytes.Value,
        _ => null,
    };
}
