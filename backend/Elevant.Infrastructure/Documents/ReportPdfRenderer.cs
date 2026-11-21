using Elevant.Application.Documents;
using Elevant.Infrastructure.Finance;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Documents;

/// <summary>
/// The PDF of a <see cref="ReportDocument"/> (ADR-0048), on PDFsharp with the embedded Noto Sans faces. The first page
/// carries the letterhead with the logo, the title, the metadata (station, period, filters, «Generado el … por …») and
/// the summary; every page repeats a header and the table heading. Columns take a width proportional to their content
/// within a minimum and a maximum, text wraps by word, figures align to the right with thousands and the same decimals,
/// the totals row stands out and the footer says «Página X de Y». Six or more columns, or a table wider than a portrait
/// page, turn the page to landscape.
/// </summary>
internal sealed class ReportPdfRenderer
{
    internal const string EmptyState = "No hay datos para estos filtros.";
    internal const string FooterText = "ELEVANT · AVIAM";

    private const double Margin = 36;
    private const double CellPadding = 4;
    private const double FooterHeight = 34;

    private static readonly XColor Navy = XColor.FromArgb(8, 27, 58);
    private static readonly XColor Orange = XColor.FromArgb(255, 92, 0);
    private static readonly XColor Ink = XColor.FromArgb(30, 41, 59);
    private static readonly XColor Muted = XColor.FromArgb(77, 93, 118);
    private static readonly XColor Rule = XColor.FromArgb(214, 221, 231);
    private static readonly XColor Tint = XColor.FromArgb(244, 247, 251);
    private static readonly XColor Stripe = XColor.FromArgb(248, 250, 252);
    private static readonly XColor TotalFill = XColor.FromArgb(226, 234, 245);
    private static readonly XColor NoticeFill = XColor.FromArgb(255, 241, 230);

    private static readonly Lazy<byte[]> Logo = new(() => EmbeddedResources.Read("elevant-logo.jpg"));

    static ReportPdfRenderer() => ElevantPdfFontResolver.EnsureRegistered();

    public byte[] Render(ReportDocument report)
    {
        ArgumentNullException.ThrowIfNull(report);
        report.Validate();
        var layout = Layout.Create(report);
        using var document = new PdfDocument();
        document.Info.Title = report.StationCode is { } code ? $"{report.Title} · {code}" : report.Title;
        document.Info.Author = "ELEVANT";
        document.Info.Subject = report.Notice is { } notice ? $"{report.Area} · {notice}" : $"{report.Area} · {report.Audience.ToLowerInvariant()}";
        new Writer(document, report, layout).Write();
        DrawFooters(document, report);
        using var output = new MemoryStream();
        document.Save(output, false);
        return output.ToArray();
    }

    private static void DrawFooters(PdfDocument document, ReportDocument report)
    {
        var small = ElevantPdfFonts.Regular(7.5);
        var total = document.PageCount;
        for (var index = 0; index < total; index++)
        {
            var page = document.Pages[index];
            using var graphics = XGraphics.FromPdfPage(page, XGraphicsPdfPageOptions.Append);
            var width = page.Width.Point - 2 * Margin;
            var top = page.Height.Point - FooterHeight + 8;
            graphics.DrawLine(new XPen(Rule, 0.6), Margin, top, Margin + width, top);
            var footer = $"{FooterText} · {report.Audience} — Página {index + 1} de {total}";
            graphics.DrawString(footer, small, new XSolidBrush(Muted), new XRect(Margin, top + 5, width, 10),
                XStringFormats.TopRight);
            // The left side wraps (two short lines at most fit the footer); nothing is cut.
            var left = report.Notice is { } notice ? $"{notice}." : $"{report.Title} · {report.GeneratedLabel}";
            var lines = PdfTextLayout.Wrap(graphics, left, small, width - graphics.MeasureString(footer, small).Width - 24);
            for (var line = 0; line < lines.Count; line++)
                graphics.DrawString(lines[line], small, new XSolidBrush(report.Notice is null ? Muted : Orange),
                    new XRect(Margin, top + 5 + line * 9, width, 10), XStringFormats.TopLeft);
        }
    }

