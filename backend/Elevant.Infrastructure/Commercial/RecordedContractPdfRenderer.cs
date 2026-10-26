using System.Globalization;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Infrastructure.Finance;
using PdfSharp;
using PdfSharp.Drawing;
using PdfSharp.Pdf;
using PdfSharp.Pdf.IO;

namespace Elevant.Infrastructure.Commercial;

/// <summary>Renders a frozen contract snapshot without an external document service.</summary>
public sealed class RecordedContractPdfRenderer : IRecordedContractPdfRenderer
{
    private const string Version = "contract-clauses-v1";
    private static readonly Lazy<(byte[] Bytes, Clause[] Clauses)> Template = new(LoadTemplate);
    private static readonly CultureInfo NumberCulture = CultureInfo.InvariantCulture;

    static RecordedContractPdfRenderer() => ElevantPdfFontResolver.EnsureRegistered();

    public string TemplateVersion => Version;
    public string TemplateSha256 => Hash(Template.Value.Bytes);

    public byte[] RenderDraft(ContractPdfSnapshot snapshot)
    {
        Validate(snapshot);
        var coverage = Coverage(snapshot);
        using var document = new PdfDocument();
        document.Info.Title = $"Contrato {snapshot.ContractCode} · versión {snapshot.VersionNumber}";
        document.Info.Subject = "Versión contractual pendiente de aceptaciones";
        document.Info.Author = "ELEVANT";
        using var writer = new PdfWriter(document, snapshot.ContractCode);
        writer.Title("Contrato de servicios aeroportuarios");
        writer.Paragraph($"Contrato {snapshot.ContractCode} · Versión {snapshot.VersionNumber} · Solicitud {snapshot.RequestCode}");
        writer.Paragraph($"Generado: {Utc(snapshot.GeneratedAtUtc)} · Plantilla {TemplateVersion}");
        writer.Section("Partes y representantes");
        writer.Paragraph($"AVIAM: {snapshot.AviamLegalName}. Representante designado: {snapshot.AviamSignerName} ({snapshot.AviamSignerEmail}).");
        writer.Paragraph($"Aerolínea: {snapshot.AirlineLegalName} ({snapshot.AirlineCode}). Representante autorizado: {snapshot.AirlineSignerName}, {snapshot.AirlineSignerTitle} ({snapshot.AirlineSignerEmail}).");
        writer.Section("Vigencia y estaciones");
        writer.Paragraph($"Desde {Date(snapshot.ValidFrom)} hasta {(snapshot.ValidTo is null ? "sin fecha de fin acordada" : Date(snapshot.ValidTo.Value))}. Moneda: {snapshot.CurrencyCode}.");
        writer.Paragraph(string.Join("; ", snapshot.Stations.OrderBy(x => x.Code, StringComparer.Ordinal)
            .Select(x => $"{x.Code} · {x.Name}")));

        writer.Section("Servicios contratados");
        writer.Paragraph("Servicio · unidad y condición económica", muted: true);
        foreach (var service in snapshot.Services.OrderBy(x => x.Code, StringComparer.Ordinal))
        {
            var prefix = $"{service.Code} · {service.Name}";
            var detail = coverage.TryGetValue(service.ServiceId, out var package)
                ? $"Incluido en paquete {package.Code}; unidad {service.BillingUnit}. No se suma como tarifa individual."
                : $"{snapshot.CurrencyCode} {Money(service.UnitPrice)} por {service.BillingUnit}; mínimo {Quantity(service.MinimumQuantity)}.";
            writer.Row(prefix, detail);
        }

        if (snapshot.Packages.Count > 0)
        {
            writer.Section("Paquetes contratados");
            foreach (var package in snapshot.Packages.OrderBy(x => x.Code, StringComparer.Ordinal))
            {
                writer.Row($"{package.Code} · {package.Name} · v{package.VersionNumber}",
                    $"Precio base {snapshot.CurrencyCode} {Money(package.BasePrice)} por {package.Scope}.");
                foreach (var component in package.Components.OrderBy(x => x.Code, StringComparer.Ordinal))
                    writer.Paragraph($"  {component.Code} · {component.Name}: incluye {Quantity(component.IncludedQuantity)} {component.BillingUnit}; excedente en bloques de {Quantity(component.ExcessBlockSize)} a {snapshot.CurrencyCode} {Money(component.ExcessBlockPrice)}.");
            }
        }

        writer.Section("Condiciones particulares");
        writer.Paragraph(snapshot.Terms);
        foreach (var clause in Template.Value.Clauses)
        {
            writer.Section(clause.Title);
            writer.Paragraph(clause.Body);
        }
        writer.Section("Aceptaciones previstas");
        writer.Paragraph($"AVIAM: {snapshot.AviamSignerName} · {snapshot.AviamSignerEmail} — pendiente.");
        writer.Paragraph($"Aerolínea: {snapshot.AirlineSignerName} · {snapshot.AirlineSignerEmail} — pendiente.");
        writer.Paragraph("Esta versión no acredita aceptación hasta que el expediente registre ambas acciones.", muted: true);
        return writer.Save();
    }

