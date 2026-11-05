using System.Data;
using System.Text.Json;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Finance;

/// <summary>
/// Issues one simulated e-CF invoice from completed operations in a single transaction (ADR-0035):
/// it values the approved services through the internal draft (packages, minimums, charges),
/// applies ITBIS 18 %, issues the invoice with its e-NCF, settles a charter with its confirmed
/// prepayment and queues the invoice email. No preinvoice is ever left visible or pending.
/// </summary>
internal sealed class EfInvoiceIssuanceStore(
    ElevantDbContext context, TimeProvider timeProvider,
    EfPreinvoiceDraftStore drafts, EfFinanceInvoiceIssueStore issues) : IInvoiceIssuanceStore
{
    public async Task<IssueInvoiceResult> IssueAsync(IssueInvoiceRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var strategy = context.Database.CreateExecutionStrategy();
        IssueInvoiceResult? attempt = null;
        try
        {
            return await strategy.ExecuteInTransactionAsync(
                async token =>
                {
                    context.ChangeTracker.Clear();
                    attempt = await IssueInsideTransactionAsync(request, token);
                    if (!attempt.IsSuccess) context.ChangeTracker.Clear();
                    return attempt;
                },
                async token =>
                {
                    context.ChangeTracker.Clear();
                    return attempt is not { IsSuccess: true } || await context.NonFiscalInvoices.AsNoTracking()
                        .AnyAsync(item => item.PublicId == attempt.InvoiceId, token);
                },
                IsolationLevel.Serializable, cancellationToken);
        }
        catch (Exception exception) when (exception is DbUpdateException or RetryLimitExceededException or SqlException &&
            exception.GetBaseException() is SqlException { Number: 2601 or 2627 or 1205 or 1222 or 3960 })
        {
            context.ChangeTracker.Clear();
            return await ReplayAsync(request, cancellationToken) ?? IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict);
        }
    }

    private async Task<IssueInvoiceResult> IssueInsideTransactionAsync(IssueInvoiceRequest request,
        CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider).ResolveAsync(request.AccountId, cancellationToken);
        if (actor is null || !actor.HasPermission(IssueInvoiceHandler.IssuePermission) ||
            !actor.Memberships.Any(membership => membership.OrganizationType == OrganizationType.AviamOperator &&
                membership.Kind == MembershipKind.InternalStaff) ||
            !actor.StationScopes.Any(scope => scope.StationId == request.StationId))
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Forbidden);
        if (await ReplayAsync(request, cancellationToken) is { } replay) return replay;

        var now = timeProvider.GetUtcNow();
        var operations = await (from operation in context.GroundOperations.AsNoTracking()
                                join turnaround in context.Turnarounds.AsNoTracking() on operation.TurnaroundId equals turnaround.Id
                                join station in context.Stations.AsNoTracking() on turnaround.StationId equals station.Id
                                where request.OperationIds.Contains(operation.PublicId) && station.PublicId == request.StationId
                                select new { operation.Id, operation.PublicId, operation.CurrentStatus, turnaround.OperationDate,
                                    TurnaroundId = turnaround.Id, turnaround.AirlineId })
            .ToArrayAsync(cancellationToken);
        if (operations.Length != request.OperationIds.Count) return IssueInvoiceResult.Failed(IssueInvoiceFailure.NotFound);
        if (operations.Any(item => item.CurrentStatus != GroundOperationStatus.Approved))
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict, "operation_not_approved");
        if (operations.Select(item => item.AirlineId).Distinct().Count() != 1)
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Unprocessable, "mixed_airline");
        var operationIds = operations.Select(item => item.Id).ToArray();
        // Only completed services are billable; one not performed is not invoiced.
        var services = await context.OperationServices.AsNoTracking()
            .Where(service => operationIds.Contains(service.GroundOperationId) &&
                service.CurrentStatus == ServiceExecutionStatus.Completed && service.ExecutedQuantity > 0)
            .Select(service => new { service.PublicId, service.GroundOperationId }).ToArrayAsync(cancellationToken);
        if (operations.Any(item => services.All(service => service.GroundOperationId != item.Id)))
            return IssueInvoiceResult.Failed(IssueInvoiceFailure.Unprocessable, "nothing_to_invoice");

        var draft = await drafts.DraftForInvoiceAsync(new CreatePreinvoiceDraftCommand(request.AccountId, request.StationId,
            operations.Min(item => item.OperationDate), operations.Max(item => item.OperationDate), request.RequestId,
            services.Select(service => service.PublicId).ToArray()), cancellationToken);
        if (!draft.IsSuccess)
            return IssueInvoiceResult.Failed(draft.Failure switch
            {
                PreinvoiceDraftFailure.NotFound => IssueInvoiceFailure.NotFound,
                PreinvoiceDraftFailure.Conflict => IssueInvoiceFailure.Conflict,
                PreinvoiceDraftFailure.Forbidden => IssueInvoiceFailure.Forbidden,
                _ => IssueInvoiceFailure.Unprocessable,
            }, draft.Reason ?? (draft.Failure == PreinvoiceDraftFailure.Conflict ? "already_invoiced" : null));

        // The draft is internal: ITBIS 18 % on every line, then accepted on the spot.
        var preinvoice = await context.Preinvoices.SingleAsync(item => item.PublicId == draft.DraftId, cancellationToken);
        var lines = await context.PreinvoiceLines.Where(line => line.PreinvoiceId == preinvoice.Id).ToListAsync(cancellationToken);
        foreach (var line in lines) FinanceInvoicePolicy.ApplyItbis(line, now);
        preinvoice.Total = lines.Where(line => !line.IsExcluded).Sum(line => line.Amount);
        preinvoice.Status = PreinvoiceStatus.Accepted;
        preinvoice.UpdatedAt = now;
        await context.SaveChangesAsync(cancellationToken);

        var issued = await issues.IssueForInvoicingAsync(
            new IssueFinanceInvoiceCommand(request.AccountId, preinvoice.PublicId, request.RequestId), cancellationToken);
        if (!issued.IsSuccess)
            return IssueInvoiceResult.Failed(issued.Failure == IssueFinanceInvoiceFailure.Forbidden
                ? IssueInvoiceFailure.Forbidden : IssueInvoiceFailure.Conflict);
        var invoice = await context.NonFiscalInvoices.SingleAsync(item => item.PublicId == issued.InvoiceId, cancellationToken);
        var accountId = invoice.IssuedByAccountId;

        // A charter is prepaid: its confirmed prepayment settles the invoice up to its total.
        var turnaroundIds = operations.Select(item => item.TurnaroundId).Distinct().ToArray();
        var charters = await context.Set<CharterAgreement>().AsNoTracking()
            .Where(item => turnaroundIds.Contains(item.TurnaroundId) && item.PrepaymentStatus == CharterPrepaymentStatus.Confirmed &&
                item.PrepaymentAmount > 0)
            .Select(item => new { item.PublicId, item.PrepaymentAmount, item.PrepaymentReference, item.CurrencyCode })
            .ToArrayAsync(cancellationToken);
        decimal prepaid = 0m;
        foreach (var charter in charters.Where(item => item.CurrencyCode == invoice.CurrencyCode))
        {
            var reference = $"PREPAGO {charter.PrepaymentReference}".Trim();
            if (await context.Set<FinanceTreasuryReceipt>().AnyAsync(receipt => receipt.AirlineId == invoice.AirlineId &&
                    receipt.Reference == reference, cancellationToken))
                reference = $"{reference} · {charter.PublicId:N}"[..Math.Min(80, reference.Length + 35)];
            var posted = await FinanceTreasuryPosting.ReceiveAndApplyAsync(context, invoice, accountId, PaymentMethod.Transfer,
                reference, charter.PrepaymentAmount!.Value, "Prepago del charter confirmado por Finanzas.", now,
                cancellationToken);
            prepaid += posted.Applied;
        }

        var airline = await context.Airlines.AsNoTracking().Where(item => item.Id == invoice.AirlineId)
            .Select(item => new { item.OrganizationId, item.PublicId }).SingleAsync(cancellationToken);
        var airlineOrganization = airline.OrganizationId;
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account, ActorAccountId = accountId,
            ActorDisplay = actor.DisplayName, Action = "finance.invoice.issued", EntityType = nameof(NonFiscalInvoice),
            EntityPublicId = invoice.PublicId, OrganizationId = airlineOrganization, StationId = invoice.StationId,
            Source = AuditSource.Api, CorrelationId = request.RequestId, RequestId = request.RequestId.ToString("D"),
            Reason = "Finanzas emitió la factura (e-CF simulado) de operaciones completadas.",
            MetadataJson = JsonSerializer.Serialize(new { fiscalNumber = invoice.FiscalNumber, total = invoice.Total,
                operations = request.OperationIds, prepaid }),
        });
        await InvoiceEmails.QueueIssuedAsync(context, invoice, now, cancellationToken);
        await AirlineOperationChangeWriter.AddTreasuryAsync(context, airlineOrganization, airline.PublicId, now, cancellationToken);
        await FinanceApprovedServiceChangeWriter.AddAsync(context, invoice.StationId, invoice.PublicId, now,
            "finance_approved_services", cancellationToken);
        await FinanceApprovedServiceChangeWriter.AddAsync(context, invoice.StationId, invoice.PublicId, now,
            "finance_receipts", cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return IssueInvoiceResult.Success(invoice.PublicId, invoice.Number, invoice.FiscalNumber!, invoice.Total,
            invoice.CurrencyCode, false);
    }

    /// <summary>The same request again returns the invoice it issued, for the same account only.</summary>
    private async Task<IssueInvoiceResult?> ReplayAsync(IssueInvoiceRequest request, CancellationToken cancellationToken)
    {
        var prior = await (from invoice in context.NonFiscalInvoices.AsNoTracking()
                           join account in context.Users.AsNoTracking() on invoice.IssuedByAccountId equals account.Id
                           where invoice.RequestId == request.RequestId
                           select new { invoice.PublicId, invoice.Number, invoice.FiscalNumber, invoice.Total,
                               invoice.CurrencyCode, AccountId = account.PublicId })
            .SingleOrDefaultAsync(cancellationToken);
        if (prior is null) return null;
        return prior.AccountId == request.AccountId && prior.FiscalNumber is not null
            ? IssueInvoiceResult.Success(prior.PublicId, prior.Number, prior.FiscalNumber, prior.Total, prior.CurrencyCode, true)
            : IssueInvoiceResult.Failed(IssueInvoiceFailure.Conflict);
    }
}