    /// <summary>The fonts, orientation and column widths a report is drawn with, decided before the first page.</summary>
    private sealed record Layout(bool Landscape, double FontSize, double[] Widths, string[][] Cells,
        string[][] Totals, bool[] Numeric, bool[] Fixed)
    {
        public XFont Body => ElevantPdfFonts.Regular(FontSize);

        public XFont BodyBold => ElevantPdfFonts.Bold(FontSize);

        public double LineHeight => Math.Round(FontSize * 1.32, 2);

        public static Layout Create(ReportDocument report)
        {
            var columns = report.Columns;
            var decimals = Enumerable.Range(0, columns.Count)
                .Select(index => ReportFormat.DecimalsOf(columns[index], report.Rows.Select(row => row[index]))).ToArray();
            var cells = report.Rows.Select(row => Enumerable.Range(0, columns.Count)
                .Select(index => ReportFormat.Display(columns[index], row[index], decimals[index])).ToArray()).ToArray();
            var totals = report.EffectiveTotals.Select(total => Enumerable.Range(0, columns.Count)
                .Select(index => total.Cells[index] is { } cell
                    ? cell.HasValue ? ReportFormat.Display(columns[index], cell, decimals[index]) : cell.Text
                    : string.Empty).ToArray()).ToArray();
            var numeric = columns.Select(column => column.IsNumeric).ToArray();
            // Figures, dates and times never wrap: «01/11/2026 06:00» stays on one line.
            var fixedWidth = columns.Select(column => column.IsNumeric || column.Type is ReportColumnType.Date or
                ReportColumnType.DateTime or ReportColumnType.Time).ToArray();
            var portrait = new XSize(595.28, 841.89);
            using var measure = XGraphics.CreateMeasureContext(portrait, XGraphicsUnit.Point, XPageDirection.Downwards);
            foreach (var size in new[] { 8d, 7.5d, 7d, 6.5d })
            {
                var (desired, minimum) = Natural(measure, report, cells, totals, fixedWidth, size);
                var landscape = columns.Count >= 6 || desired.Sum() > portrait.Width - 2 * Margin;
                var available = (landscape ? portrait.Height : portrait.Width) - 2 * Margin;
                if (minimum.Sum() <= available || size == 6.5d)
                    return new Layout(landscape, size, Fit(desired, minimum, fixedWidth, available), cells, totals, numeric, fixedWidth);
            }
            throw new InvalidOperationException("Unreachable: the smallest font always returns a layout.");
        }

        /// <summary>
        /// What each column would like (its widest value, capped) and the least it accepts (its longest word, so words
        /// are not broken; figures never wrap).
        /// </summary>
        private static (double[] Desired, double[] Minimum) Natural(XGraphics measure, ReportDocument report,
            string[][] cells, string[][] totals, bool[] numeric, double size)
        {
            var body = ElevantPdfFonts.Regular(size);
            var bold = ElevantPdfFonts.Bold(size);
            var count = report.Columns.Count;
            var desired = new double[count];
            var minimum = new double[count];
            // A sample is enough to size a very long table; figures are measured in full because they never wrap.
            var sample = cells.Length <= 1500 ? cells : cells.Where((_, index) => index % (cells.Length / 1500 + 1) == 0).ToArray();
            for (var column = 0; column < count; column++)
            {
                var heading = report.Columns[column].Heading;
                var headingWord = PdfTextLayout.LongestWord(measure, heading, bold);
                var headingFull = measure.MeasureString(heading, bold).Width;
                var values = (numeric[column] ? cells : sample).Select(row => row[column]).Where(text => text.Length > 0);
                double widest = 0, longestWord = 0;
                foreach (var value in values)
                {
                    widest = Math.Max(widest, PdfTextLayout.Width(measure, value, body));
                    if (!numeric[column]) longestWord = Math.Max(longestWord, PdfTextLayout.LongestWord(measure, value, body));
                }
                foreach (var total in totals)
                    if (total[column].Length > 0)
                        widest = Math.Max(widest, measure.MeasureString(total[column], bold).Width);
                if (numeric[column])
                {
                    // A point and a half of slack: the page measures a hair wider than the measuring context.
                    minimum[column] = Math.Max(widest, headingWord) + 2 * CellPadding + 1.5;
                    desired[column] = Math.Max(minimum[column], Math.Min(headingFull, 90) + 2 * CellPadding);
                }
                else
                {
                    minimum[column] = Math.Max(Math.Max(headingWord, Math.Min(longestWord, 110)), 28) + 2 * CellPadding + 1.5;
                    desired[column] = Math.Max(minimum[column], Math.Min(Math.Max(widest, Math.Min(headingFull, 120)), 230) +
                        2 * CellPadding);
                }
            }
            return (desired, minimum);
        }

        /// <summary>
        /// Widths that fill the page: the spare room goes to the text columns in proportion to what they want; when the
        /// page is short, the text columns give up width toward their minimum in proportion to what they can give.
        /// </summary>
        private static double[] Fit(double[] desired, double[] minimum, bool[] numeric, double available)
        {
            var widths = desired.ToArray();
            var total = widths.Sum();
            if (total <= available)
            {
                var growable = Enumerable.Range(0, widths.Length).Where(index => !numeric[index]).ToArray();
                if (growable.Length == 0) growable = Enumerable.Range(0, widths.Length).ToArray();
                var weight = growable.Sum(index => widths[index]);
                foreach (var index in growable) widths[index] += (available - total) * widths[index] / weight;
                return widths;
            }
            var slack = Enumerable.Range(0, widths.Length).Sum(index => desired[index] - minimum[index]);
            var excess = total - available;
            if (slack >= excess)
            {
                for (var index = 0; index < widths.Length; index++)
                    widths[index] -= excess * (desired[index] - minimum[index]) / slack;
                return widths;
            }
            // Even the minimums do not fit at the smallest size: scale everything; long words break by characters.
            var scale = available / minimum.Sum();
            return minimum.Select(width => width * scale).ToArray();
        }
    }

