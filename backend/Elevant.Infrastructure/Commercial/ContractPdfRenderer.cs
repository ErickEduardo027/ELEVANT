using System.Globalization;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Identity;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Commercial;

/// <summary>
/// Formal ground-handling contract: branded header, parties, validity, stations, agreed rates and,
/// for versions whose signed content includes them (pricing policy 2, 2-N04), the surcharges (3.1) and
/// packages (3.2); numbered terms and the signature block with the SHA-256 of the signed content. Draft versions
/// (still editable or awaiting Finance) carry a diagonal «BORRADOR» watermark and show unconfirmed
/// prices as «Por definir»; they are for review, never for signature.
/// </summary>
public sealed class ContractPdfRenderer(TimeProvider? timeProvider = null) : IContractPdfRenderer
{
    private const double Margin = 48;
    private const double Line = 13;
    private static readonly CultureInfo Spanish = CultureInfo.GetCultureInfo("es-DO");
    private static readonly XColor Navy = XColor.FromArgb(8, 27, 58);
    private static readonly XColor Blue = XColor.FromArgb(0, 51, 153);
    private static readonly XColor Orange = XColor.FromArgb(255, 92, 0);
    private static readonly XColor Muted = XColor.FromArgb(77, 93, 118);
    private static readonly XColor Rule = XColor.FromArgb(214, 221, 231);
    private static readonly XColor Tint = XColor.FromArgb(244, 247, 251);
    private static readonly XColor Success = XColor.FromArgb(21, 128, 61);
    private static readonly Lazy<byte[]> Logo = new(() => EmbeddedResources.Read("elevant-logo.jpg"));

    static ContractPdfRenderer() => ElevantPdfFontResolver.EnsureRegistered();

    /// <summary>Versions that are not yet approved print as drafts.</summary>
    public static bool IsDraft(ContractDocumentData document) =>
        document.VersionStatus is "Draft" or "PendingFinanceApproval";

