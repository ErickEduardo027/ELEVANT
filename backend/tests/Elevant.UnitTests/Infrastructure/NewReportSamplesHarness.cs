using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Commercial;
using Elevant.Application.Documents;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Infrastructure.Documents;

namespace Elevant.UnitTests.Infrastructure;

/// <summary>
/// The visual review of the new reports (ADR-0048, Â«Reportes nuevosÂ»): with <c>ELEVANT_REPORT_SAMPLES_DIR</c> set, writes
/// a PDF and an Excel of each one with synthetic data shaped as their stores build them. Without it the test only
/// renders them in memory and checks the documents are complete.
/// </summary>
public sealed class NewReportSamplesHarness
{
    private static readonly DateTimeOffset At = new(2026, 11, 21, 14, 35, 0, TimeSpan.Zero);
    private static readonly string[] Airlines = ["Arajet", "JetBlue Airways", "AerolÃ­neas del Caribe de Transporte AÃ©reo Internacional, S.A.", "Sky High"];
    private static readonly string[] People = ["Pedro GuzmÃ¡n", "Ana PÃ©rez MartÃ­nez", "Luis RodrÃ­guez", "MarÃ­a Fernanda de los Santos"];
    private static readonly string[] Services = ["GPU Â· Ground power unit", "PBB Â· Pasarela de abordaje", "PUSH Â· Remolque (pushback)",
        "LAV Â· Servicio de lavabos", "WAT Â· Agua potable", "BAG Â· Manejo de equipaje"];