    private sealed class Writer(PdfDocument document, ReportDocument report, Layout layout)
    {
        private readonly XFont small = ElevantPdfFonts.Regular(7.5);
        private readonly XFont smallBold = ElevantPdfFonts.Bold(7.5);
        private readonly XFont label = ElevantPdfFonts.Bold(8);
        private readonly XFont text = ElevantPdfFonts.Regular(8.5);
        private readonly XFont title = ElevantPdfFonts.Bold(16);
        private readonly XFont kpi = ElevantPdfFonts.Bold(13);
        private PdfPage page = null!;
        private XGraphics graphics = null!;
        private double y;

        private double Width => page.Width.Point - 2 * Margin;

        private double Bottom => page.Height.Point - FooterHeight - 6;

        public void Write()
        {
            NewPage(first: true);
            Metadata();
            Summary();
            if (report.Rows.Count == 0)
            {
                TableHeading();
                Empty();
            }
            else
            {
                TableHeading();
                for (var row = 0; row < layout.Cells.Length; row++) DataRow(layout.Cells[row], row % 2 == 1);
                foreach (var total in layout.Totals) TotalRow(total);
            }
            Notes();
            graphics.Dispose();
        }

        private void NewPage(bool first)
        {
            graphics?.Dispose();
            page = document.AddPage();
            page.Size = PageSize.A4;
            if (layout.Landscape) page.Orientation = PageOrientation.Landscape;
            graphics = XGraphics.FromPdfPage(page);
            using (var logo = XImage.FromStream(new MemoryStream(Logo.Value)))
            {
                var logoWidth = first ? 78d : 56d;
                graphics.DrawImage(logo, Margin, 24, logoWidth, logoWidth * logo.PixelHeight / (double)logo.PixelWidth);
            }
            var right = new XRect(Margin + 140, 26, Width - 140, 11);
            graphics.DrawString(report.Area.ToUpperInvariant(), smallBold, new XSolidBrush(Navy), right, XStringFormats.TopRight);
            right.Offset(0, 11);
            graphics.DrawString(report.StationLabel ?? "ELEVANT · AVIAM", small, new XSolidBrush(Muted), right,
                XStringFormats.TopRight);
            if (report.PeriodLabel is { } period)
            {
                right.Offset(0, 10);
                graphics.DrawString($"{report.PeriodHeading}: {period}", small, new XSolidBrush(Muted), right,
                    XStringFormats.TopRight);
            }
            var ruleY = first ? 74d : 62d;
            graphics.DrawRectangle(new XSolidBrush(Navy), Margin, ruleY, Width, 1.8);
            graphics.DrawRectangle(new XSolidBrush(Orange), Margin, ruleY + 1.8, Width * 0.22, 1.8);
            y = ruleY + 12;
            if (first)
            {
                foreach (var line in PdfTextLayout.Wrap(graphics, report.Title, title, Width))
                {
                    graphics.DrawString(line, title, new XSolidBrush(Navy), new XRect(Margin, y, Width, 20), XStringFormats.TopLeft);
                    y += 20;
                }
                if (report.Description is { Length: > 0 } description)
                    Paragraph(description, text, Muted, Margin, Width, 11.5);
                if (report.Notice is { } notice)
                {
                    y += 4;
                    graphics.DrawRectangle(new XSolidBrush(NoticeFill), Margin, y, Width, 16);
                    graphics.DrawString(notice.ToUpperInvariant(), smallBold, new XSolidBrush(Orange),
                        new XRect(Margin + 8, y + 4, Width - 16, 10), XStringFormats.TopLeft);
                    y += 20;
                }
                y += 6;
            }
            else
            {
                graphics.DrawString($"{report.Title} (continuación)", label, new XSolidBrush(Navy),
                    new XRect(Margin, y, Width, 12), XStringFormats.TopLeft);
                y += 18;
            }
        }

