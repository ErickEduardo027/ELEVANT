using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinancePayablesStore
{
    private static bool OwnExpenseAccess(Actor a) => FinancePayablesPolicy.CanUseOwnExpenses(a.Context, a.Employee is not null);
    private static bool CanReadExpense(Actor a, EmployeeExpenseClaim row) =>
        OwnExpenseAccess(a) && a.Employee!.Id == row.EmployeeId ||
        Finance(a, "finance.expenses.read") ||
        a.Context.EffectiveAccess is { Kind: DepartmentAssignmentKind.Administrator } access && access.Department == row.Department;
    private async Task<EmployeeExpenseClaim> ExpenseAsync(Actor a, Guid id, CancellationToken ct)
    {
        var row = await context.Set<EmployeeExpenseClaim>().SingleOrDefaultAsync(x => x.PublicId == id, ct);
        Require(row is not null, "not_found"); Scope(a, row!.ScopeStationId); Require(CanReadExpense(a, row), "not_found"); return row;
    }
    public Task<FinancePayablesResult<EmployeeExpenseView>> GetExpenseAsync(Guid actorId, Guid id, CancellationToken ct = default) =>
        ReadAsync(actorId, "", async a => await ExpenseViewAsync(await ExpenseAsync(a, id, ct), ct), ct);
    public Task<FinancePayablesResult<IReadOnlyList<EmployeeExpenseView>>> ListExpensesAsync(Guid actorId, FinancePayablesFilter filter, CancellationToken ct = default) =>
        ReadAsync<IReadOnlyList<EmployeeExpenseView>>(actorId, "", async a =>
        {
            Filter(filter); var station = await FilterStationAsync(a, filter, ct);
            var query = context.Set<EmployeeExpenseClaim>().AsNoTracking().Where(x => a.Stations.Contains(x.ScopeStationId));
            var finance = Finance(a, "finance.expenses.read"); var own = OwnExpenseAccess(a); var employeeId = a.Employee?.Id;
            var admin = a.Context.EffectiveAccess?.Kind == DepartmentAssignmentKind.Administrator; var department = a.Context.EffectiveAccess?.Department;
            Require(finance || own || admin, "forbidden");
            if (!finance) query = query.Where(x => own && x.EmployeeId == employeeId || admin && x.Department == department);
            if (filter.DepartmentOnly) query = query.Where(x => admin && x.Department == department);
            if (filter.OwnOnly) query = query.Where(x => own && x.EmployeeId == employeeId);
            if (station is not null) query = query.Where(x => x.ScopeStationId == station);
            if (filter.EmployeeId is { } emp) query = query.Where(x => context.Employees.Any(e => e.Id == x.EmployeeId && e.PublicId == emp));
            if (filter.Status is { } status) { Require(Enum.TryParse<EmployeeExpenseStatus>(status, out var parsed) && Enum.IsDefined(parsed)); query = query.Where(x => x.Status == parsed); }
            if (filter.From is { } from) query = query.Where(x => x.ExpenseDate >= from);
            if (filter.To is { } to) query = query.Where(x => x.ExpenseDate <= to);
            if (!string.IsNullOrWhiteSpace(filter.Search)) query = query.Where(x => x.Description.Contains(filter.Search));
            var reimbursements = CurrentReimbursements();
            if (filter.OutstandingOnly) query = query.Where(x => x.Status == EmployeeExpenseStatus.Approved && x.Total > (reimbursements.Where(p => p.ExpenseClaimId == x.Id).Sum(p => (decimal?)p.ExpenseAmount) ?? 0));
            var rows = await query.OrderByDescending(x => x.ExpenseDate).ThenBy(x => x.Id).Skip(filter.Skip).Take(filter.Take).ToArrayAsync(ct);
            var result = new List<EmployeeExpenseView>(); foreach (var row in rows) result.Add(await ExpenseViewAsync(row, ct)); return result;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> SaveExpenseAsync(Guid actorId, Guid? id, EmployeeExpenseSave input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "expense.save", id, input, "", async a =>
        {
            Require(OwnExpenseAccess(a), "forbidden");
            Require(Text(input.Description, 500)); var total = ValidateLines(input.Lines); var dop = ValidateFx(input.Fx, total, input.ExpenseDate);
            var station = await StationAsync(a, input.ScopeStationId, ct);
            Require(await context.EmployeeStations.AnyAsync(s => s.EmployeeId == a.Employee!.Id && s.StationId == station && s.ValidFrom <= input.ExpenseDate && (s.ValidTo == null || s.ValidTo >= input.ExpenseDate), ct), "forbidden");
            var dims = await DimensionsAsync(a, station, input.Dimensions, ct); var now = clock.GetUtcNow();
            var row = id is { } key ? await ExpenseAsync(a, key, ct) : new EmployeeExpenseClaim { PublicId = Guid.CreateVersion7(), CreatedAt = now,
                CreatedByAccountId = a.Id, EmployeeId = a.Employee!.Id, Department = a.Employee.Department, ScopeStationId = station };
            Require(row.CreatedByAccountId == a.Id && row.EmployeeId == a.Employee!.Id && row.Department == a.Employee.Department, "forbidden");
            if (id is not null) { Match(row.RowVersion, input.ExpectedVersion); Require(row.Status == EmployeeExpenseStatus.Draft, "conflict"); Require(row.ScopeStationId == station); }
            else context.Set<EmployeeExpenseClaim>().Add(row);
            row.Description = input.Description.Trim(); row.ExpenseDate = input.ExpenseDate;
            row.CurrencyCode = input.Fx.Currency; row.FxToDop = input.Fx.RateToDop!.Value; row.FxSource = input.Fx.Source.Trim(); row.FxDate = input.Fx.RateDate!.Value;
            row.Total = total; row.TotalDop = dop; row.StationId = dims.Station; row.AirlineId = dims.Airline; row.TurnaroundId = dims.Turnaround; row.ServiceDefinitionId = dims.Service;
            row.UpdatedAt = now; await context.SaveChangesAsync(ct);
            context.Set<EmployeeExpenseLine>().RemoveRange(await context.Set<EmployeeExpenseLine>().Where(x => x.DocumentId == row.Id).ToArrayAsync(ct)); await context.SaveChangesAsync(ct);
            context.Set<EmployeeExpenseLine>().AddRange(input.Lines.Select((l, i) => new EmployeeExpenseLine { PublicId = Guid.CreateVersion7(), DocumentId = row.Id,
                LineNumber = i + 1, Description = l.Description.Trim(), Quantity = l.Quantity, UnitPrice = l.UnitPrice, TaxAmount = l.TaxAmount,
                Total = FinancePayablesPolicy.LineTotal(l.Quantity, l.UnitPrice, l.TaxAmount) }));
            Audit(a, id is null ? "finance.expense.created" : "finance.expense.draft_updated", "commercial.employee_expense_claims", row.PublicId); return row.PublicId;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> DecideExpenseAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "expense.decide", id, input, "", async a =>
        {
            var row = await ExpenseAsync(a, id, ct); Match(row.RowVersion, input.ExpectedVersion);
            Require(OptionalText(input.Reason, 500) && FinancePayablesPolicy.CanTransitionExpense(row.Status.ToString(), input.Decision, input.Reason), "conflict");
            var requester = await context.Users.Where(x => x.Id == row.CreatedByAccountId).Select(x => x.PublicId).SingleAsync(ct);
            if (input.Decision != "Submitted") Require(!await context.Employees.AnyAsync(e => e.Id == row.EmployeeId && e.PersonId == a.PersonId, ct), "forbidden");
            string stage;
            if (input.Decision == "Submitted")
            {
                Require(a.Id == row.CreatedByAccountId && a.Employee?.Id == row.EmployeeId && OwnExpenseAccess(a), "forbidden");
                Require(await context.Set<FinancePayablesAttachment>().AnyAsync(x => x.ExpenseClaimId == row.Id, ct), "receipt_required"); stage = "Submission";
            }
            else if (row.Status == EmployeeExpenseStatus.Submitted)
            {
                Require(a.Employee?.Id != row.EmployeeId, "forbidden");
                Require(FinancePayablesPolicy.CanReviewDepartment(actorId, requester, a.Context.EffectiveAccess, row.Department), "forbidden"); stage = "Department";
            }
            else
            {
                Require(a.Id != row.CreatedByAccountId && a.Employee?.Id != row.EmployeeId && Finance(a, "finance.expenses.approve"), "forbidden");
                // A Finance employee still requires two different reviewers.
                Require(!await (from r in context.Set<EmployeeExpenseReview>() join u in context.Users on r.ActorAccountId equals u.Id
                    where r.DocumentId == row.Id && r.Stage == "Department" && u.PersonId == a.PersonId select r.Id).AnyAsync(ct), "forbidden");
                stage = "Finance";
            }
            row.Status = Enum.Parse<EmployeeExpenseStatus>(input.Decision); row.UpdatedAt = clock.GetUtcNow();
            context.Set<EmployeeExpenseReview>().Add(new EmployeeExpenseReview { DocumentId = row.Id, Stage = stage, Decision = input.Decision,
                Reason = input.Reason?.Trim(), ActorAccountId = a.Id, DecidedAt = clock.GetUtcNow() });
            Audit(a, "finance.expense." + input.Decision.ToLowerInvariant(), "commercial.employee_expense_claims", id, input.Reason); return id;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> ReimburseExpenseAsync(Guid actorId, Guid id, EmployeeExpensePaymentSave input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "expense.reimburse", id, input, "finance.expenses.pay", async a =>
        {
            Require(Finance(a, "finance.expenses.pay"), "forbidden"); var row = await ExpenseAsync(a, id, ct); Match(row.RowVersion, input.ExpectedVersion);
            Require(a.Id != row.CreatedByAccountId && !await context.Employees.AnyAsync(e => e.Id == row.EmployeeId && e.PersonId == a.PersonId, ct), "forbidden"); Require(row.Status == EmployeeExpenseStatus.Approved, "conflict");
            Require(Text(input.Reference, 100) && FinancePayablesPolicy.Money(input.Amount) && input.Amount > 0); RequireSettlementDate(input.PaidOn);
            var dop = ValidateFx(input.Fx, input.Amount, input.PaidOn);
            // Preserve the write cap across all retained records; current projections use only effective reimbursements.
            var paid = await context.Set<EmployeeExpensePayment>().Where(p => p.ExpenseClaimId == row.Id).SumAsync(p => (decimal?)p.ExpenseAmount, ct) ?? 0m;
            var rate = ApplicationRate(input.Fx.Currency, input.Fx.RateToDop!.Value, row.CurrencyCode, row.FxToDop, input.RateToExpense);
            Require(FinancePayablesPolicy.CanApply(input.Amount, row.Total - paid, input.Amount, rate), "conflict");
            var payment = new EmployeeExpensePayment { PublicId = Guid.CreateVersion7(), ExpenseClaimId = row.Id, PaidOn = input.PaidOn, Reference = input.Reference.Trim(),
                CurrencyCode = input.Fx.Currency, FxToDop = input.Fx.RateToDop.Value, FxSource = input.Fx.Source.Trim(), FxDate = input.Fx.RateDate!.Value,
                Amount = input.Amount, AmountDop = dop, RateToExpense = rate, ExpenseAmount = FinancePayablesPolicy.Round(input.Amount * rate), ActorAccountId = a.Id, CreatedAt = clock.GetUtcNow() };
            context.Set<EmployeeExpensePayment>().Add(payment); row.UpdatedAt = clock.GetUtcNow(); context.Entry(row).Property(x => x.UpdatedAt).IsModified = true;
            Audit(a, "finance.expense.reimbursed", "commercial.employee_expense_claims", id); return payment.PublicId;
        }, ct);
}
