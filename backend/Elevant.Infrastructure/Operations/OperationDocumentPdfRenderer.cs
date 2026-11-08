using System.Globalization;
using Elevant.Application.Common;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Finance;
using PdfSharp.Drawing;
using PdfSharp.Pdf;

namespace Elevant.Infrastructure.Operations;

/// <summary>
/// AVIAM's paper forms drawn from the operation's single record (ADR-0032): Orden de Servicio en
/// Rampa, Reporte de Vuelo and Check-List/Reporte Diario del Puente. Same sections, wording, codes
/// and revisions as the paper; signatures are the strokes drawn on the tablet, and the footer
/// prints the SHA-256 of the content they signed. A Service Order OCC corrected after the signature
/// (3-N02) prints its corrections and the version its signatures were drawn on. Times are the
/// station's local time (BusinessCalendar).
/// </summary>
public sealed class OperationDocumentPdfRenderer(TimeProvider? timeProvider = null) : IOperationDocumentPdfRenderer
{
    private const double Margin = 34;
    private static readonly CultureInfo Spanish = CultureInfo.GetCultureInfo("es-DO");
    private static readonly XColor Navy = XColor.FromArgb(8, 27, 58);
    private static readonly XColor Orange = XColor.FromArgb(240, 128, 0);
    private static readonly XColor Muted = XColor.FromArgb(77, 93, 118);
    private static readonly XColor Rule = XColor.FromArgb(120, 130, 145);
    private static readonly XColor Tint = XColor.FromArgb(244, 247, 251);
    private static readonly XColor Mark = XColor.FromArgb(200, 30, 30);

    static OperationDocumentPdfRenderer() => ElevantPdfFontResolver.EnsureRegistered();

    public byte[] Render(OperationDocumentContent content, string contentSha256,
        IReadOnlyList<OperationDocumentSignatureData> signatures, IReadOnlyDictionary<Guid, DamagePhoto> damagePhotos,
        IReadOnlyList<OperationDocumentCorrectionData>? corrections = null)
    {
        ArgumentNullException.ThrowIfNull(content);
        var corrected = content.Kind == OperationDocumentKind.ServiceOrder ? corrections ?? [] : [];
        using var pdf = new PdfDocument();
        pdf.Info.Title = $"{content.Title} · {content.Number}";
        pdf.Info.Author = "AVIAM Ltd. · ELEVANT";
        pdf.Info.Subject = content.FormCode;
        var writer = new Writer(pdf, content, BusinessCalendar.Zone(content.Flight.StationTimeZone));
        switch (content.Kind)
        {
            case OperationDocumentKind.ServiceOrder: writer.ServiceOrder(signatures, corrected); break;
            case OperationDocumentKind.FlightReport: writer.FlightReport(signatures, damagePhotos); break;
            case OperationDocumentKind.CharterServiceRequest: writer.CharterServiceRequest(signatures); break;
            default: writer.BridgeChecklist(signatures); break;
        }
        writer.Finish(contentSha256, signatures, (timeProvider ?? TimeProvider.System).GetUtcNow(), corrected.Count > 0);
        using var output = new MemoryStream();
        pdf.Save(output, false);
        return output.ToArray();
    }

    private static readonly string[] PaperLeft =
    [
        "BLOCK_ON", "STAIRS_JETBRIDGE", "SECOND_STAIRS", "UNLOADING_EQUIPMENT", "FIRST_CUSTOMS", "LAST_CUSTOMS", "BOARDING",
        "CARGO_DOOR_CLOSED", "BULK_CLOSED", "PAX_DOOR_CLOSED", "STAIRS_JETBRIDGE_REMOVED", "PUSHBACK",
    ];

    private static readonly string[] PaperRight =
    [
        "UNLOAD_SHEET", "LOAD_SHEET", "COMMERCIAL_CARGO", "FIRST_MAKEUP", "LAST_MAKEUP", "FIRST_LOADING", "LAST_LOADING",
        "LAVATORY_SERVICE", "POTABLE_WATER", "AMBULIFT", "DNCD",
    ];

    private sealed class Writer
    {
        // 2-D: the complete Unicode Noto Sans faces of every ELEVANT PDF (ElevantPdfFonts).
        private readonly XFont body = ElevantPdfFonts.Regular(8.5);
        private readonly XFont bold = ElevantPdfFonts.Bold(8.5);
        private readonly XFont small = ElevantPdfFonts.Regular(7);
        private readonly XFont smallBold = ElevantPdfFonts.Bold(7);
        private readonly XFont tiny = ElevantPdfFonts.Regular(5.8);
        private readonly XFont band = ElevantPdfFonts.Bold(8.5);
        private readonly XFont brand = ElevantPdfFonts.Bold(24);
        private readonly XFont title = ElevantPdfFonts.Bold(13);
        private readonly PdfDocument pdf;
        private readonly OperationDocumentContent content;
        private readonly TimeZoneInfo zone;
        private PdfPage page = null!;
        private XGraphics graphics = null!;
        private double y;

        public Writer(PdfDocument pdf, OperationDocumentContent content, TimeZoneInfo zone)
        {
            this.pdf = pdf;
            this.content = content;
            this.zone = zone;
            NewPage();
        }

        private double Width => page.Width.Point - 2 * Margin;
        private double Bottom => page.Height.Point - 52;
        private DocumentFlightHeader Flight => content.Flight;

