using System.Globalization;
using System.Text;
using System.Text.RegularExpressions;
using PdfSharp.Pdf;
using PdfSharp.Pdf.Content;
using PdfSharp.Pdf.Content.Objects;
using PdfSharp.Pdf.IO;

namespace Elevant.UnitTests.Application;

/// <summary>
/// Reads back what an ELEVANT PDF embeds (2-D): the fonts of every page and the text its content
/// streams draw, decoded through the ToUnicode map of the font each string uses.
/// </summary>
internal static partial class PdfFontInspector
{
    /// <summary>A font resource of a page with what decides whether Spanish accents survive.</summary>
    internal sealed record EmbeddedFont(string Subtype, string? Encoding, string? BaseFont, int? FontFileLength);

    public static IReadOnlyList<EmbeddedFont> Fonts(byte[] pdf)
    {
        using var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        var fonts = new List<EmbeddedFont>();
        foreach (var page in document.Pages)
            foreach (var (_, font) in PageFonts(page))
            {
                var descendant = font.Elements.GetArray("/DescendantFonts")?.Elements.GetDictionary(0);
                var file = descendant?.Elements.GetDictionary("/FontDescriptor")?.Elements.GetDictionary("/FontFile2");
                fonts.Add(new EmbeddedFont(font.Elements.GetName("/Subtype"), NameOrNull(font, "/Encoding"),
                    NameOrNull(font, "/BaseFont"), file?.Stream?.UnfilteredValue.Length));
            }
        return fonts;
    }

    /// <summary>Every string the pages draw, decoded by the font in use, one line per text operator.</summary>
    public static string Text(byte[] pdf)
    {
        using var document = PdfReader.Open(new MemoryStream(pdf), PdfDocumentOpenMode.Import);
        var text = new StringBuilder();
        foreach (var page in document.Pages)
        {
            var maps = PageFonts(page).ToDictionary(item => item.Name, item => ToUnicode(item.Font));
            IReadOnlyDictionary<int, string>? current = null;
            foreach (var item in ContentReader.ReadContent(page))
            {
                if (item is not COperator operation) continue;
                switch (operation.OpCode.Name)
                {
                    case "Tf" when operation.Operands.Count > 0 && operation.Operands[0] is CName name:
                        current = maps.GetValueOrDefault(name.Name);
                        break;
                    case "Tj" or "'" or "\"" when operation.Operands.Count > 0 &&
                        operation.Operands[^1] is CString shown:
                        text.AppendLine(Decode(shown, current));
                        break;
                    case "TJ" when operation.Operands.Count > 0 && operation.Operands[0] is CArray array:
                        text.AppendLine(string.Concat(array.OfType<CString>().Select(part => Decode(part, current))));
                        break;
                }
            }
        }
        return text.ToString();
    }

    private static IEnumerable<(string Name, PdfDictionary Font)> PageFonts(PdfPage page)
    {
        var fonts = page.Resources.Elements.GetDictionary("/Font");
        if (fonts is null) yield break;
        foreach (var key in fonts.Elements.Keys)
            if (fonts.Elements.GetDictionary(key) is { } font) yield return (key, font);
    }

    private static string? NameOrNull(PdfDictionary dictionary, string key) =>
        dictionary.Elements.ContainsKey(key) ? dictionary.Elements.GetName(key) : null;

    /// <summary>Two-byte codes of an Identity-H string mapped back to Unicode; unknown codes print as «?».</summary>
    private static string Decode(CString value, IReadOnlyDictionary<int, string>? map)
    {
        var bytes = value.CStringType is CStringType.UnicodeString or CStringType.UnicodeHexString
            ? value.Value.SelectMany(character => new[] { (byte)(character >> 8), (byte)(character & 0xFF) }).ToArray()
            : value.Value.Select(character => (byte)character).ToArray();
        if (map is null) return Encoding.Latin1.GetString(bytes);
        var text = new StringBuilder();
        for (var index = 0; index + 1 < bytes.Length; index += 2)
            text.Append(map.TryGetValue(bytes[index] << 8 | bytes[index + 1], out var mapped) ? mapped : "?");
        return text.ToString();
    }

    private static Dictionary<int, string>? ToUnicode(PdfDictionary font)
    {
        var stream = font.Elements.GetDictionary("/ToUnicode")?.Stream;
        if (stream is null) return null;
        var cmap = Encoding.ASCII.GetString(stream.UnfilteredValue);
        var map = new Dictionary<int, string>();
        foreach (Match section in BfChar().Matches(cmap))
            foreach (Match pair in Pair().Matches(section.Groups[1].Value))
                map[Hex(pair.Groups[1].Value)] = Utf16(pair.Groups[2].Value);
        foreach (Match section in BfRange().Matches(cmap))
            foreach (Match range in Range().Matches(section.Groups[1].Value))
            {
                var (low, high, start) = (Hex(range.Groups[1].Value), Hex(range.Groups[2].Value), Hex(range.Groups[3].Value));
                for (var code = low; code <= high; code++) map[code] = char.ConvertFromUtf32(start + code - low);
            }
        return map;
    }

    private static int Hex(string value) => int.Parse(value, NumberStyles.HexNumber, CultureInfo.InvariantCulture);

    private static string Utf16(string hex) => Encoding.BigEndianUnicode.GetString(Convert.FromHexString(hex));

    [GeneratedRegex(@"beginbfchar(.*?)endbfchar", RegexOptions.Singleline)]
    private static partial Regex BfChar();

    [GeneratedRegex(@"beginbfrange(.*?)endbfrange", RegexOptions.Singleline)]
    private static partial Regex BfRange();

    [GeneratedRegex(@"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>")]
    private static partial Regex Pair();

    [GeneratedRegex(@"<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>")]
    private static partial Regex Range();
}