        private void Paragraph(string value, XFont font, XColor color, double x, double width, double lineHeight)
        {
            foreach (var line in PdfTextLayout.Wrap(graphics, value, font, width))
            {
                graphics.DrawString(line, font, new XSolidBrush(color), new XRect(x, y, width, lineHeight), XStringFormats.TopLeft);
                y += lineHeight;
            }
        }

        /// <summary>The station, the period, every filter by name, «Generado el … por …» and the rows, in a tinted box.</summary>
        private void Metadata()
        {
            var items = report.Metadata.Where(item => item.Label != "Área").ToArray();
            var perRow = layout.Landscape ? 3 : 2;
            var cellWidth = (Width - 16) / perRow;
            const double labelWidth = 74;
            var blocks = items.Select(item => (item.Label,
                Lines: PdfTextLayout.Wrap(graphics, item.Value, small, cellWidth - labelWidth - 8))).ToArray();
            var rowHeights = blocks.Chunk(perRow).Select(chunk => chunk.Max(block => block.Lines.Count) * 10d + 4).ToArray();
            var height = rowHeights.Sum() + 10;
            graphics.DrawRectangle(new XPen(Rule, 0.6), new XSolidBrush(Tint), Margin, y, Width, height);
            var top = y + 6;
            foreach (var (chunk, rowHeight) in blocks.Chunk(perRow).Zip(rowHeights))
            {
                for (var column = 0; column < chunk.Length; column++)
                {
                    var x = Margin + 8 + column * cellWidth;
                    graphics.DrawString(chunk[column].Label, smallBold, new XSolidBrush(Navy),
                        new XRect(x, top, labelWidth, 10), XStringFormats.TopLeft);
                    for (var line = 0; line < chunk[column].Lines.Count; line++)
                        graphics.DrawString(chunk[column].Lines[line], small, new XSolidBrush(Ink),
                            new XRect(x + labelWidth, top + line * 10, cellWidth - labelWidth - 8, 10), XStringFormats.TopLeft);
                }
                top += rowHeight;
            }
            y += height + 10;
        }