        // ───────────────────────── Orden de Servicio ─────────────────────────
        public void ServiceOrder(IReadOnlyList<OperationDocumentSignatureData> signatures,
            IReadOnlyList<OperationDocumentCorrectionData> corrections)
        {
            Header("ORDEN DE SERVICIO EN RAMPA / RAMP ORDER SERVICE",
                [("Estación / Station", Flight.StationName), ("Número / Number", content.Number)]);
            Band("Información General / General Information");
            Grid([
                ("Aerolínea-Cliente / Airline-Client", Airline()), ("Operador / Operator", Flight.AirlineName),
                ("Número de Vuelo Entrante / Flight Number In", Flight.FlightIn), ("Procedencia / Origin", Flight.Origin),
                ("Fecha y Hora de Llegada / Date Arrival Time", Time(Flight.ArrivalAt)),
                ("Número de Vuelo Saliente / Flight Number Out", Flight.FlightOut),
                ("Destino / Destination", Flight.Destination),
                ("Fecha y Hora de Salida / Date Departure Time", Time(Flight.DepartureAt)),
                ("Tipo de Aeronave / Aircraft Type", Flight.AircraftType), ("Matrícula / Registration", Flight.Registration),
                ("Posición / Position", Flight.Position),
                ("Cantidad de Pasajeros Llegados / Pax In", Flight.PassengersIn?.ToString(Spanish)),
                ("Cantidad de Pasajeros Salientes / Pax Out", Flight.PassengersOut?.ToString(Spanish)),
                ("Peso Despegue en Libras / MTOW", Mtow()),
                ("Vuelo Regular / Regular Flight", content.Charter is null ? "X" : string.Empty),
                ("Vuelo Charter / Charter Flight", content.Charter is null ? string.Empty : "X"),
            ]);
            Band("Servicios / Services");
            var currency = content.CurrencyCode ?? "USD";
            Table([("Descripción / Description", 0.52, false), ("Unid-Hrs", 0.14, true), ($"Costo / Cost ({currency})", 0.17, true),
                    ($"Total ({currency})", 0.17, true)],
                content.Services.Select(line => (IReadOnlyList<string>)
                [
                    $"{line.Name} ({line.Code})", $"{line.Quantity.ToString("0.##", Spanish)} {Unit(line.Unit)}",
                    line.UnitPrice?.ToString("N2", Spanish) ?? "—", line.Amount?.ToString("N2", Spanish) ?? "—",
                ]).ToArray(), "Sin servicios registrados.");
            if (content.Surcharges.Count > 0)
                Lines("Recargos / Surcharges: " + string.Join("; ",
                    content.Surcharges.Select(item => $"{item.Name} ({item.Code}) sobre {item.ServiceCode}")), small);
            Row([("Monto Total / Total Amount", 0.66), (content.TotalAmount is decimal total
                ? $"{currency} {total.ToString("N2", Spanish)}" : "Pendiente de valoración", 0.34)], highlight: true);
            Row([("Tipo de Factura / Billing Type", 0.4), ((content.BillingType == "Cash" ? "[X]" : "[  ]") + " De Contado / Cash", 0.3),
                ((content.BillingType == "Cash" ? "[  ]" : "[X]") + " A Crédito / Credit", 0.3)]);
            Band("Observaciones / Remarks");
            Lines(content.Observations.Count == 0 ? "—" : string.Join(" · ", content.Observations), body);
            y += 4;
            foreach (var clause in new[]
            {
                "El firmante, actuando en nombre y representación de la aerolínea antes citada, certifica que la Aerolínea " +
                "reconoce y acepta todos los términos y condiciones de responsabilidad e indemnización establecidas en el " +
                "Acuerdo Estándar, para la prestación de los Servicios de Rampa de IATA.",
                "Se aplicará cargo adicional de 15% a operaciones de vuelos entre las 22:00 y 05:59.",
                "Cargo adicional de 15% en operaciones de vuelos entre 06:00 y 21:59 los domingos y festivos. Todos los cargos " +
                "y tasas establecidos en USD (Dólares de los Estados Unidos de América).",
                "En caso de que el monto sea pagado en efectivo, este formulario constituye una factura.",
            })
                Lines("•  " + clause, small);
            SignatureBoxes(signatures, [(OperationSignatureRole.AirlineRepresentative, "Cliente / Airline Client"),
                (OperationSignatureRole.AviamAgent, "Aviam Ltd. · Responsable / Responsible")]);
            if (corrections.Count > 0) Corrections(signatures, corrections);
        }

        /// <summary>
        /// 3-N02: what OCC changed after the airline and AVIAM signed, with its reason, time and author; the signatures
        /// above were drawn on the version of the day they show.
        /// </summary>
        private void Corrections(IReadOnlyList<OperationDocumentSignatureData> signatures,
            IReadOnlyList<OperationDocumentCorrectionData> corrections)
        {
            y += 6;
            Band("Corregida por OCC después de la firma / Corrected by OCC after signature");
            foreach (var correction in corrections)
                Lines($"{Time(correction.CorrectedAt)} · {correction.CorrectedBy}: {correction.Reason}", body);
            if (signatures.Count > 0)
                Lines($"Las firmas se hicieron sobre la versión del {Time(signatures.Min(item => item.SignedAt))}, " +
                    "antes de la corrección de OCC.", small);
        }

        // ───────────────────────── Reporte de Vuelo ─────────────────────────
        public void FlightReport(IReadOnlyList<OperationDocumentSignatureData> signatures,
            IReadOnlyDictionary<Guid, DamagePhoto> photos)
        {
            Header("REPORTE DE VUELO", [("Número", content.Number)]);
            Band("INFORMACIÓN GENERAL");
            var at = content.Milestones.ToDictionary(item => item.Code, item => item.At);
            Grid([
                ("Fecha", Flight.OperationDate.ToString("dd/MM/yyyy", Spanish)), ("Posición", Flight.Position),
                ("Aerolínea", Airline()), ("Supervisor", null),
                ("Vuelo", Flights()), ("Encargado", Flight.AgentName),
                ("Tipo de Aeronave", Flight.AircraftType), ("Inicio Inspección", Clock(at, "WALKAROUND_START")),
                ("Matrícula", Flight.Registration), ("Término Inspección", Clock(at, "WALKAROUND_END")),
            ]);
            Checklist("LLEGADA DE AERONAVE", content.Checklist.Where(item => item.ItemCode.StartsWith("ARR-", StringComparison.Ordinal)));
            Band("OPERACIÓN EN POSICIÓN");
            InPosition(at);
            Row([("ALTDS / IATA DELAYS", 0.3), (content.Delays.Count == 0 ? "—"
                : string.Join("; ", content.Delays.Select(delay => $"{delay.Code} · {delay.Description}")), 0.7)]);
            if (content.Damages.Count > 0)
                Lines("Anomalías marcadas en el walk-around: " + string.Join("; ",
                    content.Damages.Select((damage, index) => $"{index + 1}. {damage.Note}" +
                        (photos.ContainsKey(damage.Id) ? " (foto adjunta)" : string.Empty))), small);
            Checklist("RETROEMPUJE DE AERONAVE", content.Checklist.Where(item => item.ItemCode.StartsWith("PUSH-", StringComparison.Ordinal)));
            Band("OBSERVACIONES GENERALES");
            Lines(content.Observations.Count == 0 ? "—" : string.Join(" · ", content.Observations), body);
            SignatureBoxes(signatures, [(OperationSignatureRole.Coordinator, "Nombre Coordinador")]);
            if (photos.Count > 0) Photos(photos);
        }