    public byte[] Render(ContractDocumentData document)
    {
        ArgumentNullException.ThrowIfNull(document);
        var draft = IsDraft(document);
        using var pdf = new PdfDocument();
        pdf.Info.Title = $"Contrato {document.ContractCode} · versión {document.VersionNumber}" + (draft ? " · borrador" : string.Empty);
        pdf.Info.Author = "ELEVANT · AVIAM";
        pdf.Info.Subject = "Contrato de servicios de asistencia en tierra";
        var writer = new Writer(pdf);

        writer.Header(document, draft);
        writer.Parties(document);
        writer.Summary(document);

        writer.Heading("1", "Objeto");
        writer.Paragraph("AVIAM, operador de servicios de asistencia en tierra (en adelante, «el Prestador»), y " +
            $"{document.AirlineLegalName ?? document.AirlineName} ({document.AirlineCode}), en adelante «la Aerolínea», " +
            "acuerdan los servicios, tarifas y condiciones de esta versión del contrato.");

        writer.Heading("2", "Vigencia y cobertura");
        writer.Paragraph($"El contrato rige desde el {Date(document.ValidFrom)} " +
            (document.ValidTo is { } end ? $"hasta el {Date(end)}." : "sin fecha de vencimiento.") +
            $" Las operaciones se facturan en {document.CurrencyCode}.");
        writer.Paragraph("Estaciones cubiertas: " + (document.Stations.Count == 0 ? "ninguna" : string.Join("; ", document.Stations)) + ".");
        // ADR-0025: renewal and termination terms Contratos confirmed after Finance approval.
        if (document.Validity is { } validity)
        {
            writer.Paragraph(validity.RenewalMode == "Automatic"
                ? $"Renovación automática: {validity.RenewalNoticeDays} días antes del vencimiento se inicia una nueva versión por " +
                  $"{validity.RenewalTermMonths} meses, que requiere la aprobación de Finanzas y la firma de ambas partes."
                : "Renovación manual: las partes acuerdan una nueva versión antes del vencimiento" +
                  (validity.RenewalTermMonths is { } months ? $", por períodos de {months} meses." : ".") +
                  (validity.RenewalNoticeDays > 0 ? $" AVIAM avisa con {validity.RenewalNoticeDays} días de antelación." : string.Empty));
            writer.Paragraph($"Terminación anticipada: cualquiera de las partes puede terminar el contrato con un preaviso de " +
                $"{validity.TerminationNoticeDays} días." +
                (string.IsNullOrWhiteSpace(validity.TerminationTerms) ? string.Empty : " " + validity.TerminationTerms.Trim()));
        }

        writer.Heading("3", document.Pricing is null ? "Servicios y tarifas pactadas" : "Servicios, tarifas, recargos y paquetes");
        writer.Table(
            [new("Código", 0.13, false), new("Servicio", 0.37, false), new("Unidad", 0.18, false),
                new($"Precio ({document.CurrencyCode})", 0.18, true), new("Mínimo", 0.14, true)],
            document.Rates.Select(rate => (IReadOnlyList<string>)
            [
                rate.ServiceCode, rate.ServiceName, Unit(rate.BillingUnit),
                rate.PriceConfirmed ? rate.UnitPrice.ToString("N2", Spanish) : "Por definir",
                rate.MinimumQuantity.ToString("0.##", Spanish),
            ]).ToArray());
        if (draft && document.Rates.Any(rate => !rate.PriceConfirmed))
            writer.Paragraph("«Por definir»: tarifa propuesta pendiente de confirmación por Contratos.", Muted, small: true);
        // 2-N04: the surcharges and packages that are billed are part of the signed content.
        if (document.Pricing is { } pricing)
        {
            writer.SubHeading("3.1", "Recargos");
            if (pricing.Charges.Count == 0) writer.Paragraph("Sin recargos en esta versión.", Muted);
            else
                writer.Table(
                    [new("Código", 0.13, false), new("Recargo", 0.31, false), new("Cálculo", 0.24, false),
                        new($"Valor ({document.CurrencyCode})", 0.17, true), new("Mínimo", 0.15, true)],
                    pricing.Charges.Select(charge => (IReadOnlyList<string>)
                    [
                        charge.ChargeCode, charge.ChargeName, ChargeBasis(charge), ChargeValue(charge),
                        charge.IsExcluded || charge.MinimumAmount is not > 0 ? "—" : charge.MinimumAmount.Value.ToString("N2", Spanish),
                    ]).ToArray());
            writer.SubHeading("3.2", "Paquetes");
            if (pricing.Packages.Count == 0) writer.Paragraph("Sin paquetes en esta versión.", Muted);
            else
                writer.Table(
                    [new("Código", 0.14, false), new("Paquete", 0.24, false), new("Alcance", 0.17, false),
                        new("Precio base", 0.14, true), new("Incluye", 0.31, false)],
                    pricing.Packages.Select(package => (IReadOnlyList<string>)
                    [
                        $"{package.Code} v{package.VersionNumber}", package.Name, Scope(package),
                        $"{package.CurrencyCode} {package.BasePrice.ToString("N2", Spanish)}", Components(package),
                    ]).ToArray());
        }

        writer.Heading("4", "Términos y condiciones");
        writer.Clauses("4", document.Terms);

        writer.Heading("5", "Firmas");
        if (draft)
        {
            writer.Paragraph("Este documento es un borrador para revisión. No es válido para firma: las partes firman " +
                "la versión aprobada por Finanzas, que se publica con su propia huella.", Muted);
        }
        else
        {
            writer.Paragraph(document.Pricing is null
                ? "Cada parte acepta el contenido identificado por esta huella SHA-256. Un cambio en servicios, " +
                  "tarifas, vigencia, estaciones o términos produce otra huella y requiere una nueva firma. Los recargos " +
                  "y paquetes de esta versión no forman parte de la huella."
                : "Cada parte acepta el contenido identificado por esta huella SHA-256. Un cambio en servicios, " +
                  "tarifas, recargos, paquetes, vigencia, estaciones o términos produce otra huella y requiere una nueva firma.",
                Muted);
            writer.Fingerprint(document.ContentSha256);
            writer.Signatures(document);
        }

        writer.Finish(document, draft, (timeProvider ?? TimeProvider.System).GetUtcNow());
        using var output = new MemoryStream();
        pdf.Save(output, false);
        return output.ToArray();
    }

    private static string Date(DateOnly value) => value.ToString("d 'de' MMMM 'de' yyyy", Spanish);

    /// <summary>Spanish noun of the units every environment starts with; another code prints as stored.</summary>
    private static string Unit(string? code) => code?.Trim().ToLowerInvariant() switch
    {
        "operation" => "operación",
        "aircraft" => "aeronave",
        "passenger" => "pasajero",
        "ton" => "tonelada",
        "hour" => "hora",
        "minute" => "minuto",
        "unit" => "unidad",
        "service" => "servicio",
        "day" => "día",
        null or "" => "—",
        _ => code.Trim(),
    };

