using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;
namespace Elevant.Persistence.Finance;

/// <summary>
/// 4-N17: a credit or debit note on an E31 invoice gets its own simulated e-NCF (E34, E33) and freezes the ITBIS of each
/// line it adjusts; its PDF is read by Finance, by the airline in its portal and by the email that announces it.
/// </summary>
internal sealed partial class FinanceTreasuryStore
{
    /// <summary>
    /// The number of a new note: the next E34 (credit) or E33 (debit) when the invoice is an e-CF E31, read under
    /// UPDLOCK, HOLDLOCK in the serializable transaction like the E31 sequence (the unique index of the number is the
    /// last guard); an invoice without e-NCF keeps the internal TC-/TD- number.
    /// </summary>
    private async Task<string> NoteNumberAsync(NonFiscalInvoice invoice, FinanceTreasuryAdjustmentKind kind, Guid noteId,
        CancellationToken ct)
    {
        var credit = kind == FinanceTreasuryAdjustmentKind.Credit;
        if (!FinanceInvoicePolicy.IsFiscalNumber(invoice.FiscalNumber)) return $"{(credit ? "TC" : "TD")}-{noteId:N}";
        var prefix = FinanceInvoicePolicy.NoteFiscalPrefix(credit);
        var highest = await context.Set<FinanceTreasuryAdjustmentNote>()
            .FromSqlRaw("SELECT * FROM [commercial].[finance_treasury_adjustment_notes] WITH (UPDLOCK, HOLDLOCK)")
            .Where(note => note.Number.StartsWith(prefix)).Select(note => note.Number).MaxAsync(ct);
        return FinanceInvoicePolicy.NextFiscalNumber(prefix, highest);
    }

    /// <summary>
    /// The frozen net, ITBIS and rate of each line a note adjusts, from the invoice line's immutable tax snapshot and
    /// what the earlier notes of the same kind took from it. A line that froze no tax freezes nothing; an earlier note
    /// issued before the breakdown counts with its proportional ITBIS.
    /// </summary>
    private async Task<Dictionary<long, (decimal? Net, decimal? Tax, decimal? Rate)>> BreakdownAsync(
        NonFiscalInvoiceLine[] invoiceLines, FinanceTreasuryAdjustmentKind kind,
        IReadOnlyList<FinanceTreasuryAdjustmentLineInput> lines, CancellationToken ct)
    {
        var ids = invoiceLines.Select(line => line.Id).ToArray();
        var earlier = await (from entry in context.Set<FinanceTreasuryAdjustmentLine>().AsNoTracking()
                             join note in context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking() on entry.NoteId equals note.Id
                             where ids.Contains(entry.InvoiceLineId) && note.Kind == kind
                             select new { entry.InvoiceLineId, entry.Amount, entry.TaxAmount }).ToArrayAsync(ct);
        var result = new Dictionary<long, (decimal? Net, decimal? Tax, decimal? Rate)>();
        foreach (var input in lines)
        {
            var line = invoiceLines.Single(item => item.PublicId == input.InvoiceLineId);
            if (line.TaxAmount is not { } lineTax || line.TaxRate is not { } rate)
            {
                result[line.Id] = (null, null, null);
                continue;
            }
            var gross = line.GrossAmount ?? line.Amount;
            var before = earlier.Where(item => item.InvoiceLineId == line.Id).ToArray();
            var adjustedTax = before.Sum(item => item.TaxAmount ??
                (gross <= 0m ? 0m : decimal.Round(item.Amount * lineTax / gross, 2, MidpointRounding.AwayFromZero)));
            var breakdown = FinanceInvoicePolicy.AdjustmentTax(gross, lineTax, before.Sum(item => item.Amount), adjustedTax,
                input.Amount);
            result[line.Id] = (breakdown.Net, breakdown.Tax, rate);
        }
        return result;
    }

    public async Task<FinanceAdjustmentNoteDocumentData?> AdjustmentNoteDocumentAsync(Guid actorId, Guid noteId,
        CancellationToken cancellationToken = default)
    {
        if (noteId == Guid.Empty) return null;
        var actor = await ActorAsync(actorId, "finance.adjustments.read", cancellationToken);
        if (actor is null) return null;
        var note = await (from item in context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking()
                          join invoice in Invoices(actor).AsNoTracking() on item.InvoiceId equals invoice.Invoice.Id
                          where item.PublicId == noteId
                          select (long?)item.Id).SingleOrDefaultAsync(cancellationToken);
        return note is null ? null : await AdjustmentNoteDocuments.ReadAsync(context, note.Value, cancellationToken);
    }

