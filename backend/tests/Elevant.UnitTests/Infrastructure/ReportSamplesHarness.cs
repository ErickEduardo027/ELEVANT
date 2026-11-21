using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Documents;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Application.Operations;
using Elevant.Infrastructure.Documents;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// The visual review of ADR-0048: with <c>ELEVANT_REPORT_SAMPLES_DIR</c> set, writes a PDF and an Excel of every report
/// (OCC, Gestión Humana and Finanzas) with synthetic data. Without it the test only renders them in memory.
/// </summary>
public sealed class ReportSamplesHarness
{
    private static readonly DateTimeOffset At = new(2026, 11, 21, 14, 35, 0, TimeSpan.Zero);
    private static readonly string[] Airlines = ["Arajet", "JetBlue Airways", "Aerolíneas del Caribe de Transporte Aéreo Internacional, S.A.", "Sky High"];
    private static readonly string[] People = ["Pedro Guzmán", "Ana Pérez Martínez", "Luis Rodríguez", "María Fernanda de los Santos"];

    [Fact]
    public void EveryReportRendersAsPdfAndExcel()
    {
        var directory = Environment.GetEnvironmentVariable("ELEVANT_REPORT_SAMPLES_DIR");
        if (directory is { Length: > 0 }) Directory.CreateDirectory(directory);
        var renderer = new ReportRenderer();
        foreach (var (name, document) in Documents())
        {
            var pdf = renderer.RenderPdf(document);
            var xlsx = renderer.RenderXlsx(document);
            Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
            Assert.Equal((byte)'P', xlsx[0]);
            if (directory is not { Length: > 0 }) continue;
            File.WriteAllBytes(Path.Combine(directory, name + ".pdf"), pdf);
            File.WriteAllBytes(Path.Combine(directory, name + ".xlsx"), xlsx);
        }
    }

    private static IEnumerable<(string Name, ReportDocument Document)> Documents()
    {
        foreach (var definition in OccReportCatalog.All)
        {
            var rows = Enumerable.Range(0, definition.Kind == OccReportKind.Operations ? 140 : 24)
                .Select(index => (IReadOnlyList<OccReportCell>)definition.Specs.Select((column, position) =>
                    OccCell(definition, column, position, index)).ToArray()).ToArray();
            var table = new OccReportTable(definition, Guid.NewGuid(), "PUJ", new(2026, 11, 1), new(2026, 11, 20), At, rows, 1,
                5000, false)
            {
                StationName = "Aeropuerto Internacional de Punta Cana", TimeZoneId = "America/Santo_Domingo",
                GeneratedBy = "Ana Pérez Martínez",
                Filters = definition.Filters.Contains(OccReportCatalog.AirlineFilter) ? [new("Aerolínea", "Arajet")] :
                    definition.Filters.Contains(OccReportCatalog.TerminalFilter) ? [new("Terminal", "T1 · Terminal A")] : [],
                TotalRows = rows.Length,
                Summary = OccReportDocuments.Summary(definition.Kind, rows),
                Totals = OccReportDocuments.Totals(definition, rows),
            };
            yield return ($"occ-{definition.Key}", OccReportDocuments.ToDocument(table));
        }
        foreach (var definition in HumanResourcesReportCatalog.All)
        {
            var rows = Enumerable.Range(0, 30).Select(index => (IReadOnlyList<HumanResourcesReportCell>)definition.Columns
                .Select((column, position) => HrCell(definition.Kind, column, position, index)).ToArray()).ToArray();
            var snapshot = new HumanResourcesReportSnapshot(definition.Kind, Guid.NewGuid(), new(2026, 11, 1),
                new(2026, 11, 30), At, definition.Columns.Select(column => column.Label).ToArray(), rows)
            {
                StationCode = "PUJ", StationName = "Aeropuerto Internacional de Punta Cana", TimeZone = "America/Santo_Domingo",
                GeneratedBy = "Ana Pérez Martínez", StationAgents = 50,
                DocumentKind = definition.Kind == HumanResourcesReportKind.Expirations ? "Qualification" : null,
            };
            yield return ($"gh-{definition.Key}", HumanResourcesReportCatalog.ToDocument(snapshot));
        }
        foreach (var report in FinanceSamples())
            yield return ($"finanzas-{report.Key}", FinanceReportDocuments.ToDocument(report, "Ana Pérez Martínez", At));
        yield return ("vacio-occ-operations", OccReportDocuments.ToDocument(new OccReportTable(OccReportCatalog.All[0],
            Guid.NewGuid(), "PUJ", new(2026, 11, 1), new(2026, 11, 20), At, [], 1, 5000, false) { GeneratedBy = "Ana Pérez Martínez" }));
    }

