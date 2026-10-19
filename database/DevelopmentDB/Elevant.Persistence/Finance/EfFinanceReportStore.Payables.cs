using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

internal sealed partial class EfFinanceReportStore
{
    private sealed record PayableRow(long Id, long SupplierId, string Supplier, string Reference, string Station,
        string Currency, DateOnly Date, DateOnly Due, decimal Total, decimal TotalDop, decimal Applied);

    private async Task<PayableRow[]> ApprovedPayablesAsync(Scope scope, CancellationToken ct)
    {
        var end = EndOf(scope.Filter.To);
        var documents = await (from document in context.Set<SupplierInvoice>().AsNoTracking()
            join supplier in context.Set<Supplier>().AsNoTracking() on document.SupplierId equals supplier.Id
            join station in context.Stations.AsNoTracking() on document.ScopeStationId equals station.Id
            where scope.StationIds.Contains(document.ScopeStationId) && scope.StationIds.Contains(supplier.ScopeStationId) &&
                document.CreatedAt < end && document.DocumentDate <= scope.Filter.To &&
                (scope.AirlineId == null || document.AirlineId == scope.AirlineId) &&
                (scope.Filter.CurrencyCode == null || document.CurrencyCode == scope.Filter.CurrencyCode)
            select new { Document = document, Supplier = supplier.Code + " · " + supplier.Name, Station = station.Code }).ToArrayAsync(ct);
        var ids = documents.Select(d => d.Document.Id).ToArray();
        var reviews = await context.Set<SupplierInvoiceReview>().AsNoTracking().Where(r => ids.Contains(r.DocumentId) && r.DecidedAt < end)
            .OrderBy(r => r.DecidedAt).ThenBy(r => r.Id).ToArrayAsync(ct);
        var statuses = reviews.GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.Last().Decision);
        var applications = await (from a in context.Set<FinancePayablesApplication>().AsNoTracking()
            join payment in context.Set<FinancePayablesPayment>().AsNoTracking() on a.PaymentId equals payment.Id
            where ids.Contains(a.SupplierInvoiceId) && a.AppliedAt < end &&
                payment.CreatedAt < end && payment.PaidOn <= scope.Filter.To
            select new { a.SupplierInvoiceId, a.InvoiceAmount }).ToArrayAsync(ct);
        var paid = applications.GroupBy(a => a.SupplierInvoiceId).ToDictionary(g => g.Key, g => g.Sum(a => a.InvoiceAmount));
        return documents.Where(d => statuses.GetValueOrDefault(d.Document.Id,
                d.Document.UpdatedAt < end ? d.Document.Status.ToString() : "Draft") == "Approved")
            .Select(d => new PayableRow(d.Document.Id, d.Document.SupplierId, d.Supplier, d.Document.DocumentReference, d.Station,
                d.Document.CurrencyCode, d.Document.DocumentDate, d.Document.DueDate, d.Document.Total, d.Document.TotalDop,
                paid.GetValueOrDefault(d.Document.Id))).ToArray();
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        PayablesReportAsync(Scope scope, bool bySupplier, CancellationToken ct)
    {
        var documents = await ApprovedPayablesAsync(scope, ct);
        var summary = documents.GroupBy(d => d.Currency).SelectMany(g => new[] {
            new FinanceReportMetric($"Por pagar {g.Key}", Money(g.Sum(d => d.Total - d.Applied)), "money", g.Key),
            new FinanceReportMetric($"Vencido {g.Key}", Money(g.Where(d => d.Due < scope.Filter.To).Sum(d => d.Total - d.Applied)), "money", g.Key),
        }).ToList();
        if (!bySupplier)
            return (summary, [Col("reference", "Documento"), Col("supplier", "Proveedor"), Col("station", "Estación"), Col("date", "Fecha", "date"),
                    Col("due", "Vencimiento", "date"), Col("currency", "Moneda"), Col("total", "Aprobado", "money"), Col("applied", "Aplicado", "money"),
                    Col("balance", "Saldo", "money"), Col("dop", "Total DOP congelado", "money")],
                documents.OrderBy(d => d.Due).ThenBy(d => d.Reference).Select(d => (IReadOnlyList<string?>)[d.Reference, d.Supplier, d.Station,
                    DateText(d.Date), DateText(d.Due), d.Currency, Money(d.Total), Money(d.Applied), Money(d.Total - d.Applied), Money(d.TotalDop)]).ToArray(),
                [$"Obligaciones aprobadas al {DateText(scope.Filter.To)}. Los pagos sin aplicar no reducen facturas; los importes aplicados están en moneda de factura."]);

        var end = EndOf(scope.Filter.To);
        var payments = await (from p in context.Set<FinancePayablesPayment>().AsNoTracking()
            join supplier in context.Set<Supplier>().AsNoTracking() on p.SupplierId equals supplier.Id
            where scope.StationIds.Contains(p.ScopeStationId) && scope.StationIds.Contains(supplier.ScopeStationId) && p.CreatedAt < end && p.PaidOn <= scope.Filter.To &&
                (scope.Filter.CurrencyCode == null || p.CurrencyCode == scope.Filter.CurrencyCode) && scope.AirlineId == null
            select new { Payment = p, Supplier = supplier.Code + " · " + supplier.Name }).ToArrayAsync(ct);
        var ids = payments.Select(p => p.Payment.Id).ToArray();
        // Source payments are already scoped. Every allocation reduces their remanent, irrespective of destination dimensions.
        var allocations = await context.Set<FinancePayablesApplication>().AsNoTracking()
            .Where(application => ids.Contains(application.PaymentId) && application.AppliedAt < end)
            .Select(application => new { application.PaymentId, application.PaymentAmount }).ToArrayAsync(ct);
        var used = allocations.GroupBy(a => a.PaymentId).ToDictionary(g => g.Key, g => g.Sum(a => a.PaymentAmount));
        var keys = documents.Select(d => (d.SupplierId, d.Supplier, d.Currency)).Concat(payments.Select(p =>
            (p.Payment.SupplierId, p.Supplier, Currency: p.Payment.CurrencyCode))).Distinct().OrderBy(k => k.Supplier).ThenBy(k => k.Currency);
        var rows = new List<IReadOnlyList<string?>>();
        foreach (var k in keys)
        {
            var invoices = documents.Where(d => d.SupplierId == k.SupplierId && d.Currency == k.Currency).ToArray();
            var unapplied = payments.Where(p => p.Payment.SupplierId == k.SupplierId && p.Payment.CurrencyCode == k.Currency)
                .Sum(p => p.Payment.Amount - used.GetValueOrDefault(p.Payment.Id));
            rows.Add([k.Supplier, k.Currency, Number(invoices.Length), Money(invoices.Sum(d => d.Total)), Money(invoices.Sum(d => d.Applied)),
                Money(invoices.Sum(d => d.Total - d.Applied)), scope.AirlineId is null ? Money(unapplied) : null]);
        }
        summary.AddRange(payments.GroupBy(p => p.Payment.CurrencyCode).Select(g => new FinanceReportMetric($"Pago sin aplicar {g.Key}",
            Money(g.Sum(p => p.Payment.Amount - used.GetValueOrDefault(p.Payment.Id))), "money", g.Key)));
        return (summary, [Col("supplier", "Proveedor"), Col("currency", "Moneda"), Col("documents", "Facturas", "number"),
            Col("total", "Aprobado", "money"), Col("applied", "Aplicado", "money"), Col("balance", "Saldo", "money"), Col("unapplied", "Pago sin aplicar", "money")], rows,
            ["Saldos al cierre. Los pagos se cuentan una sola vez; su remanente se calcula en moneda del pago, las aplicaciones en moneda de factura.",
                "Con filtro de aerolínea se omiten los pagos sin aplicar: no tienen esa dimensión hasta su aplicación."]);
    }

