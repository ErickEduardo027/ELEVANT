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
            var staff = new Dictionary<long, IReadOnlyList<StationStaff>>();
            var result = new List<EmployeeExpenseView>(); foreach (var row in rows) result.Add(await ExpenseViewAsync(row, ct, staff)); return result;
        }, ct);
    public Task<FinancePayablesResult<FinancePayablesMutation>> SaveExpenseAsync(Guid actorId, Guid? id, EmployeeExpenseSave input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "expense.save", id, input, "", async a =>
        {
            Require(OwnExpenseAccess(a), "forbidden");
            Require(Text(input.Description, 500)); var total = ValidateLines(input.Lines); var dop = ValidateFx(input.Fx, total, input.ExpenseDate);
            var station = await StationAsync(a, input.ScopeStationId, ct);
            // 4-N27: an employee never assigned to the station is refused; a date outside the assignment says so.
            var assignments = context.EmployeeStations.Where(s => s.EmployeeId == a.Employee!.Id && s.StationId == station);
            Require(await assignments.AnyAsync(ct), FinancePayablesProblems.Forbidden);
            Require(await assignments.AnyAsync(s => s.ValidFrom <= input.ExpenseDate && (s.ValidTo == null || s.ValidTo >= input.ExpenseDate), ct),
                FinancePayablesProblems.ExpenseDateOutsideAssignment);
            var dims = await DimensionsAsync(a, station, input.Dimensions, ct); var now = clock.GetUtcNow();
            var row = id is { } key ? await ExpenseAsync(a, key, ct) : new EmployeeExpenseClaim { PublicId = Guid.CreateVersion7(), CreatedAt = now,
                CreatedByAccountId = a.Id, EmployeeId = a.Employee!.Id, Department = a.Employee.Department, ScopeStationId = station };
            Require(row.CreatedByAccountId == a.Id && row.EmployeeId == a.Employee!.Id && row.Department == a.Employee.Department, "forbidden");
            if (id is not null) { Match(row.RowVersion, input.ExpectedVersion); Require(row.Status == EmployeeExpenseStatus.Draft, FinancePayablesProblems.InvalidState); Require(row.ScopeStationId == station); }
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
    /// <summary>
    /// Decides an employee expense. Its requester submits it and, 4-N13, withdraws it while the department has not decided,
    /// corrects a rejected one and discards a draft or a rejected one, each with its reason. Another administrator of its
    /// department reviews it (without one at the station, a Finance administrator does, as an escalation) and another
    /// person of Finance gives the final approval.
    /// </summary>
    public Task<FinancePayablesResult<FinancePayablesMutation>> DecideExpenseAsync(Guid actorId, Guid id, FinancePayablesDecision input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "expense.decide", id, input, "", async a =>
        {
            Require(Enum.GetNames<EmployeeExpenseStatus>().Contains(input.Decision));
            var row = await ExpenseAsync(a, id, ct); Match(row.RowVersion, input.ExpectedVersion);
            var from = row.Status;
            var needsReason = FinancePayablesPolicy.ExpenseTransitionNeedsReason(from.ToString(), input.Decision);
            Require(needsReason is not null, FinancePayablesProblems.InvalidState); RequireReason(input.Reason, needsReason!.Value);
            var requester = await context.Users.Where(x => x.Id == row.CreatedByAccountId).Select(x => x.PublicId).SingleAsync(ct);
            var ownClaim = a.Id == row.CreatedByAccountId && a.Employee?.Id == row.EmployeeId && OwnExpenseAccess(a);
            string stage, action;
            switch (input.Decision)
            {
                case nameof(EmployeeExpenseStatus.Submitted):
                    Require(ownClaim, FinancePayablesProblems.Forbidden);
                    Require(await context.Set<FinancePayablesAttachment>().AnyAsync(x => x.ExpenseClaimId == row.Id && x.RemovedAt == null, ct),
                        FinancePayablesProblems.ReceiptRequired);
                    (stage, action) = ("Submission", "finance.expense.submitted");
                    break;
                // 4-N13: only the requester takes its claim back, corrects it or discards it.
                case nameof(EmployeeExpenseStatus.Draft):
                    Require(ownClaim, FinancePayablesProblems.Forbidden);
                    (stage, action) = from == EmployeeExpenseStatus.Submitted
                        ? ("Withdrawal", "finance.expense.withdrawn") : ("Correction", "finance.expense.reopened");
                    break;
                case nameof(EmployeeExpenseStatus.Cancelled):
                    Require(ownClaim, FinancePayablesProblems.Forbidden);
                    (stage, action) = ("Discard", "finance.expense.discarded");
                    break;
                default:
                    Require(!await context.Employees.AnyAsync(e => e.Id == row.EmployeeId && e.PersonId == a.PersonId, ct), FinancePayablesProblems.Forbidden);
                    if (from == EmployeeExpenseStatus.Submitted)
                    {
                        Require(a.Employee?.Id != row.EmployeeId, FinancePayablesProblems.Forbidden);
                        if (FinancePayablesPolicy.CanReviewDepartment(actorId, requester, a.Context.EffectiveAccess, row.Department))
                            (stage, action) = ("Department", "finance.expense." + input.Decision.ToLowerInvariant());
                        else
                        {
                            // 4-N13: without another administrator of the department at the station, Finance reviews it.
                            Require(FinancePayablesPolicy.CanEscalateExpenseReview(actorId, requester, a.Context.EffectiveAccess) &&
                                await ExpenseReviewRouteAsync(row, ct) == "Finance", FinancePayablesProblems.Forbidden);
                            (stage, action) = ("Escalation", "finance.expense.escalated_review");
                        }
                    }
                    else
                    {
                        Require(a.Id != row.CreatedByAccountId && a.Employee?.Id != row.EmployeeId && Finance(a, "finance.expenses.approve"),
                            FinancePayablesProblems.Forbidden);
                        // Two different people review it: who approved it for the department, or by escalation, does not decide it again.
                        var departmentApprover = await (from r in context.Set<EmployeeExpenseReview>() join u in context.Users on r.ActorAccountId equals u.Id
                            where r.DocumentId == row.Id && r.Decision == nameof(EmployeeExpenseStatus.DepartmentApproved)
                            orderby r.Id descending select (long?)u.PersonId).FirstOrDefaultAsync(ct);
                        Require(departmentApprover != a.PersonId, FinancePayablesProblems.SegregationOfDuties);
                        (stage, action) = ("Finance", "finance.expense." + input.Decision.ToLowerInvariant());
                    }
                    break;
            }
            var now = clock.GetUtcNow();
            row.Status = Enum.Parse<EmployeeExpenseStatus>(input.Decision); row.UpdatedAt = now;
            context.Set<EmployeeExpenseReview>().Add(new EmployeeExpenseReview { DocumentId = row.Id, Stage = stage, Decision = input.Decision,
                Reason = input.Reason?.Trim(), ActorAccountId = a.Id, DecidedAt = now });
            Audit(a, action, "commercial.employee_expense_claims", id, input.Reason); return id;
        }, ct);
    /// <summary>
    /// 4-N13: who reviews a submitted expense. «Department» while another administrator of its department holds its station;
    /// otherwise «Finance» when a Finance administrator does; «None» when nobody can. Its employee and its requester never
    /// count, whatever their access.
    /// </summary>
    private static string ExpenseReviewRoute(EmployeeExpenseClaim claim, long employeePerson, long requesterPerson, IReadOnlyList<StationStaff> staff)
    {
        bool Reviews(StationStaff member, Department department) => member.AccountId != claim.CreatedByAccountId &&
            member.PersonId != employeePerson && member.PersonId != requesterPerson &&
            member.Access is { Kind: DepartmentAssignmentKind.Administrator } access && access.Department == department;
        return FinancePayablesPolicy.ExpenseReviewRoute(staff.Any(m => Reviews(m, claim.Department)), staff.Any(m => Reviews(m, Department.Finance)));
    }
    private async Task<string> ExpenseReviewRouteAsync(EmployeeExpenseClaim claim, CancellationToken ct)
    {
        var employeePerson = await context.Employees.Where(e => e.Id == claim.EmployeeId).Select(e => e.PersonId).SingleAsync(ct);
        var requesterPerson = await context.Users.Where(u => u.Id == claim.CreatedByAccountId).Select(u => u.PersonId).SingleAsync(ct);
        return ExpenseReviewRoute(claim, employeePerson, requesterPerson, await StationStaffAsync(claim.ScopeStationId, clock.GetUtcNow(), ct));
    }
    public Task<FinancePayablesResult<FinancePayablesMutation>> ReimburseExpenseAsync(Guid actorId, Guid id, EmployeeExpensePaymentSave input, CancellationToken ct = default) =>
        WriteAsync(actorId, input.RequestId, "expense.reimburse", id, input, "finance.expenses.pay", async a =>
        {
            Require(Finance(a, "finance.expenses.pay"), "forbidden"); var row = await ExpenseAsync(a, id, ct); Match(row.RowVersion, input.ExpectedVersion);
            Require(a.Id != row.CreatedByAccountId && !await context.Employees.AnyAsync(e => e.Id == row.EmployeeId && e.PersonId == a.PersonId, ct), "forbidden");
            Require(row.Status == EmployeeExpenseStatus.Approved, FinancePayablesProblems.InvalidState);
            Require(Text(input.Reference, 100) && FinancePayablesPolicy.Money(input.Amount) && input.Amount > 0); RequireSettlementDate(input.PaidOn);
            var dop = ValidateFx(input.Fx, input.Amount, input.PaidOn);
            // Preserve the write cap across all retained records; current projections use only effective reimbursements.
            var paid = await context.Set<EmployeeExpensePayment>().Where(p => p.ExpenseClaimId == row.Id).SumAsync(p => (decimal?)p.ExpenseAmount, ct) ?? 0m;
            var rate = ApplicationRate(input.Fx.Currency, input.Fx.RateToDop!.Value, row.CurrencyCode, row.FxToDop, input.RateToExpense);
            Require(FinancePayablesPolicy.CanApply(input.Amount, row.Total - paid, input.Amount, rate), FinancePayablesProblems.BalanceExceeded);
            var payment = new EmployeeExpensePayment { PublicId = Guid.CreateVersion7(), ExpenseClaimId = row.Id, PaidOn = input.PaidOn, Reference = input.Reference.Trim(),
                CurrencyCode = input.Fx.Currency, FxToDop = input.Fx.RateToDop.Value, FxSource = input.Fx.Source.Trim(), FxDate = input.Fx.RateDate!.Value,
                Amount = input.Amount, AmountDop = dop, RateToExpense = rate, ExpenseAmount = FinancePayablesPolicy.Round(input.Amount * rate), ActorAccountId = a.Id, CreatedAt = clock.GetUtcNow() };
            context.Set<EmployeeExpensePayment>().Add(payment); row.UpdatedAt = clock.GetUtcNow(); context.Entry(row).Property(x => x.UpdatedAt).IsModified = true;
            Audit(a, "finance.expense.reimbursed", "commercial.employee_expense_claims", id); return payment.PublicId;
        }, ct);
}
