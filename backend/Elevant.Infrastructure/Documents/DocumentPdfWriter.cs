using Elevant.Infrastructure.Finance;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Documents;

/// <summary>The palette and the logo every ELEVANT document and report shares (ADR-0048).</summary>
internal static class DocumentPalette
{
    public static readonly XColor Navy = XColor.FromArgb(8, 27, 58);
    public static readonly XColor Orange = XColor.FromArgb(255, 92, 0);
    public static readonly XColor Ink = XColor.FromArgb(30, 41, 59);
    public static readonly XColor Muted = XColor.FromArgb(77, 93, 118);
    public static readonly XColor Rule = XColor.FromArgb(214, 221, 231);
    public static readonly XColor Tint = XColor.FromArgb(244, 247, 251);
    public static readonly XColor Stripe = XColor.FromArgb(248, 250, 252);
    public static readonly XColor TotalFill = XColor.FromArgb(226, 234, 245);
    public static readonly XColor NoticeFill = XColor.FromArgb(255, 241, 230);
    public static readonly XColor Success = XColor.FromArgb(21, 128, 61);

    private static readonly Lazy<byte[]> LogoBytes = new(() => EmbeddedResources.Read("elevant-logo.jpg"));

    /// <summary>Draws the ELEVANT logo <paramref name="width"/> points wide and returns its height.</summary>
    public static double DrawLogo(XGraphics graphics, double x, double y, double width)
    {
        using var logo = XImage.FromStream(new MemoryStream(LogoBytes.Value));
        var height = width * logo.PixelHeight / (double)logo.PixelWidth;
        graphics.DrawImage(logo, x, y, width, height);
        return height;
    }
}

/// <summary>
/// The letterhead of a document: the title and its reference on the right of the logo (both in the same, largest size),
/// the detail lines under them, and the running title the following pages repeat.
/// </summary>
internal sealed record DocumentLetterhead(string Title, string? Reference, IReadOnlyList<string> Details, string Running)
{
    /// <summary>The size of the title and of the reference: the title is never smaller than the number (G2).</summary>
    public double TitleSize { get; init; } = 14;
}

/// <summary>
/// The footer of every page: a legend on the left (it wraps, nothing is cut), «Página X de Y» on the right and, under
/// them, an optional reference line (a form code, a SHA-256).
/// </summary>
internal sealed record DocumentFooter(string Legend, string? Reference = null)
{
    public XColor LegendColor { get; init; } = DocumentPalette.Muted;
}

/// <summary>A table column: its heading, whether it holds figures (right-aligned, never wrapped) and its share of the room.</summary>
internal sealed record DocumentColumn(string Heading, bool Numeric = false, double Weight = 1);

/// <summary>A box of a row of boxes: a caption over lines, the first one in bold.</summary>
internal sealed record DocumentBox(string Caption, IReadOnlyList<string> Lines, bool Accent = false);

/// <summary>A line of a totals block; <paramref name="Strong"/> is the grand total.</summary>
internal sealed record DocumentTotal(string Label, string Value, bool Strong = false);

/// <summary>
/// The common writer of ELEVANT's printable documents (invoices, notes, receipts, statements): A4 portrait, the
/// letterhead with the logo on the first page and a compact one on the next pages, text that wraps by word
/// (<see cref="PdfTextLayout"/>), boxes, label/value grids, tables whose heading repeats on every page with the figures
/// right-aligned, a totals block whose decimals stand in one column, and the footer with «Página X de Y». No text is
/// ever cut with «...». The smallest size is <see cref="BaseSize"/> (9 pt by default, legible once printed).
/// </summary>
internal sealed class DocumentPdfWriter
{
    public const double Margin = 40;
    private const double FooterHeight = 40;
    private const double CellPadding = 4;

    private readonly PdfDocument pdf;
    private readonly DocumentLetterhead letterhead;
    private readonly DocumentFooter footer;
    private PdfPage page = null!;
    private XGraphics graphics = null!;