        /// <summary>The summary figures as tiles, each with its label and its context («de 50 operaciones (16.0 %)»).</summary>
        private void Summary()
        {
            if (report.Summary.Count == 0) return;
            var perRow = Math.Min(report.Summary.Count, layout.Landscape ? 5 : 4);
            const double gap = 8;
            var tileWidth = (Width - gap * (perRow - 1)) / perRow;
            foreach (var chunk in report.Summary.Chunk(perRow))
            {
                var blocks = chunk.Select(metric => (metric,
                    Labels: PdfTextLayout.Wrap(graphics, metric.Label, smallBold, tileWidth - 16),
                    Values: PdfTextLayout.Wrap(graphics, metric.Value, kpi, tileWidth - 16),
                    Context: metric.Context is { Length: > 0 } context
                        ? PdfTextLayout.Wrap(graphics, context, small, tileWidth - 16) : [])).ToArray();
                var height = blocks.Max(block => block.Labels.Count * 9.5 + block.Values.Count * 16 + block.Context.Count * 9.5) + 12;
                for (var index = 0; index < blocks.Length; index++)
                {
                    var x = Margin + index * (tileWidth + gap);
                    graphics.DrawRectangle(new XPen(Rule, 0.6), XBrushes.White, x, y, tileWidth, height);
                    graphics.DrawRectangle(new XSolidBrush(Orange), x, y, 2.2, height);
                    var top = y + 6;
                    foreach (var line in blocks[index].Labels)
                    {
                        graphics.DrawString(line, smallBold, new XSolidBrush(Muted), new XRect(x + 8, top, tileWidth - 16, 9.5),
                            XStringFormats.TopLeft);
                        top += 9.5;
                    }
                    foreach (var line in blocks[index].Values)
                    {
                        graphics.DrawString(line, kpi, new XSolidBrush(Navy), new XRect(x + 8, top + 1, tileWidth - 16, 16),
                            XStringFormats.TopLeft);
                        top += 16;
                    }
                    foreach (var line in blocks[index].Context)
                    {
                        graphics.DrawString(line, small, new XSolidBrush(Muted), new XRect(x + 8, top, tileWidth - 16, 9.5),
                            XStringFormats.TopLeft);
                        top += 9.5;
                    }
                }
                y += height + gap;
            }
            y += 4;
        }

        private void TableHeading()
        {
            var headings = report.Columns.Select((column, index) =>
                PdfTextLayout.Wrap(graphics, column.Heading, layout.BodyBold, layout.Widths[index] - 2 * CellPadding)).ToArray();
            var height = headings.Max(lines => lines.Count) * layout.LineHeight + 2 * CellPadding;
            if (y + height + layout.LineHeight * 2 > Bottom) NewPage(first: false);
            graphics.DrawRectangle(new XSolidBrush(Navy), Margin, y, Width, height);
            var x = Margin;
            for (var column = 0; column < headings.Length; column++)
            {
                DrawLines(headings[column], layout.BodyBold, XColors.White, x, y + CellPadding, layout.Widths[column],
                    layout.Numeric[column], 0, headings[column].Count);
                x += layout.Widths[column];
            }
            y += height;
        }

