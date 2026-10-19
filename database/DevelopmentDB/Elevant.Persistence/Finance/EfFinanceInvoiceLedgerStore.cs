using System.Data;
using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Commercial;
using Elevant.Persistence.Operations;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>Non-fiscal invoice ledger within the actor's stations: balances, payments and credit notes.</summary>
internal sealed class EfFinanceInvoiceLedgerStore(
    ElevantDbContext context,
    IActorContextResolver actors,
    TimeProvider timeProvider) : IFinanceInvoiceLedgerStore
{
    private sealed class Row
    {
        public long Id { get; init; }
        public Guid PublicId { get; init; }
        public string Number { get; init; } = string.Empty;
        public Guid PreinvoiceId { get; init; }
        public Guid AirlineId { get; init; }
        public string Airline { get; init; } = string.Empty;
        public Guid StationId { get; init; }
        public string StationCode { get; init; } = string.Empty;
        public string CurrencyCode { get; init; } = string.Empty;
        public decimal Total { get; init; }
        public DateTimeOffset IssuedAt { get; init; }
        public DateOnly? DueDate { get; init; }
    }

    private async Task<Guid[]?> StationsAsync(Guid actorId, string permission, CancellationToken cancellationToken)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || !actor.HasPermission(permission) || !actor.Memberships.Any(membership =>
                membership.Kind == MembershipKind.InternalStaff &&
                membership.OrganizationType == OrganizationType.AviamOperator))
            return null;
        return actor.StationScopes.Select(scope => scope.StationId).ToArray();
    }

    private IQueryable<Row> Invoices(Guid[] stations) =>
        from invoice in context.NonFiscalInvoices.AsNoTracking()
        join preinvoice in context.Preinvoices.AsNoTracking() on invoice.PreinvoiceId equals preinvoice.Id
        join airline in context.Airlines.AsNoTracking() on invoice.AirlineId equals airline.Id
        join station in context.Stations.AsNoTracking() on invoice.StationId equals station.Id
        where stations.Contains(station.PublicId)
        select new Row
        {
            Id = invoice.Id, PublicId = invoice.PublicId, Number = invoice.Number, PreinvoiceId = preinvoice.PublicId,
            AirlineId = airline.PublicId, Airline = airline.Name, StationId = station.PublicId, StationCode = station.Code,
            CurrencyCode = invoice.CurrencyCode, Total = invoice.Total, IssuedAt = invoice.CreatedAt, DueDate = invoice.DueDate,
        };

    /// <summary>Balance and status of each invoice; overdue counts whole days past the due date.</summary>
    private async Task<IReadOnlyList<FinanceInvoiceSummaryData>> SummariesAsync(IReadOnlyList<Row> rows,
        CancellationToken cancellationToken)
    {
        var ids = rows.Select(row => row.Id).ToArray();
        var paid = await context.NonFiscalPayments.AsNoTracking().Where(item => ids.Contains(item.InvoiceId))
            .GroupBy(item => item.InvoiceId).Select(group => new { group.Key, Sum = group.Sum(item => item.Amount) })
            .ToDictionaryAsync(item => item.Key, item => item.Sum, cancellationToken);
        var credited = await context.NonFiscalCreditNotes.AsNoTracking().Where(item => ids.Contains(item.InvoiceId))
            .GroupBy(item => item.InvoiceId).Select(group => new { group.Key, Sum = group.Sum(item => item.Amount) })
            .ToDictionaryAsync(item => item.Key, item => item.Sum, cancellationToken);
        var treasury = await FinanceTreasuryBalances.TotalsAsync(context, ids, cancellationToken);
        var today = DateOnly.FromDateTime(timeProvider.GetUtcNow().UtcDateTime);
        return rows.Select(row =>
        {
            var movements = treasury[row.Id];
            var paidAmount = paid.GetValueOrDefault(row.Id) + movements.Applied;
            var creditedAmount = credited.GetValueOrDefault(row.Id) + movements.Credited - movements.Debited;
            var balance = row.Total - paidAmount - creditedAmount;
            var overdueDays = balance > 0 && row.DueDate is { } due && due < today ? today.DayNumber - due.DayNumber : 0;
            var status = balance <= 0 ? "Paid" : overdueDays > 0 ? "Overdue" : paidAmount + creditedAmount > 0
                ? "PartiallyPaid" : "Pending";
            return new FinanceInvoiceSummaryData(row.PublicId, row.Number, row.PreinvoiceId, row.AirlineId, row.Airline,
                row.StationId, row.StationCode, row.CurrencyCode, row.Total, paidAmount, creditedAmount, balance,
                row.IssuedAt, row.DueDate, status, overdueDays);
        }).ToArray();
    }

    public async Task<FinanceInvoicePageData?> ListAsync(Guid actorId, Guid? stationId, Guid? airlineId, string? status,
        int page, int limit, CancellationToken cancellationToken = default)
    {
        if (page < 1 || limit is < 1 or > 100) return null;
        var stations = await StationsAsync(actorId, "finance.reconciliation.read", cancellationToken);
        if (stations is null || stationId is { } requested && !stations.Contains(requested)) return null;
        var scope = stationId is { } only ? [only] : stations;
        var rows = await Invoices(scope).Where(row => airlineId == null || row.AirlineId == airlineId)
            .OrderByDescending(row => row.IssuedAt).ToArrayAsync(cancellationToken);
        var summaries = (await SummariesAsync(rows, cancellationToken))
            .Where(item => status is null || item.Status == status).ToArray();
        return new FinanceInvoicePageData(page, limit, page * limit < summaries.Length,
            summaries.Skip((page - 1) * limit).Take(limit).ToArray());
    }

    public async Task<FinanceInvoiceDetailData?> GetAsync(Guid actorId, Guid invoiceId,
        CancellationToken cancellationToken = default)
    {
        var stations = await StationsAsync(actorId, "finance.reconciliation.read", cancellationToken);
        if (stations is null) return null;
        var row = await Invoices(stations).SingleOrDefaultAsync(item => item.PublicId == invoiceId, cancellationToken);
        if (row is null) return null;
        var summary = (await SummariesAsync([row], cancellationToken))[0];
        var lines = await context.NonFiscalInvoiceLines.AsNoTracking().Where(line => line.InvoiceId == row.Id)
            .OrderBy(line => line.LineNumber)
            .Select(line => new FinanceInvoiceLineData(line.LineNumber, line.Kind.ToString(), line.ParentLineNumber,
                line.OperationCode, line.OperationDate, line.ServiceCode, line.ServiceName, line.ExecutedQuantity,
                line.BillingUnit, line.UnitPrice, line.Amount, line.Reason))
            .ToArrayAsync(cancellationToken);
        var payments = await (from payment in context.NonFiscalPayments.AsNoTracking()
                              join user in context.Users.AsNoTracking() on payment.RecordedByAccountId equals user.Id
                              join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                              where payment.InvoiceId == row.Id
                              orderby payment.CreatedAt
                              select new FinancePaymentData(payment.PublicId, payment.Reference, payment.Method.ToString(),
                                  payment.PaidOn, payment.Amount, payment.CreatedAt,
                                  person.FirstName + " " + person.LastName)).ToArrayAsync(cancellationToken);
        var notes = await (from note in context.NonFiscalCreditNotes.AsNoTracking()
                           join user in context.Users.AsNoTracking() on note.IssuedByAccountId equals user.Id
                           join person in context.Persons.AsNoTracking() on user.PersonId equals person.Id
                           where note.InvoiceId == row.Id
                           orderby note.CreatedAt
                           select new FinanceCreditNoteData(note.PublicId, note.Number, note.Amount, note.Reason,
                               note.CreatedAt, person.FirstName + " " + person.LastName)).ToArrayAsync(cancellationToken);
        return new FinanceInvoiceDetailData(summary, lines, payments, notes);
    }

    public async Task<AirlineInvoiceStatementData?> GetStatementForAirlineAsync(Guid organizationId, Guid invoiceId,
        CancellationToken cancellationToken = default)
    {
        if (organizationId == Guid.Empty || invoiceId == Guid.Empty) return null;
        var row = await (
            from invoice in context.NonFiscalInvoices.AsNoTracking()
            join preinvoice in context.Preinvoices.AsNoTracking() on invoice.PreinvoiceId equals preinvoice.Id
            join airline in context.Airlines.AsNoTracking() on invoice.AirlineId equals airline.Id
            join organization in context.Organizations.AsNoTracking() on airline.OrganizationId equals organization.Id
            join station in context.Stations.AsNoTracking() on invoice.StationId equals station.Id
            where organization.PublicId == organizationId && organization.Type == OrganizationType.AirlineCustomer &&
                  organization.Status == OrganizationStatus.Active && airline.IsActive && invoice.PublicId == invoiceId
            select new Row
            {
                Id = invoice.Id, PublicId = invoice.PublicId, Number = invoice.Number, PreinvoiceId = preinvoice.PublicId,
                AirlineId = airline.PublicId, Airline = airline.Name, StationId = station.PublicId,
                StationCode = station.Code, CurrencyCode = invoice.CurrencyCode, Total = invoice.Total,
                IssuedAt = invoice.CreatedAt, DueDate = invoice.DueDate,
            }).SingleOrDefaultAsync(cancellationToken);
        if (row is null) return null;
        var summary = (await SummariesAsync([row], cancellationToken))[0];
        var lines = await context.NonFiscalInvoiceLines.AsNoTracking().Where(line => line.InvoiceId == row.Id)
            .OrderBy(line => line.LineNumber)
            .Select(line => new FinanceInvoiceLineData(line.LineNumber, line.Kind.ToString(), line.ParentLineNumber,
                line.OperationCode, line.OperationDate, line.ServiceCode, line.ServiceName, line.ExecutedQuantity,
                line.BillingUnit, line.UnitPrice, line.Amount, line.Reason))
            .ToArrayAsync(cancellationToken);
        var payments = await context.NonFiscalPayments.AsNoTracking().Where(payment => payment.InvoiceId == row.Id)
            .OrderBy(payment => payment.CreatedAt)
            .Select(payment => new AirlineInvoicePaymentData(payment.Reference, payment.Method.ToString(),
                payment.PaidOn, payment.Amount, payment.CreatedAt))
            .ToArrayAsync(cancellationToken);
        var notes = await context.NonFiscalCreditNotes.AsNoTracking().Where(note => note.InvoiceId == row.Id)
            .OrderBy(note => note.CreatedAt)
            .Select(note => new AirlineInvoiceCreditNoteData(note.Number, note.Amount, note.Reason, note.CreatedAt))
            .ToArrayAsync(cancellationToken);
        return new AirlineInvoiceStatementData(summary.Id, summary.Number, summary.PreinvoiceId, summary.CurrencyCode,
            summary.Total, summary.Paid, summary.Credited, summary.Balance, summary.IssuedAt, summary.DueDate,
            summary.Status, summary.DaysOverdue, lines, payments, notes);
    }

    /// <summary>A credit note reduces the balance and never exceeds it; the request id makes it idempotent.</summary>
    public async Task<FinanceCatalogResult> IssueCreditNoteAsync(Guid actorId, Guid invoiceId, IssueCreditNoteInput input,
        CancellationToken cancellationToken = default)
    {
        var stations = await StationsAsync(actorId, "finance.reconciliation.record", cancellationToken);
        if (stations is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.Forbidden);
        if (input is null || input.RequestId == Guid.Empty || input.Amount is <= 0 or > 900_000_000_000m ||
            decimal.Round(input.Amount, 4) != input.Amount || input.Reason?.Trim().Length is not (>= 3 and <= 1000))
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Invalid);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable,
                    cancellationToken);
                var row = await Invoices(stations).SingleOrDefaultAsync(item => item.PublicId == invoiceId, cancellationToken);
                if (row is null) return FinanceCatalogResult.Failed(FinanceCatalogFailure.NotFound);
                // Both correction writers serialize on the same immutable invoice.
                _ = await context.NonFiscalInvoices.FromSqlInterpolated(
                    $"SELECT * FROM [commercial].[non_fiscal_invoices] WITH (UPDLOCK, HOLDLOCK) WHERE [id] = {row.Id}")
                    .AsNoTracking().SingleAsync(cancellationToken);
                var accountId = await context.Users.Where(user => user.PublicId == actorId).Select(user => user.Id)
                    .SingleAsync(cancellationToken);
                var prior = await context.NonFiscalCreditNotes.AsNoTracking()
                    .SingleOrDefaultAsync(note => note.RequestId == input.RequestId, cancellationToken);
                if (prior is not null)
                    return prior.InvoiceId == row.Id && prior.Amount == input.Amount && prior.IssuedByAccountId == accountId
                        ? FinanceCatalogResult.Success(prior.PublicId)
                        : FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
                var balance = (await SummariesAsync([row], cancellationToken))[0].Balance;
                var legacyCredited = await context.NonFiscalCreditNotes.AsNoTracking().Where(n => n.InvoiceId == row.Id)
                    .SumAsync(n => (decimal?)n.Amount, cancellationToken) ?? 0m;
                var allocatedCredited = await context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking()
                    .Where(n => n.InvoiceId == row.Id && n.Kind == FinanceTreasuryAdjustmentKind.Credit)
                    .SumAsync(n => (decimal?)n.Amount, cancellationToken) ?? 0m;
                // Debits change the receivable balance, never the original credit ceiling.
                if (input.Amount > balance || input.Amount > row.Total - legacyCredited - allocatedCredited)
                    return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
                var now = timeProvider.GetUtcNow();
                var id = Guid.CreateVersion7();
                context.NonFiscalCreditNotes.Add(new NonFiscalCreditNote
                {
                    PublicId = id, InvoiceId = row.Id, IssuedByAccountId = accountId, RequestId = input.RequestId,
                    Number = $"NC-{id:N}", CurrencyCode = row.CurrencyCode, Amount = input.Amount,
                    Reason = input.Reason.Trim(), CreatedAt = now, UpdatedAt = now,
                });
                CommercialAuditWriter.Add(context, accountId, "finance.credit_note.issued", "commercial.non_fiscal_credit_notes",
                    id, input.Reason.Trim(),
                    new AuditFieldChangeData("credit_note.amount", null, input.Amount.ToString(CultureInfo.InvariantCulture)));
                var invoice = await context.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.Id == row.Id,
                    cancellationToken);
                await FinanceApprovedServiceChangeWriter.AddAsync(context, invoice.StationId, row.PreinvoiceId, now,
                    "finance_preinvoices", cancellationToken);
                var organization = await context.Airlines.AsNoTracking().Where(airline => airline.Id == invoice.AirlineId)
                    .Select(airline => airline.OrganizationId).SingleAsync(cancellationToken);
                await AirlineOperationChangeWriter.AddPreinvoiceAsync(context, organization, row.PreinvoiceId, now,
                    cancellationToken);
                await context.SaveChangesAsync(cancellationToken);
                await transaction.CommitAsync(cancellationToken);
                return FinanceCatalogResult.Success(id);
            });
        }
        catch (DbUpdateException)
        {
            context.ChangeTracker.Clear();
            return FinanceCatalogResult.Failed(FinanceCatalogFailure.Conflict);
        }
    }
}
