using System.Globalization;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Identity;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Commercial;

/// <summary>
/// Formal ground-handling contract: parties, validity, stations, agreed rates, terms and the
/// signature block with each party's acceptance and the SHA-256 of the signed content.
/// </summary>
public sealed class ContractPdfRenderer : IContractPdfRenderer
{
    private const double Margin = 48;
    private const double Line = 13;
    private static readonly CultureInfo Spanish = CultureInfo.GetCultureInfo("es-DO");
    private static readonly XColor Navy = XColor.FromArgb(8, 27, 58);
    private static readonly XColor Muted = XColor.FromArgb(77, 93, 118);

    static ContractPdfRenderer() => ElevantPdfFontResolver.EnsureRegistered();

    public byte[] Render(ContractDocumentData document)
    {
        ArgumentNullException.ThrowIfNull(document);
        using var pdf = new PdfDocument();
        pdf.Info.Title = $"Contrato {document.ContractCode} · versión {document.VersionNumber}";
        pdf.Info.Author = "ELEVANT · AVIAM";
        pdf.Info.Subject = "Contrato de servicios de asistencia en tierra";
        var writer = new Writer(pdf);

        writer.Banner(document);
        writer.Heading("1. Partes");
        writer.Paragraph("AVIAM, operador de servicios de asistencia en tierra (en adelante, «el Prestador»), y " +
            $"{document.AirlineLegalName ?? document.AirlineName} ({document.AirlineCode}), en adelante «la Aerolínea», " +
            "acuerdan los servicios, tarifas y condiciones de esta versión del contrato.");
        writer.Heading("2. Vigencia, moneda y cobertura");
        writer.Paragraph($"Vigente desde el {Date(document.ValidFrom)} " +
            (document.ValidTo is { } end ? $"hasta el {Date(end)}." : "sin fecha de vencimiento.") +
            $" Moneda de facturación: {document.CurrencyCode}. Estado de la versión: {VersionStatus(document.VersionStatus)}.");
        writer.Paragraph("Estaciones cubiertas: " + (document.Stations.Count == 0 ? "ninguna" : string.Join("; ", document.Stations)) + ".");
        writer.Heading("3. Servicios y tarifas pactadas");
        writer.Table(["Código", "Servicio", "Unidad", $"Precio ({document.CurrencyCode})", "Mínimo"], [0.14, 0.38, 0.18, 0.17, 0.13],
            document.Rates.Select(rate => (IReadOnlyList<string>)
            [
                rate.ServiceCode, rate.ServiceName, rate.BillingUnit,
                rate.UnitPrice.ToString("N2", Spanish), rate.MinimumQuantity.ToString("0.##", Spanish),
            ]).ToArray());
        writer.Heading("4. Términos y condiciones");
        writer.Paragraph(string.IsNullOrWhiteSpace(document.Terms) ? "Sin términos particulares." : document.Terms.Trim());
        writer.Heading("5. Firmas");
        writer.Paragraph("Cada parte acepta el contenido identificado por esta huella SHA-256. Un cambio en servicios, " +
            "tarifas, vigencia, estaciones o términos produce otra huella y requiere una nueva firma.", Muted);
        writer.Paragraph(document.ContentSha256, Navy, monospace: true);
        writer.Signatures(document);
        writer.Finish();

        using var output = new MemoryStream();
        pdf.Save(output, false);
        return output.ToArray();
    }

    private static string Date(DateOnly value) => value.ToString("d 'de' MMMM 'de' yyyy", Spanish);

    private static string VersionStatus(string status) => status switch
    {
        "Approved" => "aprobada",
        "Superseded" => "reemplazada por una versión posterior",
        _ => status,
    };

    private sealed class Writer
    {
        private readonly PdfDocument pdf;
        private readonly XFont body = new(ElevantPdfFontResolver.Typeface, 9.5, XFontStyleEx.Regular);
        private readonly XFont small = new(ElevantPdfFontResolver.Typeface, 8, XFontStyleEx.Regular);
        private readonly XFont heading = new(ElevantPdfFontResolver.Typeface, 12, XFontStyleEx.Regular);
        private readonly XFont title = new(ElevantPdfFontResolver.Typeface, 16, XFontStyleEx.Regular);
        private PdfPage page = null!;
        private XGraphics graphics = null!;
        private double y;
        private string footer = string.Empty;

        public Writer(PdfDocument pdf)
        {
            this.pdf = pdf;
            NewPage();
        }

        private double Width => page.Width.Point - 2 * Margin;

        public void Banner(ContractDocumentData document)
        {
            footer = $"{document.ContractCode} · versión {document.VersionNumber}";
            graphics.DrawRectangle(new XSolidBrush(Navy), 0, 0, page.Width.Point, 92);
            graphics.DrawString("ELEVANT · AVIAM", heading, XBrushes.White, new XRect(Margin, 24, Width, 18), XStringFormats.TopLeft);
            graphics.DrawString("Contrato de servicios de asistencia en tierra", title, XBrushes.White,
                new XRect(Margin, 46, Width, 24), XStringFormats.TopLeft);
            y = 112;
            Paragraph($"Contrato {document.ContractCode} · Versión {document.VersionNumber} · {document.AirlineName}", Navy);
        }