    public DocumentPdfWriter(PdfDocument pdf, DocumentLetterhead letterhead, DocumentFooter footer, double baseSize = 9)
    {
        ElevantPdfFontResolver.EnsureRegistered();
        this.pdf = pdf;
        this.letterhead = letterhead;
        this.footer = footer;
        BaseSize = baseSize;
        Body = ElevantPdfFonts.Regular(baseSize);
        Bold = ElevantPdfFonts.Bold(baseSize);
        NewPage(first: true);
    }

    public double BaseSize { get; }

    public XFont Body { get; }

    public XFont Bold { get; }

    public double LineHeight => Math.Round(BaseSize * 1.35, 2);

    public XGraphics Graphics => graphics;

    public double Y { get; set; }

    public double Left => Margin;

    public double Width => page.Width.Point - 2 * Margin;

    public double Bottom => page.Height.Point - FooterHeight - 8;

    public int PageNumber => pdf.PageCount;

    /// <summary>Starts a new page when <paramref name="height"/> does not fit; returns whether it did.</summary>
    public bool Ensure(double height)
    {
        if (Y + height <= Bottom) return false;
        NewPage(first: false);
        return true;
    }

    public void Space(double points) => Y += points;

    public IReadOnlyList<string> Wrap(string? text, XFont font, double width) => PdfTextLayout.Wrap(graphics, text, font, width);

    /// <summary>A paragraph that wraps by word and continues on the next page when it must.</summary>
    public void Paragraph(string text, XFont? font = null, XColor? color = null, double indent = 0, double? lineHeight = null)
    {
        font ??= Body;
        var height = lineHeight ?? Math.Round(font.Size * 1.35, 2);
        foreach (var line in Wrap(text, font, Width - indent))
        {
            Ensure(height);
            graphics.DrawString(line, font, new XSolidBrush(color ?? DocumentPalette.Ink),
                new XRect(Left + indent, Y, Width - indent, height), XStringFormats.TopLeft);
            Y += height;
        }
    }

    /// <summary>A section heading with the orange mark; it never stays alone at the foot of a page.</summary>
    public void Section(string text)
    {
        var font = ElevantPdfFonts.Bold(BaseSize + 2);
        Ensure(font.Size * 1.4 + LineHeight * 3);
        Y += 4;
        graphics.DrawRectangle(new XSolidBrush(DocumentPalette.Orange), Left, Y + 1, 3, font.Size + 1);
        foreach (var line in Wrap(text, font, Width - 10))
        {
            graphics.DrawString(line, font, new XSolidBrush(DocumentPalette.Navy), new XRect(Left + 10, Y, Width - 10, font.Size * 1.4),
                XStringFormats.TopLeft);
            Y += font.Size * 1.4;
        }
        Y += 4;
    }

    /// <summary>A tinted band with a notice (the simulation legend); it wraps.</summary>
    public void Notice(string text, XColor? color = null)
    {
        var lines = Wrap(text, Bold, Width - 16);
        var height = lines.Count * LineHeight + 8;
        Ensure(height);
        graphics.DrawRectangle(new XSolidBrush(DocumentPalette.NoticeFill), Left, Y, Width, height);
        graphics.DrawRectangle(new XSolidBrush(color ?? DocumentPalette.Orange), Left, Y, 3, height);
        for (var line = 0; line < lines.Count; line++)
            graphics.DrawString(lines[line], Bold, new XSolidBrush(color ?? DocumentPalette.Orange),
                new XRect(Left + 10, Y + 4 + line * LineHeight, Width - 16, LineHeight), XStringFormats.TopLeft);
        Y += height + 8;
    }

