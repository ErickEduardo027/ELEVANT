using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Finance;

/// <summary>
/// The only way ELEVANT PDFs create fonts (2-D): Noto Sans with Unicode encoding (Type0 / Identity-H) and
/// the complete font file embedded. PdfSharp's subsetter drops the components of composite glyphs, so
/// «á», «í» or «ó» printed without accents; the complete faces keep Spanish text intact. Contracts and
/// operation documents already embedded the fonts this way, so their output does not change. PDFs stored
/// before (invoices, receipts) are immutable snapshots and are never regenerated.
/// </summary>
internal static class ElevantPdfFonts
{
    /// <summary>Unicode encoding with the whole font file: every glyph and its accent components travel.</summary>
    internal static readonly XPdfFontOptions Embedding = new(PdfFontEncoding.Unicode, PdfFontEmbedding.EmbedCompleteFontFile);

    /// <summary>Noto Sans Regular at <paramref name="size"/> points.</summary>
    internal static XFont Regular(double size) => Create(size, XFontStyleEx.Regular);

    /// <summary>Noto Sans Bold (the real face, not a simulated stroke) at <paramref name="size"/> points.</summary>
    internal static XFont Bold(double size) => Create(size, XFontStyleEx.Bold);

    private static XFont Create(double size, XFontStyleEx style)
    {
        ElevantPdfFontResolver.EnsureRegistered();
        return new XFont(ElevantPdfFontResolver.Typeface, size, style, Embedding);
    }
}