    private static OccReportCell OccCell(OccReportDefinition definition, ReportColumn column, int position, int index)
    {
        var day = new DateOnly(2026, 11, 1).AddDays(index % 20);
        return column.Type switch
        {
            ReportColumnType.Date => new(day.ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture)),
            ReportColumnType.Time => new(index % 7 == 0 ? "—" : $"{(6 + index % 14):00}:{index * 7 % 60:00}"),
            ReportColumnType.DateTime => new(index % 5 == 0 && column.Label.StartsWith("Liberada", StringComparison.Ordinal)
                ? $"{day:dd/MM/yyyy} 15:{index % 60:00}" : column.Label.StartsWith("Liberada", StringComparison.Ordinal) ? "—"
                : $"{day:dd/MM/yyyy} {(6 + index % 12):00}:{index * 11 % 60:00}"),
            ReportColumnType.Number => OccReportCell.Number(column.Label.Contains("Desviación", StringComparison.Ordinal)
                ? index % 9 - 4 : index % 6 + position + (column.Label.Contains("Cantidad", StringComparison.Ordinal) ? 0.5m : 0)),
            _ => new(Text(column.Label, index, definition.Kind)),
        };
    }

    private static string Text(string label, int index, OccReportKind kind) => label switch
    {
        "Aerolínea" => Airlines[index % Airlines.Length],
        "Agente" or "Agentes" when kind == OccReportKind.Operations => index % 6 == 0 ? "Sin asignar" : $"{People[index % 4]}, {People[(index + 1) % 4]}",
        "Agente" or "Asignada por" => People[index % People.Length],
        "Liberada por" => index % 5 == 0 ? People[(index + 2) % 4] : "—",
        "Estado" => index % 4 == 0 ? "Devuelta" : "Aprobada",
        "Resultado" => index % 4 == 0 ? "Devuelta" : "Aprobada",
        "Motivo" => index % 4 == 0 ? "Falta la foto del cono de seguridad y la firma del supervisor del vuelo" : "—",
        "Incidencias" => index % 3 == 0 ? "Seguridad (alta); Daño a equipaje (media)" : "Ninguna",
        "Operación" => $"DEV-TAT-{index + 1:0000}",
        "Matrícula" => $"HI{1000 + index}",
        "Servicio" => index % 2 == 0 ? "Asistencia en rampa con equipo de tierra" : "Remolque (push-back)",
        "Unidad" => index % 2 == 0 ? "Operación" : "Hora",
        "Vuelos" => $"DM{400 + index} / DM{401 + index}",
        "Terminal" => "T1",
        "Posiciones" => index % 3 == 0 ? "A1, A2, A3" : "B4",
        "Refuerzo" => index % 4 == 0 ? "Sí" : "No",
        "Demoras IATA" => index % 3 == 0 ? "15, 93" : "—",
        "Posición inicial" or "Posición final" => $"A{index % 9 + 1}",
        _ => $"Valor {index + 1}",
    };

    private static HumanResourcesReportCell HrCell(HumanResourcesReportKind kind, ReportColumn column, int position, int index)
    {
        var day = new DateOnly(2026, 11, 1).AddDays(index % 30);
        return column.Type switch
        {
            ReportColumnType.Date => new(day.ToString("dd/MM/yyyy", System.Globalization.CultureInfo.InvariantCulture),
                HumanResourcesReportCellType.Date),
            ReportColumnType.DateTime => new($"{day:dd/MM/yyyy} 09:{index % 60:00}", HumanResourcesReportCellType.DateTime),
            ReportColumnType.Time => new(position == 5 ? "06:00" : "14:00", HumanResourcesReportCellType.Text),
            ReportColumnType.Number => new((position == 2 ? 10 + index % 5 : position == 3 ? 8 + index % 3 : 2 + index % 5 - index % 3)
                .ToString(System.Globalization.CultureInfo.InvariantCulture), HumanResourcesReportCellType.Number),
            ReportColumnType.Percent => new(Math.Round((8m + index % 3) * 100m / (10 + index % 5), 1)
                .ToString(System.Globalization.CultureInfo.InvariantCulture), HumanResourcesReportCellType.Number),
            _ => new(column.Label switch
            {
                "Agente" => People[index % 4],
                "Empleado" => $"DEV-{100 + index}",
                "Clase" => index % 2 == 0 ? "Habilitación" : "Permiso",
                "Documento" => index % 2 == 0 ? "GPU" : "Carnet aeroportuario",
                "Movimiento" => index % 3 == 0 ? "Alta de cuenta" : index % 3 == 1 ? "Cuenta desactivada" : "Cuenta reactivada",
                "Terminal" => "T1",
                "Puesto" => index % 5 == 0 ? "" : "Operador de cinta",
                "Equipo" => $"EQ-{index + 1:00}",
                "Nombre" => index % 2 == 0 ? "Planta eléctrica de tierra (GPU)" : "Cinta transportadora de equipaje",
                _ => $"Valor {index}",
            }, HumanResourcesReportCellType.Text),
        };
    }

    private static IEnumerable<FinanceReportData> FinanceSamples()
    {
        FinanceReportColumn C(string key, string label, string type = "text") => new(key, label, type);
        IReadOnlyList<FinanceReportAppliedFilter> filters =
            [new("Estación", "PUJ · Aeropuerto Internacional de Punta Cana"), new("Aerolínea", "Todas"), new("Moneda", "Todas")];
        string Currency(int index) => index % 3 == 0 ? "DOP" : "USD";
        string Money(int index, decimal factor) => (factor * (index + 1) * 1234.567m).ToString("0.00", System.Globalization.CultureInfo.InvariantCulture);
        FinanceReportData Report(string key, IReadOnlyList<FinanceReportColumn> columns, Func<int, IReadOnlyList<string?>> row,
            IReadOnlyList<FinanceReportMetric> summary, int rows = 18)
        {
            var definition = FinanceReports.All.Single(item => item.Key == key);
            return new FinanceReportData(key, definition.Title, definition.Description, new(2026, 11, 1), new(2026, 11, 30), "USD",
                summary, columns, Enumerable.Range(0, rows).Select(row).ToArray(),
                ["Los importes en DOP se consolidan en USD con la tasa registrada."]) { Filters = filters };
        }
        yield return Report("revenue",
            [C("month", "Mes"), C("airline", "Aerolínea"), C("currency", "Moneda"), C("invoices", "Facturas", "number"),
                C("services", "Servicios", "money"), C("charges", "Cargos", "money"), C("adjustments", "Ajustes", "money"),
                C("credit_notes", "Notas de crédito", "money"), C("debit_notes", "Notas de débito", "money"),
                C("total", "Total", "money"), C("usd", "Total USD", "money"), C("packages", "Paquetes", "money"),
                C("excess", "Excedentes", "money"), C("minimum", "Mínimos", "money"), C("tax", "ITBIS", "money")],
            index => ["2026-11", Airlines[index % 4], Currency(index), (index % 4 + 1).ToString(), Money(index, 1), Money(index, 0.1m),
                "0.00", Money(index, 0.05m), "0.00", Money(index, 1.2m), Money(index, 1.1m), Money(index, 0.4m), "0.00", "0.00", Money(index, 0.18m)],
            [new("Facturado USD", "152340.55", "money", "USD", "en 12 facturas de 4 aerolíneas"), new("Facturas", "18", "number")]);
        yield return Report("receivables",
            [C("airline", "Aerolínea"), C("currency", "Moneda"), C("invoices", "Facturas abiertas", "number"), C("current", "Por vencer", "money"),
                C("d30", "1-30 días", "money"), C("d60", "31-60 días", "money"), C("d90", "61-90 días", "money"),
                C("d90plus", "+90 días", "money"), C("balance", "Saldo", "money")],
            index => [Airlines[index % 4], Currency(index), "2", Money(index, 1), Money(index, 0.5m), "0.00", "0.00", Money(index, 0.2m), Money(index, 1.7m)],
            [new("Por cobrar USD", "45210.10", "money", "USD", "en 8 facturas abiertas de 3 aerolíneas"),
                new("Vencido USD", "12000.00", "money", "USD", "26.5 % del saldo por cobrar")], 6);
        yield return Report("collections",
            [C("month", "Mes"), C("airline", "Aerolínea"), C("currency", "Moneda"), C("method", "Método"), C("payments", "Movimientos", "number"),
                C("amount", "Efectivo neto", "money"), C("kind", "Origen")],
            index => ["2026-11", Airlines[index % 4], Currency(index), index % 2 == 0 ? "Transferencia" : "Tarjeta", "1", Money(index, 0.9m), "Recibo"],
            [new("Cobrado USD", "98000.00", "money", "USD", "64.3 % de lo facturado"), new("Cobro sobre facturado USD", "64.3", "percent")]);
        yield return Report("payables",
            [C("reference", "Documento"), C("supplier", "Proveedor"), C("station", "Estación"), C("date", "Fecha", "date"),
                C("due", "Vencimiento", "date"), C("currency", "Moneda"), C("total", "Aprobado", "money"), C("applied", "Aplicado", "money"),
                C("balance", "Saldo", "money"), C("dop", "Total DOP congelado", "money")],
            index => [$"FP-{index + 1:0000}", index % 2 == 0 ? "Combustibles del Este, S.R.L." : "Talleres Aeronáuticos Unidos", "PUJ",
                $"2026-11-{index % 28 + 1:00}", $"2026-12-{index % 28 + 1:00}", Currency(index), Money(index, 1), Money(index, 0.3m),
                Money(index, 0.7m), Money(index, 60m)],
            [new("Por pagar USD", "22000.00", "money", "USD", "en 12 documentos de proveedores")]);
        yield return Report("charges",
            [C("kind", "Tipo"), C("concept", "Concepto"), C("currency", "Moneda"), C("count", "Líneas", "number"),
                C("net", "Neto", "money"), C("tax", "ITBIS", "money"), C("total", "Total", "money")],
            index => [index % 2 == 0 ? "Cargo" : "Mínimo", $"CHG-{index:00} · Recargo nocturno por servicio fuera de horario", Currency(index),
                (index % 5 + 1).ToString(), Money(index, 0.3m), Money(index, 0.054m), Money(index, 0.354m)],
            [new("Recargos USD", "5400.00", "money", "USD"), new("Cargos facturados", "31", "number")]);
        yield return Report("sales",
            [C("date", "Fecha", "date"), C("fiscalNumber", "e-NCF"), C("number", "Número interno"), C("airline", "Aerolínea"),
                C("station", "Estación"), C("currency", "Moneda"), C("subtotal", "Subtotal", "money"), C("tax", "ITBIS", "money"),
                C("total", "Total", "money")],
            index => [$"2026-11-{index % 28 + 1:00}", $"E3100000000{index + 1:00}", $"DEV-NF-2026-000000{index + 1:00}",
                Airlines[index % 4], "PUJ", Currency(index), Money(index, 1), Money(index, 0.18m), Money(index, 1.18m)],
            [new("Ventas USD", "88000.00", "money", "USD"), new("Facturas e-CF", "18", "number")]);
    }
}
