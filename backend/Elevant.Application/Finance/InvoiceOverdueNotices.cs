namespace Elevant.Application.Finance;

/// <summary>
/// 4-N23: the one notice of an e-CF invoice that passed its due date with a balance. An invoice is overdue from the first
/// business day of AVIAM in Santo Domingo after its due date; the audit entry <see cref="AuditAction"/> marks it as
/// notified, so the notice is sent once whatever the number of API hosts.
/// </summary>
public static class InvoiceOverdueNotices
{
    /// <summary>The audit action that records the notice and keeps it from repeating.</summary>
    public const string AuditAction = "finance.invoice.overdue_notified";

    /// <summary>How many invoices one sweep notifies at most; the next hourly sweep takes the rest.</summary>
    public const int BatchSize = 200;
}

/// <summary>4-N23: notifies the airline of each invoice that became overdue, once.</summary>
public interface IInvoiceOverdueNoticeStore
{
    /// <summary>
    /// Notifies at most <paramref name="limit"/> invoices overdue on the business day of <paramref name="now"/>, each
    /// in its own serializable transaction that checks the invoice again; returns how many it notified.
    /// </summary>
    Task<int> SweepAsync(DateTimeOffset now, int limit, CancellationToken cancellationToken = default);
}
