using System.Globalization;
using Elevant.Application.Common;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Documents;
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
/// station's local time (BusinessCalendar). PR E: the ELEVANT logo beside AVIAM's name, text that wraps instead of being
/// cut, «No registrado» for a field the record does not keep, and «Página X de Y» next to the form code.
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

    /// <summary>What a form prints for a field the operation's record does not keep (PR E).</summary>
    internal const string NotRecorded = "No registrado";

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
        private double Bottom => page.Height.Point - 60;
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
                    $"{line.Name} ({line.Code})", $"{line.Quantity.ToString("0.##", Spanish)} {Unit(line.Unit, line.Quantity)}",
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
                ("Aerolínea", Airline()), ("Supervisor", NotRecorded),
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
            var brandWidth = Brand();
            var headTop = y + 2;
            foreach (var line in new[]
            {
                "SOLICITUD DE SERVICIO Y DESCARGO DE RESPONSABILIDAD E INDEMNIZACION /",
                "SERVICE REQUEST AND RELEASE AND WAIVER OF LIABILITY AND INDEMNITY",
            })
                foreach (var part in Wrap(line, bold, Width - brandWidth))
                {
                    graphics.DrawString(part, bold, new XSolidBrush(Navy), new XRect(Margin + brandWidth, headTop, Width - brandWidth, 11),
                        XStringFormats.TopRight);
                    headTop += 11;
                }
            y = Math.Max(y + 36, headTop + 4);
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
            // «Otro» lists every other service in full: it takes the rows it needs below the right column.
            var otherLabel = "Otro/Other " + (others.Length == 0 ? "______________________" : string.Join(", ", others));
            var otherRows = Math.Max(1, (int)Math.Ceiling(Wrap(otherLabel, tiny, Width / 2 - 24).Count() * (tiny.Size + 0.6) / rowHeight));
            var rows = Math.Max(left.Length, right.Length + otherRows);
            Ensure(rows * rowHeight + 8);
            var top = y + 4;
            graphics.DrawRectangle(new XPen(Rule, 0.5), Margin, y, Width, rows * rowHeight + 8);
            graphics.DrawLine(new XPen(Rule, 0.5), Margin + Width / 2, y, Margin + Width / 2, y + rows * rowHeight + 8);
            void Box(double x, double rowTop, string label, bool ticked)
            {
                graphics.DrawRectangle(new XPen(Navy, 0.7), x, rowTop + 1.5, 7, 7);
                if (ticked) graphics.DrawString("X", smallBold, new XSolidBrush(Navy), x + 1.2, rowTop + 7.8);
                // The form prints every service in full; a long one uses a smaller size and, if still long, two lines.
                var font = graphics.MeasureString(label, small).Width <= Width / 2 - 30 ? small : tiny;
                var lines = Wrap(label, font, Width / 2 - 24).ToList();
                for (var line = 0; line < lines.Count; line++)
                    graphics.DrawString(lines[line], font, XBrushes.Black, x + 12,
                        rowTop + (font == small ? 0 : 0.6) + font.Size - 1 + line * (font.Size + 0.6));
            }
            for (var index = 0; index < left.Length; index++)
                Box(Margin + 8, top + index * rowHeight, left[index].Label, left[index].Ticked);
            for (var index = 0; index < right.Length; index++)
                Box(Margin + Width / 2 + 8, top + index * rowHeight, right[index].Label, right[index].Ticked);
            Box(Margin + Width / 2 + 8, top + right.Length * rowHeight, otherLabel, others.Length > 0);
            y += rows * rowHeight + 12;
            foreach (var clause in new[]
            {
                "El firmante, actuando en nombre y representación de la Aerolínea antes citada, por este medio certifica que la " +
                "Aerolínea reconoce y acepta todos los términos y condiciones de responsabilidad e indemnización establecidas en el " +
                "Acuerdo Estándar de IATA 2018, con modificaciones, utilizado por AVIAM, LTD., para la prestación de los servicios " +
                "de rampa. Véase la página 2.",
                "The undersigned, acting on behalf and in representation of the above referenced Carrier, hereby certifies that " +
                "the Carrier recognizes and accepts the terms and conditions of liability and indemnity as provided in the 2018 " +
                "IATA Standard Ground Handling Agreement, with modifications, with AVIAM, LTD. for ground handling services. " +
                "See page 2.",
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
            var cellWidth = Width / 2;
            for (var index = 0; index < cells.Count; index += 2)
            {
                var row = cells.Skip(index).Take(2).Select(cell => (Label: Wrap(cell.Label, small, cellWidth - 6).ToList(),
                    Value: Wrap(string.IsNullOrWhiteSpace(cell.Value) ? string.Empty : cell.Value, bold, cellWidth - 10).ToList())).ToArray();
                var height = row.Max(cell => cell.Label.Count * 8.5 + Math.Max(1, cell.Value.Count) * 10.5) + 4;
                Ensure(height);
                for (var column = 0; column < row.Length; column++)
                {
                    var x = Margin + column * cellWidth;
                    graphics.DrawRectangle(new XPen(Rule, 0.5), x, y, cellWidth, height);
                    var top = y + 1.5;
                    foreach (var line in row[column].Label)
                    {
                        graphics.DrawString(line, small, XBrushes.Black, x + 3, top + small.Size - 0.5);
                        top += 8.5;
                    }
                    var valueHeight = Math.Max(1, row[column].Value.Count) * 10.5;
                    graphics.DrawRectangle(new XSolidBrush(Tint), x + 3, top, cellWidth - 6, valueHeight);
                    foreach (var line in row[column].Value)
                    {
                        graphics.DrawString(line, bold, new XSolidBrush(Navy), x + 5, top + bold.Size);
                        top += 10.5;
                    }
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
                    var font = graphics.MeasureString(value ?? string.Empty, bold).Width <= columnWidth - 6 ? bold : smallBold;
                    graphics.DrawString(value ?? string.Empty, font, new XSolidBrush(Navy), x + 3, top + 10);
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
        /// Their text was not available; ELEVANT states what they are and never invents them (ADR-0033). In the
        /// generated document they are page 2, and page 1 points there in both languages (PR E).
        /// </summary>
        private void TermsNote()
        {
            NewPage();
            Band("PÁGINA 2 · TÉRMINOS Y CONDICIONES / PAGE 2 · TERMS AND CONDITIONS");
            y += 6;
            Lines("Los términos y condiciones de responsabilidad e indemnización a los que se refiere la página 1 son los del " +
                "Acuerdo Estándar de Servicios en Tierra de IATA 2018 (SGHA), con las modificaciones utilizadas por AVIAM, Ltd. " +
                "Su texto completo forma parte de este acuerdo en la versión vigente de AVIAM (páginas 2 y 3 del formulario en " +
                "papel) y no se reproduce en este documento generado.", body);
            y += 4;
            Lines("The terms and conditions of liability and indemnity referred to on page 1 are those of the 2018 IATA Standard " +
                "Ground Handling Agreement (SGHA), with the modifications used by AVIAM, Ltd. Their full text is part of this " +
                "agreement in AVIAM's current version (pages 2 and 3 of the paper form) and is not reproduced in this generated " +
                "document.", body);
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

        private IEnumerable<string> Wrap(string text, XFont font, double width) =>
            PdfTextLayout.Wrap(graphics, text, font, width).Where((line, index) => index == 0 || line.Length > 0);

        private string? ActualTime(string code) => content.Milestones.FirstOrDefault(item => item.Code == code) is { } milestone
            ? Time(milestone.At) : null;

        public void BridgeChecklist(IReadOnlyList<OperationDocumentSignatureData> signatures)
        {
            Header($"Check-List Diario Puente Abordaje · {Flight.StationName}",
                [("Puente No.", Flight.Position ?? "—"), ("No. de vuelo", Flights())]);
            Grid([
                ("Línea Aérea", Airline()), ("Destino", Flight.Destination),
                ("Fecha", Flight.OperationDate.ToString("dd/MM/yyyy", Spanish)), ("Llave recibida de", NotRecorded),
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
                var top = pdf.Pages[index].Height.Point - 52;
                var width = pageWidth - 2 * Margin;
                footer.DrawLine(new XPen(Rule, 0.5), Margin, top, pageWidth - Margin, top);
                // The revision on the left, the form code with «Página X de Y» on the right, the confidentiality notice
                // under them and the SHA-256 line last: nothing overlaps (PR E).
                footer.DrawString(content.FormRevision, small, new XSolidBrush(Muted), new XRect(Margin, top + 4, width, 10),
                    XStringFormats.TopLeft);
                footer.DrawString($"{content.FormCode} · Página {index + 1} de {total}", smallBold, new XSolidBrush(Navy),
                    new XRect(Margin, top + 4, width, 10), XStringFormats.TopRight);
                footer.DrawString("Documento confidencial. Su reproducción y/o distribución debe(n) ser autorizada(s) por AVIAM.",
                    small, new XSolidBrush(Muted), new XRect(Margin, top + 13, width, 10), XStringFormats.TopCenter);
                var signed = DocumentText.Count(signatures.Count, "firma", "firmas");
                var state = signatures.Count == 0 ? "sin firmas"
                    : corrected ? $"{signed} sobre la versión firmada · corregida por OCC"
                    : $"{signed} sobre esta huella";
                var lines = PdfTextLayout.Wrap(footer, $"SHA-256 {sha256} · {state} · generado por ELEVANT el " +
                    $"{TimeZoneInfo.ConvertTime(generatedAt, zone).ToString("dd/MM/yyyy HH:mm", Spanish)} (hora de la estación)",
                    small, width);
                for (var line = 0; line < lines.Count; line++)
                    footer.DrawString(lines[line], small, new XSolidBrush(Muted), new XRect(Margin, top + 22 + line * 8.5, width, 10),
                        XStringFormats.TopLeft);
            }
        }

        /// <summary>The ELEVANT logo and AVIAM's name, as every form starts; returns the width they take.</summary>
        private double Brand()
        {
            DocumentPalette.DrawLogo(graphics, Margin, y, 46);
            graphics.DrawString("AVIAM", brand, new XSolidBrush(Navy), Margin + 54, y + 22);
            graphics.DrawString("Ltd.", small, new XSolidBrush(Navy), Margin + 140, y + 22);
            return 164;
        }

        private void Header(string formTitle, IReadOnlyList<(string Label, string Value)> boxes)
        {
            var left = Brand();
            var top = y + 4;
            foreach (var line in Wrap(formTitle, title, Width - left))
            {
                graphics.DrawString(line, title, new XSolidBrush(Navy), new XRect(Margin + left, top, Width - left, 16),
                    XStringFormats.TopRight);
                top += 16;
            }
            top += 4;
            foreach (var (label, value) in boxes)
            {
                graphics.DrawString($"{label}: ", smallBold, new XSolidBrush(Muted),
                    new XRect(Margin, top, Width - 170, 10), XStringFormats.TopRight);
                var lines = Wrap(value, bold, 168).ToList();
                foreach (var line in lines)
                {
                    graphics.DrawString(line, bold, new XSolidBrush(Navy), new XRect(Margin + Width - 168, top - 1, 168, 11),
                        XStringFormats.TopLeft);
                    top += 11;
                }
                top += 1;
            }
            y = Math.Max(y + 44, top + 4);
        }

        private void Band(string text)
        {
            // A long bilingual heading shrinks and, if still long, takes a second line (never overflows the band).
            var font = graphics.MeasureString(text, band).Width <= Width - 8 ? band : smallBold;
            var lines = Wrap(text, font, Width - 8).ToList();
            var height = 13 + (lines.Count - 1) * (font.Size + 2);
            Ensure(height + 5);
            graphics.DrawRectangle(new XSolidBrush(Orange), Margin, y, Width, height);
            for (var line = 0; line < lines.Count; line++)
                graphics.DrawString(lines[line], font, XBrushes.White,
                    new XRect(Margin, y + (font == band ? 1.5 : 2.5) + line * (font.Size + 2), Width, 11), XStringFormats.TopCenter);
            y += height;
        }

        /// <summary>Label/value cells two per row, as on the paper's «Información General»; both wrap, the row grows.</summary>
        private void Grid(IReadOnlyList<(string Label, string? Value)> cells)
        {
            var labelWidth = Width / 2 * 0.62;
            var valueWidth = Width / 2 - labelWidth;
            for (var index = 0; index < cells.Count; index += 2)
            {
                var row = cells.Skip(index).Take(2).Select(cell => (Label: Wrap(cell.Label, small, labelWidth - 6).ToList(),
                    Value: Wrap(string.IsNullOrWhiteSpace(cell.Value) ? "—" : cell.Value, bold, valueWidth - 6).ToList(),
                    Muted: cell.Value == NotRecorded)).ToArray();
                var height = Math.Max(15, row.Max(cell => Math.Max(cell.Label.Count * 8.5, cell.Value.Count * 10.5)) + 5);
                Ensure(height);
                for (var column = 0; column < row.Length; column++)
                {
                    var x = Margin + column * Width / 2;
                    graphics.DrawRectangle(new XPen(Rule, 0.5), new XSolidBrush(Tint), x, y, labelWidth, height);
                    graphics.DrawRectangle(new XPen(Rule, 0.5), x + labelWidth, y, valueWidth, height);
                    for (var line = 0; line < row[column].Label.Count; line++)
                        graphics.DrawString(row[column].Label[line], small, XBrushes.Black, x + 3, y + 3 + small.Size + line * 8.5);
                    var font = row[column].Muted ? body : bold;
                    for (var line = 0; line < row[column].Value.Count; line++)
                        graphics.DrawString(row[column].Value[line], font, new XSolidBrush(row[column].Muted ? Muted : Navy),
                            x + labelWidth + 3, y + 2.5 + bold.Size + line * 10.5);
                }
                y += height;
            }
        }

        private void Row(IReadOnlyList<(string Text, double Share)> cells, bool highlight = false)
        {
            var font = highlight ? bold : body;
            var wrapped = cells.Select(cell => Wrap(cell.Text, font, Width * cell.Share - 6).ToList()).ToArray();
            var height = Math.Max(15, wrapped.Max(lines => lines.Count) * 10.5 + 4.5);
            Ensure(height);
            var x = Margin;
            for (var index = 0; index < cells.Count; index++)
            {
                var width = Width * cells[index].Share;
                graphics.DrawRectangle(new XPen(Rule, 0.5), highlight ? new XSolidBrush(Tint) : XBrushes.White, x, y, width, height);
                for (var line = 0; line < wrapped[index].Count; line++)
                    graphics.DrawString(wrapped[index][line], font, new XSolidBrush(Navy), x + 3, y + 2.5 + font.Size + line * 10.5);
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
                var wrapped = columns.Select((column, index) => column.Right
                    ? [row[index]] : Wrap(row[index], body, Width * column.Share - 6).ToList()).ToArray();
                var rowHeight = Math.Max(height, wrapped.Max(lines => lines.Count) * 10.5 + 3.5);
                if (y + rowHeight > Bottom) { NewPage(); Head(); }
                var x = Margin;
                for (var index = 0; index < columns.Count; index++)
                {
                    var (_, share, right) = columns[index];
                    graphics.DrawRectangle(new XPen(Rule, 0.5), x, y, Width * share, rowHeight);
                    for (var line = 0; line < wrapped[index].Count; line++)
                        graphics.DrawString(wrapped[index][line], body, XBrushes.Black,
                            new XRect(x + 3, y + 3 + line * 10.5, Width * share - 6, 10),
                            right ? XStringFormats.TopRight : XStringFormats.TopLeft);
                    x += Width * share;
                }
                y += rowHeight;
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
                var labels = Wrap($"{(bridge ? number.ToString("00", Spanish) + "-" : ItemNumber(item.ItemCode))} {item.Label}", body,
                    labelWidth - 6).ToList();
                var rowHeight = Math.Max(height, labels.Count * 10.5 + 2.5);
                Ensure(rowHeight);
                graphics.DrawRectangle(new XPen(Rule, 0.5), Margin, y, labelWidth, rowHeight);
                for (var line = 0; line < labels.Count; line++)
                    graphics.DrawString(labels[line], body, XBrushes.Black, Margin + 3, y + 1.5 + body.Size + line * 10.5);
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
                    graphics.DrawRectangle(new XPen(Rule, 0.5), x, y, answerWidth, rowHeight);
                    if (index == selected)
                        graphics.DrawString("X", bold, new XSolidBrush(Navy), new XRect(x, y + 2, answerWidth, 10), XStringFormats.TopCenter);
                }
                if (!bridge && item.Value == "NotApplicable")
                    graphics.DrawString("N/A", small, new XSolidBrush(Muted),
                        new XRect(Margin + labelWidth, y + 3, answers.Length * answerWidth, 10), XStringFormats.TopCenter);
                y += rowHeight;
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
                var label = milestones[index].Label.ToUpper(Spanish);
                var labelFont = graphics.MeasureString(label, smallBold).Width <= columnWidth * 0.68 - 4 ? smallBold : tiny;
                graphics.DrawString(label, labelFont, XBrushes.Black, x + 2, rowY + 2.5 + labelFont.Size - 1);
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
                var name = "Nombre / Name: " + (signature?.SignerName ?? string.Empty);
                var nameFont = graphics.MeasureString(name, body).Width <= width - 14 ? body : small;
                graphics.DrawString(name, nameFont, new XSolidBrush(Navy), x + 4, y + 22);
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

        private static string Unit(string unit, decimal quantity) => unit.ToLowerInvariant() switch
        {
            "perhour" or "hour" or "hours" => "h",
            "perservice" or "service" or "peroperation" or "operation" or "turnaround" => "serv.",
            "unit" or "perunit" or "each" => "unid.",
            "passenger" or "perpassenger" => "pax",
            "minute" or "perminute" => "min",
            _ => DocumentText.Unit(unit, quantity),
        };
    }
}
