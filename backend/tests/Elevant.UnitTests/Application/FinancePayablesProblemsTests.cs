using Elevant.Application.Finance;

namespace Elevant.UnitTests.Application;

/// <summary>4-N27: every refusal of suppliers, payables and expenses has a stable code with one HTTP status.</summary>
public sealed class FinancePayablesProblemsTests
{
    [Theory]
    [InlineData(FinancePayablesProblems.Unauthorized, 401)]
    [InlineData(FinancePayablesProblems.Forbidden, 403)]
    [InlineData(FinancePayablesProblems.SegregationOfDuties, 403)]
    [InlineData(FinancePayablesProblems.NotFound, 404)]
    [InlineData(FinancePayablesProblems.VersionConflict, 409)]
    [InlineData(FinancePayablesProblems.IdempotencyConflict, 409)]
    [InlineData(FinancePayablesProblems.InvalidState, 409)]
    [InlineData(FinancePayablesProblems.DuplicateReference, 409)]
    [InlineData(FinancePayablesProblems.DuplicateSupplierCode, 409)]
    [InlineData(FinancePayablesProblems.SupplierInactive, 409)]
    [InlineData(FinancePayablesProblems.SupplierHasOpenBalance, 409)]
    [InlineData(FinancePayablesProblems.InvoiceHasApplications, 409)]
    [InlineData(FinancePayablesProblems.PaymentHasApplications, 409)]
    [InlineData(FinancePayablesProblems.PaymentVoided, 409)]
    [InlineData(FinancePayablesProblems.AlreadyReversed, 409)]
    [InlineData(FinancePayablesProblems.BalanceExceeded, 409)]
    [InlineData(FinancePayablesProblems.Invalid, 400)]
    [InlineData(FinancePayablesProblems.ReasonRequired, 400)]
    [InlineData(FinancePayablesProblems.ReceiptRequired, 400)]
    [InlineData(FinancePayablesProblems.ExpenseDateOutsideAssignment, 400)]
    [InlineData(FinancePayablesProblems.AttachmentLimit, 400)]
    [InlineData(FinancePayablesProblems.InvalidAttachment, 400)]
    [InlineData(FinancePayablesProblems.Unavailable, 503)]
    public void EachCodeAnswersItsStatus(string code, int status) => Assert.Equal(status, FinancePayablesProblems.StatusOf(code));

    [Theory]
    [InlineData(null)]
    [InlineData("")]
    [InlineData("conflict")]
    [InlineData("Version_Conflict")]
    public void AnUnknownCodeIsABadRequest(string? code) => Assert.Equal(400, FinancePayablesProblems.StatusOf(code));

    [Fact]
    public void CodesAreLowerSnakeCaseAndUnique()
    {
        var codes = typeof(FinancePayablesProblems).GetFields()
            .Where(field => field.IsLiteral && field.FieldType == typeof(string))
            .Select(field => (string)field.GetRawConstantValue()!).ToArray();
        Assert.Equal(23, codes.Length);
        Assert.Equal(codes.Length, codes.Distinct(StringComparer.Ordinal).Count());
        Assert.All(codes, code => Assert.Matches("^[a-z]+(_[a-z]+)*$", code));
    }
}
