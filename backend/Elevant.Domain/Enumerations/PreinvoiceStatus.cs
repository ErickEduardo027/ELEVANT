namespace Elevant.Domain.Enumerations;

public enum PreinvoiceStatus
{
    Draft,
    Submitted,
    Disputed,
    Accepted,
    Invoiced,
    Voided,

    /// <summary>
    /// 4-N07: the internal draft of operations Finance closed without charge (their valuation was zero): it holds
    /// their services like an invoice and keeps the package consumption it recorded. Stored as text.
    /// </summary>
    NoCharge,
}
