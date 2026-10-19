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
            return FinancePayablesResult<FinancePayablesMutation>.Fail("invalid");
        var sha = Convert.ToHexString(SHA256.HashData(bytes)); var attachmentId = Guid.CreateVersion7();
        var key = "finance-payables/" + attachmentId.ToString("N"); var stored = false;
        var result = await WriteAsync(actorId, requestId, expense ? "expense.receipt.upload" : "payable.attachment.upload", id,
            new { expectedVersion, contentType, sha, bytes.Length }, expense ? "" : "finance.payables.manage", async a =>
            {
                long? invoice = null, claim = null;
                if (expense)
                {
                    var row = await ExpenseAsync(a, id, ct); Match(row.RowVersion, expectedVersion);
                    Require(OwnExpenseAccess(a) && row.CreatedByAccountId == a.Id && row.EmployeeId == a.Employee?.Id, "forbidden");
                    Require(row.Status == EmployeeExpenseStatus.Draft, "conflict"); claim = row.Id;
                    row.UpdatedAt = clock.GetUtcNow(); context.Entry(row).Property(x => x.UpdatedAt).IsModified = true;
                }
                else
                {
                    Require(Finance(a, "finance.payables.manage"), "forbidden"); var row = await InvoiceAsync(a, id, ct); Match(row.RowVersion, expectedVersion);
                    Require(row.Status == SupplierInvoiceStatus.Draft, "conflict"); invoice = row.Id;
                    row.UpdatedAt = clock.GetUtcNow(); context.Entry(row).Property(x => x.UpdatedAt).IsModified = true;
                }
                Require(await context.Set<FinancePayablesAttachment>().CountAsync(x => expense ? x.ExpenseClaimId == claim : x.SupplierInvoiceId == invoice, ct) < 20);
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
            var row = await context.Set<FinancePayablesAttachment>().AsNoTracking().SingleOrDefaultAsync(x => x.PublicId == attachmentId &&
                (expense ? x.ExpenseClaimId == documentId : x.SupplierInvoiceId == documentId), ct);
            Require(row is not null, "not_found"); var content = await objects.GetAsync(row!.ObjectKey, ct);
            Require(content is not null && content.LongLength == row.Length && Convert.ToHexString(SHA256.HashData(content)) == row.Sha256, "unavailable");
            return new FinancePayablesAttachmentContent(content!, row.ContentType, row.Sha256);
        }, ct);
}