        private void DataRow(string[] cells, bool striped)
        {
            var lines = cells.Select((value, index) => layout.Fixed[index]
                ? (IReadOnlyList<string>)[value]
                : PdfTextLayout.Wrap(graphics, value, layout.Body, layout.Widths[index] - 2 * CellPadding)).ToArray();
            var count = lines.Max(item => item.Count);
            var offset = 0;
            while (offset < count)
            {
                var fit = (int)Math.Floor((Bottom - y - 2 * CellPadding) / layout.LineHeight);
                // A row moves whole to the next page unless it is taller than a page by itself.
                if (fit < count - offset && (fit < 1 || offset == 0 && count <= PageLines()))
                {
                    NewPage(first: false);
                    TableHeading();
                    continue;
                }
                var drawn = Math.Min(fit, count - offset);
                var height = drawn * layout.LineHeight + 2 * CellPadding;
                if (striped) graphics.DrawRectangle(new XSolidBrush(Stripe), Margin, y, Width, height);
                var x = Margin;
                for (var column = 0; column < cells.Length; column++)
                {
                    DrawLines(lines[column], layout.Body, Ink, x, y + CellPadding, layout.Widths[column], layout.Numeric[column],
                        offset, drawn);
                    x += layout.Widths[column];
                }
                y += height;
                graphics.DrawLine(new XPen(Rule, 0.35), Margin, y, Margin + Width, y);
                offset += drawn;
            }
        }

        private int PageLines() => (int)Math.Floor((page.Height.Point - FooterHeight - 6 - 140) / layout.LineHeight);

        private void TotalRow(string[] cells)
        {
            var height = layout.LineHeight + 2 * CellPadding;
            if (y + height > Bottom)
            {
                NewPage(first: false);
                TableHeading();
            }
            graphics.DrawRectangle(new XSolidBrush(TotalFill), Margin, y, Width, height);
            graphics.DrawLine(new XPen(Navy, 0.9), Margin, y, Margin + Width, y);
            var x = Margin;
            for (var column = 0; column < cells.Length; column++)
            {
                var value = cells[column];
                if (value.Length > 0)
                {
                    // The label of the totals row never wraps: it may run into the next empty column.
                    var width = layout.Numeric[column] ? layout.Widths[column] : Math.Max(layout.Widths[column],
                        graphics.MeasureString(value, layout.BodyBold).Width + 2 * CellPadding);
                    DrawLines([value], layout.BodyBold, Navy, x, y + CellPadding, width, layout.Numeric[column], 0, 1);
                }
                x += layout.Widths[column];
            }
            y += height;
        }

        private void Empty()
        {
            var height = 34d;
            graphics.DrawRectangle(new XPen(Rule, 0.6), new XSolidBrush(Tint), Margin, y, Width, height);
            graphics.DrawString(EmptyState, text, new XSolidBrush(Muted), new XRect(Margin, y, Width, height),
                XStringFormats.Center);
            y += height;
        }

        private void Notes()
        {
            if (report.Notes.Count == 0) return;
            y += 10;
            if (y + 30 > Bottom) NewPage(first: false);
            graphics.DrawString("Notas", label, new XSolidBrush(Navy), new XRect(Margin, y, Width, 12), XStringFormats.TopLeft);
            y += 13;
            foreach (var note in report.Notes)
                foreach (var line in PdfTextLayout.Wrap(graphics, "• " + note, small, Width))
                {
                    if (y + 10 > Bottom) NewPage(first: false);
                    graphics.DrawString(line, small, new XSolidBrush(Muted), new XRect(Margin, y, Width, 10), XStringFormats.TopLeft);
                    y += 10;
                }
        }

        private void DrawLines(IReadOnlyList<string> lines, XFont font, XColor color, double x, double top, double width,
            bool right, int offset, int count)
        {
            var brush = new XSolidBrush(color);
            for (var line = 0; line < count && offset + line < lines.Count; line++)
                graphics.DrawString(lines[offset + line], font, brush,
                    new XRect(x + CellPadding, top + line * layout.LineHeight, width - 2 * CellPadding, layout.LineHeight),
                    right ? XStringFormats.TopRight : XStringFormats.TopLeft);
        }
    }
}