    private static string ChargeBasis(ContractDocumentCharge charge)
    {
        var basis = charge.Method switch
        {
            "FixedAmount" => "Monto fijo",
            "PercentOfService" => "Porcentaje del servicio",
            "PerHour" => "Por hora",
            "PerMinute" => "Por minuto",
            "PerUnit" => $"Por {Unit(charge.BillingUnit)}",
            _ => charge.Method,
        };
        var rule = charge.QuantityRule switch
        {
            "ServiceDuration" => "según la duración del servicio",
            "OperationOverrun" => "según el exceso de la operación",
            "ArrivalDelay" => "según el retraso de la llegada",
            "ServiceQuantity" => "según la cantidad del servicio",
            _ => null,
        };
        var grace = charge.GraceMinutes > 0 ? $"{charge.GraceMinutes} min de gracia" : null;
        return string.Join(", ", new[] { basis, rule, grace }.Where(part => part is not null));
    }

    private static string ChargeValue(ContractDocumentCharge charge) =>
        charge.IsExcluded ? "Exento"
        : charge.Value is not { } value ? "Tarifa general"
        : charge.Method == "PercentOfService" ? $"{value.ToString("0.##", Spanish)} %"
        : value.ToString("N2", Spanish);

    private static string Scope(ContractDocumentPackage package) => package.Scope switch
    {
        "Turnaround" => "Por escala",
        "Flight" => package.FlightDirection switch
        {
            "Arrival" => "Por vuelo de llegada",
            "Departure" => "Por vuelo de salida",
            _ => "Por vuelo",
        },
        "Period" => package.PeriodDays is { } days ? $"Por período de {days} días" : "Por período",
        _ => package.Scope,
    };

    private static string Components(ContractDocumentPackage package) => package.Components.Count == 0 ? "—"
        : string.Join("; ", package.Components.Select(component =>
            $"{component.ServiceCode}: {component.IncludedQuantity.ToString("0.##", Spanish)} {Unit(component.BillingUnit)}" +
            (component.ExcessBlockPrice > 0
                ? $", exceso {package.CurrencyCode} {component.ExcessBlockPrice.ToString("N2", Spanish)} por cada " +
                  $"{component.ExcessBlockSize.ToString("0.##", Spanish)} {Unit(component.BillingUnit)}"
                : string.Empty)));

    private static string VersionStatus(string status) => status switch
    {
        "Draft" => "Borrador",
        "PendingFinanceApproval" => "Borrador · en revisión de Finanzas",
        "Approved" => "Aprobada",
        "Superseded" => "Reemplazada por una versión posterior",
        _ => status,
    };

    private sealed record Column(string Title, double Share, bool AlignRight);

    private sealed class Writer
    {
        // 2-D: every ELEVANT PDF embeds the complete Unicode Noto Sans faces (ElevantPdfFonts).
        private readonly PdfDocument pdf;
        private readonly XFont body = ElevantPdfFonts.Regular(9.5);
        private readonly XFont bodyBold = ElevantPdfFonts.Bold(9.5);
        private readonly XFont small = ElevantPdfFonts.Regular(8);
        private readonly XFont smallBold = ElevantPdfFonts.Bold(8);
        private readonly XFont label = ElevantPdfFonts.Bold(7);
        private readonly XFont heading = ElevantPdfFonts.Bold(12);
        private readonly XFont title = ElevantPdfFonts.Bold(17);
        private readonly XFont watermark = ElevantPdfFonts.Bold(72);
        private readonly XFont watermarkNote = ElevantPdfFonts.Bold(22);
        private PdfPage page = null!;
        private XGraphics graphics = null!;
        private double y;

        public Writer(PdfDocument pdf)
        {
            this.pdf = pdf;
            NewPage();
        }

        private double Width => page.Width.Point - 2 * Margin;

        public void Header(ContractDocumentData document, bool draft)
        {
            using (var logo = XImage.FromStream(new MemoryStream(Logo.Value)))
                graphics.DrawImage(logo, Margin, 34, 92, 92 * logo.PixelHeight / (double)logo.PixelWidth);
            var right = new XRect(Margin + 120, 38, Width - 120, 12);
            graphics.DrawString("CONTRATO DE SERVICIOS DE ASISTENCIA EN TIERRA", label, new XSolidBrush(Muted), right, XStringFormats.TopRight);
            right.Offset(0, 14);
            graphics.DrawString(document.ContractCode, title, new XSolidBrush(Navy), right, XStringFormats.TopRight);
            right.Offset(0, 24);
            graphics.DrawString($"Versión {document.VersionNumber} · {VersionStatus(document.VersionStatus)}", small,
                new XSolidBrush(draft ? Orange : Muted), right, XStringFormats.TopRight);
            graphics.DrawRectangle(new XSolidBrush(Navy), Margin, 98, Width, 2.2);
            graphics.DrawRectangle(new XSolidBrush(Orange), Margin, 100.2, Width * 0.28, 2.2);
            y = 116;
        }