        // ──────────────────── Check-List y Reporte Diario Puente ────────────────────
        // ─────────── Solicitud de Servicio y Descargo de Responsabilidad (charter, ADR-0033) ───────────
        /// <summary>Page 1 exactly as AVIAM's form; the services served are ticked on its fixed list.</summary>
        public void CharterServiceRequest(IReadOnlyList<OperationDocumentSignatureData> signatures)
        {
            var charter = content.Charter;
            graphics.DrawString("AVIAM", brand, new XSolidBrush(Navy), Margin, y + 22);
            graphics.DrawString("Ltd.", small, new XSolidBrush(Navy), Margin + 86, y + 22);
            foreach (var (line, offset) in new[]
            {
                ("SOLICITUD DE SERVICIO Y DESCARGO DE RESPONSABILIDAD E INDEMNIZACION /", 4.0),
                ("SERVICE REQUEST AND RELEASE AND WAIVER OF LIABILITY AND INDEMNITY", 16.0),
            })
                Fit(line, bold, new XSolidBrush(Navy), Margin + 130, y + offset, Width - 130);
            y += 34;
            graphics.DrawLine(new XPen(Rule, 0.8), Margin, y, Margin + Width, y);
            y += 10;
            Band("INFORMACION GENERAL/GENERAL INFORMATION");
            StackedGrid([
                ("Aerolínea / Carrier:", Airline()), ("Estación / Station:", charter?.StationLabel),
                ("Dirección / Address:", charter?.CarrierAddress), ("Tipo  de Aeronave /Type Of Aircraft:", Flight.AircraftType),
                ("Vuelo No. / Flight No.:", Flights()), ("Matrícula de Aeronave / Aircraft Registration:", Flight.Registration),
                ("No. de la Nota de Cargo / Charge Note Number:", content.Number),
                ("Cargos pagaderos por / Charges payable by:", charter?.ChargesPayableBy ?? Airline()),
            ]);
            TwoLineHeads(("FECHA-HORA LOCAL DE LLEGADA/", "DATE-LOCAL TIME OF ARRIVAL"),
                ("FECHA-HORA LOCAL DE SALIDA/", "DATE-LOCAL TIME OF DEPARTURE"));
            StackedGrid([
                ("Fecha-Hora Itinerario / Date-Time Schedule", Time(Flight.ArrivalAt)),
                ("Fecha-Hora Itinerario / Date-Time Schedule:", Time(Flight.DepartureAt)),
                ("Fecha-Hora Real /  Date-Time Actual:", ActualTime("BLOCK_ON")),
                ("Fecha-Hora Real / Date-Time Actual:", ActualTime("PUSHBACK")),
            ]);
            Band("LISTA DE LOS SERVICIOS PROVISTOS PARA FINES CONTABLES /LIST OF SERVICES RENDERED AND FOR ACCOUNTING PURPOSES");
            var served = content.Services.Select(line => line.Code.ToUpperInvariant()).ToArray();
            var matched = new HashSet<string>(StringComparer.Ordinal);
            bool Ticked(params string[] tokens)
            {
                var hits = served.Where(code => tokens.Any(token => code.Contains(token, StringComparison.Ordinal))).ToArray();
                foreach (var hit in hits) matched.Add(hit);
                return hits.Length > 0;
            }
            (string Label, bool Ticked)[] left =
            [
                ("Escalera Pasajero/ Passenger Stairs", Ticked("STAIR")),
                ("Correa de Equipaje Motorizada/Cargoveyor", Ticked("CONVEYOR", "BELT")),
                ("Elevador de Carga/Loader", Ticked("LOADER")),
                ("Tractor", Ticked("TOW", "TRACTOR", "PUSH")),
                ("Carro de Equipaje/Baggage Cart-Dollies", Ticked("BAGGAGE", "CART", "DOLL")),
                ("Limpieza de Cabina/ Cabin Cleaning", Ticked("CLEAN")),
                ("Servicio de Agua Potable/Potable Water", Ticked("WATER")),
                ("Servicio a los Baños/Lavatory", Ticked("LAV", "TOILET")),
            ];
            (string Label, bool Ticked)[] right =
            [
                ("Energía Eléctrica/ Ground Power Unit (GPU)", Ticked("GPU")),
                ("Aire Acondicionado/Air Conditioning (ACU)", Ticked("ACU", "-AC")),
                ("Aire Neumático/Air Starter (ASU)", Ticked("ASU")),
                ("Ascensor Pasajeros Discapacitados/Disabled Passenger Lift", Ticked("LIFT", "AMBU")),
                ("Uso de Escalera por Pasajero Discapacitados/ Use of Stair by Disabled Passenger", Ticked("PRM")),
            ];
            var others = content.Services.Where(line => !matched.Contains(line.Code.ToUpperInvariant()))
                .Select(line => line.Name).ToArray();
            const double rowHeight = 12;
            var rows = Math.Max(left.Length, right.Length + 1);
            Ensure(rows * rowHeight + 8);
            var top = y + 4;
            graphics.DrawRectangle(new XPen(Rule, 0.5), Margin, y, Width, rows * rowHeight + 8);
            graphics.DrawLine(new XPen(Rule, 0.5), Margin + Width / 2, y, Margin + Width / 2, y + rows * rowHeight + 8);
            void Box(double x, double rowTop, string label, bool ticked)
            {
                graphics.DrawRectangle(new XPen(Navy, 0.7), x, rowTop + 1.5, 7, 7);
                if (ticked) graphics.DrawString("X", smallBold, new XSolidBrush(Navy), x + 1.2, rowTop + 7.8);
                // The form prints every service in full; a long one uses a smaller size rather than an ellipsis.
                var font = graphics.MeasureString(label, small).Width <= Width / 2 - 30 ? small : tiny;
                Fit(label, font, XBrushes.Black, x + 12, rowTop + (font == small ? 0 : 0.6), Width / 2 - 24);
            }
            for (var index = 0; index < left.Length; index++)
                Box(Margin + 8, top + index * rowHeight, left[index].Label, left[index].Ticked);
            for (var index = 0; index < right.Length; index++)
                Box(Margin + Width / 2 + 8, top + index * rowHeight, right[index].Label, right[index].Ticked);
            Box(Margin + Width / 2 + 8, top + right.Length * rowHeight,
                "Otro/Other " + (others.Length == 0 ? "______________________" : string.Join(", ", others)), others.Length > 0);
            y += rows * rowHeight + 12;
            foreach (var clause in new[]
            {
                "El firmante, actuando en nombre y representación de la Aerolínea antes citada, por este medio certifica que la " +
                "Aerolínea reconoce y acepta todos los términos y condiciones de responsabilidad e indemnización establecidas en el " +
                "Acuerdo Estándar de IATA 2018, con modificaciones, utilizado por AVIAM, LTD., para la prestación de los servicios " +
                "de rampa. Véase página 2.",
                "The undersigned, acting on behalf and in representation of the above referenced Carrier, hereby certifies that " +
                "the Carrier recognizes and accepts the terms and conditions of liability and indemnity as provided in the 2018 " +
                "IATA Standard Ground Handling Agreement, with modifications, with AVIAM, LTD. for ground handling services. " +
                "See page 3.",
            })
            {
                Lines(clause, small);
                y += 3;
            }
            CharterSignatures(signatures);
            TermsNote();
        }

