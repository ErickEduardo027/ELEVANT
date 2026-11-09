using Elevant.Domain.Enumerations;

namespace Elevant.Application.Finance;

/// <summary>
/// Spanish labels of the Finance codes that reports, CSV and PDF print (4-N19): a code is never exported raw.
/// </summary>
public static class FinanceLabels
{
    /// <summary>How a payment or receipt was collected: «Transferencia», «Cheque», «Efectivo», «Otro» or «Tarjeta».</summary>
    public static string PaymentMethod(PaymentMethod method) => method switch
    {
        Domain.Enumerations.PaymentMethod.Transfer => "Transferencia",
        Domain.Enumerations.PaymentMethod.Check => "Cheque",
        Domain.Enumerations.PaymentMethod.Cash => "Efectivo",
        Domain.Enumerations.PaymentMethod.Card => "Tarjeta",
        _ => "Otro",
    };
}