        public void Heading(string text)
        {
            Ensure(Line * 3);
            y += 8;
            graphics.DrawString(text, heading, new XSolidBrush(Navy), new XRect(Margin, y, Width, 16), XStringFormats.TopLeft);
            y += 20;
        }

        public void Paragraph(string text, XColor? color = null, bool monospace = false)
        {
            var font = monospace ? small : body;
            foreach (var paragraph in text.Replace("\r\n", "\n").Split('\n'))
                foreach (var line in Wrap(paragraph, font, Width))
                {
                    Ensure(Line);
                    graphics.DrawString(line, font, new XSolidBrush(color ?? XColors.Black), new XRect(Margin, y, Width, Line),
                        XStringFormats.TopLeft);
                    y += Line;
                }
            y += 4;
        }

        public void Table(IReadOnlyList<string> columns, IReadOnlyList<double> shares, IReadOnlyList<IReadOnlyList<string>> rows)
        {
            var widths = shares.Select(share => share * Width).ToArray();
            void Row(IReadOnlyList<string> cells, XFont font, XColor color)
            {
                var wrapped = cells.Select((cell, index) => Wrap(cell, font, widths[index] - 6)).ToArray();
                var height = wrapped.Max(lines => lines.Count) * Line + 4;
                Ensure(height);
                var x = Margin;
                for (var column = 0; column < cells.Count; column++)
                {
                    for (var line = 0; line < wrapped[column].Count; line++)
                        graphics.DrawString(wrapped[column][line], font, new XSolidBrush(color),
                            new XRect(x, y + line * Line, widths[column] - 6, Line), XStringFormats.TopLeft);
                    x += widths[column];
                }
                y += height;
                graphics.DrawLine(new XPen(XColor.FromArgb(225, 231, 239), 0.4), Margin, y - 2, Margin + Width, y - 2);
            }
            Row(columns, small, Muted);
            if (rows.Count == 0) Paragraph("Sin tarifas pactadas en esta versión.", Muted);
            foreach (var row in rows) Row(row, body, XColors.Black);
            y += 6;
        }

        public void Signatures(ContractDocumentData document)
        {
            Ensure(120);
            var column = (Width - 24) / 2;
            var top = y + 6;
            var parties = new[] { ("Aviam", "Por AVIAM (el Prestador)"), ("Airline", $"Por {document.AirlineName} (la Aerolínea)") };
            for (var index = 0; index < parties.Length; index++)
            {
                var (party, label) = parties[index];
                var x = Margin + index * (column + 24);
                var signature = document.Signatures.FirstOrDefault(item => item.Party == party);
                graphics.DrawRectangle(new XPen(XColor.FromArgb(200, 208, 220), 0.6), x, top, column, 104);
                graphics.DrawString(label, small, new XSolidBrush(Muted), new XRect(x + 8, top + 8, column - 16, Line), XStringFormats.TopLeft);
                var lines = signature is null
                    ? new[] { "Pendiente de firma." }
                    : new[]
                    {
                        $"Firmado por: {signature.SignerName}", $"Cargo: {signature.SignerTitle}",
                        $"Fecha: {signature.SignedAt.ToUniversalTime().ToString("dd/MM/yyyy HH:mm", Spanish)} UTC",
                        signature.DocumentSha256 == document.ContentSha256
                            ? "Huella coincidente con este documento."
                            : "Atención: firmó un contenido distinto.",
                    };
                for (var line = 0; line < lines.Length; line++)
                    graphics.DrawString(lines[line], body, new XSolidBrush(signature is null ? Muted : XColors.Black),
                        new XRect(x + 8, top + 28 + line * Line, column - 16, Line), XStringFormats.TopLeft);
            }
            y = top + 116;
            if (document.SignedOn is { } signedOn)
                Paragraph($"Contrato firmado por ambas partes el {Date(signedOn)}.", Navy);
        }

        public void Finish() => DrawFooter();

        private void Ensure(double height)
        {
            if (y + height <= page.Height.Point - 56) return;
            DrawFooter();
            NewPage();
        }

        private void NewPage()
        {
            graphics?.Dispose();
            page = pdf.AddPage();
            page.Size = PageSize.A4;
            graphics = XGraphics.FromPdfPage(page);
            y = Margin;
        }

        private void DrawFooter() =>
            graphics.DrawString($"{footer}  ·  Página {pdf.PageCount}", small, new XSolidBrush(Muted),
                new XRect(Margin, page.Height.Point - 36, Width, 14), XStringFormats.TopRight);

        private List<string> Wrap(string text, XFont font, double width)
        {
            var lines = new List<string>();
            var current = string.Empty;
            foreach (var word in text.Split(' '))
            {
                var candidate = current.Length == 0 ? word : current + " " + word;
                if (graphics.MeasureString(candidate, font).Width <= width) { current = candidate; continue; }
                if (current.Length > 0) lines.Add(current);
                // A single word wider than the column (a hash, a long code) is split by characters.
                if (graphics.MeasureString(word, font).Width > width)
                {
                    lines.AddRange(HumanResourcesReportPdfRenderer.WrapCellText(graphics, word, font, width + 7));
                    current = lines[^1];
                    lines.RemoveAt(lines.Count - 1);
                }
                else current = word;
            }
            lines.Add(current);
            return lines;
        }
    }
}