        /// <summary>Cells as on the charter form: the label on top, the value below across the cell.</summary>
        private void StackedGrid(IReadOnlyList<(string Label, string? Value)> cells)
        {
            const double height = 24;
            for (var index = 0; index < cells.Count; index += 2)
            {
                Ensure(height);
                for (var column = 0; column < 2 && index + column < cells.Count; column++)
                {
                    var (label, value) = cells[index + column];
                    var x = Margin + column * Width / 2;
                    graphics.DrawRectangle(new XPen(Rule, 0.5), x, y, Width / 2, height);
                    Fit(label, small, XBrushes.Black, x + 3, y + 2, Width / 2 - 6);
                    graphics.DrawRectangle(new XSolidBrush(Tint), x + 3, y + 11, Width / 2 - 6, 11);
                    Fit(string.IsNullOrWhiteSpace(value) ? string.Empty : value, bold, new XSolidBrush(Navy), x + 5, y + 12,
                        Width / 2 - 10);
                }
                y += height;
            }
        }

        private void TwoLineHeads((string First, string Second) left, (string First, string Second) right)
        {
            const double height = 20;
            Ensure(height);
            foreach (var (head, column) in new[] { (left, 0), (right, 1) })
            {
                var x = Margin + column * Width / 2;
                graphics.DrawRectangle(new XPen(Rule, 0.5), new XSolidBrush(Tint), x, y, Width / 2, height);
                graphics.DrawString(head.First, smallBold, XBrushes.Black, new XRect(x, y + 2, Width / 2, 9), XStringFormats.TopCenter);
                graphics.DrawString(head.Second, smallBold, XBrushes.Black, new XRect(x, y + 10.5, Width / 2, 9),
                    XStringFormats.TopCenter);
            }
            y += height;
        }

