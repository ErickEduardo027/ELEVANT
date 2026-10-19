using Elevant.Application.Abstractions.Finance;
using Elevant.Contracts.Finance;
namespace Elevant.Api.Controllers;
internal static class AirlineTreasuryResponseMapper
{
    public static AirlineTreasuryInvoiceResponse Map(AirlineTreasuryInvoiceData value) => new(value.Id, value.PreinvoiceId, value.Number, value.StationId, value.StationCode, value.CurrencyCode, value.Total, value.LegacyPaid, value.LegacyCredited, value.Applied, value.Credited, value.Debited, value.Balance, value.DueDate, value.DaysOverdue, value.AgingBucket);
    public static AirlineTreasuryMovementResponse Map(AirlineTreasuryMovementData value) => new(value.Id, value.ReceiptId, value.InvoiceId, value.Kind, value.CurrencyCode, value.Amount, value.EffectiveOn, value.RecordedAt, value.ReversesId, value.Reference);
    public static AirlineTreasuryReceiptMovementResponse Map(AirlineTreasuryReceiptMovementData value) => new(value.Id, value.Kind, value.InvoiceId, value.ReversesId, value.EffectiveOn, value.ReceiptAmount, value.InvoiceAmount, value.ReceiptCurrency, value.InvoiceCurrency, value.ExchangeRate, value.ExchangeRateOn, value.Reference, value.Reason, value.RecordedAt);
    public static AirlineTreasuryReceiptResponse Map(AirlineTreasuryReceiptData value) => new(value.Id, value.StationId, value.StationCode, value.Reference, value.CurrencyCode, value.Amount, value.Applied, value.Refunded, value.Available, value.Reversed, value.Method, value.ReceivedOn, value.Movements.Select(Map).ToArray());
    public static AirlineTreasuryAdjustmentLineResponse Map(AirlineTreasuryAdjustmentLineData value) => new(value.InvoiceLineId, value.Quantity, value.Amount);
    public static AirlineTreasuryAdjustmentResponse Map(AirlineTreasuryAdjustmentData value) => new(value.Id, value.Number, value.InvoiceId, value.RelatedNoteId, value.Kind, value.CurrencyCode, value.Amount, value.EffectiveOn, value.Reason, value.RecordedAt, value.Lines.Select(Map).ToArray());
    public static AirlineTreasuryAdjustmentsResponse Map(AirlineTreasuryAdjustmentsData value) => new(value.InvoiceId, value.Number, value.CurrencyCode, value.LegacyCredited, value.Notes.Select(Map).ToArray());
    public static AirlineTreasuryInvoiceLineResponse Map(AirlineTreasuryInvoiceLineData value) => new(value.Id, value.LineNumber, value.Kind, value.ParentLineNumber, value.OperationCode, value.OperationDate, value.ServiceCode, value.ServiceName, value.Quantity, value.BillingUnit, value.UnitPrice, value.Amount, value.Reason);
    public static AirlineTreasuryInvoiceDetailResponse Map(AirlineTreasuryInvoiceDetailData value) => new(Map(value.Invoice), value.Lines.Select(Map).ToArray(), value.Movements.Select(Map).ToArray(), value.Notes.Select(Map).ToArray());
    public static AirlineTreasuryAgingResponse Map(AirlineTreasuryAgingData value) => new(value.CurrencyCode, value.Balance, value.Current, value.Days1To30, value.Days31To60, value.Days61To90, value.Days91Plus, value.Unallocated, value.CreditBalance);
    public static AirlineTreasuryStatementResponse Map(AirlineTreasuryStatementData value) => new(value.AirlineId, value.AsOf, value.Invoices.Select(Map).ToArray(), value.Receipts.Select(Map).ToArray(), value.Movements.Select(Map).ToArray(), value.Aging.Select(Map).ToArray());
}