    /// <summary>Boxes side by side (the parties): a caption over their lines, the first line in bold; the tallest sets the row.</summary>
    public void Boxes(IReadOnlyList<DocumentBox> boxes, double gap = 12)
    {
        var width = (Width - gap * (boxes.Count - 1)) / boxes.Count;
        var blocks = boxes.Select(box => box.Lines.Select((line, index) =>
            Wrap(line, index == 0 ? Bold : Body, width - 22)).ToArray()).ToArray();
        var height = blocks.Max(block => block.Sum(lines => lines.Count)) * LineHeight + LineHeight + 16;
        Ensure(height);
        for (var index = 0; index < boxes.Count; index++)
        {
            var x = Left + index * (width + gap);
            graphics.DrawRectangle(new XSolidBrush(DocumentPalette.Tint), x, Y, width, height);
            graphics.DrawRectangle(new XSolidBrush(boxes[index].Accent ? DocumentPalette.Orange : DocumentPalette.Navy), x, Y, 3, height);
            graphics.DrawString(boxes[index].Caption.ToUpperInvariant(), Bold, new XSolidBrush(DocumentPalette.Muted),
                new XRect(x + 12, Y + 7, width - 22, LineHeight), XStringFormats.TopLeft);
            var top = Y + 7 + LineHeight + 2;
            for (var block = 0; block < blocks[index].Length; block++)
                foreach (var line in blocks[index][block])
                {
                    graphics.DrawString(line, block == 0 ? Bold : Body,
                        new XSolidBrush(block == 0 ? DocumentPalette.Navy : DocumentPalette.Ink),
                        new XRect(x + 12, top, width - 22, LineHeight), XStringFormats.TopLeft);
                    top += LineHeight;
                }
        }
        Y += height + 10;
    }

    /// <summary>Label/value cells, <paramref name="perRow"/> per row, the label above its value; values wrap.</summary>
    public void Facts(IReadOnlyList<(string Label, string Value)> facts, int perRow = 4)
    {
        var width = Width / perRow;
        foreach (var chunk in facts.Chunk(perRow))
        {
            var cells = chunk.Select(fact => (Label: Wrap(fact.Label.ToUpperInvariant(), Bold, width - 12),
                Value: Wrap(fact.Value, Body, width - 12))).ToArray();
            var height = cells.Max(cell => cell.Label.Count + cell.Value.Count) * LineHeight + 10;
            Ensure(height);
            for (var index = 0; index < cells.Length; index++)
            {
                var x = Left + index * width;
                graphics.DrawRectangle(new XPen(DocumentPalette.Rule, 0.7), x, Y, width, height);
                var top = Y + 5;
                foreach (var line in cells[index].Label)
                {
                    graphics.DrawString(line, Bold, new XSolidBrush(DocumentPalette.Muted), new XRect(x + 6, top, width - 12, LineHeight),
                        XStringFormats.TopLeft);
                    top += LineHeight;
                }
                foreach (var line in cells[index].Value)
                {
                    graphics.DrawString(line, Body, new XSolidBrush(DocumentPalette.Navy), new XRect(x + 6, top, width - 12, LineHeight),
                        XStringFormats.TopLeft);
                    top += LineHeight;
                }
            }
            Y += height;
        }
        Y += 10;
    }