        private void CharterSignatures(IReadOnlyList<OperationDocumentSignatureData> signatures)
        {
            const double height = 150;
            Ensure(height + 4);
            y += 4;
            var half = Width / 2;
            (OperationSignatureRole Role, string Caption, string NameLabel, string IdLabel, string SealLabel)[] columns =
            [
                (OperationSignatureRole.AirlineRepresentative,
                    "Firma de aceptación por parte de la Aerolínea a los términos y condiciones referidos / Signature of " +
                    "acceptance by the Carrier for the terms and conditions previously stated.",
                    "Nombre del representante en letras de molde / Name of the representative in bold letters",
                    "Número de Cédula o Pasaporte del Representante / ID or Passport number of the representative",
                    "Sello de la Aerolínea/ Airline Seal"),
                (OperationSignatureRole.AviamAgent,
                    "Firma del representante de AVIAM, Ltd. / Signature of AVIAM, Ltd. representative",
                    "Nombre del representante de AVIAM LTD en letras de  molde / Name of the representative of the Carrier in bold letters",
                    "Número de Cédula o Pasaporte del Representante de AVIAM / ID or Passport number of the AVIAM representative",
                    "Sello AVIAM/ AVIAMSeal"),
            ];
            graphics.DrawRectangle(new XPen(Rule, 0.5), Margin, y, Width, height);
            graphics.DrawLine(new XPen(Rule, 0.5), Margin + half, y, Margin + half, y + height);
            for (var index = 0; index < columns.Length; index++)
            {
                var column = columns[index];
                var x = Margin + index * half + 5;
                var columnWidth = half - 10;
                var signature = signatures.FirstOrDefault(item => item.Role == column.Role);
                var top = y + 2;
                foreach (var line in Wrap(column.Caption, smallBold, columnWidth))
                {
                    graphics.DrawString(line, smallBold, XBrushes.Black, x, top + 7);
                    top += 8.5;
                }
                var area = new XRect(x, top + 2, columnWidth, 28);
                if (signature is not null) DrawStrokes(signature, area);
                top += 32;
                graphics.DrawLine(new XPen(Rule, 0.5), x, top, x + columnWidth, top);
                foreach (var (label, value) in new[]
                {
                    (column.NameLabel, signature?.SignerName.ToUpper(Spanish)),
                    (column.IdLabel, signature?.SignerIdentification),
                })
                {
                    foreach (var line in Wrap(label, smallBold, columnWidth))
                    {
                        graphics.DrawString(line, smallBold, XBrushes.Black, x, top + 8);
                        top += 8.5;
                    }
                    graphics.DrawRectangle(new XSolidBrush(Tint), x, top + 1, columnWidth, 12);
                    graphics.DrawString(value ?? string.Empty, bold, new XSolidBrush(Navy), x + 3, top + 10);
                    top += 15;
                }
                graphics.DrawString(column.SealLabel, smallBold, XBrushes.Black, x, top + 8);
                if (signature is not null)
                    graphics.DrawString("Firmado en ELEVANT · " +
                        TimeZoneInfo.ConvertTime(signature.SignedAt, zone).ToString("dd/MM/yyyy HH:mm", Spanish),
                        small, new XSolidBrush(Muted), x, y + height - 4);
            }
            y += height;
        }

        /// <summary>
        /// Pages 2 and 3 of the paper form carry the 2018 IATA SGHA terms with AVIAM's modifications.
        /// Their text was not available; ELEVANT states what they are and never invents them (ADR-0033).
        /// </summary>
        private void TermsNote()
        {
            NewPage();
            Band("PÁGINAS 2 Y 3 · TÉRMINOS Y CONDICIONES / PAGES 2 AND 3 · TERMS AND CONDITIONS");
            y += 6;
            Lines("Los términos y condiciones de responsabilidad e indemnización a los que se refiere la página 1 son los del " +
                "Acuerdo Estándar de Servicios en Tierra de IATA 2018 (SGHA), con las modificaciones utilizadas por AVIAM, Ltd. " +
                "Su texto completo forma parte de este acuerdo en la versión vigente de AVIAM y no se reproduce en este documento " +
                "generado.", body);
            y += 4;
            Lines("The terms and conditions of liability and indemnity referred to on page 1 are those of the 2018 IATA Standard " +
                "Ground Handling Agreement (SGHA), with the modifications used by AVIAM, Ltd. Their full text is part of this " +
                "agreement in AVIAM's current version and is not reproduced in this generated document.", body);
        }

        private void DrawStrokes(OperationDocumentSignatureData signature, XRect area)
        {
            var pen = new XPen(Navy, 1.1) { LineCap = XLineCap.Round, LineJoin = XLineJoin.Round };
            var scale = Math.Min(area.Width / 3, area.Height);
            foreach (var stroke in signature.Strokes)
            {
                var points = new XPoint[stroke.Count / 2];
                for (var point = 0; point < points.Length; point++)
                    points[point] = new XPoint(area.X + (double)stroke[point * 2] * scale * 3,
                        area.Y + (double)stroke[point * 2 + 1] * scale);
                if (points.Length > 1) graphics.DrawLines(pen, points);
            }
        }

        private IEnumerable<string> Wrap(string text, XFont font, double width)
        {
            var line = string.Empty;
            foreach (var word in text.Split(' ', StringSplitOptions.RemoveEmptyEntries))
            {
                var candidate = line.Length == 0 ? word : line + " " + word;
                if (graphics.MeasureString(candidate, font).Width > width && line.Length > 0)
                {
                    yield return line;
                    line = word;
                }
                else line = candidate;
            }
            if (line.Length > 0) yield return line;
        }

        private string? ActualTime(string code) => content.Milestones.FirstOrDefault(item => item.Code == code) is { } milestone
            ? Time(milestone.At) : null;

        public void BridgeChecklist(IReadOnlyList<OperationDocumentSignatureData> signatures)
        {
            Header($"Check-List Diario Puente Abordaje · {Flight.StationName}",
                [("Puente No.", Flight.Position ?? "—"), ("No. de vuelo", Flights())]);
            Grid([
                ("Línea Aérea", Airline()), ("Destino", Flight.Destination),
                ("Fecha", Flight.OperationDate.ToString("dd/MM/yyyy", Spanish)), ("Llave recibida de", null),
            ]);
            Lines("Leyenda: OK Ok · NA No Aplica · NO No Opera", small);
            foreach (var section in content.Checklist.GroupBy(item => item.Section))
                Checklist(section.Key.ToUpper(Spanish), section, bridge: true);
            Band("REPORTE DIARIO PUENTE ABORDAJE (F-MGO-AVL 8.14.1/A2)");
            Lines(content.Observations.Count == 0 ? "Sin observaciones en ninguna fase." : string.Join(" · ", content.Observations), body);
            SignatureBoxes(signatures, [(OperationSignatureRole.BridgeOperator, "Operador")]);
        }

