using Elevant.Application.Finance;

namespace Elevant.UnitTests.Application;

/// <summary>4-N24: an invoice credited to zero without any payment is «Anulada», never «Pagada».</summary>
public sealed class FinanceInvoiceStatusTests
{
    [Theory]
    // Credited in full, nobody paid: voided.
    [InlineData(0, 0, 118, 0, FinanceInvoiceStatus.Voided)]
    [InlineData(0, 0, 118, 12, FinanceInvoiceStatus.Voided)]
    // Paid in full, or partly paid and the rest credited: the invoice was collected.
    [InlineData(0, 118, 0, 0, FinanceInvoiceStatus.Paid)]
    [InlineData(0, 18, 100, 0, FinanceInvoiceStatus.Paid)]
    [InlineData(-5, 123, 0, 0, FinanceInvoiceStatus.Paid)]
    // A historical invoice of zero, neither paid nor credited, stays paid.
    [InlineData(0, 0, 0, 0, FinanceInvoiceStatus.Paid)]
    // With a balance: overdue first, then partly settled, then pending.
    [InlineData(100, 18, 0, 3, FinanceInvoiceStatus.Overdue)]
    [InlineData(100, 0, 18, 0, FinanceInvoiceStatus.PartiallyPaid)]
    [InlineData(100, 18, 0, 0, FinanceInvoiceStatus.PartiallyPaid)]
    [InlineData(118, 0, 0, 0, FinanceInvoiceStatus.Pending)]
    public void TheStatusFollowsTheBalanceAndWhatSettledIt(double balance, double paid, double credited, int overdueDays,
        string expected) =>
        Assert.Equal(expected, FinanceInvoiceStatus.Of((decimal)balance, (decimal)paid, (decimal)credited, overdueDays));

    [Fact]
    public void VoidedIsOneOfTheProjectedStatuses() =>
        Assert.Equal(["Pending", "PartiallyPaid", "Paid", "Overdue", "Voided"], FinanceInvoiceStatus.All);
}