    /// <summary>
    /// A table: figures take exactly the width they need and are right-aligned (the decimals of a column fall under each
    /// other); the text columns share the rest by weight and wrap by word. The heading repeats on every page; a row moves
    /// whole to the next page, and the last row never leaves the totals alone on a page. The label of a totals row runs
    /// over the empty text columns next to it.
    /// </summary>
    public void Table(IReadOnlyList<DocumentColumn> columns, IReadOnlyList<string[]> rows, string emptyText,
        IReadOnlyList<string[]>? totals = null)
    {
        var widths = ColumnWidths(columns, rows.Concat(totals ?? []).ToArray());
        void Heading()
        {
            var lines = columns.Select((column, index) => Wrap(column.Heading, Bold, widths[index] - 2 * CellPadding)).ToArray();
            var height = lines.Max(item => item.Count) * LineHeight + 2 * CellPadding;
            Ensure(height + LineHeight * 2 + 2 * CellPadding);
            graphics.DrawRectangle(new XSolidBrush(DocumentPalette.Navy), Left, Y, Width, height);
            var x = Left;
            for (var column = 0; column < columns.Count; column++)
            {
                for (var line = 0; line < lines[column].Count; line++)
                    graphics.DrawString(lines[column][line], Bold, XBrushes.White,
                        new XRect(x + CellPadding, Y + CellPadding + line * LineHeight, widths[column] - 2 * CellPadding, LineHeight),
                        columns[column].Numeric ? XStringFormats.TopRight : XStringFormats.TopLeft);
                x += widths[column];
            }
            Y += height;
        }
        Heading();
        if (rows.Count == 0)
        {
            graphics.DrawRectangle(new XPen(DocumentPalette.Rule, 0.6), new XSolidBrush(DocumentPalette.Tint), Left, Y, Width, 26);
            graphics.DrawString(emptyText, Body, new XSolidBrush(DocumentPalette.Muted), new XRect(Left, Y, Width, 26), XStringFormats.Center);
            Y += 34;
            return;
        }
        var totalRows = (totals ?? []).Select(total =>
        {
            var spans = Spans(columns, total, widths);
            var cells = CellLines(columns, total, spans, Bold);
            return (Spans: spans, Cells: cells, Height: cells.Max(item => item.Count) * LineHeight + 2 * CellPadding);
        }).ToArray();
        var totalsHeight = totalRows.Sum(total => total.Height);
        for (var index = 0; index < rows.Count; index++)
        {
            var cells = CellLines(columns, rows[index], widths, Body);
            var height = cells.Max(item => item.Count) * LineHeight + 2 * CellPadding;
            if (Ensure(height + (index == rows.Count - 1 ? totalsHeight : 0))) Heading();
            if (index % 2 == 1) graphics.DrawRectangle(new XSolidBrush(DocumentPalette.Stripe), Left, Y, Width, height);
            DrawRow(columns, cells, widths, Body, DocumentPalette.Ink);
            Y += height;
            graphics.DrawLine(new XPen(DocumentPalette.Rule, 0.4), Left, Y, Left + Width, Y);
        }
        foreach (var (spans, cells, height) in totalRows)
        {
            if (Ensure(height)) Heading();
            graphics.DrawRectangle(new XSolidBrush(DocumentPalette.TotalFill), Left, Y, Width, height);
            graphics.DrawLine(new XPen(DocumentPalette.Navy, 0.9), Left, Y, Left + Width, Y);
            DrawRow(columns, cells, widths, Bold, DocumentPalette.Navy, spans);
            Y += height;
        }
        Y += 10;
    }

    /// <summary>
    /// The totals of a document in a block on the right: labels on the left of the block, figures right-aligned in one
    /// column so their decimal points stand under each other; the strong line (the total) is framed in navy.
    /// </summary>
    public void Totals(IReadOnlyList<DocumentTotal> totals, double width, double? top = null)
    {
        var strong = ElevantPdfFonts.Bold(BaseSize + 2);
        var height = totals.Sum(total => total.Strong ? strong.Size * 1.5 + 6 : LineHeight + 4) + 4;
        if (top is null) Ensure(height);
        var y = top ?? Y;
        var x = Left + Width - width;
        graphics.DrawRectangle(new XPen(DocumentPalette.Rule, 0.7), new XSolidBrush(DocumentPalette.Tint), x, y, width, height);
        y += 2;
        foreach (var total in totals)
        {
            var font = total.Strong ? strong : Body;
            var rowHeight = total.Strong ? strong.Size * 1.5 + 6 : LineHeight + 4;
            if (total.Strong) graphics.DrawRectangle(new XSolidBrush(DocumentPalette.Navy), x, y, width, rowHeight);
            var color = total.Strong ? XColors.White : DocumentPalette.Ink;
            graphics.DrawString(total.Label, total.Strong ? strong : Bold, new XSolidBrush(total.Strong ? XColors.White : DocumentPalette.Muted),
                new XRect(x + 8, y + 2 + (total.Strong ? 1 : 0), width - 16, rowHeight), XStringFormats.TopLeft);
            graphics.DrawString(total.Value, font, new XSolidBrush(color),
                new XRect(x + 8, y + 2 + (total.Strong ? 1 : 0), width - 16, rowHeight), XStringFormats.TopRight);
            y += rowHeight;
        }
        if (top is null) Y += height + 10;
    }