        public void Parties(ContractDocumentData document)
        {
            var column = (Width - 14) / 2;
            var boxes = new[]
            {
                ("EL PRESTADOR", "AVIAM", "Operador de servicios de asistencia en tierra"),
                ("LA AEROLÍNEA", document.AirlineLegalName ?? document.AirlineName,
                    $"{document.AirlineName} · código {document.AirlineCode}"),
            };
            for (var index = 0; index < boxes.Length; index++)
            {
                var (caption, name, detail) = boxes[index];
                var x = Margin + index * (column + 14);
                graphics.DrawRectangle(new XSolidBrush(Tint), x, y, column, 58);
                graphics.DrawRectangle(new XSolidBrush(index == 0 ? Navy : Orange), x, y, 3, 58);
                graphics.DrawString(caption, label, new XSolidBrush(Muted), new XRect(x + 12, y + 9, column - 20, 10), XStringFormats.TopLeft);
                graphics.DrawString(Fit(name, bodyBold, column - 20), bodyBold, new XSolidBrush(Navy),
                    new XRect(x + 12, y + 22, column - 20, Line), XStringFormats.TopLeft);
                graphics.DrawString(Fit(detail, small, column - 20), small, new XSolidBrush(Muted),
                    new XRect(x + 12, y + 37, column - 20, Line), XStringFormats.TopLeft);
            }
            y += 70;
        }

        public void Summary(ContractDocumentData document)
        {
            var cards = new[]
            {
                ("VIGENCIA", $"{document.ValidFrom.ToString("dd/MM/yyyy", Spanish)} – " +
                    (document.ValidTo?.ToString("dd/MM/yyyy", Spanish) ?? "sin vencimiento")),
                ("MONEDA", document.CurrencyCode),
                ("ESTACIONES", document.Stations.Count == 1 ? "1 estación" : $"{document.Stations.Count} estaciones"),
                ("SERVICIOS", document.Rates.Count == 1 ? "1 tarifa" : $"{document.Rates.Count} tarifas"),
            };
            // The validity card is wider so both dates fit.
            var shares = new[] { 0.34, 0.18, 0.24, 0.24 };
            var x = Margin;
            for (var index = 0; index < cards.Length; index++)
            {
                var width = shares[index] * (Width - 3 * 10);
                if (index > 0) x += shares[index - 1] * (Width - 3 * 10) + 10;
                graphics.DrawRectangle(new XPen(Rule, 0.7), x, y, width, 42);
                graphics.DrawString(cards[index].Item1, label, new XSolidBrush(Muted), new XRect(x + 9, y + 8, width - 18, 10), XStringFormats.TopLeft);
                graphics.DrawString(Fit(cards[index].Item2, bodyBold, width - 18), bodyBold, new XSolidBrush(Navy),
                    new XRect(x + 9, y + 21, width - 18, Line), XStringFormats.TopLeft);
            }
            y += 54;
        }

        /// <summary>A numbered subsection inside a section (3.1, 3.2).</summary>
        public void SubHeading(string number, string text)
        {
            Ensure(Line * 3);
            y += 4;
            graphics.DrawString($"{number} {text}", bodyBold, new XSolidBrush(Navy), new XRect(Margin, y, Width, Line),
                XStringFormats.TopLeft);
            y += Line + 4;
        }

        public void Heading(string number, string text)
        {
            Ensure(Line * 4);
            y += 8;
            graphics.DrawRectangle(new XSolidBrush(Orange), Margin, y + 2, 3, 13);
            graphics.DrawString($"{number}. {text}", heading, new XSolidBrush(Navy), new XRect(Margin + 10, y, Width - 10, 16), XStringFormats.TopLeft);
            y += 22;
        }

