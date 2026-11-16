using System.Security.Cryptography;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

internal sealed partial class FinancePayablesStore
{
    private static bool Signature(string contentType, byte[] bytes) => contentType switch
    {
        "application/pdf" => bytes.AsSpan().StartsWith("%PDF-"u8),
        "image/png" => bytes.AsSpan().StartsWith(new byte[] { 137, 80, 78, 71, 13, 10, 26, 10 }),
        "image/jpeg" => bytes.Length >= 3 && bytes[0] == 255 && bytes[1] == 216 && bytes[2] == 255,
        _ => false,
    };
    public async Task<FinancePayablesResult<FinancePayablesMutation>> UploadAttachmentAsync(Guid actorId, Guid id, bool expense,
        Guid requestId, string expectedVersion, string contentType, byte[] bytes, CancellationToken ct = default)
    {
        if (bytes is null || bytes.Length is < 1 or > 8 * 1024 * 1024 || !Signature(contentType, bytes))
            return FinancePayablesResult<FinancePayablesMutation>.Fail(FinancePayablesProblems.InvalidAttachment);
        var sha = Convert.ToHexString(SHA256.HashData(bytes)); var attachmentId = Guid.CreateVersion7();
        var key = "finance-payables/" + attachmentId.ToString("N"); var stored = false;
        var result = await WriteAsync(actorId, requestId, expense ? "expense.receipt.upload" : "payable.attachment.upload", id,
            new { expectedVersion, contentType, sha, bytes.Length }, expense ? "" : "finance.payables.update", async a =>
            {
                long? invoice = null, claim = null;
                if (expense)
                {
                    var row = await ExpenseAsync(a, id, ct); Match(row.RowVersion, expectedVersion);
                    Require(OwnExpenseAccess(a) && row.CreatedByAccountId == a.Id && row.EmployeeId == a.Employee?.Id, "forbidden");
                    Require(row.Status == EmployeeExpenseStatus.Draft, FinancePayablesProblems.InvalidState); claim = row.Id;
                    row.UpdatedAt = clock.GetUtcNow(); context.Entry(row).Property(x => x.UpdatedAt).IsModified = true;
                }
                else
                {
                    Require(Finance(a, "finance.payables.update"), "forbidden"); var row = await InvoiceAsync(a, id, ct); Match(row.RowVersion, expectedVersion);
                    Require(row.Status == SupplierInvoiceStatus.Draft, FinancePayablesProblems.InvalidState); invoice = row.Id;
                    row.UpdatedAt = clock.GetUtcNow(); context.Entry(row).Property(x => x.UpdatedAt).IsModified = true;
                }
                // 4-N13: a removed receipt no longer takes one of the 20 places.
                Require(await context.Set<FinancePayablesAttachment>().CountAsync(x => (expense ? x.ExpenseClaimId == claim : x.SupplierInvoiceId == invoice) &&
                    x.RemovedAt == null, ct) < 20, FinancePayablesProblems.AttachmentLimit);
                await objects.PutAsync(key, bytes, ct); stored = true;
                context.Set<FinancePayablesAttachment>().Add(new FinancePayablesAttachment { PublicId = attachmentId, SupplierInvoiceId = invoice, ExpenseClaimId = claim,
                    ObjectKey = key, ContentType = contentType, Length = bytes.Length, Sha256 = sha, UploadedByAccountId = a.Id, CreatedAt = clock.GetUtcNow() });
                Audit(a, expense ? "finance.expense.receipt_uploaded" : "finance.payable.attachment_uploaded", "commercial.finance_payables_attachments", attachmentId); return attachmentId;
            }, ct);
        if (!result.IsSuccess && stored) await objects.DeleteAsync(key, ct);
        return result;
    }
    public Task<FinancePayablesResult<FinancePayablesAttachmentContent>> DownloadAttachmentAsync(Guid actorId, Guid id, bool expense, Guid attachmentId, CancellationToken ct = default) =>
        ReadAsync(actorId, expense ? "" : "finance.payables.read", async a =>
        {
            var documentId = expense ? (await ExpenseAsync(a, id, ct)).Id : (await InvoiceAsync(a, id, ct)).Id;
            // 4-N13: a removed receipt is history only; nobody downloads it again.
            var row = await context.Set<FinancePayablesAttachment>().AsNoTracking().SingleOrDefaultAsync(x => x.PublicId == attachmentId &&
                (expense ? x.ExpenseClaimId == documentId : x.SupplierInvoiceId == documentId) && x.RemovedAt == null, ct);
            Require(row is not null, "not_found"); var content = await objects.GetAsync(row!.ObjectKey, ct);
            Require(content is not null && content.LongLength == row.Length && Convert.ToHexString(SHA256.HashData(content)) == row.Sha256, "unavailable");
            return new FinancePayablesAttachmentContent(content!, row.ContentType, row.Sha256);
        }, ct);
    /// <summary>
    /// 4-N13: removes a receipt from a draft expense (only its requester) or supplier invoice (<c>finance.payables.update</c>),
    /// say a document uploaded by mistake. The row stays, marked with who removed it and when, and the document moves to a
    /// new version. A receipt no submission ever included was never reviewed, so its bytes are erased once the removal
    /// commits (best effort: a storage failure leaves them private and unreachable); one a reviewer saw is kept hidden.
    /// </summary>
    public async Task<FinancePayablesResult<FinancePayablesMutation>> RemoveAttachmentAsync(Guid actorId, Guid id, bool expense, Guid attachmentId,
        FinancePayablesAttachmentRemoval input, CancellationToken ct = default)
    {
        string? erase = null;
        var result = await WriteAsync(actorId, input.RequestId, expense ? "expense.receipt.remove" : "payable.attachment.remove", id,
            new { attachmentId, input.ExpectedVersion }, expense ? "" : "finance.payables.update", async a =>
            {
                erase = null; long document; IQueryable<DateTimeOffset> submissions;
                if (expense)
                {
                    var row = await ExpenseAsync(a, id, ct); Match(row.RowVersion, input.ExpectedVersion);
                    Require(OwnExpenseAccess(a) && row.CreatedByAccountId == a.Id && row.EmployeeId == a.Employee?.Id, FinancePayablesProblems.Forbidden);
                    Require(row.Status == EmployeeExpenseStatus.Draft, FinancePayablesProblems.InvalidState); document = row.Id;
                    row.UpdatedAt = clock.GetUtcNow(); context.Entry(row).Property(x => x.UpdatedAt).IsModified = true;
                    submissions = context.Set<EmployeeExpenseReview>().Where(r => r.DocumentId == document && r.Stage == "Submission").Select(r => r.DecidedAt);
                }
                else
                {
                    Require(Finance(a, "finance.payables.update"), FinancePayablesProblems.Forbidden);
                    var row = await InvoiceAsync(a, id, ct); Match(row.RowVersion, input.ExpectedVersion);
                    Require(row.Status == SupplierInvoiceStatus.Draft, FinancePayablesProblems.InvalidState); document = row.Id;
                    row.UpdatedAt = clock.GetUtcNow(); context.Entry(row).Property(x => x.UpdatedAt).IsModified = true;
                    submissions = context.Set<SupplierInvoiceReview>().Where(r => r.DocumentId == document && r.Stage == "Submission").Select(r => r.DecidedAt);
                }
                var attachment = await context.Set<FinancePayablesAttachment>().SingleOrDefaultAsync(x => x.PublicId == attachmentId &&
                    (expense ? x.ExpenseClaimId == document : x.SupplierInvoiceId == document) && x.RemovedAt == null, ct);
                Require(attachment is not null, FinancePayablesProblems.NotFound);
                var uploadedAt = attachment!.CreatedAt;
                attachment.RemovedAt = clock.GetUtcNow(); attachment.RemovedByAccountId = a.Id;
                if (!await submissions.AnyAsync(at => at >= uploadedAt, ct)) erase = attachment.ObjectKey;
                Audit(a, expense ? "finance.expense.receipt_removed" : "finance.payable.attachment_removed", "commercial.finance_payables_attachments", attachmentId);
                return attachmentId;
            }, ct);
        if (result.IsSuccess && !result.Value!.Replayed && erase is not null)
        {
            // The removal is committed whatever happens here: a storage failure or a timeout leaves the bytes private and
            // unreachable, never a failed answer for a change that already happened.
            try { await objects.DeleteAsync(erase, CancellationToken.None); }
            catch (FinancialDocumentUnavailableException) { }
            catch (OperationCanceledException) { }
        }
        return result;
    }
}