    public Task<AirlineTreasuryReadResult<FinanceAdjustmentNoteDocumentData>> PortalAdjustmentNoteDocumentAsync(Guid actorId,
        Guid noteId, CancellationToken cancellationToken = default)
    {
        var ct = cancellationToken;
        return PortalReadAsync<FinanceAdjustmentNoteDocumentData>(actorId, async scope =>
        {
            var note = await (from item in context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking()
                              join invoice in PortalInvoices(scope) on item.InvoiceId equals invoice.Invoice.Id
                              where item.PublicId == noteId
                              select (long?)item.Id).SingleOrDefaultAsync(ct);
            return note is null ? null : await AdjustmentNoteDocuments.ReadAsync(context, note.Value, ct);
        }, ct);
    }
}

/// <summary>Reads the document of a note for whoever the caller already authorized, or for the email that announces it.</summary>
internal static class AdjustmentNoteDocuments
{
    public const string AttachmentPrefix = "adjustment-note:";

    public static async Task<FinanceAdjustmentNoteDocumentData?> ReadAsync(ElevantDbContext context, long noteId,
        CancellationToken ct)
    {
        var head = await (from note in context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking()
                          join invoice in context.NonFiscalInvoices.AsNoTracking() on note.InvoiceId equals invoice.Id
                          join airline in context.Airlines.AsNoTracking() on invoice.AirlineId equals airline.Id
                          join organization in context.Organizations.AsNoTracking() on airline.OrganizationId equals organization.Id
                          join station in context.Stations.AsNoTracking() on invoice.StationId equals station.Id
                          where note.Id == noteId
                          select new
                          {
                              note.PublicId, note.Number, note.Kind, InvoiceId = invoice.PublicId, InvoiceNumber = invoice.Number,
                              invoice.FiscalNumber, note.CurrencyCode, note.Amount, note.EffectiveOn, note.CreatedAt,
                              note.Reason, organization.LegalName, organization.Code, StationCode = station.Code,
                          }).SingleOrDefaultAsync(ct);
        if (head is null) return null;
        var lines = await (from entry in context.Set<FinanceTreasuryAdjustmentLine>().AsNoTracking()
                           join line in context.NonFiscalInvoiceLines.AsNoTracking() on entry.InvoiceLineId equals line.Id
                           where entry.NoteId == noteId
                           orderby line.LineNumber
                           select new FinanceAdjustmentNoteDocumentLineData(line.LineNumber, line.OperationCode,
                               line.ServiceCode, line.ServiceName, entry.Quantity, entry.Amount, entry.NetAmount,
                               entry.TaxAmount, entry.TaxRate)).ToArrayAsync(ct);
        return new FinanceAdjustmentNoteDocumentData(head.PublicId, head.Number, head.Kind.ToString(), head.InvoiceId,
            head.InvoiceNumber, head.FiscalNumber, head.CurrencyCode, head.Amount, head.EffectiveOn, head.CreatedAt, head.Reason,
            "AVIAM Ltd.", FinanceInvoicePolicy.SimulatedIssuerRnc, head.LegalName, head.Code, head.StationCode, lines);
    }

    public static async Task<FinanceAdjustmentNoteDocumentData?> ReadAsync(ElevantDbContext context, Guid noteId,
        CancellationToken ct)
    {
        var id = await context.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking().Where(note => note.PublicId == noteId)
            .Select(note => (long?)note.Id).SingleOrDefaultAsync(ct);
        return id is null ? null : await ReadAsync(context, id.Value, ct);
    }

    /// <summary>The file name of the note's PDF.</summary>
    public static string FileName(FinanceAdjustmentNoteDocumentData note) => $"nota-{note.Number}.pdf";
}

/// <summary>Resolves <c>adjustment-note:{publicId}</c> to the note's PDF when the email is sent (4-N23).</summary>
internal sealed class EfAdjustmentNoteAttachmentResolver(ElevantDbContext context, IFinancialDocumentPdfRenderer renderer)
    : Application.Abstractions.Messaging.IEmailAttachmentResolver
{
    public async Task<Application.Abstractions.Messaging.EmailAttachment?> ResolveAsync(string reference,
        CancellationToken cancellationToken = default)
    {
        if (!reference.StartsWith(AdjustmentNoteDocuments.AttachmentPrefix, StringComparison.Ordinal) ||
            !Guid.TryParse(reference[AdjustmentNoteDocuments.AttachmentPrefix.Length..], out var noteId)) return null;
        var note = await AdjustmentNoteDocuments.ReadAsync(context, noteId, cancellationToken);
        return note is null ? null
            : new Application.Abstractions.Messaging.EmailAttachment(AdjustmentNoteDocuments.FileName(note), "application/pdf",
                renderer.RenderAdjustmentNote(note));
    }
}