    public byte[] RenderFinal(byte[] draftPdf, ContractAcceptanceEvidence aviam,
        ContractAcceptanceEvidence airline)
    {
        ArgumentNullException.ThrowIfNull(draftPdf);
        ValidateAcceptances(draftPdf, aviam, airline);
        using var source = PdfReader.Open(new MemoryStream(draftPdf, writable: false),
            PdfDocumentOpenMode.Import);
        if (source.PageCount == 0) throw new ArgumentException("The draft PDF is empty.", nameof(draftPdf));
        using var final = new PdfDocument();
        final.Info.Title = source.Info.Title + " · formalizado";
        final.Info.Subject = "Contrato y constancia de aceptaciones registradas en ELEVANT";
        final.Info.Author = "ELEVANT";
        foreach (var page in source.Pages) final.AddPage(page);
        using var writer = new PdfWriter(final, "Constancia de aceptación");
        writer.Title("Constancia de aceptaciones");
        WriteAcceptance(writer, aviam, airline);
        return writer.Save();
    }

    public byte[] RenderEvidence(ContractPdfSnapshot snapshot, string draftSha256,
        ContractAcceptanceEvidence aviam, ContractAcceptanceEvidence airline)
    {
        Validate(snapshot);
        if (!ValidHash(draftSha256) ||
            !string.Equals(draftSha256, aviam.DraftSha256, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(draftSha256, airline.DraftSha256, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Acceptance does not match the frozen document.", nameof(draftSha256));
        ValidateParties(aviam, airline);
        using var document = new PdfDocument();
        document.Info.Title = $"Constancia de aceptación · {snapshot.ContractCode} v{snapshot.VersionNumber}";
        document.Info.Subject = "Registro interno de aceptación electrónica, sin certificación externa";
        document.Info.Author = "ELEVANT";
        using var writer = new PdfWriter(document, snapshot.ContractCode);
        writer.Title("Constancia de aceptación electrónica");
        writer.Paragraph($"Contrato {snapshot.ContractCode} · versión {snapshot.VersionNumber} · solicitud {snapshot.RequestCode}");
        writer.Paragraph($"Huella SHA-256 del borrador aceptado: {draftSha256.ToLowerInvariant()}");
        writer.Paragraph($"Plantilla {TemplateVersion} · SHA-256 {TemplateSha256}");
        WriteAcceptance(writer, aviam, airline);
        return writer.Save();
    }

    internal static IReadOnlyDictionary<Guid, ContractPdfPackage> Coverage(ContractPdfSnapshot snapshot)
    {
        var coverage = new Dictionary<Guid, ContractPdfPackage>();
        var services = snapshot.Services.Select(x => x.ServiceId).ToHashSet();
        foreach (var package in snapshot.Packages)
            foreach (var component in package.Components)
            {
                if (!services.Contains(component.ServiceId) ||
                    !coverage.TryAdd(component.ServiceId, package))
                    throw new ArgumentException("Package coverage is incomplete or ambiguous.", nameof(snapshot));
            }
        return coverage;
    }

    private static void Validate(ContractPdfSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);
        if (snapshot.ContractId == Guid.Empty || snapshot.VersionId == Guid.Empty ||
            snapshot.RequestId == Guid.Empty || snapshot.VersionNumber < 1 ||
            snapshot.GeneratedAtUtc.Offset != TimeSpan.Zero ||
            snapshot.ValidTo < snapshot.ValidFrom ||
            snapshot.CurrencyCode.Length != 3 ||
            snapshot.Stations is not { Count: > 0 } ||
            snapshot.Services is not { Count: > 0 } ||
            snapshot.Packages is null ||
            snapshot.Services.Any(x => x.ServiceId == Guid.Empty || x.UnitPrice < 0 || x.MinimumQuantity < 0) ||
            snapshot.Services.Select(x => x.ServiceId).Distinct().Count() != snapshot.Services.Count ||
            snapshot.Packages.Select(x => x.PackageVersionId).Distinct().Count() != snapshot.Packages.Count ||
            string.IsNullOrWhiteSpace(snapshot.ContractCode) ||
            string.IsNullOrWhiteSpace(snapshot.RequestCode) ||
            string.IsNullOrWhiteSpace(snapshot.AviamLegalName) ||
            string.IsNullOrWhiteSpace(snapshot.AirlineLegalName) ||
            string.IsNullOrWhiteSpace(snapshot.AviamSignerName) ||
            string.IsNullOrWhiteSpace(snapshot.AviamSignerEmail) ||
            string.IsNullOrWhiteSpace(snapshot.AirlineSignerName) ||
            string.IsNullOrWhiteSpace(snapshot.AirlineSignerTitle) ||
            string.IsNullOrWhiteSpace(snapshot.AirlineSignerEmail) ||
            string.IsNullOrWhiteSpace(snapshot.Terms))
            throw new ArgumentException("The frozen contract snapshot is incomplete.", nameof(snapshot));
        Coverage(snapshot);
    }

    private static void ValidateAcceptances(byte[] draftPdf,
        ContractAcceptanceEvidence aviam, ContractAcceptanceEvidence airline)
    {
        if (draftPdf.Length < 5 || Encoding.ASCII.GetString(draftPdf, 0, 5) != "%PDF-")
            throw new ArgumentException("The draft is not a PDF.", nameof(draftPdf));
        ValidateParties(aviam, airline);
        var hash = Hash(draftPdf);
        if (!string.Equals(hash, aviam.DraftSha256, StringComparison.OrdinalIgnoreCase) ||
            !string.Equals(hash, airline.DraftSha256, StringComparison.OrdinalIgnoreCase))
            throw new ArgumentException("Acceptance does not match the frozen PDF.", nameof(draftPdf));
    }

    private static void ValidateParties(ContractAcceptanceEvidence aviam,
        ContractAcceptanceEvidence airline)
    {
        ArgumentNullException.ThrowIfNull(aviam);
        ArgumentNullException.ThrowIfNull(airline);
        if (aviam.Party != "Aviam" || airline.Party != "Airline" ||
            aviam.ActorAccountId == Guid.Empty || airline.ActorAccountId == Guid.Empty ||
            aviam.ActorAccountId == airline.ActorAccountId ||
            aviam.AcceptedAtUtc.Offset != TimeSpan.Zero ||
            airline.AcceptedAtUtc.Offset != TimeSpan.Zero ||
            aviam.AcceptedAtUtc > airline.AcceptedAtUtc ||
            string.IsNullOrWhiteSpace(aviam.Name) || string.IsNullOrWhiteSpace(aviam.Email) ||
            string.IsNullOrWhiteSpace(airline.Name) || string.IsNullOrWhiteSpace(airline.Email) ||
            !ValidHash(aviam.DraftSha256) || !ValidHash(airline.DraftSha256))
            throw new ArgumentException("Acceptance evidence is incomplete or out of order.");
    }

    private static void WriteAcceptance(PdfWriter writer,
        ContractAcceptanceEvidence aviam, ContractAcceptanceEvidence airline)
    {
        writer.Section("AVIAM");
        writer.Paragraph($"{aviam.Name} · {aviam.Email}");
        writer.Paragraph($"Cuenta {aviam.ActorAccountId:D} · aceptación registrada {Utc(aviam.AcceptedAtUtc)} UTC.");
        writer.Section("Aerolínea");
        writer.Paragraph($"{airline.Name} · {airline.Email}");
        writer.Paragraph($"Cuenta {airline.ActorAccountId:D} · aceptación registrada {Utc(airline.AcceptedAtUtc)} UTC.");
        writer.Section("Contenido aceptado");
        writer.Paragraph($"SHA-256 del PDF revisado por ambas cuentas: {aviam.DraftSha256.ToLowerInvariant()}");
        writer.Paragraph("Estas acciones son aceptaciones electrónicas registradas por ELEVANT. No se emitió un certificado de firma digital ni una validación de un proveedor externo.");
    }

    private static (byte[] Bytes, Clause[] Clauses) LoadTemplate()
    {
        var assembly = typeof(RecordedContractPdfRenderer).Assembly;
        var name = assembly.GetManifestResourceNames().Single(x =>
            x.EndsWith("contract-clauses-v1.json", StringComparison.Ordinal));
        using var stream = assembly.GetManifestResourceStream(name)!;
        using var buffer = new MemoryStream();
        stream.CopyTo(buffer);
        var bytes = buffer.ToArray();
        var clauses = JsonSerializer.Deserialize<Clause[]>(bytes,
            new JsonSerializerOptions { PropertyNameCaseInsensitive = true }) ?? [];
        if (clauses.Length == 0 || clauses.Any(x => string.IsNullOrWhiteSpace(x.Title) ||
            string.IsNullOrWhiteSpace(x.Body) || x.Body.Contains('[') || x.Body.Contains("{{")))
            throw new InvalidDataException("The contract template is incomplete.");
        return (bytes, clauses);
    }

    private sealed record Clause(string Title, string Body);
    private static bool ValidHash(string? value) => value is { Length: 64 } &&
        value.All(Uri.IsHexDigit);
    private static string Hash(byte[] bytes) =>
        Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
    private static string Money(decimal amount) => amount.ToString("0.00##", NumberCulture);
    private static string Quantity(decimal amount) => amount.ToString("0.####", NumberCulture);
    private static string Date(DateOnly value) => value.ToString("dd/MM/yyyy", NumberCulture);
    private static string Utc(DateTimeOffset value) =>
        value.ToUniversalTime().ToString("dd/MM/yyyy HH:mm:ss", NumberCulture);

    private sealed class PdfWriter : IDisposable
    {
        private const double Margin = 44;
        private readonly PdfDocument document;
        private readonly string reference;
        private readonly XFont body = new(ElevantPdfFontResolver.Typeface, 9, XFontStyleEx.Regular);
        private readonly XFont small = new(ElevantPdfFontResolver.Typeface, 8, XFontStyleEx.Regular);
        private readonly XFont heading = new(ElevantPdfFontResolver.Typeface, 15, XFontStyleEx.Regular);
        private readonly XColor navy = XColor.FromArgb(11, 31, 63);
        private readonly XColor blue = XColor.FromArgb(20, 93, 196);
        private readonly XColor muted = XColor.FromArgb(88, 103, 122);
        private XGraphics graphics = null!;
        private PdfPage page = null!;
        private double y;

        internal PdfWriter(PdfDocument document, string reference)
        {
            this.document = document;
            this.reference = reference;
            NewPage();
        }

        internal void Title(string title)
        {
            Ensure(44);
            graphics.DrawString(title, heading, new XSolidBrush(navy),
                new XRect(Margin, y, page.Width.Point - Margin * 2, 27), XStringFormats.TopLeft);
            y += 38;
        }

        internal void Section(string title)
        {
            Ensure(43);
            y += 7;
            graphics.DrawString(title, body, new XSolidBrush(blue),
                new XRect(Margin, y, page.Width.Point - Margin * 2, 17), XStringFormats.TopLeft);
            y += 23;
        }

        internal void Paragraph(string text, bool muted = false)
        {
            foreach (var line in Wrap(text, body, page.Width.Point - Margin * 2))
            {
                Ensure(15);
                graphics.DrawString(line, body, new XSolidBrush(muted ? this.muted : navy),
                    new XRect(Margin, y, page.Width.Point - Margin * 2, 14), XStringFormats.TopLeft);
                y += 14;
            }
            y += 5;
        }

        internal void Row(string label, string detail)
        {
            Ensure(36);
            graphics.DrawLine(new XPen(XColor.FromArgb(224, 230, 238), 0.5),
                Margin, y - 4, page.Width.Point - Margin, y - 4);
            Paragraph(label);
            Paragraph(detail, muted: true);
        }

        internal byte[] Save()
        {
            graphics.Dispose();
            using var output = new MemoryStream();
            document.Save(output, false);
            return output.ToArray();
        }

        private IEnumerable<string> Wrap(string text, XFont font, double width)
        {
            foreach (var paragraph in text.Replace("\r\n", "\n", StringComparison.Ordinal)
                         .Split('\n'))
            {
                var line = new StringBuilder();
                foreach (var word in paragraph.Split(' ', StringSplitOptions.RemoveEmptyEntries))
                {
                    var remaining = word;
                    while (remaining.Length > 0)
                    {
                        var prefix = line.Length == 0 ? string.Empty : " ";
                        if (graphics.MeasureString(line + prefix + remaining, font).Width <= width)
                        {
                            line.Append(prefix).Append(remaining);
                            break;
                        }
                        if (line.Length > 0)
                        {
                            yield return line.ToString();
                            line.Clear();
                            continue;
                        }
                        var count = remaining.Length;
                        while (count > 1 && graphics.MeasureString(remaining[..count], font).Width > width)
                            count--;
                        yield return remaining[..count];
                        remaining = remaining[count..];
                    }
                }
                if (line.Length > 0) yield return line.ToString();
            }
        }

        private void Ensure(double height)
        {
            if (y + height > page.Height.Point - 67) NewPage();
        }

        private void NewPage()
        {
            if (graphics is not null) graphics.Dispose();
            page = document.AddPage();
            page.Size = PageSize.A4;
            graphics = XGraphics.FromPdfPage(page);
            graphics.DrawString("ELEVANT  |  CONTRATOS", small, new XSolidBrush(navy),
                new XRect(Margin, 29, page.Width.Point - Margin * 2, 14), XStringFormats.TopLeft);
            graphics.DrawLine(new XPen(blue, 1), Margin, 49, page.Width.Point - Margin, 49);
            graphics.DrawLine(new XPen(XColor.FromArgb(210, 218, 228), 0.5),
                Margin, page.Height.Point - 51, page.Width.Point - Margin, page.Height.Point - 51);
            graphics.DrawString($"{reference}  |  Página {document.PageCount}", small,
                new XSolidBrush(muted),
                new XRect(Margin, page.Height.Point - 43, page.Width.Point - Margin * 2, 16),
                XStringFormats.TopLeft);
            y = 70;
        }

        public void Dispose() => graphics.Dispose();
    }
}