        public void Finish(string sha256, IReadOnlyList<OperationDocumentSignatureData> signatures, DateTimeOffset generatedAt,
            bool corrected = false)
        {
            graphics.Dispose();
            var total = pdf.PageCount;
            for (var index = 0; index < total; index++)
            {
                using var footer = XGraphics.FromPdfPage(pdf.Pages[index], XGraphicsPdfPageOptions.Append);
                var pageWidth = pdf.Pages[index].Width.Point;
                var top = pdf.Pages[index].Height.Point - 44;
                footer.DrawLine(new XPen(Rule, 0.5), Margin, top, pageWidth - Margin, top);
                footer.DrawString($"{content.FormRevision}", small, new XSolidBrush(Muted), Margin, top + 11);
                footer.DrawString("Documento confidencial. Su reproducción y/o distribución debe(n) ser autorizada(s) por AVIAM.",
                    small, new XSolidBrush(Muted), new XRect(Margin, top + 4, pageWidth - 2 * Margin, 10), XStringFormats.TopCenter);
                footer.DrawString($"{content.FormCode}  {index + 1}/{total}", smallBold, new XSolidBrush(Navy),
                    new XRect(Margin, top + 4, pageWidth - 2 * Margin, 10), XStringFormats.TopRight);
                var state = signatures.Count == 0 ? "sin firmas"
                    : corrected ? $"{signatures.Count} firma(s) sobre la versión firmada · corregida por OCC"
                    : $"{signatures.Count} firma(s) sobre esta huella";
                footer.DrawString($"SHA-256 {sha256} · {state} · generado por ELEVANT el " +
                    $"{TimeZoneInfo.ConvertTime(generatedAt, zone).ToString("dd/MM/yyyy HH:mm", Spanish)}",
                    small, new XSolidBrush(Muted), Margin, top + 24);
            }
        }

        private void Header(string formTitle, IReadOnlyList<(string Label, string Value)> boxes)
        {
            graphics.DrawString("AVIAM", brand, new XSolidBrush(Navy), Margin, y + 22);
            graphics.DrawString("Ltd.", small, new XSolidBrush(Navy), Margin + 86, y + 22);
            graphics.DrawString(formTitle, title, new XSolidBrush(Navy),
                new XRect(Margin + 110, y + 4, Width - 110, 16), XStringFormats.TopRight);
            var top = y + 24;
            foreach (var (label, value) in boxes)
            {
                graphics.DrawString($"{label}: ", smallBold, new XSolidBrush(Muted),
                    new XRect(Margin, top, Width - 150, 10), XStringFormats.TopRight);
                graphics.DrawString(value, bold, new XSolidBrush(Navy), new XRect(Margin + Width - 148, top - 1, 148, 11),
                    XStringFormats.TopLeft);
                top += 12;
            }
            y = Math.Max(y + 44, top + 4);
        }

        private void Band(string text)
        {
            Ensure(18);
            graphics.DrawRectangle(new XSolidBrush(Orange), Margin, y, Width, 13);
            // A long bilingual heading shrinks instead of overflowing the band.
            var font = graphics.MeasureString(text, band).Width <= Width - 8 ? band : smallBold;
            graphics.DrawString(text, font, XBrushes.White, new XRect(Margin, y + (font == band ? 1.5 : 2.5), Width, 11),
                XStringFormats.TopCenter);
            y += 13;
        }

        /// <summary>Label/value cells two per row, as on the paper's «Información General».</summary>
        private void Grid(IReadOnlyList<(string Label, string? Value)> cells)
        {
            const double height = 15;
            for (var index = 0; index < cells.Count; index += 2)
            {
                Ensure(height);
                for (var column = 0; column < 2 && index + column < cells.Count; column++)
                {
                    var (label, value) = cells[index + column];
                    var x = Margin + column * Width / 2;
                    var labelWidth = Width / 2 * 0.62;
                    graphics.DrawRectangle(new XPen(Rule, 0.5), new XSolidBrush(Tint), x, y, labelWidth, height);
                    graphics.DrawRectangle(new XPen(Rule, 0.5), x + labelWidth, y, Width / 2 - labelWidth, height);
                    Fit(label, small, XBrushes.Black, x + 3, y + 4, labelWidth - 6);
                    Fit(string.IsNullOrWhiteSpace(value) ? "—" : value, bold, new XSolidBrush(Navy), x + labelWidth + 3, y + 3.5,
                        Width / 2 - labelWidth - 6);
                }
                y += height;
            }
        }

        private void Row(IReadOnlyList<(string Text, double Share)> cells, bool highlight = false)
        {
            const double height = 15;
            Ensure(height);
            var x = Margin;
            foreach (var (text, share) in cells)
            {
                var width = Width * share;
                graphics.DrawRectangle(new XPen(Rule, 0.5), highlight ? new XSolidBrush(Tint) : XBrushes.White, x, y, width, height);
                Fit(text, highlight ? bold : body, new XSolidBrush(Navy), x + 3, y + 3.5, width - 6);
                x += width;
            }
            y += height;
        }

        private void Table(IReadOnlyList<(string Title, double Share, bool Right)> columns, IReadOnlyList<IReadOnlyList<string>> rows,
            string empty)
        {
            const double height = 14;
            void Head()
            {
                var x = Margin;
                foreach (var (text, share, right) in columns)
                {
                    graphics.DrawRectangle(new XPen(Rule, 0.5), new XSolidBrush(Tint), x, y, Width * share, height);
                    graphics.DrawString(text, smallBold, XBrushes.Black, new XRect(x + 3, y + 3.5, Width * share - 6, 10),
                        right ? XStringFormats.TopRight : XStringFormats.TopLeft);
                    x += Width * share;
                }
                y += height;
            }
            Ensure(height * 2);
            Head();
            if (rows.Count == 0) { Row([(empty, 1)]); return; }
            foreach (var row in rows)
            {
                if (y + height > Bottom) { NewPage(); Head(); }
                var x = Margin;
                for (var index = 0; index < columns.Count; index++)
                {
                    var (_, share, right) = columns[index];
                    graphics.DrawRectangle(new XPen(Rule, 0.5), x, y, Width * share, height);
                    if (right)
                        graphics.DrawString(row[index], body, XBrushes.Black, new XRect(x + 3, y + 3, Width * share - 6, 10),
                            XStringFormats.TopRight);
                    else Fit(row[index], body, XBrushes.Black, x + 3, y + 3, Width * share - 6);
                    x += Width * share;
                }
                y += height;
            }
        }

