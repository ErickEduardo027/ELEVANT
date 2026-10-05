using PdfSharp;
using PdfSharp.Fonts;

namespace Elevant.Infrastructure.Finance;

internal sealed class ElevantPdfFontResolver : IFontResolver
{
    internal const string Typeface = "Elevant Noto Sans";
    private const string FaceName = "elevant-noto-sans-regular";
    private static readonly object Gate = new();
    private static readonly Lazy<byte[]> FontBytes = new(() =>
    {
        var assembly = typeof(ElevantPdfFontResolver).Assembly;
        var resource = assembly.GetManifestResourceNames().Single(name =>
            name.EndsWith("NotoSans-Regular.ttf", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(resource)!;
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        return buffer.ToArray();
    });

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

    public FontResolverInfo? ResolveTypeface(string familyName, bool bold, bool italic) =>
        familyName == Typeface ? new FontResolverInfo(FaceName) : null;

    public byte[]? GetFont(string faceName) => faceName == FaceName ? FontBytes.Value : null;
}