    [Fact]
    public void EveryNewReportRendersAsPdfAndExcel()
    {
        var directory = Environment.GetEnvironmentVariable("ELEVANT_REPORT_SAMPLES_DIR");
        if (directory is { Length: > 0 }) Directory.CreateDirectory(directory);
        var renderer = new ReportRenderer();
        foreach (var (name, document) in Documents())
        {
            document.Validate();
            var pdf = renderer.RenderPdf(document);
            var xlsx = renderer.RenderXlsx(document);
            Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(pdf, 0, 4));
            Assert.Equal((byte)'P', xlsx[0]);
            if (directory is not { Length: > 0 }) continue;
            File.WriteAllBytes(Path.Combine(directory, name + ".pdf"), pdf);
            File.WriteAllBytes(Path.Combine(directory, name + ".xlsx"), xlsx);
        }
        // The PDF of the statement is the printable document of PR E, from the same data.
        var printable = new Elevant.Infrastructure.Finance.FinancialDocumentPdfRenderer().RenderStatement(
            AccountStatementDocuments.ToPrintable(Statement("PUJ · Aeropuerto Internacional de Punta Cana"), "USD",
                new AirlineCustomerHeader("Arajet", "DM", "RNC 1-31-23456-9"), At, "Ana Pérez Martínez"));
        Assert.StartsWith("%PDF", System.Text.Encoding.ASCII.GetString(printable, 0, 4));
        if (directory is { Length: > 0 }) File.WriteAllBytes(Path.Combine(directory, "finanzas-statement-documento.pdf"), printable);
    }

    private static ReportDocument Stamp(ReportDocument document) => document with
    {
        GeneratedAt = At, GeneratedBy = document.GeneratedBy ?? "Ana PÃ©rez MartÃ­nez", TimeZoneId = "America/Santo_Domingo",
    };

    private static DateOnly Day(int offset) => new DateOnly(2026, 11, 1).AddDays(offset);

    private static DateTime Moment(int offset, int hour) => Day(offset).ToDateTime(new TimeOnly(hour, ((offset * 7) % 60 + 60) % 60));

    private static ReportDocument Tabular(string area, TabularReportDefinition definition, int count,
        Func<int, IReadOnlyList<ReportCell>> row, IReadOnlyList<ReportMetric> summary, IReadOnlyList<ReportFilter> filters,
        DateOnly? from = null, DateOnly? to = null, string? notes = null) =>
        Stamp(new ReportDocument(area, definition.Title, definition.Columns, Enumerable.Range(0, count).Select(row).ToArray())
        {
            Description = definition.Description,
            From = from,
            To = to ?? new DateOnly(2026, 11, 21),
            AsOfDate = definition.Period != ReportPeriod.Range,
            StationScope = area == ContractsReportCatalog.Area ? "Todas las aerolÃ­neas" : "Todas las estaciones",
            Filters = filters,
            Summary = summary,
            Notes = notes is null ? [] : [notes],
        });

    private static IEnumerable<(string Name, ReportDocument Document)> Documents()
    {
        var contracts = ContractsReportCatalog.All;
        yield return ("contratos-agreements", Tabular(ContractsReportCatalog.Area, contracts.Find("agreements")!, 14, index =>
        [
            ReportCell.Of(Airlines[index % 4]), ReportCell.Of($"CTR-2026-{index + 1:000}"), ReportCell.Value(index % 3 + 1),
            ReportCell.Of(index % 5 == 4 ? "Suspendido" : "Activo"), ReportCell.Of("Aprobada"), ReportCell.Date(Day(-300 + index * 9)),
            ReportCell.Date(Day(20 + index * 31)), ReportCell.Value(20 + index * 31 - 20), ReportCell.Of(index % 2 == 0 ? "PUJ, SDQ" : "PUJ"),
            ReportCell.Of(index % 3 == 0 ? "DOP" : "USD"), ReportCell.Value(index % 6 + 3), ReportCell.Date(Day(-320 + index * 9)),
        ], [new("Contratos", "14", "de 4 aerolÃ­neas"), new("Activos", "12", "de 14 contratos (85.7 %)"),
            new("Activos que vencen en 30 dÃ­as", "1", "de 12 activos (8.3 %)")],
            [new("Estado", "Activo"), new("Vence en", "365 dÃ­as")],
            notes: "La versiÃ³n es la aprobada que rige hoy o, si no hay, la mÃ¡s reciente sin descartar."));
        yield return ("contratos-rates", Tabular(ContractsReportCatalog.Area, contracts.Find("rates")!, 36, index =>
        [
            ReportCell.Of($"CTR-2026-{index / 6 + 1:000}"), ReportCell.Of(Airlines[index / 6 % 4]), ReportCell.Value(1),
            ReportCell.Of(Services[index % 6]), ReportCell.Of(index % 6 == 0 ? "Hora" : "OperaciÃ³n"),
            ReportCell.Of(index / 6 % 3 == 0 ? "DOP" : "USD"), ReportCell.Value(45m + index * 12.5m), ReportCell.Value(index % 6 == 0 ? 1 : 0),
            ReportCell.Date(Day(-200)), ReportCell.Date(Day(165)),
        ], [new("Tarifas", "36", "en 6 contratos"), new("Servicios con tarifa", "6", "de 9 servicios activos del catÃ¡logo")],
            [new("AerolÃ­nea", "Arajet")], notes: "Solo versiones aprobadas. El precio no se suma entre tarifas."));
        yield return ("contratos-requests", Tabular(ContractsReportCatalog.Area, contracts.Find("requests")!, 11, index =>
        [
            ReportCell.Of($"SOL-2026-{index + 40:0000}"), ReportCell.Of(Airlines[index % 4]), ReportCell.Of(People[(index + 1) % 4]),
            ReportCell.DateTime(Moment(index * 2, 9 + index % 8)),
            ReportCell.Of(index % 4 == 0 ? "Aprobada" : index % 4 == 1 ? "Rechazada" : index % 4 == 2 ? "En revisiÃ³n" : "Recibida"),
            index % 4 < 2 ? ReportCell.DateTime(Moment(index * 2 + 3, 15)) : ReportCell.Empty,
            index % 4 < 2 ? ReportCell.Of(People[index % 4]) : ReportCell.Empty,
            ReportCell.Of(string.Join(", ", Services.Skip(index % 4).Take(2 + index % 3).Select(item => item.Split(" Â· ")[1]))),
        ], [new("Recibidas", "11", "en el perÃ­odo"), new("Aprobadas", "3", "de 11 recibidas (27.3 %)"),
            new("Rechazadas", "3", "de 11 recibidas (27.3 %)"), new("Sin decidir", "5", "de 11 recibidas (45.5 %)")],
            [], Day(0), Day(29)));
        yield return ("contratos-permits", Tabular(ContractsReportCatalog.Area, contracts.Find("permits")!, 12, index =>
        [
            ReportCell.Of(Airlines[index % 4]),
            ReportCell.Of(index % 3 == 0 ? "Permiso de operaciÃ³n (JAC)" : index % 3 == 1 ? "Certificado de operador aÃ©reo" : "PÃ³liza de seguro"),
            ReportCell.Of($"JAC-{2024 + index % 3}-{index * 37 + 100}"), ReportCell.Of(index % 3 == 2 ? "Seguros Universal" : "Junta de AviaciÃ³n Civil"),
            ReportCell.Date(Day(-400 + index * 11)), ReportCell.Date(Day(-20 + index * 25)),
            ReportCell.Of(index == 0 ? "Vencido" : index < 3 ? "Vence en 30 dÃ­as" : "Vigente"),
            ReportCell.Of(index % 5 == 3 ? "Pendiente de revisiÃ³n" : "Verificado"),
            index % 5 == 3 ? ReportCell.Empty : ReportCell.DateTime(Moment(-390 + index * 11, 11)),
            index % 5 == 3 ? ReportCell.Empty : ReportCell.Of(People[index % 4]), ReportCell.DateTime(Moment(-395 + index * 11, 10)),
        ], [new("Permisos", "12", "de 4 aerolÃ­neas"), new("Verificados", "10", "de 12 permisos (83.3 %)"),
            new("Vencen en 30 dÃ­as", "2", "de 12 permisos (16.7 %)"), new("Vencidos", "1", "de 12 permisos (8.3 %)")], []));

        // Finanzas: Â«Facturas emitidasÂ» and Â«CobrosÂ» go through the Finance document; the statement through its own.
        string Money(decimal value) => value.ToString("0.00", CultureInfo.InvariantCulture);
        FinanceReportData Finance(string key, IReadOnlyList<FinanceReportColumn> columns, int count, Func<int, IReadOnlyList<string?>> row,
            IReadOnlyList<FinanceReportMetric> summary, string note)
        {
            var definition = FinanceReports.All.Single(item => item.Key == key);
            return new FinanceReportData(key, definition.Title, definition.Description, Day(0), Day(29), null, summary, columns,
                Enumerable.Range(0, count).Select(row).ToArray(), [note])
            {
                Filters = [new("EstaciÃ³n", "PUJ Â· Aeropuerto Internacional de Punta Cana"), new("AerolÃ­nea", "Todas"),
                    new("Moneda", "Todas")],
            };
        }
        static FinanceReportColumn C(string key, string label, string type = "text") => new(key, label, type);
        yield return ("finanzas-invoices", FinanceReportDocuments.ToDocument(Finance("invoices",
            [C("date", "EmisiÃ³n", "date"), C("fiscalNumber", "e-NCF"), C("number", "NÃºmero interno"), C("airline", "AerolÃ­nea"),
                C("station", "EstaciÃ³n"), C("currency", "Moneda"), C("due", "Vence", "date"), C("status", "Estado"),
                C("subtotal", "Subtotal", "money"), C("tax", "ITBIS", "money"), C("total", "Total", "money"),
                C("paid", "Pagado", "money"), C("balance", "Saldo", "money")], 22, index =>
            {
                var subtotal = 850m + index * 137.25m;
                var total = subtotal * 1.18m;
                var paid = index % 3 == 0 ? total : index % 3 == 1 ? decimal.Round(total / 2, 2) : 0m;
                return [Day(index).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), $"E31{index + 1:0000000000}",
                    $"DEV-NF-2026-{index + 101:000000}", Airlines[index % 4], "PUJ", index % 5 == 0 ? "DOP" : "USD",
                    Day(index + 30).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture),
                    index % 3 == 0 ? "Pagada" : index % 4 == 0 ? "Vencida" : "Pendiente", Money(subtotal), Money(total - subtotal),
                    Money(total), Money(paid), Money(total - paid)];
            },
            [new("Facturas", "22", "number", null, "emitidas en el perÃ­odo"), new("Vencidas", "4", "number", null, "de 22 facturas"),
                new("Facturado USD", "31245.80", "money", "USD", "en 17 facturas"),
                new("Saldo USD", "18210.40", "money", "USD", "58.3 % de lo facturado")],
            "Estado, pagado y saldo al 30/11/2026."), "Ana PÃ©rez MartÃ­nez", At));
        yield return ("finanzas-receipts", FinanceReportDocuments.ToDocument(Finance("receipts",
            [C("date", "Fecha", "date"), C("airline", "AerolÃ­nea"), C("station", "EstaciÃ³n"), C("currency", "Moneda"),
                C("method", "MÃ©todo"), C("reference", "Referencia"), C("kind", "Origen"), C("received", "Recibido", "money"),
                C("applied", "Aplicado", "money"), C("refunded", "Devuelto", "money"), C("remaining", "Remanente", "money")], 16, index =>
            {
                var received = 1200m + index * 310m;
                var applied = index % 4 == 3 ? 0m : decimal.Round(received * (index % 2 == 0 ? 1m : 0.6m), 2);
                return [Day(index + 1).ToString("yyyy-MM-dd", CultureInfo.InvariantCulture), Airlines[index % 4], "PUJ",
                    index % 5 == 0 ? "DOP" : "USD", index % 3 == 0 ? "Tarjeta" : "Transferencia", $"TRF-{88120 + index * 7}",
                    index % 4 == 3 ? "Reversado" : "Recibo", Money(received), Money(applied), "0.00",
                    Money(index % 4 == 3 ? 0m : received - applied)];
            },
            [new("Cobros", "16", "number", null, "recibidos en el perÃ­odo"),
                new("Recibido USD", "28430.00", "money", "USD", "en 13 cobros"),
                new("Remanente USD", "4120.00", "money", "USD", "14.5 % de lo recibido")],
            "Aplicado, devuelto y remanente al 30/11/2026, en la moneda del cobro."), "Ana PÃ©rez MartÃ­nez", At));
        yield return ("finanzas-statement", Stamp(AccountStatementDocuments.ToDocument(Statement("PUJ Â· Aeropuerto Internacional de Punta Cana"))));

        // GestiÃ³n Humana.
        var hr = HumanResourcesTableReports.All;
        string[] positions = ["Agente de rampa", "Supervisor de rampa", "Analista de nÃ³mina", "Coordinador OCC", "Contador"];
        yield return ("gh-staff-roster", Tabular(HumanResourcesReportCatalog.Area, hr.Find("staff-roster")!, 30, index =>
        [
            ReportCell.Of($"EMP-{index + 1001}"), ReportCell.Of(People[index % 4] + (index >= 4 ? $" {index}" : "")),
            ReportCell.Of(positions[index % 5]),
            ReportCell.Of(index % 5 < 2 ? "Operaciones (OCC)" : index % 5 == 2 ? "GestiÃ³n Humana" : index % 5 == 3 ? "Operaciones (OCC)" : "Finanzas"),
            ReportCell.Of(index % 3 == 0 ? "PUJ, SDQ" : "PUJ"), ReportCell.Of(index % 9 == 8 ? "De baja" : "Activo"),
            ReportCell.Date(Day(-900 + index * 23)), ReportCell.Of(index % 6 == 5 ? "Sin cuenta" : "Activa"),
            ReportCell.Of(index % 6 == 5 ? null : $"empleado{index + 1001}@aviam.com.do"),
        ], [new("Empleados", "30", "en la plantilla filtrada"), new("Activos", "27", "de 30 empleados (90.0 %)"),
            new("Con cuenta de acceso", "25", "de 30 empleados (83.3 %)"), new("Agentes de rampa", "6", "de 30 empleados (20.0 %)")],
            [new("Estado", "Activo")]));
        string[] actions = ["IniciÃ³ sesiÃ³n", "RegistrÃ³ un empleado", "ValidÃ³ un acceso", "TrasladÃ³ un empleado",
            "ExportÃ³ un reporte de Finanzas", "RestableciÃ³ una contraseÃ±a"];
        string[] targets = ["SesiÃ³n", "Empleado", "Solicitud de acceso", "Empleado", "Reporte", "Cuenta"];
        yield return ("gh-audit-trail", Tabular(HumanResourcesReportCatalog.Area, hr.Find("audit-trail")!, 40, index =>
        [
            ReportCell.DateTime(Moment(index / 2, 7 + index % 12)), ReportCell.Of(People[index % 4]),
            ReportCell.Of(actions[index % 6]), ReportCell.Of(targets[index % 6]),
            ReportCell.Of(index % 3 == 0 ? "GestiÃ³n Humana" : "Finanzas"), ReportCell.Of(index % 2 == 0 ? "PUJ" : null),
            ReportCell.Of(index % 6 == 3 ? "Cambio de estaciÃ³n por reestructuraciÃ³n del turno de madrugada" : null),
        ], [new("Movimientos", "40", "de 4 personas o procesos"), new("Inicios de sesiÃ³n", "7", "de 40 movimientos (17.5 %)")],
            [new("Tipo", "Usuarios y accesos")], Day(0), Day(20)));

        // Portal de aerolÃ­neas.
        var portal = AirlinePortalReports.All;
        yield return ("portal-operations", Stamp(Tabular(AirlinePortalReports.Area, portal.Find("operations")!, 34, index =>
        [
            ReportCell.Date(Day(index / 3)), ReportCell.Of($"PUJ-{20261101 + index / 3}-{index / 3 + 1:000}"),
            ReportCell.Of($"DM{410 + index / 3 * 2} / DM{411 + index / 3 * 2}"), ReportCell.Of("PUJ"),
            ReportCell.Of(index / 3 % 5 == 4 ? "En revisiÃ³n" : "Aprobada"),
            ReportCell.Of(index / 3 % 5 == 4 ? "Pendiente de aprobaciÃ³n de AVIAM" : Services[index % 6]),
            index / 3 % 5 == 4 ? ReportCell.Empty : ReportCell.Of("Ejecutado"),
            index / 3 % 5 == 4 ? ReportCell.Empty : ReportCell.Value(index % 6 == 0 ? 1.5m : 1m),
            index / 3 % 5 == 4 ? ReportCell.Empty : ReportCell.Of(index % 6 == 0 ? "Hora" : "OperaciÃ³n"),
        ], [new("Operaciones", "12", "en el perÃ­odo"), new("Aprobadas por AVIAM", "10", "de 12 operaciones (83.3 %)"),
            new("Servicios ejecutados", "30", "en 10 operaciones aprobadas")],
            [new("AerolÃ­nea", "Arajet")], Day(0), Day(20)) with { Audience = AirlinePortalReports.Audience,
                StationScope = "Todas las estaciones de su contrato", GeneratedBy = "Laura GÃ³mez" }));
        yield return ("portal-invoices", Stamp(Tabular(AirlinePortalReports.Area, portal.Find("invoices")!, 9, index =>
        {
            var total = 1180m + index * 236m;
            var paid = index % 3 == 0 ? total : 0m;
            return
            [
                ReportCell.Date(Day(index * 3)), ReportCell.Of($"E31{index + 1:0000000000}"), ReportCell.Of("PUJ"), ReportCell.Of("USD"),
                ReportCell.Date(Day(index * 3 + 30)), ReportCell.Of(paid > 0 ? "Pagada" : index == 1 ? "Vencida" : "Pendiente"),
                ReportCell.Value(total), ReportCell.Value(paid), ReportCell.Value(0m), ReportCell.Value(total - paid),
            ];
        }, [new("Facturas", "9", "emitidas en el perÃ­odo"), new("Pagadas", "3", "de 9 facturas (33.3 %)"),
            new("Saldo USD", "USD 9,676.00", "en 6 facturas con saldo")],
            [new("AerolÃ­nea", "Arajet")], Day(0), Day(29)) with { Audience = AirlinePortalReports.Audience,
                StationScope = "Todas las estaciones de su contrato", Notice = FinanceInvoicePolicy.Disclaimer, GeneratedBy = "Laura GÃ³mez" }));
        yield return ("portal-statement", Stamp(AccountStatementDocuments.ToDocument(Statement("Todas las estaciones de su contrato")) with
        {
            Audience = AirlinePortalReports.Audience, GeneratedBy = "Laura GÃ³mez",
        }));
    }

    private static AccountStatementInput Statement(string station)
    {
        var invoices = Enumerable.Range(0, 8).Select(index => new AccountStatementInvoice(Guid.NewGuid(), $"DEV-NF-{index + 1:000}",
            $"E31{index + 1:0000000000}", index == 7 ? "DOP" : "USD", 1180m + index * 354m,
            index < 3 ? 0m : 1180m + index * 354m - (index == 4 ? 500m : 0m), Day(index * 9 - 40))).ToArray();
        var movements = new List<AccountStatementMovement>();
        foreach (var (invoice, index) in invoices.Select((invoice, index) => (invoice, index)))
        {
            movements.Add(new("Invoice", invoice.Id, invoice.CurrencyCode, invoice.Total, Day(index * 9 - 70), invoice.FiscalNumber!));
            if (index < 3)
            {
                movements.Add(new("Receipt", null, "USD", invoice.Total, Day(index * 9 - 50), $"TRF-{4410 + index}"));
                movements.Add(new("Application", invoice.Id, "USD", invoice.Total, Day(index * 9 - 50), $"TRF-{4410 + index}"));
            }
        }
        movements.Add(new("Receipt", null, "USD", 900m, Day(-5), "TRF-4450"));
        movements.Add(new("Application", invoices[4].Id, "USD", 500m, Day(-5), "TRF-4450"));
        movements.Add(new("Credit", invoices[5].Id, "USD", 0m, Day(-3), "E340000000001"));
        return new AccountStatementInput("Arajet", station, new DateOnly(2026, 11, 20), invoices, movements,
        [
            new FinanceTreasuryAgingData("DOP", invoices[7].Balance, invoices[7].Balance, 0m, 0m, 0m, 0m, 0m, 0m),
            new FinanceTreasuryAgingData("USD", invoices.Where(item => item.CurrencyCode == "USD").Sum(item => item.Balance),
                1888m, 2242m, 1652m, 2006m, 0m, 400m, 0m),
        ]);
    }
}