        public void Paragraph(string text, XColor? color = null, bool monospace = false, bool small = false)
        {
            var font = monospace || small ? this.small : body;
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

        /// <summary>Each non-empty line of the terms becomes a numbered clause (4.1, 4.2, …).</summary>
        public void Clauses(string section, string? terms)
        {
            var clauses = (terms ?? string.Empty).Replace("\r\n", "\n").Split('\n')
                .Select(item => item.Trim()).Where(item => item.Length > 0).ToArray();
            if (clauses.Length == 0)
            {
                Paragraph("Sin términos particulares.", Muted);
                return;
            }
            for (var index = 0; index < clauses.Length; index++)
            {
                var number = $"{section}.{index + 1}";
                var lines = Wrap(clauses[index], body, Width - 30);
                for (var line = 0; line < lines.Count; line++)
                {
                    Ensure(Line);
                    if (line == 0)
                        graphics.DrawString(number, bodyBold, new XSolidBrush(Navy), new XRect(Margin, y, 28, Line), XStringFormats.TopLeft);
                    graphics.DrawString(lines[line], body, XBrushes.Black, new XRect(Margin + 30, y, Width - 30, Line), XStringFormats.TopLeft);
                    y += Line;
                }
                y += 5;
            }
        }

        public void Table(IReadOnlyList<Column> columns, IReadOnlyList<IReadOnlyList<string>> rows)
        {
            var widths = columns.Select(column => column.Share * Width).ToArray();
            void Row(IReadOnlyList<string> cells, XFont font, XColor color, XColor? fill)
            {
                var wrapped = cells.Select((cell, index) => Wrap(cell, font, widths[index] - 12)).ToArray();
                var height = wrapped.Max(lines => lines.Count) * Line + 8;
                Ensure(height);
                if (fill is { } background) graphics.DrawRectangle(new XSolidBrush(background), Margin, y, Width, height);
                var x = Margin;
                for (var column = 0; column < cells.Count; column++)
                {
                    var format = columns[column].AlignRight ? XStringFormats.TopRight : XStringFormats.TopLeft;
                    var cellColor = cells[column] == "Por definir" ? Orange : color;
                    for (var line = 0; line < wrapped[column].Count; line++)
                        graphics.DrawString(wrapped[column][line], font, new XSolidBrush(cellColor),
                            new XRect(x + 6, y + 4 + line * Line, widths[column] - 12, Line), format);
                    x += widths[column];
                }
                y += height;
            }
            Row(columns.Select(column => column.Title).ToArray(), smallBold, XColors.White, Navy);
            if (rows.Count == 0) Paragraph("Sin tarifas pactadas en esta versión.", Muted);
            for (var index = 0; index < rows.Count; index++)
                Row(rows[index], body, XColors.Black, index % 2 == 1 ? Tint : null);
            graphics.DrawLine(new XPen(Rule, 0.7), Margin, y, Margin + Width, y);
            y += 8;
        }

        public void Fingerprint(string sha256)
        {
            Ensure(34);
            graphics.DrawRectangle(new XSolidBrush(Tint), Margin, y, Width, 30);
            graphics.DrawString("HUELLA SHA-256 DEL CONTENIDO", label, new XSolidBrush(Muted), new XRect(Margin + 10, y + 5, Width - 20, 10), XStringFormats.TopLeft);
            graphics.DrawString(sha256, small, new XSolidBrush(Navy), new XRect(Margin + 10, y + 16, Width - 20, 10), XStringFormats.TopLeft);
            y += 40;
        }

        public void Signatures(ContractDocumentData document)
        {
            Ensure(162);
            var column = (Width - 20) / 2;
            var top = y;
            var parties = new[] { ("Aviam", "POR AVIAM (EL PRESTADOR)"), ("Airline", $"POR {document.AirlineName.ToUpper(Spanish)} (LA AEROLÍNEA)") };
            for (var index = 0; index < parties.Length; index++)
            {
                var (party, caption) = parties[index];
                var x = Margin + index * (column + 20);
                var signature = document.Signatures.FirstOrDefault(item => item.Party == party);
                graphics.DrawRectangle(new XPen(Rule, 0.8), x, top, column, 144);
                graphics.DrawString(Fit(caption, label, column - 90), label, new XSolidBrush(Muted),
                    new XRect(x + 10, top + 10, column - 90, 10), XStringFormats.TopLeft);
                var signed = signature is not null;
                var chip = signed ? "FIRMADO" : "PENDIENTE";
                var chipWidth = graphics.MeasureString(chip, label).Width + 14;
                graphics.DrawRoundedRectangle(new XSolidBrush(signed ? Success : Muted), x + column - chipWidth - 10, top + 7, chipWidth, 14, 6, 6);
                graphics.DrawString(chip, label, XBrushes.White, new XRect(x + column - chipWidth - 10, top + 10, chipWidth, 10), XStringFormats.TopCenter);
                // ADR-0025: the drawn signature sits above the signer's name.
                var offset = 0.0;
                if (signature?.Image is { Length: > 0 } png)
                {
                    using var image = XImage.FromStream(new MemoryStream(png));
                    var height = 34.0;
                    var width = Math.Min(column - 20, height * image.PixelWidth / Math.Max(1.0, image.PixelHeight));
                    graphics.DrawImage(image, x + 10, top + 34, width, height);
                    offset = height + 2;
                }
                var lines = signature is null
                    ? new[] { ("Pendiente de firma.", Muted, body) }
                    : new[]
                    {
                        (signature.SignerName, Navy, bodyBold),
                        (signature.SignerTitle, XColors.Black, body),
                        ($"{signature.SignedAt.ToUniversalTime().ToString("dd/MM/yyyy HH:mm", Spanish)} UTC", Muted, small),
                        signature.DocumentSha256 == document.ContentSha256
                            ? ("Huella coincidente con este documento.", Success, small)
                            : ("Atención: firmó un contenido distinto.", Orange, small),
                    };
                graphics.DrawLine(new XPen(Rule, 0.6), x + 10, top + 30, x + column - 10, top + 30);
                for (var line = 0; line < lines.Length; line++)
                    graphics.DrawString(Fit(lines[line].Item1, lines[line].Item3, column - 20), lines[line].Item3,
                        new XSolidBrush(lines[line].Item2), new XRect(x + 10, top + 40 + offset + line * Line, column - 20, Line), XStringFormats.TopLeft);
            }
            y = top + 156;
            // 2-N05: the date of this version's second signature, not the day the contract first activated.
            if (document.SignedOn is { } signedOn)
                Paragraph($"Versión firmada por ambas partes el {Date(signedOn)}.", Navy);
        }

        /// <summary>Draws the footer («Página X de Y») and, for drafts, the watermark on every page.</summary>
        public void Finish(ContractDocumentData document, bool draft, DateTimeOffset generatedAt)
        {
            graphics.Dispose();
            var stamp = $"Generado el {generatedAt.ToUniversalTime().ToString("dd/MM/yyyy HH:mm", Spanish)} UTC";
            var reference = $"ELEVANT · AVIAM · {document.ContractCode} v{document.VersionNumber}" + (draft ? " · BORRADOR" : string.Empty);
            for (var index = 0; index < pdf.PageCount; index++)
            {
                var current = pdf.Pages[index];
                using var overlay = XGraphics.FromPdfPage(current, XGraphicsPdfPageOptions.Append);
                var width = current.Width.Point - 2 * Margin;
                var bottom = current.Height.Point - 44;
                overlay.DrawLine(new XPen(Rule, 0.6), Margin, bottom - 6, Margin + width, bottom - 6);
                var area = new XRect(Margin, bottom, width, 12);
                overlay.DrawString(reference, small, new XSolidBrush(Muted), area, XStringFormats.TopLeft);
                overlay.DrawString(stamp, small, new XSolidBrush(Muted), new XRect(Margin, bottom + 11, width, 12), XStringFormats.TopLeft);
                overlay.DrawString($"Página {index + 1} de {pdf.PageCount}", smallBold, new XSolidBrush(Navy), area, XStringFormats.TopRight);
                if (!draft) continue;
                var center = new XPoint(current.Width.Point / 2, current.Height.Point / 2);
                overlay.Save();
                overlay.RotateAtTransform(-35, center);
                var ink = new XSolidBrush(XColor.FromArgb(46, 255, 92, 0));
                overlay.DrawString("BORRADOR", watermark, ink, new XRect(center.X - 300, center.Y - 60, 600, 80), XStringFormats.Center);
                overlay.DrawString("NO VÁLIDO PARA FIRMA", watermarkNote, ink, new XRect(center.X - 300, center.Y + 18, 600, 30), XStringFormats.Center);
                overlay.Restore();
            }
        }

        private void Ensure(double height)
        {
            if (y + height <= page.Height.Point - 60) return;
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

        private string Fit(string text, XFont font, double width)
        {
            if (graphics.MeasureString(text, font).Width <= width) return text;
            while (text.Length > 1 && graphics.MeasureString(text + "…", font).Width > width) text = text[..^1];
            return text + "…";
        }

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
