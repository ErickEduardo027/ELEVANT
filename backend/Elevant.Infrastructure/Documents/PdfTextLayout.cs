using PdfSharp.Drawing;

namespace Elevant.Infrastructure.Documents;

/// <summary>
/// Line breaking for ELEVANT PDFs (ADR-0048): text wraps by word and only a word wider than its column (a hash, a long
/// code) breaks by characters. Nothing is ever cut with «...»: what does not fit takes another line.
/// </summary>
internal static class PdfTextLayout
{
    /// <summary>The lines of <paramref name="value"/> within <paramref name="width"/> points, by word.</summary>
    public static IReadOnlyList<string> Wrap(XGraphics graphics, string? value, XFont font, double width)
    {
        var text = Clean(value);
        if (text.Length == 0) return [string.Empty];
        var lines = new List<string>();
        foreach (var paragraph in text.Split('\n'))
        {
            var current = string.Empty;
            foreach (var word in paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var candidate = current.Length == 0 ? word : current + " " + word;
                if (graphics.MeasureString(candidate, font).Width <= width)
                {
                    current = candidate;
                    continue;
                }
                if (current.Length > 0) lines.Add(current);
                if (graphics.MeasureString(word, font).Width <= width)
                {
                    current = word;
                    continue;
                }
                var pieces = BreakCharacters(graphics, word, font, width);
                lines.AddRange(pieces.Take(pieces.Count - 1));
                current = pieces[^1];
            }
            lines.Add(current);
        }
        return lines;
    }

    /// <summary>
    /// A text broken by characters so each piece measures at most <paramref name="width"/> − 7 points (the legacy
    /// column padding); every piece has at least one character.
    /// </summary>
    public static IReadOnlyList<string> WrapCharacters(XGraphics graphics, string? value, XFont font, double width) =>
        BreakCharacters(graphics, Clean(value).Replace('\n', ' '), font, width - 7);

    /// <summary>The width of the widest word, the narrowest a column can be without breaking words.</summary>
    public static double LongestWord(XGraphics graphics, string? value, XFont font) =>
        Clean(value).Split([' ', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .Select(word => graphics.MeasureString(word, font).Width).DefaultIfEmpty(0).Max();

    public static double Width(XGraphics graphics, string? value, XFont font) =>
        Clean(value).Split('\n').Select(line => graphics.MeasureString(line, font).Width).DefaultIfEmpty(0).Max();

    private static List<string> BreakCharacters(XGraphics graphics, string text, XFont font, double width)
    {
        if (text.Length == 0) return [string.Empty];
        var lines = new List<string>();
        for (var offset = 0; offset < text.Length;)
        {
            var length = 1;
            while (offset + length < text.Length &&
                graphics.MeasureString(text.Substring(offset, length + 1), font).Width <= width)
                length++;
            lines.Add(text.Substring(offset, length));
            offset += length;
        }
        return lines;
    }

    private static string Clean(string? value) =>
        new((value ?? string.Empty).Replace("\r\n", "\n", StringComparison.Ordinal)
            .Select(character => character == '\n' ? '\n' : char.IsControl(character) ? ' ' : character).ToArray());
}
