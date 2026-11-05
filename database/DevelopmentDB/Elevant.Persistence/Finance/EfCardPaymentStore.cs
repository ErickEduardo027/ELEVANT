using System.Data;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Audit;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Elevant.Persistence.Operations;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Finance;

/// <summary>
/// Pays an airline's own invoice with a simulated card (ADR-0036), always for its whole balance. One
/// serializable transaction records the attempt (brand and last four digits only) and, when approved,
/// a card receipt applied to the invoice, the audit, the «Pago recibido» email and the Finance alert.
/// The same idempotency key returns the stored attempt; with another body it is a conflict.
/// </summary>
internal sealed class EfCardPaymentStore(ElevantDbContext context, TimeProvider timeProvider, ICardPaymentGateway gateway)
    : ICardPaymentStore
{
    public const string AttachmentPrefix = "card-receipt:";

    public async Task<CardPaymentResult> PayAsync(PayInvoiceByCardRequest request, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(request);
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, cancellationToken);
                var result = await PayInsideTransactionAsync(request, cancellationToken);
                if (result.Failure is null || result.Attempt is not null) await transaction.CommitAsync(cancellationToken);
                return result;
            });
        }
        catch (Exception exception) when (exception is DbUpdateException or RetryLimitExceededException or SqlException &&
            exception.GetBaseException() is SqlException { Number: 2601 or 2627 or 1205 or 1222 or 3960 })
        {
            context.ChangeTracker.Clear();
            var replay = await ReplayAsync(request, cancellationToken);
            return replay ?? CardPaymentResult.Failed(CardPaymentFailure.Conflict, "concurrent_payment");
        }
    }

    private async Task<CardPaymentResult> PayInsideTransactionAsync(PayInvoiceByCardRequest request, CancellationToken cancellationToken)
    {
        var portal = await PortalAsync(request.AccountId, cancellationToken);
        if (portal is null) return CardPaymentResult.Failed(CardPaymentFailure.Forbidden);
        var invoice = await context.NonFiscalInvoices.AsNoTracking()
            .SingleOrDefaultAsync(item => item.PublicId == request.InvoiceId && item.AirlineId == portal.AirlineKey, cancellationToken);
        if (invoice is null) return CardPaymentResult.Failed(CardPaymentFailure.NotFound);

        var digits = CardPaymentPolicy.Digits(request.CardNumber);
        var brand = CardPaymentPolicy.Brand(digits);
        var last4 = digits[^4..];
        var hash = CardPaymentPolicy.RequestHash(request.InvoiceId, request.Amount, brand, last4);
        var prior = await context.Set<CardPaymentAttempt>().AsNoTracking()
            .SingleOrDefaultAsync(item => item.AccountId == portal.AccountKey && item.IdempotencyKey == request.IdempotencyKey,
                cancellationToken);
        if (prior is not null)
            return prior.RequestHash == hash
                ? await ResultAsync(prior, invoice, true, cancellationToken)
                : CardPaymentResult.Failed(CardPaymentFailure.Conflict, "idempotency_conflict");

        var balance = await FinanceTreasuryBalances.BalanceAsync(context, invoice.Id, invoice.Total, cancellationToken);
        if (balance <= 0) return CardPaymentResult.Failed(CardPaymentFailure.Conflict, "invoice_paid");
        if (request.Amount != balance) return CardPaymentResult.Failed(CardPaymentFailure.Conflict, "amount_mismatch");

        var now = timeProvider.GetUtcNow();
        var authorization = gateway.Authorize(new CardCharge(digits, request.ExpiryMonth, request.ExpiryYear,
            request.SecurityCode!, request.Amount, invoice.CurrencyCode));
        var attempt = new CardPaymentAttempt
        {
            PublicId = Guid.CreateVersion7(), InvoiceId = invoice.Id, AirlineId = invoice.AirlineId, AccountId = portal.AccountKey,
            IdempotencyKey = request.IdempotencyKey, RequestHash = hash, Amount = request.Amount, CurrencyCode = invoice.CurrencyCode,
            Brand = brand, Last4 = last4, Status = authorization.Status, CreatedAt = now, UpdatedAt = now,
            AuthorizationCode = authorization.Status == CardPaymentStatus.Approved ? authorization.AuthorizationCode : null,
            DeclineCode = authorization.Status == CardPaymentStatus.Approved ? null : authorization.DeclineCode ?? "declined",
        };
        if (attempt.Status == CardPaymentStatus.Approved)
        {
            var reference = $"TARJETA {brand.ToUpperInvariant()} *{last4} AUT {attempt.AuthorizationCode}";
            var posted = await FinanceTreasuryPosting.ReceiveAndApplyAsync(context, invoice, portal.AccountKey, PaymentMethod.Card,
                reference, request.Amount, "Pago con tarjeta desde el portal de la aerolínea (simulado).", now, cancellationToken);
            attempt.ReceiptId = posted.Receipt.Id;
        }
        context.Add(attempt);
        context.AuditEntries.Add(new AuditEntry
        {
            PublicId = Guid.CreateVersion7(), OccurredAt = now, ActorType = AuditActorType.Account, ActorAccountId = portal.AccountKey,
            ActorDisplay = portal.DisplayName, Action = $"finance.card_payment.{attempt.Status.ToString().ToLowerInvariant()}",
            EntityType = nameof(NonFiscalInvoice), EntityPublicId = invoice.PublicId, OrganizationId = portal.OrganizationKey,
            StationId = invoice.StationId, Source = AuditSource.Api, CorrelationId = request.IdempotencyKey,
            RequestId = request.IdempotencyKey.ToString("D"),
            Reason = attempt.Status == CardPaymentStatus.Approved
                ? "La aerolínea pagó la factura con tarjeta (simulado)."
                : "La tarjeta no fue aprobada (simulado).",
            // Card data never reaches the audit: only the brand, the last four digits and the outcome.
            MetadataJson = JsonSerializer.Serialize(new { attempt = attempt.PublicId, brand, last4, amount = request.Amount,
                status = attempt.Status.ToString(), declineCode = attempt.DeclineCode }),
        });
        await context.SaveChangesAsync(cancellationToken);

        if (attempt.Status == CardPaymentStatus.Approved)
        {
            var label = invoice.FiscalNumber ?? invoice.Number;
            var email = await context.Users.AsNoTracking().Where(user => user.Id == portal.AccountKey)
                .Select(user => user.Email).SingleOrDefaultAsync(cancellationToken);
            if (!string.IsNullOrWhiteSpace(email))
                EfEmailOutboxStore.Add(context, Application.Identity.AccountEmails.AccountEmailTemplates.PaymentReceived(email,
                        portal.AirlineName, label, invoice.CurrencyCode, request.Amount, brand, last4, attempt.AuthorizationCode!),
                    EmailPurpose.PaymentReceived, now, AttachmentPrefix + attempt.PublicId.ToString("D"));
            await DepartmentNotificationWriter.NotifyAsync(context, Department.Finance, "finance.reconciliation.read",
                "invoice_paid", invoice.PublicId, $"{portal.AirlineName} · {label}", now, cancellationToken,
                stationId: invoice.StationId);
            await FinanceApprovedServiceChangeWriter.AddAsync(context, invoice.StationId, invoice.PublicId, now,
                "finance_receipts", cancellationToken);
        }
        await AirlineOperationChangeWriter.AddTreasuryAsync(context, portal.OrganizationKey, portal.AirlineId, now, cancellationToken);
        await context.SaveChangesAsync(cancellationToken);
        return await ResultAsync(attempt, invoice, false, cancellationToken);
    }

    private async Task<CardPaymentResult?> ReplayAsync(PayInvoiceByCardRequest request, CancellationToken cancellationToken)
    {
        var accountKey = await context.Users.AsNoTracking().Where(user => user.PublicId == request.AccountId)
            .Select(user => (long?)user.Id).SingleOrDefaultAsync(cancellationToken);
        if (accountKey is null) return null;
        var prior = await context.Set<CardPaymentAttempt>().AsNoTracking()
            .SingleOrDefaultAsync(item => item.AccountId == accountKey && item.IdempotencyKey == request.IdempotencyKey, cancellationToken);
        if (prior is null) return null;
        var invoice = await context.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.Id == prior.InvoiceId, cancellationToken);
        var digits = CardPaymentPolicy.Digits(request.CardNumber);
        return prior.InvoiceId == invoice.Id && invoice.PublicId == request.InvoiceId && digits.Length >= 4 &&
               prior.RequestHash == CardPaymentPolicy.RequestHash(request.InvoiceId, request.Amount, CardPaymentPolicy.Brand(digits), digits[^4..])
            ? await ResultAsync(prior, invoice, true, cancellationToken)
            : CardPaymentResult.Failed(CardPaymentFailure.Conflict, "idempotency_conflict");
    }

    private async Task<CardPaymentResult> ResultAsync(CardPaymentAttempt attempt, NonFiscalInvoice invoice, bool replayed,
        CancellationToken cancellationToken)
    {
        var balance = await FinanceTreasuryBalances.BalanceAsync(context, invoice.Id, invoice.Total, cancellationToken);
        var receipt = attempt.ReceiptId is { } receiptId
            ? await context.Set<FinanceTreasuryReceipt>().AsNoTracking().Where(item => item.Id == receiptId)
                .Select(item => (Guid?)item.PublicId).SingleAsync(cancellationToken)
            : null;
        return new CardPaymentResult(Data(attempt, invoice.PublicId, receipt), balance, replayed, null, []);
    }

    private static CardPaymentAttemptData Data(CardPaymentAttempt attempt, Guid invoiceId, Guid? receiptId) =>
        new(attempt.PublicId, invoiceId, attempt.Status.ToString(), attempt.Brand, attempt.Last4, attempt.Amount,
            attempt.CurrencyCode, attempt.AuthorizationCode, attempt.DeclineCode, receiptId, attempt.CreatedAt);

    public async Task<IReadOnlyList<CardPaymentAttemptData>?> AirlineAttemptsAsync(Guid accountId, Guid invoiceId,
        CancellationToken cancellationToken = default)
    {
        var portal = await PortalAsync(accountId, cancellationToken);
        if (portal is null) return null;
        var invoice = await context.NonFiscalInvoices.AsNoTracking()
            .Where(item => item.PublicId == invoiceId && item.AirlineId == portal.AirlineKey)
            .Select(item => (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        return invoice is null ? null : await AttemptsAsync(invoice.Value, invoiceId, cancellationToken);
    }

    public async Task<IReadOnlyList<CardPaymentAttemptData>?> FinanceAttemptsAsync(Guid accountId, Guid invoiceId,
        CancellationToken cancellationToken = default)
    {
        var actor = await new EfActorContextResolver(context, timeProvider).ResolveAsync(accountId, cancellationToken);
        if (actor is null || !actor.HasPermission("finance.reconciliation.read") ||
            !actor.Memberships.Any(item => item.OrganizationType == OrganizationType.AviamOperator &&
                item.Kind == MembershipKind.InternalStaff)) return null;
        var stations = actor.StationScopes.Select(scope => scope.StationId).ToArray();
        var invoice = await (from item in context.NonFiscalInvoices.AsNoTracking()
                             join station in context.Stations.AsNoTracking() on item.StationId equals station.Id
                             where item.PublicId == invoiceId && stations.Contains(station.PublicId)
                             select (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        return invoice is null ? null : await AttemptsAsync(invoice.Value, invoiceId, cancellationToken);
    }

    private async Task<IReadOnlyList<CardPaymentAttemptData>> AttemptsAsync(long invoiceKey, Guid invoiceId,
        CancellationToken cancellationToken)
    {
        var rows = await (from attempt in context.Set<CardPaymentAttempt>().AsNoTracking()
                          join receipt in context.Set<FinanceTreasuryReceipt>().AsNoTracking()
                              on attempt.ReceiptId equals (long?)receipt.Id into receipts
                          from receipt in receipts.DefaultIfEmpty()
                          where attempt.InvoiceId == invoiceKey
                          orderby attempt.CreatedAt descending
                          select new { attempt, ReceiptId = receipt == null ? (Guid?)null : receipt.PublicId })
            .ToArrayAsync(cancellationToken);
        return rows.Select(row => Data(row.attempt, invoiceId, row.ReceiptId)).ToArray();
    }

    public async Task<CardPaymentReceiptData?> AirlineReceiptAsync(Guid accountId, Guid attemptId,
        CancellationToken cancellationToken = default)
    {
        var portal = await PortalAsync(accountId, cancellationToken);
        return portal is null ? null : await ReceiptAsync(attemptId, portal.AirlineKey, cancellationToken);
    }

    /// <summary>System read for the email attachment: the outbox already chose the recipient.</summary>
    internal Task<CardPaymentReceiptData?> SystemReceiptAsync(Guid attemptId, CancellationToken cancellationToken) =>
        ReceiptAsync(attemptId, null, cancellationToken);

    private async Task<CardPaymentReceiptData?> ReceiptAsync(Guid attemptId, long? airlineKey, CancellationToken cancellationToken) =>
        await (from attempt in context.Set<CardPaymentAttempt>().AsNoTracking()
               join invoice in context.NonFiscalInvoices.AsNoTracking() on attempt.InvoiceId equals invoice.Id
               join airline in context.Airlines.AsNoTracking() on attempt.AirlineId equals airline.Id
               join receipt in context.Set<FinanceTreasuryReceipt>().AsNoTracking() on attempt.ReceiptId equals (long?)receipt.Id
               where attempt.PublicId == attemptId && attempt.Status == CardPaymentStatus.Approved &&
                   (airlineKey == null || attempt.AirlineId == airlineKey)
               select new CardPaymentReceiptData(attempt.PublicId, airline.Name, invoice.Number, invoice.FiscalNumber,
                   attempt.Brand, attempt.Last4, attempt.AuthorizationCode!, attempt.Amount, attempt.CurrencyCode,
                   attempt.CreatedAt, receipt.Reference))
            .SingleOrDefaultAsync(cancellationToken);

    private sealed record Portal(long AccountKey, string DisplayName, long OrganizationKey, long AirlineKey, Guid AirlineId,
        string AirlineName);

    private async Task<Portal?> PortalAsync(Guid accountId, CancellationToken cancellationToken)
    {
        var actor = await new EfActorContextResolver(context, timeProvider).ResolveAsync(accountId, cancellationToken);
        var organizationId = FinanceTreasuryPortalAccess.OrganizationId(actor, accountId);
        if (organizationId is null) return null;
        var airline = await (from item in context.Airlines.AsNoTracking()
                             join organization in context.Organizations.AsNoTracking() on item.OrganizationId equals organization.Id
                             where organization.PublicId == organizationId && organization.Type == OrganizationType.AirlineCustomer &&
                                 organization.Status == OrganizationStatus.Active && item.IsActive
                             select new { item.Id, item.PublicId, item.Name, OrganizationKey = organization.Id })
            .SingleOrDefaultAsync(cancellationToken);
        var accountKey = await context.Users.AsNoTracking().Where(user => user.PublicId == accountId)
            .Select(user => (long?)user.Id).SingleOrDefaultAsync(cancellationToken);
        return airline is null || accountKey is null ? null
            : new Portal(accountKey.Value, actor!.DisplayName, airline.OrganizationKey, airline.Id, airline.PublicId, airline.Name);
    }
}

/// <summary>Resolves <c>card-receipt:{attemptId}</c> to the receipt PDF when the email is sent.</summary>
internal sealed class EfCardReceiptAttachmentResolver(EfCardPaymentStore store, IFinancialDocumentPdfRenderer renderer)
    : Application.Abstractions.Messaging.IEmailAttachmentResolver
{
    public async Task<Application.Abstractions.Messaging.EmailAttachment?> ResolveAsync(string reference,
        CancellationToken cancellationToken = default)
    {
        if (!reference.StartsWith(EfCardPaymentStore.AttachmentPrefix, StringComparison.Ordinal) ||
            !Guid.TryParse(reference[EfCardPaymentStore.AttachmentPrefix.Length..], out var attemptId)) return null;
        var receipt = await store.SystemReceiptAsync(attemptId, cancellationToken);
        return receipt is null ? null
            : new Application.Abstractions.Messaging.EmailAttachment($"recibo-{receipt.AuthorizationCode}.pdf", "application/pdf",
                renderer.RenderCardReceipt(receipt));
    }
}
