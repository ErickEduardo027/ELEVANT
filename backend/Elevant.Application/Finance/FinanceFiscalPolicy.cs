using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
namespace Elevant.Application.Finance;

public static class FinanceFiscalPolicy
{
    public const string Disclaimer = "SIMULATION WITHOUT FISCAL VALIDITY";
    public static FinanceFiscalFailure? ExecutionFailure(FinanceFiscalOptions options) => options.Mode switch
    {
        FiscalMode.Off => FinanceFiscalFailure.Disabled,
        FiscalMode.ProviderSandbox => FinanceFiscalFailure.ProviderNotConfigured,
        FiscalMode.LocalSimulation when options.Environment is "Development" or "Test" => null,
        _ => FinanceFiscalFailure.Invalid,
    };
    public static string Hash(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
    public static string Hash(string text) => Hash(Encoding.UTF8.GetBytes(text));
    public static bool CanDispatch(FiscalState state) => state is FiscalState.AwaitingArchive or FiscalState.ArchiveBlocked;
    public static bool CanApply(FiscalState current, FiscalState next, long lastSequence, long sequence) =>
        sequence > lastSequence && current is FiscalState.Dispatching or FiscalState.Pending or FiscalState.Conditional or FiscalState.Unknown &&
        next is FiscalState.Accepted or FiscalState.Rejected or FiscalState.Conditional or FiscalState.Pending or FiscalState.Unknown;
    public static string Snapshot(Guid invoiceId, string number, string currency, decimal total, IReadOnlyList<FiscalSnapshotLine> lines,
        string? originalCommercialSnapshot = null, decimal? net = null, decimal? discount = null, decimal? tax = null)
    {
        ArgumentNullException.ThrowIfNull(lines);
        if (invoiceId == Guid.Empty || string.IsNullOrWhiteSpace(number) || currency is not ("USD" or "DOP") ||
            total < 0 || decimal.Round(total, 4) != total || lines.Count is < 1 or > 500 ||
            lines.Select(l => l.LineNumber).Distinct().Count() != lines.Count ||
            lines.Any(l => l.LineNumber < 1 || l.CurrencyCode != currency || l.Quantity < 0 || l.UnitPrice < 0 ||
                string.IsNullOrWhiteSpace(l.ServiceCode) || string.IsNullOrWhiteSpace(l.ServiceName) ||
                string.IsNullOrWhiteSpace(l.BillingUnit) || l.OperationDate == default ||
                decimal.Round(l.Amount, 4) != l.Amount || decimal.Round(l.Quantity, 4) != l.Quantity ||
                decimal.Round(l.UnitPrice, 4) != l.UnitPrice || !HasExplicitTax(l)) || lines.Sum(l => l.Amount) != total ||
            !FourDecimals(net) || !FourDecimals(discount) || !FourDecimals(tax) ||
            lines.Sum(l => l.Net) != net || lines.Sum(l => l.Discount) != discount || lines.Sum(l => l.Tax) != tax ||
            net - discount + tax != total)
            throw new ArgumentException("Invoice does not have a valid frozen financial snapshot.");
        try
        {
            using var commercial = JsonDocument.Parse(originalCommercialSnapshot ?? "null");
            if (commercial.RootElement.ValueKind != JsonValueKind.Object ||
                !commercial.RootElement.TryGetProperty("issuer", out var issuer) || issuer.ValueKind != JsonValueKind.Object ||
                !commercial.RootElement.TryGetProperty("customer", out var customer) || customer.ValueKind != JsonValueKind.Object)
                throw new ArgumentException("Invoice does not have a frozen issuer/customer commercial snapshot.");
        }
        catch (JsonException e) { throw new ArgumentException("Invoice commercial snapshot is invalid.", nameof(originalCommercialSnapshot), e); }
        return JsonSerializer.Serialize(new
        {
            format = "elevant-fiscal-simulation-v2", disclaimer = Disclaimer, invoiceId, number,
            currencyCode = currency, total, net, discount, tax, gross = total, originalCommercialSnapshot,
            taxValidation = "ExplicitFrozenTreatmentsOnly: statutory fiscal validation not performed",
            rounding = "Original frozen amounts retained at decimal(19,4); net before discount; no repricing or inferred tax",
            lines = lines.OrderBy(l => l.LineNumber).Select(l => new { lineNumber = l.LineNumber, kind = l.Kind,
                parentLineNumber = l.ParentLineNumber, reason = l.Reason, operationCode = l.OperationCode,
                operationDate = l.OperationDate, serviceCode = l.ServiceCode, serviceName = l.ServiceName,
                quantity = l.Quantity, billingUnit = l.BillingUnit, unitPrice = l.UnitPrice,
                currencyCode = l.CurrencyCode, amount = l.Amount, net = l.Net, discount = l.Discount, tax = l.Tax,
                gross = l.Gross, treatment = l.Treatment, rate = l.Rate, basis = l.Basis,
                policyId = l.PolicyId, capturedAt = l.CapturedAt }),
        });
    }

    private static bool FourDecimals(decimal? value) => value.HasValue && decimal.Round(value.Value, 4) == value;
    private static bool HasExplicitTax(FiscalSnapshotLine line)
    {
        if (!FourDecimals(line.Net) || !FourDecimals(line.Discount) || !FourDecimals(line.Tax) || !FourDecimals(line.Gross) ||
            line.Discount < 0 || line.Gross != line.Amount || line.Net - line.Discount + line.Tax != line.Gross ||
            line.PolicyId is null || line.PolicyId == Guid.Empty || line.CapturedAt is null ||
            !Enum.TryParse<FinanceTaxTreatment>(line.Treatment, false, out var treatment)) return false;
        return treatment switch
        {
            FinanceTaxTreatment.Taxable => line.Rate is >= 0 and <= 100 && FourDecimals(line.Rate) && (line.Rate != 0 || line.Tax == 0),
            FinanceTaxTreatment.Exempt or FinanceTaxTreatment.NotSubject => line.Rate is null && line.Tax == 0 &&
                line.Basis?.Trim().Length is >= 3 and <= 500,
            _ => false,
        };
    }
}
