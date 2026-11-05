using Elevant.Application.Abstractions.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;
internal sealed partial class FinanceTreasuryStore
{
    public Task<FinanceTreasuryResult> RecordAsync(Guid actorId, FinanceTreasuryReceiptInput input, CancellationToken cancellationToken = default)
    {
        if (input is null || !FinanceTreasuryRules.Money(input.Amount) || input.CurrencyCode is not ("USD" or "DOP") ||
            input.Reference?.Trim().Length is not (>= 1 and <= 120) || !Reason(input.Reason) || !DateValid(input.ReceivedOn) ||
            !Enum.TryParse<PaymentMethod>(input.Method, false, out var method) || !Enum.IsDefined(method) ||
            method == PaymentMethod.Card)
            return Task.FromResult(Fail(FinanceTreasuryFailure.Invalid));
        var hash = Hash(input); var ct = cancellationToken;
        return ExecuteAsync(actorId, input.RequestId, "finance.receipts.create", async (actor, accountId) =>
        {
            var stations = actor.StationScopes.Select(s => s.StationId).ToArray();
            var scope = await (from a in context.Airlines join o in context.Organizations on a.OrganizationId equals o.Id
                from s in context.Stations where a.PublicId == input.AirlineId && s.PublicId == input.StationId &&
                    stations.Contains(s.PublicId) && s.IsActive && a.IsActive && o.Type == OrganizationType.AirlineCustomer && o.Status == OrganizationStatus.Active
                select new { Airline = a.Id, Station = s.Id, Organization = o.Id }).SingleOrDefaultAsync(ct);
            if (scope is null) return Fail(FinanceTreasuryFailure.NotFound);
            var replay = await ReplayAsync(actorId, input.RequestId, input.AirlineId, "receipt.recorded", hash, ct);
            if (replay is not null) return replay;
            if (await context.Set<FinanceTreasuryReceipt>().AnyAsync(r => r.AirlineId == scope.Airline && r.Reference == input.Reference.Trim(), ct) ||
                await context.NonFiscalPayments.AnyAsync(p => p.Reference == input.Reference.Trim(), ct))
                return Fail(FinanceTreasuryFailure.Conflict);
            var receipt = new FinanceTreasuryReceipt { PublicId = Guid.CreateVersion7(), AirlineId = scope.Airline,
                StationId = scope.Station, ActorAccountId = accountId, RequestId = input.RequestId, Amount = input.Amount,
                CurrencyCode = input.CurrencyCode, Reference = input.Reference.Trim(), Method = method, ReceivedOn = input.ReceivedOn,
                Reason = input.Reason.Trim(), CreatedAt = timeProvider.GetUtcNow(), UpdatedAt = timeProvider.GetUtcNow() };
            context.Add(receipt);
            return await CompleteAsync(accountId, input.RequestId, input.AirlineId, "receipt.recorded", hash, receipt.PublicId,
                receipt, scope.Organization, scope.Station, input.Reason, ct);
        }, ct);
    }
    public Task<FinanceTreasuryResult> ApplyAsync(Guid actorId, Guid receiptId, FinanceTreasuryApplyInput input, CancellationToken cancellationToken = default)
    {
        if (input is null || !Reason(input.Reason) || !DateValid(input.EffectiveOn) || string.IsNullOrEmpty(input.ExpectedVersion) ||
            input.Applications is not { Count: >= 1 and <= 100 } || input.Applications.Any(a => a is null || a.InvoiceId == Guid.Empty ||
                string.IsNullOrEmpty(a.ExpectedInvoiceVersion) || !FinanceTreasuryRules.Money(a.ReceiptAmount)) ||
            input.Applications.Select(a => a.InvoiceId).Distinct().Count() != input.Applications.Count)
            return Task.FromResult(Fail(FinanceTreasuryFailure.Invalid));
        var hash = Hash(input); var ct = cancellationToken;
        return ExecuteAsync(actorId, input.RequestId, "finance.receipts.apply", async (actor, accountId) =>
        {
            var scope = await Receipts(actor).SingleOrDefaultAsync(r => r.Receipt.PublicId == receiptId, ct);
            if (scope is null) return Fail(FinanceTreasuryFailure.NotFound);
            var receipt = await LockReceiptAsync(scope.Receipt.Id, ct);
            var invoiceIds = input.Applications.Select(a => a.InvoiceId).ToArray();
            var invoices = await Invoices(actor).Where(i => invoiceIds.Contains(i.Invoice.PublicId)).OrderBy(i => i.Invoice.Id).ToArrayAsync(ct);
            if (invoices.Length != invoiceIds.Length || invoices.Any(i => i.Invoice.AirlineId != receipt.AirlineId || i.Invoice.StationId != receipt.StationId))
                return Fail(FinanceTreasuryFailure.NotFound);
            var replay = await ReplayAsync(actorId, input.RequestId, receiptId, "receipt.applied", hash, ct);
            if (replay is not null) return replay;
            var moves = await ReceiptMovementsAsync(receipt.Id, ct);
            if (Version(receipt) != input.ExpectedVersion || input.EffectiveOn < receipt.ReceivedOn ||
                moves.Any(m => m.Kind == FinanceTreasuryMovementKind.ReceiptReversal)) return Fail(FinanceTreasuryFailure.Conflict);
            var available = Available(receipt, moves); Guid? firstId = null;
            foreach (var item in invoices)
            {
                await LockInvoiceAsync(item.Invoice.Id, ct);
                var account = await InvoiceAccountAsync(item.Invoice.Id, ct);
                var allocation = input.Applications.Single(a => a.InvoiceId == item.Invoice.PublicId);
                if (allocation.ExpectedInvoiceVersion != Version(account) || input.EffectiveOn < DateOnly.FromDateTime(item.Invoice.CreatedAt.UtcDateTime))
                    return Fail(FinanceTreasuryFailure.Conflict);
                var rate = await FinanceTariffLookup.ExchangeRateAsync(context, receipt.CurrencyCode, item.Invoice.CurrencyCode, input.EffectiveOn, ct);
                if (rate is null or <= 0 || item.Invoice.CurrencyCode is not ("USD" or "DOP")) return Fail(FinanceTreasuryFailure.Conflict);
                var invoiceAmount = FinanceTreasuryRules.Convert(allocation.ReceiptAmount, rate.Value);
                var balance = await FinanceTreasuryBalances.BalanceAsync(context, item.Invoice.Id, item.Invoice.Total, ct);
                if (!FinanceTreasuryRules.Money(invoiceAmount) || allocation.ReceiptAmount > available || invoiceAmount > balance)
                    return Fail(FinanceTreasuryFailure.Conflict);
                var movement = Movement(accountId, input.RequestId, receipt, FinanceTreasuryMovementKind.Application,
                    input.EffectiveOn, allocation.ReceiptAmount, input.Reason);
                movement.InvoiceId = item.Invoice.Id; movement.InvoiceCurrency = item.Invoice.CurrencyCode;
                movement.InvoiceAmount = invoiceAmount; movement.ExchangeRate = rate.Value;
                context.Add(movement); firstId ??= movement.PublicId;
                account ??= NewAccount(item.Invoice.Id); Touch(account);
                available -= allocation.ReceiptAmount;
            }
            return await CompleteAsync(accountId, input.RequestId, receiptId, "receipt.applied", hash, firstId!.Value,
                receipt, scope.OrganizationId, receipt.StationId, input.Reason, ct);
        }, ct);
    }
    public Task<FinanceTreasuryResult> ReverseAsync(Guid actorId, Guid receiptId, FinanceTreasuryReverseInput input, CancellationToken cancellationToken = default)
    {
        if (input is null || !Reason(input.Reason) || !DateValid(input.EffectiveOn) || string.IsNullOrEmpty(input.ExpectedVersion))
            return Task.FromResult(Fail(FinanceTreasuryFailure.Invalid));
        var hash = Hash(input); var ct = cancellationToken;
        return ExecuteAsync(actorId, input.RequestId, "finance.receipts.reverse", async (actor, accountId) =>
        {
            var scope = await Receipts(actor).SingleOrDefaultAsync(r => r.Receipt.PublicId == receiptId, ct);
            if (scope is null) return Fail(FinanceTreasuryFailure.NotFound);
            var receipt = await LockReceiptAsync(scope.Receipt.Id, ct);
            var moves = await ReceiptMovementsAsync(receipt.Id, ct);
            var original = input.ApplicationId is null ? null : moves.SingleOrDefault(m => m.PublicId == input.ApplicationId && m.Kind == FinanceTreasuryMovementKind.Application);
            InvoiceScope? invoice = null;
            if (input.ApplicationId is not null)
            {
                if (original is null) return Fail(FinanceTreasuryFailure.NotFound);
                invoice = await Invoices(actor).SingleOrDefaultAsync(i => i.Invoice.Id == original.InvoiceId, ct);
                if (invoice is null || invoice.Invoice.AirlineId != receipt.AirlineId || invoice.Invoice.StationId != receipt.StationId)
                    return Fail(FinanceTreasuryFailure.NotFound);
            }
            var replay = await ReplayAsync(actorId, input.RequestId, receiptId, "receipt.reversed", hash, ct);
            if (replay is not null) return replay;
            if (Version(receipt) != input.ExpectedVersion || input.EffectiveOn < receipt.ReceivedOn ||
                moves.Any(m => m.Kind == FinanceTreasuryMovementKind.ReceiptReversal)) return Fail(FinanceTreasuryFailure.Conflict);
            var movement = Movement(accountId, input.RequestId, receipt, original is null ? FinanceTreasuryMovementKind.ReceiptReversal :
                FinanceTreasuryMovementKind.ApplicationReversal, input.EffectiveOn, original?.ReceiptAmount ?? receipt.Amount, input.Reason);
            if (original is null)
            {
                if (Applied(moves) != 0m || moves.Any(m => m.Kind == FinanceTreasuryMovementKind.Refund) ||
                    moves.Any(m => m.EffectiveOn > input.EffectiveOn)) return Fail(FinanceTreasuryFailure.Conflict);
            }
            else
            {
                if (input.EffectiveOn < original.EffectiveOn || moves.Any(m => m.ReversesMovementId == original.Id)) return Fail(FinanceTreasuryFailure.Conflict);
                await LockInvoiceAsync(invoice!.Invoice.Id, ct);
                movement.ReversesMovementId = original.Id; movement.InvoiceId = original.InvoiceId;
                movement.InvoiceAmount = original.InvoiceAmount; movement.InvoiceCurrency = original.InvoiceCurrency;
                movement.ExchangeRate = original.ExchangeRate; movement.ExchangeRateOn = original.ExchangeRateOn;
                var account = await InvoiceAccountAsync(invoice.Invoice.Id, ct) ?? NewAccount(invoice.Invoice.Id);
                Touch(account);
            }
            context.Add(movement);
            return await CompleteAsync(accountId, input.RequestId, receiptId, "receipt.reversed", hash, movement.PublicId,
                receipt, scope.OrganizationId, receipt.StationId, input.Reason, ct);
        }, ct);
    }
    public Task<FinanceTreasuryResult> RefundAsync(Guid actorId, Guid receiptId, FinanceTreasuryRefundInput input, CancellationToken cancellationToken = default)
    {
        if (input is null || !Reason(input.Reason) || !DateValid(input.EffectiveOn) || string.IsNullOrEmpty(input.ExpectedVersion) ||
            !FinanceTreasuryRules.Money(input.Amount) || input.Reference?.Trim().Length is not (>= 1 and <= 120))
            return Task.FromResult(Fail(FinanceTreasuryFailure.Invalid));
        var hash = Hash(input); var ct = cancellationToken;
        return ExecuteAsync(actorId, input.RequestId, "finance.receipts.refund", async (actor, accountId) =>
        {
            var scope = await Receipts(actor).SingleOrDefaultAsync(r => r.Receipt.PublicId == receiptId, ct);
            if (scope is null) return Fail(FinanceTreasuryFailure.NotFound);
            var receipt = await LockReceiptAsync(scope.Receipt.Id, ct);
            var replay = await ReplayAsync(actorId, input.RequestId, receiptId, "receipt.refunded", hash, ct);
            if (replay is not null) return replay;
            var moves = await ReceiptMovementsAsync(receipt.Id, ct);
            if (Version(receipt) != input.ExpectedVersion || input.EffectiveOn < receipt.ReceivedOn || input.Amount > Available(receipt, moves) ||
                moves.Any(m => m.Kind == FinanceTreasuryMovementKind.Refund && m.Reference == input.Reference.Trim()) ||
                moves.Any(m => m.Kind == FinanceTreasuryMovementKind.ReceiptReversal)) return Fail(FinanceTreasuryFailure.Conflict);
            var movement = Movement(accountId, input.RequestId, receipt, FinanceTreasuryMovementKind.Refund, input.EffectiveOn, input.Amount, input.Reason);
            movement.Reference = input.Reference.Trim(); context.Add(movement);
            return await CompleteAsync(accountId, input.RequestId, receiptId, "receipt.refunded", hash, movement.PublicId,
                receipt, scope.OrganizationId, receipt.StationId, input.Reason, ct);
        }, ct);
    }
}
