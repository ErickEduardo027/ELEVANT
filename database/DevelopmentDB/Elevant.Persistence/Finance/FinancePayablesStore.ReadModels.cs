using Elevant.Application.Common;
using Elevant.Application.Finance;
using Elevant.Domain.Entities;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinancePayablesStore
{
    private async Task<Guid?> PublicAsync<T>(long? id, CancellationToken ct) where T : AuditableEntity => id is null ? null :
        await context.Set<T>().Where(x => x.Id == id).Select(x => (Guid?)x.PublicId).SingleAsync(ct);
    private async Task<FinancePayablesDimensions> DimensionsViewAsync(long? station, long? airline, long? turn, long? service, CancellationToken ct) =>
        new(await PublicAsync<Station>(station, ct), await PublicAsync<Airline>(airline, ct), await PublicAsync<Turnaround>(turn, ct), await PublicAsync<ServiceDefinition>(service, ct));
    private static FinancePayablesFx FxView(string currency, decimal rate, string source, DateOnly date) => new(currency, rate, source, date);
    /// <summary>The attachments a document shows; 4-N13: a removed one stays only as history.</summary>
    private async Task<IReadOnlyList<FinancePayablesAttachmentView>> AttachmentsViewAsync(long id, bool expense, CancellationToken ct) =>
        await context.Set<FinancePayablesAttachment>().AsNoTracking().Where(x => (expense ? x.ExpenseClaimId == id : x.SupplierInvoiceId == id) && x.RemovedAt == null)
            .OrderBy(x => x.Id).Select(x => new FinancePayablesAttachmentView(x.PublicId, x.ContentType, x.Length, x.Sha256, x.CreatedAt)).ToArrayAsync(ct);
    /// <summary>A supplier invoice as <paramref name="a"/> reads it; 4-N14: it says whether that reader may approve it.</summary>
    private async Task<FinancePayablesView> InvoiceViewAsync(Actor a, SupplierInvoice row, CancellationToken ct)
    {
        var supplier = await context.Set<Supplier>().AsNoTracking().SingleAsync(x => x.Id == row.SupplierId, ct);
        var lines = await context.Set<SupplierInvoiceLine>().AsNoTracking().Where(x => x.DocumentId == row.Id).OrderBy(x => x.LineNumber)
            .Select(x => new FinancePayablesLineView(x.PublicId, x.LineNumber, x.Description, x.Quantity, x.UnitPrice, x.TaxAmount, x.Total)).ToArrayAsync(ct);
        var reviews = await (from r in context.Set<SupplierInvoiceReview>().AsNoTracking() join u in context.Users on r.ActorAccountId equals u.Id
            where r.DocumentId == row.Id orderby r.Id select new FinancePayablesReviewView(r.Stage, r.Decision, u.PublicId, r.DecidedAt, r.Reason)).ToArrayAsync(ct);
        var paid = await CurrentApplications().Where(x => x.SupplierInvoiceId == row.Id).SumAsync(x => (decimal?)x.InvoiceAmount, ct) ?? 0m;
        // 4-N03: a voided invoice owes nothing and was never paid (its applications were reversed first).
        var voided = row.Status == SupplierInvoiceStatus.Voided;
        if (voided) paid = 0m;
        return new(row.PublicId, supplier.PublicId, supplier.Name, (await PublicAsync<Station>(row.ScopeStationId, ct))!.Value,
            row.DocumentReference, row.DocumentDate, row.DueDate, row.Status.ToString(), FxView(row.CurrencyCode, row.FxToDop, row.FxSource, row.FxDate),
            await DimensionsViewAsync(row.StationId, row.AirlineId, row.TurnaroundId, row.ServiceDefinitionId, ct), row.Total, row.TotalDop, paid, voided ? 0m : row.Total - paid,
            Version(row.RowVersion), lines, await AttachmentsViewAsync(row.Id, false, ct), reviews, await ApprovalBlockedAsync(a, row, ct));
    }
    private async Task<FinancePayablesPaymentView> PaymentViewAsync(FinancePayablesPayment row, CancellationToken ct)
    {
        var supplier = await context.Set<Supplier>().AsNoTracking().Where(x => x.Id == row.SupplierId).Select(x => x.PublicId).SingleAsync(ct);
        // 4-N04: a reversed application stays listed with its instant and reason, but no longer counts.
        var end = SettlementCutoff;
        var applications = await (from a in EffectiveApplications().AsNoTracking() join i in context.Set<SupplierInvoice>() on a.SupplierInvoiceId equals i.Id
            join r in context.Set<FinancePayablesReversal>().Where(r => r.ApplicationId != null && r.ReversedAt < end) on (long?)a.Id equals r.ApplicationId into reversed
            from r in reversed.DefaultIfEmpty()
            where a.PaymentId == row.Id orderby a.Id
            select new FinancePayablesApplicationView(a.PublicId, i.PublicId, a.PaymentAmount, a.InvoiceAmount, a.RateToInvoice, a.AppliedAt,
                r == null ? (DateTimeOffset?)null : r.ReversedAt, r == null ? null : r.Reason)).ToArrayAsync(ct);
        var applied = applications.Where(x => x.ReversedAt is null).Sum(x => x.PaymentAmount);
        var voided = await PaymentVoids().AsNoTracking().Where(v => v.PaymentId == row.Id && v.ReversedAt < end)
            .Select(v => new { v.ReversedAt, v.Reason }).SingleOrDefaultAsync(ct);
        var available = voided is null && row.PaidOn <= SettlementToday && row.CreatedAt < end ? row.Amount - applied : 0m;
        return new(row.PublicId, supplier, (await PublicAsync<Station>(row.ScopeStationId, ct))!.Value, row.PaidOn, row.Reference,
            FxView(row.CurrencyCode, row.FxToDop, row.FxSource, row.FxDate), row.Amount, applied, available, Version(row.RowVersion), applications,
            voided?.ReversedAt, voided?.Reason);
    }
    /// <summary>
    /// An expense as its readers see it; 4-N13: a submitted one says who reviews it. A list shares the staff of each station
    /// through <paramref name="staffByStation"/>, so the route costs one staff read per station, not per row.
    /// </summary>
    private async Task<EmployeeExpenseView> ExpenseViewAsync(EmployeeExpenseClaim row, CancellationToken ct,
        Dictionary<long, IReadOnlyList<StationStaff>>? staffByStation = null)
    {
        var employee = await context.Employees.AsNoTracking().SingleAsync(x => x.Id == row.EmployeeId, ct);
        var account = await context.Users.Where(x => x.Id == row.CreatedByAccountId).Select(x => new { x.PublicId, x.PersonId }).SingleAsync(ct);
        var requester = account.PublicId;
        string? route = null;
        if (row.Status == EmployeeExpenseStatus.Submitted)
        {
            staffByStation ??= [];
            if (!staffByStation.TryGetValue(row.ScopeStationId, out var staff))
                staffByStation[row.ScopeStationId] = staff = await StationStaffAsync(row.ScopeStationId, clock.GetUtcNow(), ct);
            route = ExpenseReviewRoute(row, employee.PersonId, account.PersonId, staff);
        }
        var lines = await context.Set<EmployeeExpenseLine>().AsNoTracking().Where(x => x.DocumentId == row.Id).OrderBy(x => x.LineNumber)
            .Select(x => new FinancePayablesLineView(x.PublicId, x.LineNumber, x.Description, x.Quantity, x.UnitPrice, x.TaxAmount, x.Total)).ToArrayAsync(ct);
        var reviews = await (from r in context.Set<EmployeeExpenseReview>().AsNoTracking() join u in context.Users on r.ActorAccountId equals u.Id
            where r.DocumentId == row.Id orderby r.Id select new FinancePayablesReviewView(r.Stage, r.Decision, u.PublicId, r.DecidedAt, r.Reason)).ToArrayAsync(ct);
        var payments = await CurrentReimbursements().AsNoTracking().Where(x => x.ExpenseClaimId == row.Id).OrderBy(x => x.Id).ToArrayAsync(ct);
        var paid = payments.Sum(x => x.ExpenseAmount);
        return new(row.PublicId, employee.PublicId, employee.EmployeeNumber, requester, row.Department.ToString(),
            (await PublicAsync<Station>(row.ScopeStationId, ct))!.Value, row.Description, row.ExpenseDate, row.Status.ToString(),
            FxView(row.CurrencyCode, row.FxToDop, row.FxSource, row.FxDate), await DimensionsViewAsync(row.StationId, row.AirlineId, row.TurnaroundId, row.ServiceDefinitionId, ct),
            row.Total, row.TotalDop, paid, row.Total - paid, Version(row.RowVersion), lines, await AttachmentsViewAsync(row.Id, true, ct), reviews,
            payments.Select(p => new EmployeeExpensePaymentView(p.PublicId, p.PaidOn, p.Reference, FxView(p.CurrencyCode, p.FxToDop, p.FxSource, p.FxDate), p.Amount, p.ExpenseAmount, p.RateToExpense)).ToArray(),
            route);
    }
    public Task<FinancePayablesResult<FinancePayablesOptions>> OptionsAsync(Guid actorId, Guid? scopeStationId, CancellationToken ct = default) =>
        ReadAsync(actorId, "", async a =>
        {
            // 4-N28: an own expense depends only on the active employee, never on a Finance code.
            Require(OwnExpenseAccess(a) || a.Context.HasPermission("finance.expenses.read") ||
                a.Context.HasPermission("finance.suppliers.read") || a.Context.HasPermission("finance.suppliers.update") ||
                a.Context.HasPermission("finance.payables.read") || a.Context.HasPermission("finance.payables.create") ||
                a.Context.EffectiveAccess?.Kind == DepartmentAssignmentKind.Administrator, "forbidden");
            var station = scopeStationId is { } id ? await StationAsync(a, id, ct) : (long?)null;
            var stations = await context.Set<Station>().Where(x => a.Stations.Contains(x.Id)).OrderBy(x => x.Code).Select(x => new FinancePayablesOption(x.PublicId, x.Code, x.Name)).ToArrayAsync(ct);
            var suppliers = a.Context.HasPermission("finance.suppliers.read") || a.Context.HasPermission("finance.payables.create") || a.Context.HasPermission("finance.payables.read")
                ? await context.Set<Supplier>().Where(x => a.Stations.Contains(x.ScopeStationId) && x.IsActive && (station == null || x.ScopeStationId == station))
                    .OrderBy(x => x.Code).Select(x => new FinancePayablesOption(x.PublicId, x.Code, x.Name)).ToArrayAsync(ct) : [];
            var airlines = await context.Set<Airline>().Where(x => x.IsActive).OrderBy(x => x.IataCode).Select(x => new FinancePayablesOption(x.PublicId, x.IataCode ?? x.IcaoCode, x.Name)).ToArrayAsync(ct);
            var services = await context.Set<ServiceDefinition>().Where(x => x.IsActive).OrderBy(x => x.Code).Select(x => new FinancePayablesOption(x.PublicId, x.Code, x.Name)).ToArrayAsync(ct);
            var turns = await context.Set<Turnaround>().Where(x => a.Stations.Contains(x.StationId) && (station == null || x.StationId == station))
                .OrderByDescending(x => x.OperationDate).ThenByDescending(x => x.Id).Take(200).Select(x => new FinancePayablesOption(x.PublicId, x.OperationCode, x.OperationCode)).ToArrayAsync(ct);
            var own = OwnExpenseAccess(a); var today = BusinessCalendar.Today(clock.GetUtcNow());
            var canCreateOwn = own && await context.EmployeeStations.AnyAsync(s => s.EmployeeId == a.Employee!.Id &&
                a.Stations.Contains(s.StationId) && (station == null || s.StationId == station) && s.ValidFrom <= today && (s.ValidTo == null || s.ValidTo >= today), ct);
            return new FinancePayablesOptions(stations, suppliers, airlines, services, turns, ["USD", "DOP"], a.Employee?.PublicId, a.Employee?.Department.ToString(),
                canCreateOwn, own, a.Context.EffectiveAccess is { Kind: DepartmentAssignmentKind.Administrator, Department: not null },
                Finance(a, "finance.expenses.read"), Finance(a, "finance.expenses.approve"), Finance(a, "finance.expenses.pay"));
        }, ct);
}