    /// <summary>The height <see cref="Totals"/> takes.</summary>
    public double TotalsHeight(IReadOnlyList<DocumentTotal> totals) =>
        totals.Sum(total => total.Strong ? (BaseSize + 2) * 1.5 + 6 : LineHeight + 4) + 4;

    /// <summary>Draws the footers; call once, after the last line.</summary>
    public void Finish()
    {
        graphics.Dispose();
        var font = ElevantPdfFonts.Regular(BaseSize);
        var bold = ElevantPdfFonts.Bold(BaseSize);
        var total = pdf.PageCount;
        for (var index = 0; index < total; index++)
        {
            var current = pdf.Pages[index];
            using var overlay = XGraphics.FromPdfPage(current, XGraphicsPdfPageOptions.Append);
            var width = current.Width.Point - 2 * Margin;
            var top = current.Height.Point - FooterHeight;
            overlay.DrawLine(new XPen(DocumentPalette.Rule, 0.6), Margin, top, Margin + width, top);
            var pageLabel = $"Página {index + 1} de {total}";
            var pageWidth = overlay.MeasureString(pageLabel, bold).Width;
            overlay.DrawString(pageLabel, bold, new XSolidBrush(DocumentPalette.Navy), new XRect(Margin, top + 4, width, 12),
                XStringFormats.TopRight);
            var lines = PdfTextLayout.Wrap(overlay, footer.Legend, font, width - pageWidth - 16).ToList();
            if (footer.Reference is { Length: > 0 } reference)
                lines.AddRange(PdfTextLayout.Wrap(overlay, reference, font, width - pageWidth - 16));
            for (var line = 0; line < lines.Count; line++)
                overlay.DrawString(lines[line], font, new XSolidBrush(line == 0 ? footer.LegendColor : DocumentPalette.Muted),
                    new XRect(Margin, top + 4 + line * (BaseSize + 2), width - pageWidth - 16, 12), XStringFormats.TopLeft);
        }
    }

    private double[] ColumnWidths(IReadOnlyList<DocumentColumn> columns, IReadOnlyList<string[]> rows)
    {
        // A figure column takes its widest value and, room permitting, its heading on one line (up to 84 points); the
        // text columns share what is left by weight, never less than 60 points each.
        var minimum = new double[columns.Count];
        var desired = new double[columns.Count];
        for (var column = 0; column < columns.Count; column++)
        {
            if (!columns[column].Numeric) continue;
            var widest = rows.Select(row => graphics.MeasureString(row[column], Bold).Width).DefaultIfEmpty(0).Max();
            var word = PdfTextLayout.LongestWord(graphics, columns[column].Heading, Bold);
            var heading = Math.Min(graphics.MeasureString(columns[column].Heading, Bold).Width, 84);
            minimum[column] = Math.Max(widest, word) + 2 * CellPadding + 2;
            desired[column] = Math.Max(minimum[column], heading + 2 * CellPadding + 2);
        }
        var text = columns.Where(column => !column.Numeric).ToArray();
        var room = Width - text.Length * 60;
        var widths = desired.Sum() <= room ? desired : minimum;
        if (text.Length == 0)
        {
            var scale = Width / widths.Sum();
            return widths.Select(width => width * scale).ToArray();
        }
        var spare = Width - widths.Sum();
        var weight = text.Sum(column => column.Weight);
        for (var column = 0; column < columns.Count; column++)
            if (!columns[column].Numeric) widths[column] = spare * columns[column].Weight / weight;
        return widths;
    }

    private List<string>[] CellLines(IReadOnlyList<DocumentColumn> columns, string[] cells, double[] widths, XFont font) =>
        cells.Select((value, index) => columns[index].Numeric
            ? [value]
            : Wrap(value, font, widths[index] - 2 * CellPadding).ToList()).ToArray();