        /// <summary>Numbered items with the paper's answer columns (SI/NO, or ✓/NA/NO on the bridge form).</summary>
        private void Checklist(string heading, IEnumerable<DocumentChecklistAnswer> items, bool bridge = false)
        {
            var rows = items.ToArray();
            const double height = 13;
            string[] answers = bridge ? ["OK", "NA", "NO"] : ["SI", "NO"];
            var answerWidth = 26.0;
            var labelWidth = Width - answers.Length * answerWidth;
            Ensure(height * 2 + 13);
            graphics.DrawRectangle(new XSolidBrush(Orange), Margin, y, Width, 13);
            graphics.DrawString(heading, band, XBrushes.White, new XRect(Margin, y + 1.5, labelWidth, 11), XStringFormats.TopCenter);
            for (var index = 0; index < answers.Length; index++)
                graphics.DrawString(answers[index], band, XBrushes.White,
                    new XRect(Margin + labelWidth + index * answerWidth, y + 1.5, answerWidth, 11), XStringFormats.TopCenter);
            y += 13;
            if (rows.Length == 0) { Row([("Sin respuestas registradas para esta sección.", 1)]); return; }
            var number = 0;
            foreach (var item in rows)
            {
                number++;
                Ensure(height);
                graphics.DrawRectangle(new XPen(Rule, 0.5), Margin, y, labelWidth, height);
                Fit($"{(bridge ? number.ToString("00", Spanish) + "-" : ItemNumber(item.ItemCode))} {item.Label}", body, XBrushes.Black,
                    Margin + 3, y + 2.5, labelWidth - 6);
                var selected = item.Value switch
                {
                    "Ok" => 0,
                    "NotApplicable" => bridge ? 1 : -1,
                    "NotOk" => bridge ? 2 : 1,
                    _ => -1,
                };
                for (var index = 0; index < answers.Length; index++)
                {
                    var x = Margin + labelWidth + index * answerWidth;
                    graphics.DrawRectangle(new XPen(Rule, 0.5), x, y, answerWidth, height);
                    if (index == selected)
                        graphics.DrawString("X", bold, new XSolidBrush(Navy), new XRect(x, y + 2, answerWidth, 10), XStringFormats.TopCenter);
                }
                if (!bridge && item.Value == "NotApplicable")
                    graphics.DrawString("N/A", small, new XSolidBrush(Muted),
                        new XRect(Margin + labelWidth, y + 3, answers.Length * answerWidth, 10), XStringFormats.TopCenter);
                y += height;
            }
        }

        /// <summary>Silhouette with numbered marks on the left; the 25 Flight Report times on the right.</summary>
        private void InPosition(IReadOnlyDictionary<string, DateTimeOffset> at)
        {
            // Same two columns as the paper: the aircraft's flow on the left, ramp services on the right.
            var byCode = FlightReportMilestones.All.ToDictionary(item => item.Code);
            var milestones = PaperLeft.Concat(PaperRight).Select(code => byCode[code]).ToArray();
            const double height = 11.5;
            var rows = PaperLeft.Length;
            var blockHeight = Math.Max(rows * height, 120);
            Ensure(blockHeight + 4);
            var boxWidth = Width * 0.38;
            var boxHeight = Math.Min(blockHeight - 8, boxWidth / AircraftSilhouette.AspectRatio);
            boxWidth = boxHeight * AircraftSilhouette.AspectRatio;
            var left = Margin + 4;
            var top = y + 4;
            graphics.DrawRectangle(new XPen(Rule, 0.5), Margin, y, Width * 0.4, blockHeight);
            var points = AircraftSilhouette.Outline.Select(point => new XPoint(left + point.X * boxWidth, top + point.Y * boxHeight))
                .ToArray();
            graphics.DrawPolygon(new XPen(Navy, 0.8), new XSolidBrush(Tint), points, XFillMode.Winding);
            for (var index = 0; index < content.Damages.Count; index++)
            {
                var damage = content.Damages[index];
                var x = left + (double)damage.X * boxWidth;
                var markY = top + (double)damage.Y * boxHeight;
                graphics.DrawEllipse(new XPen(Mark, 1), new XSolidBrush(XColor.FromArgb(60, 200, 30, 30)), x - 5, markY - 5, 10, 10);
                graphics.DrawString((index + 1).ToString(Spanish), smallBold, new XSolidBrush(Mark), x + 6, markY + 3);
            }
            graphics.DrawString("Marque con una (X) cualquier anomalía encontrada.", smallBold, XBrushes.Black,
                Margin + 3, y + blockHeight - 4);
            var columnWidth = Width * 0.3;
            for (var index = 0; index < milestones.Length; index++)
            {
                var column = index < rows ? 0 : 1;
                var row = index < rows ? index : index - rows;
                var x = Margin + Width * 0.4 + column * columnWidth;
                var rowY = y + row * height;
                graphics.DrawRectangle(new XPen(Rule, 0.5), x, rowY, columnWidth * 0.68, height);
                graphics.DrawRectangle(new XPen(Rule, 0.5), x + columnWidth * 0.68, rowY, columnWidth * 0.32, height);
                Fit(milestones[index].Label.ToUpper(Spanish), smallBold, XBrushes.Black, x + 2, rowY + 2.5, columnWidth * 0.68 - 4);
                graphics.DrawString(Clock(at, milestones[index].Code) ?? string.Empty, bold, new XSolidBrush(Navy),
                    new XRect(x + columnWidth * 0.68, rowY + 1.5, columnWidth * 0.32, 10), XStringFormats.TopCenter);
            }
            y += blockHeight;
        }

