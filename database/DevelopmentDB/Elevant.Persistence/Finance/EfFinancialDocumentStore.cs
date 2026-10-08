using System.Security.Cryptography;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;

namespace Elevant.Persistence.Finance;

/// <summary>Publishes immutable private PDFs after the source financial record exists.</summary>
internal sealed class EfFinancialDocumentStore(
    ElevantDbContext context, IPrivateFinancialObjectStore objects,
    IFinancialDocumentPdfRenderer renderer, TimeProvider timeProvider)
    : IFinancialDocumentStore
{
    public async Task<FinancialDocumentData> OpenInvoiceAsync(
        NonFiscalInvoiceData invoice, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(invoice);
        var source = await ClassifyAsync(() => context.NonFiscalInvoices.AsNoTracking()
            .Where(item => item.PublicId == invoice.Id)
            .Select(item => new { item.Id, item.Number, item.CurrencyCode, item.Total })
            .SingleOrDefaultAsync(cancellationToken),
            FinancialDocumentFailureStage.SourceRead);
        if (source is null || source.Number != invoice.Number ||
            source.CurrencyCode != invoice.CurrencyCode || source.Total != invoice.Total)
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.SourceValidation);
        return await OpenOrCreateAsync(source.Id, null, "Invoice", invoice.Id,
            () => renderer.RenderInvoice(invoice), $"invoice-{invoice.Id:N}.pdf",
            cancellationToken);
    }

    public async Task<FinancialDocumentData> OpenReceiptAsync(
        NonFiscalPaymentData payment, string invoiceNumber,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(payment);
        var source = await ClassifyAsync(() => (
            from item in context.NonFiscalPayments.AsNoTracking()
            join invoice in context.NonFiscalInvoices.AsNoTracking()
                on item.InvoiceId equals invoice.Id
            where item.PublicId == payment.Id && invoice.PublicId == payment.InvoiceId
            select new { PaymentId = item.Id, item.InvoiceId, item.Reference,
                item.CurrencyCode, item.Amount, InvoiceNumber = invoice.Number })
            .SingleOrDefaultAsync(cancellationToken),
            FinancialDocumentFailureStage.SourceRead);
        if (source is null || source.InvoiceNumber != invoiceNumber ||
            source.Reference != payment.Reference || source.CurrencyCode != payment.CurrencyCode ||
            source.Amount != payment.Amount)
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.SourceValidation);
        return await OpenOrCreateAsync(source.InvoiceId, source.PaymentId, "Receipt", payment.Id,
            () => renderer.RenderReceipt(payment, invoiceNumber),
            $"receipt-{payment.Id:N}.pdf", cancellationToken);
    }

    private async Task<FinancialDocumentData> OpenOrCreateAsync(
        long invoiceId, long? paymentId, string kind, Guid sourceId,
        Func<byte[]> render, string fileName, CancellationToken cancellationToken)
    {
        var existing = await ClassifyAsync(() => FindAsync(invoiceId, paymentId, kind, cancellationToken),
            FinancialDocumentFailureStage.MetadataRead);
        if (existing is not null)
            return await ReadVerifiedAsync(existing, kind, fileName, cancellationToken);

        var bytes = Classify(render, FinancialDocumentFailureStage.Rendering);
        var hash = Convert.ToHexString(SHA256.HashData(bytes)).ToLowerInvariant();
        if (!FinancialDocumentIntegrity.Matches(bytes, bytes.Length, hash))
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.RenderedContent);
        var id = Guid.CreateVersion7();
        var key = $"finance/{kind.ToLowerInvariant()}/{sourceId:N}/{id:N}.pdf";
        await ClassifyAsync(() => objects.PutAsync(key, bytes, cancellationToken),
            FinancialDocumentFailureStage.StorageWrite);

        var now = timeProvider.GetUtcNow();
        var row = new FinancialDocument
        {
            PublicId = id, InvoiceId = invoiceId, PaymentId = paymentId,
            Kind = kind, ObjectKey = key, ContentType = "application/pdf",
            Length = bytes.LongLength, Sha256 = hash,
            CreatedAt = now, UpdatedAt = now,
        };
        context.FinancialDocuments.Add(row);
        try
        {
            await context.SaveChangesAsync(cancellationToken);
            return new FinancialDocumentData(id, kind, fileName, bytes, hash);
        }
        catch (DbUpdateException exception) when (IsUniquenessConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
        }
        catch (RetryLimitExceededException exception) when (IsUniquenessConflict(exception.GetBaseException()))
        {
            context.ChangeTracker.Clear();
        }
        catch (SqlException exception) when (IsUniquenessConflict(exception))
        {
            context.ChangeTracker.Clear();
        }
        catch (OperationCanceledException) { throw; }
        catch (FinancialDocumentUnavailableException) { throw; }
        catch (Exception exception)
        {
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.MetadataWrite, exception);
        }

        // An uncertain commit or a concurrent first reader may have won the
        // unique (invoice, kind) index. Re-read before cleanup: deleting this
        // attempt's S3 key would lose the document if its first commit succeeded.
        existing = await ClassifyAsync(() => FindAsync(invoiceId, paymentId, kind, cancellationToken),
                FinancialDocumentFailureStage.MetadataRead)
            ?? throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.MetadataConflict);
        if (existing.ObjectKey != key)
        {
            try
            {
                await ClassifyAsync(() => objects.DeleteAsync(key, cancellationToken),
                    FinancialDocumentFailureStage.StorageDelete);
            }
            catch (FinancialDocumentUnavailableException)
            {
                // The winning document is still available; orphan cleanup can
                // be retried operationally without failing this download.
            }
        }
        return await ReadVerifiedAsync(existing, kind, fileName, cancellationToken);
    }

    /// <summary>One invoice document per invoice; one receipt per payment (an invoice may have several).</summary>
    private Task<FinancialDocument?> FindAsync(long invoiceId, long? paymentId, string kind,
        CancellationToken cancellationToken) => context.FinancialDocuments.AsNoTracking()
        .SingleOrDefaultAsync(item => item.InvoiceId == invoiceId && item.Kind == kind &&
            (paymentId == null ? item.PaymentId == null : item.PaymentId == paymentId), cancellationToken);

    private async Task<FinancialDocumentData> ReadVerifiedAsync(
        FinancialDocument row, string kind, string fileName,
        CancellationToken cancellationToken)
    {
        if (!row.ObjectKey.StartsWith($"finance/{kind.ToLowerInvariant()}/",
                StringComparison.Ordinal) || row.ContentType != "application/pdf" ||
            row.Length > FinancialDocumentIntegrity.MaxBytes)
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.StoredContent);
        var bytes = await ClassifyAsync(() => objects.GetAsync(row.ObjectKey, cancellationToken),
            FinancialDocumentFailureStage.StorageRead);
        if (bytes is null || !FinancialDocumentIntegrity.Matches(bytes, row.Length, row.Sha256))
            throw new FinancialDocumentUnavailableException(
                FinancialDocumentFailureStage.StoredContent);
        return new FinancialDocumentData(row.PublicId, kind, fileName, bytes, row.Sha256);
    }

    private static bool IsUniquenessConflict(Exception exception) =>
        exception is SqlException sql && IsUniquenessConflict(sql.Number);

    internal static bool IsUniquenessConflict(int number) => number is 2601 or 2627;

    private static T Classify<T>(Func<T> action, FinancialDocumentFailureStage stage)
    {
        try { return action(); }
        catch (OperationCanceledException) { throw; }
        catch (FinancialDocumentUnavailableException) { throw; }
        catch (Exception exception)
        {
            throw new FinancialDocumentUnavailableException(stage, exception);
        }
    }

    private static async Task<T> ClassifyAsync<T>(Func<Task<T>> action,
        FinancialDocumentFailureStage stage)
    {
        try { return await action(); }
        catch (OperationCanceledException) { throw; }
        catch (FinancialDocumentUnavailableException) { throw; }
        catch (Exception exception)
        {
            throw new FinancialDocumentUnavailableException(stage, exception);
        }
    }

    private static async Task ClassifyAsync(Func<Task> action,
        FinancialDocumentFailureStage stage)
    {
        try { await action(); }
        catch (OperationCanceledException) { throw; }
        catch (FinancialDocumentUnavailableException) { throw; }
        catch (Exception exception)
        {
            throw new FinancialDocumentUnavailableException(stage, exception);
        }
    }
}