    private void DrawRow(IReadOnlyList<DocumentColumn> columns, List<string>[] cells, double[] widths, XFont font, XColor color,
        double[]? spans = null)
    {
        var x = Left;
        for (var column = 0; column < columns.Count; column++)
        {
            var width = (spans ?? widths)[column];
            for (var line = 0; line < cells[column].Count; line++)
                graphics.DrawString(cells[column][line], font, new XSolidBrush(color),
                    new XRect(x + CellPadding, Y + CellPadding + line * LineHeight, width - 2 * CellPadding, LineHeight),
                    columns[column].Numeric ? XStringFormats.TopRight : XStringFormats.TopLeft);
            x += widths[column];
        }
    }

    /// <summary>The width each cell of a totals row may use: a text label takes the empty text columns that follow it.</summary>
    private static double[] Spans(IReadOnlyList<DocumentColumn> columns, string[] cells, double[] widths)
    {
        var spans = widths.ToArray();
        for (var column = 0; column < columns.Count; column++)
        {
            if (columns[column].Numeric || cells[column].Length == 0) continue;
            for (var next = column + 1; next < columns.Count && !columns[next].Numeric && cells[next].Length == 0; next++)
                spans[column] += widths[next];
        }
        return spans;
    }

    private void NewPage(bool first)
    {
        graphics?.Dispose();
        page = pdf.AddPage();
        page.Size = PageSize.A4;
        graphics = XGraphics.FromPdfPage(page);
        if (first) FirstLetterhead();
        else RunningLetterhead();
    }

    private void FirstLetterhead()
    {
        var logoHeight = DocumentPalette.DrawLogo(graphics, Margin, 30, 96);
        var titleFont = ElevantPdfFonts.Bold(letterhead.TitleSize);
        var right = Width - 120;
        var y = 30d;
        foreach (var line in Wrap(letterhead.Title, titleFont, right))
        {
            graphics.DrawString(line, titleFont, new XSolidBrush(DocumentPalette.Navy),
                new XRect(Margin + 120, y, right, letterhead.TitleSize * 1.3), XStringFormats.TopRight);
            y += letterhead.TitleSize * 1.3;
        }
        if (letterhead.Reference is { Length: > 0 } reference)
            foreach (var line in Wrap(reference, titleFont, right))
            {
                graphics.DrawString(line, titleFont, new XSolidBrush(DocumentPalette.Orange),
                    new XRect(Margin + 120, y, right, letterhead.TitleSize * 1.3), XStringFormats.TopRight);
                y += letterhead.TitleSize * 1.3;
            }
        y += 2;
        foreach (var detail in letterhead.Details)
            foreach (var line in Wrap(detail, Body, right))
            {
                graphics.DrawString(line, Body, new XSolidBrush(DocumentPalette.Muted), new XRect(Margin + 120, y, right, LineHeight),
                    XStringFormats.TopRight);
                y += LineHeight;
            }
        var rule = Math.Max(30 + logoHeight, y) + 8;
        graphics.DrawRectangle(new XSolidBrush(DocumentPalette.Navy), Margin, rule, Width, 2);
        graphics.DrawRectangle(new XSolidBrush(DocumentPalette.Orange), Margin, rule + 2, Width * 0.25, 2);
        Y = rule + 16;
    }

    private void RunningLetterhead()
    {
        var logoHeight = DocumentPalette.DrawLogo(graphics, Margin, 26, 58);
        var lines = Wrap($"{letterhead.Running} (continuación)", Bold, Width - 80);
        var y = 28d;
        foreach (var line in lines)
        {
            graphics.DrawString(line, Bold, new XSolidBrush(DocumentPalette.Navy), new XRect(Margin + 80, y, Width - 80, LineHeight),
                XStringFormats.TopRight);
            y += LineHeight;
        }
        var rule = Math.Max(26 + logoHeight, y) + 6;
        graphics.DrawRectangle(new XSolidBrush(DocumentPalette.Navy), Margin, rule, Width, 1.6);
        graphics.DrawRectangle(new XSolidBrush(DocumentPalette.Orange), Margin, rule + 1.6, Width * 0.25, 1.6);
        Y = rule + 14;
    }
}