        private void SignatureBoxes(IReadOnlyList<OperationDocumentSignatureData> signatures,
            IReadOnlyList<(OperationSignatureRole Role, string Caption)> roles)
        {
            const double height = 70;
            Ensure(height + 6);
            y += 6;
            var width = Width / roles.Count;
            for (var index = 0; index < roles.Count; index++)
            {
                var (role, caption) = roles[index];
                var x = Margin + index * width;
                var signature = signatures.FirstOrDefault(item => item.Role == role);
                graphics.DrawRectangle(new XPen(Rule, 0.5), x, y, width - 6, height);
                graphics.DrawString(caption, smallBold, XBrushes.Black, x + 4, y + 10);
                graphics.DrawString("Nombre / Name: " + (signature?.SignerName ?? string.Empty), body, new XSolidBrush(Navy), x + 4, y + 22);
                var area = new XRect(x + 4, y + 26, width - 14, 32);
                if (signature is not null)
                {
                    var pen = new XPen(Navy, 1.1) { LineCap = XLineCap.Round, LineJoin = XLineJoin.Round };
                    // Strokes keep the 3:1 signature pad ratio; fit them into the area keeping it.
                    var scale = Math.Min(area.Width / 3, area.Height);
                    foreach (var stroke in signature.Strokes)
                    {
                        var stroked = new XPoint[stroke.Count / 2];
                        for (var point = 0; point < stroked.Length; point++)
                            stroked[point] = new XPoint(area.X + (double)stroke[point * 2] * scale * 3,
                                area.Y + (double)stroke[point * 2 + 1] * scale);
                        if (stroked.Length > 1) graphics.DrawLines(pen, stroked);
                    }
                    graphics.DrawString("Firma / Signature · " +
                        TimeZoneInfo.ConvertTime(signature.SignedAt, zone).ToString("dd/MM/yyyy HH:mm", Spanish),
                        small, new XSolidBrush(Muted), x + 4, y + height - 4);
                }
                else
                    graphics.DrawString("Firma / Signature: pendiente", small, new XSolidBrush(Muted), x + 4, y + height - 4);
            }
            y += height;
        }

        private void Photos(IReadOnlyDictionary<Guid, DamagePhoto> photos)
        {
            NewPage();
            Band("WALK-AROUND · FOTOS DE ANOMALÍAS");
            y += 6;
            var index = 0;
            foreach (var damage in content.Damages)
            {
                index++;
                if (!photos.TryGetValue(damage.Id, out var photo)) continue;
                try
                {
                    using var image = XImage.FromStream(new MemoryStream(photo.Content));
                    var width = Width / 2 - 8;
                    var height = Math.Min(200, width * image.PixelHeight / Math.Max(1, image.PixelWidth));
                    Ensure(height + 20);
                    graphics.DrawString($"{index}. {damage.Note}", bold, new XSolidBrush(Navy), Margin, y + 9);
                    graphics.DrawImage(image, Margin, y + 13, height * image.PixelWidth / Math.Max(1, image.PixelHeight), height);
                    y += height + 22;
                }
                catch (Exception exception) when (exception is ArgumentException or InvalidOperationException or NotSupportedException)
                {
                    Lines($"{index}. {damage.Note} (la foto no se pudo dibujar)", small);
                }
            }
        }

        private void Lines(string text, XFont font)
        {
            var words = text.Split(' ', StringSplitOptions.RemoveEmptyEntries);
            var line = string.Empty;
            foreach (var word in words)
            {
                var candidate = line.Length == 0 ? word : line + " " + word;
                if (graphics.MeasureString(candidate, font).Width > Width - 6 && line.Length > 0)
                {
                    WriteLine(line, font);
                    line = word;
                }
                else line = candidate;
            }
            if (line.Length > 0) WriteLine(line, font);
        }

        private void WriteLine(string text, XFont font)
        {
            var height = font.Size + 3;
            Ensure(height);
            graphics.DrawString(text, font, XBrushes.Black, Margin + 3, y + font.Size);
            y += height;
        }

        /// <summary>Draws text cut with an ellipsis so a long value never overflows its cell.</summary>
        private void Fit(string text, XFont font, XBrush brush, double x, double top, double width)
        {
            var value = text;
            while (value.Length > 1 && graphics.MeasureString(value, font).Width > width)
                value = value[..^2] + "…";
            graphics.DrawString(value, font, brush, x, top + font.Size - 1);
        }

        private void Ensure(double height)
        {
            if (y + height > Bottom) NewPage();
        }

        private void NewPage()
        {
            graphics?.Dispose();
            page = pdf.AddPage();
            page.Size = PdfSharp.PageSize.A4;
            graphics = XGraphics.FromPdfPage(page);
            y = 30;
        }

        private string Airline() => Flight.AirlineIataCode is { Length: > 0 } code ? $"{Flight.AirlineName} ({code})" : Flight.AirlineName;

        private string? Flights() => (Flight.FlightIn, Flight.FlightOut) switch
        {
            (null, null) => null,
            ({ } arrival, null) => arrival,
            (null, { } departure) => departure,
            var (arrival, departure) => $"{arrival} / {departure}",
        };

        private string? Mtow() => Flight.MtowKg is int kg
            ? $"{Math.Round(kg * 2.20462m).ToString("N0", Spanish)} lb ({kg.ToString("N0", Spanish)} kg)" : null;

        private string? Time(DateTimeOffset? value) => value is { } instant
            ? TimeZoneInfo.ConvertTime(instant, zone).ToString("dd/MM/yyyy HH:mm", Spanish) : null;

        private string? Clock(IReadOnlyDictionary<string, DateTimeOffset> at, string code) => at.TryGetValue(code, out var instant)
            ? TimeZoneInfo.ConvertTime(instant, zone).ToString("HH:mm", Spanish) : null;

        private static string ItemNumber(string code) => code[(code.IndexOf('-') + 1)..].TrimStart('0') is { Length: > 0 } number
            ? number : code;

        private static string Unit(string unit) => unit.ToLowerInvariant() switch
        {
            "perhour" or "hour" or "hours" => "h",
            "perservice" or "service" or "peroperation" or "operation" or "turnaround" => "serv.",
            "unit" or "perunit" or "each" => "unid.",
            var other => other,
        };
    }
}