    private async Task<(IReadOnlyList<FinanceReportMetric>, IReadOnlyList<FinanceReportColumn>, IReadOnlyList<IReadOnlyList<string?>>, IReadOnlyList<string>)>
        ExpensesReportAsync(Scope scope, CancellationToken ct)
    {
        var end = EndOf(scope.Filter.To);
        var expenses = await (from e in context.Set<EmployeeExpenseClaim>().AsNoTracking()
            join employee in context.Employees.AsNoTracking() on e.EmployeeId equals employee.Id
            join station in context.Stations.AsNoTracking() on e.ScopeStationId equals station.Id
            where scope.StationIds.Contains(e.ScopeStationId) && e.CreatedAt < end && e.ExpenseDate >= scope.Filter.From && e.ExpenseDate <= scope.Filter.To &&
                (scope.AirlineId == null || e.AirlineId == scope.AirlineId) && (scope.Filter.CurrencyCode == null || e.CurrencyCode == scope.Filter.CurrencyCode)
            select new { Expense = e, Employee = employee.EmployeeNumber, Station = station.Code }).ToArrayAsync(ct);
        var ids = expenses.Select(e => e.Expense.Id).ToArray();
        var reviews = await context.Set<EmployeeExpenseReview>().AsNoTracking().Where(r => ids.Contains(r.DocumentId) && r.DecidedAt < end)
            .OrderBy(r => r.DecidedAt).ThenBy(r => r.Id).ToArrayAsync(ct);
        var statuses = reviews.GroupBy(r => r.DocumentId).ToDictionary(g => g.Key, g => g.Last().Decision);
        var payments = await context.Set<EmployeeExpensePayment>().AsNoTracking().Where(p => ids.Contains(p.ExpenseClaimId) && p.CreatedAt < end && p.PaidOn <= scope.Filter.To).ToArrayAsync(ct);
        var paid = payments.GroupBy(p => p.ExpenseClaimId).ToDictionary(g => g.Key, g => g.Sum(p => p.ExpenseAmount));
        string Status(EmployeeExpenseClaim e) => statuses.GetValueOrDefault(e.Id, e.UpdatedAt < end ? e.Status.ToString() : "Draft");
        var approved = expenses.Where(e => Status(e.Expense) == "Approved").ToArray();
        var summary = approved.GroupBy(e => e.Expense.CurrencyCode).SelectMany(g => new[] {
            new FinanceReportMetric($"Gasto aprobado {g.Key}", Money(g.Sum(e => e.Expense.Total)), "money", g.Key),
            new FinanceReportMetric($"Por reembolsar {g.Key}", Money(g.Sum(e => e.Expense.Total - paid.GetValueOrDefault(e.Expense.Id))), "money", g.Key),
        }).ToArray();
        return (summary, [Col("date", "Fecha gasto", "date"), Col("employee", "Empleado"), Col("department", "Departamento"), Col("station", "Estación"),
                Col("status", "Etapa al corte"), Col("currency", "Moneda"), Col("total", "Solicitado", "money"), Col("reimbursed", "Reembolsado", "money"),
                Col("balance", "Por reembolsar", "money"), Col("dop", "Total DOP congelado", "money")],
            expenses.OrderBy(e => e.Expense.ExpenseDate).ThenBy(e => e.Employee).Select(e => (IReadOnlyList<string?>)[DateText(e.Expense.ExpenseDate),
                e.Employee, e.Expense.Department.ToString(), e.Station, Status(e.Expense), e.Expense.CurrencyCode, Money(e.Expense.Total),
                Money(paid.GetValueOrDefault(e.Expense.Id)), Status(e.Expense) == "Approved" ? Money(e.Expense.Total - paid.GetValueOrDefault(e.Expense.Id)) : null,
                Money(e.Expense.TotalDop)]).ToArray(),
            ["Las etapas se reconstruyen con las revisiones registradas hasta el corte. Solo la aprobación de Finanzas genera un importe por reembolsar; el reembolso usa el importe congelado en moneda del gasto."]);
    }
}
