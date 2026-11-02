using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;

namespace Elevant.UnitTests.Domain;

public sealed class EmployeeRulesTests
{
    [Theory]
    [InlineData("001-1234567-8", "00112345678")]
    [InlineData(" 001 1234567 8 ", "00112345678")]
    [InlineData("rd.123456a", "RD123456A")]
    public void NormalizesIdentificationNumbers(string input, string expected) =>
        Assert.Equal(expected, IdentificationTypes.NormalizeNumber(input));

    [Theory]
    [InlineData(null)]
    [InlineData("   ")]
    [InlineData("12")]
    [InlineData("001/1234567")]
    [InlineData("ñ123456")]
    public void RejectsUnusableIdentificationNumbers(string? input) =>
        Assert.Null(IdentificationTypes.NormalizeNumber(input));

    [Fact]
    public void RecognisesRealAndPlaceholderIdentificationTypes()
    {
        Assert.True(IdentificationTypes.IsValid("CEDULA"));
        Assert.False(IdentificationTypes.IsValid("cedula"));
        Assert.True(IdentificationTypes.IsSynthetic("GOVERNANCE_ACCOUNT"));
        Assert.True(IdentificationTypes.IsSynthetic("Synthetic"));
        Assert.False(IdentificationTypes.IsSynthetic("CEDULA"));
    }

    [Theory]
    [InlineData(RequisitionStatus.Open, RequisitionStatus.InProgress, true)]
    [InlineData(RequisitionStatus.InProgress, RequisitionStatus.Fulfilled, true)]
    [InlineData(RequisitionStatus.Open, RequisitionStatus.Cancelled, true)]
    [InlineData(RequisitionStatus.InProgress, RequisitionStatus.Open, false)]
    [InlineData(RequisitionStatus.Fulfilled, RequisitionStatus.Cancelled, false)]
    [InlineData(RequisitionStatus.Rejected, RequisitionStatus.InProgress, false)]
    public void RequisitionsOnlyMoveForward(RequisitionStatus from, RequisitionStatus to, bool allowed) =>
        Assert.Equal(allowed, RequisitionTransitions.CanMove(from, to));

    [Fact]
    public void RejectingOrCancellingARequisitionNeedsAReason()
    {
        Assert.True(RequisitionTransitions.RequiresReason(RequisitionStatus.Rejected));
        Assert.True(RequisitionTransitions.RequiresReason(RequisitionStatus.Cancelled));
        Assert.False(RequisitionTransitions.RequiresReason(RequisitionStatus.Fulfilled));
    }

    [Fact]
    public void HumanResourcesCatalogOffersEmployeePositionAndRequisitionActions()
    {
        var codes = DepartmentPermissionCatalog.CodesOf(Department.HumanResources);
        Assert.Contains("human_resources.employees.delete", codes);
        Assert.Contains("human_resources.positions.create", codes);
        Assert.Contains("human_resources.positions.update", codes);
        Assert.Contains("human_resources.requisitions.attend", codes);
        Assert.Contains("human_resources.ramp_profiles.update", codes);
        // A grant stored before ADR-0019 keeps working.
        Assert.Equal(["human_resources.employees.delete", "human_resources.employees.read"],
            DepartmentPermissionCatalog.Normalize(["human_resources.employees.terminate"]));
    }

    [Theory]
    [InlineData("RD1234567", true)]
    [InlineData("RD12345678", false)]
    [InlineData("RD12345A7", false)]
    [InlineData("X1234567", true)]
    public void EmployeePassportsStartingWithRdFollowTheDominicanRule(string number, bool valid) =>
        Assert.Equal(valid, IdentificationTypes.Normalize(IdentificationTypes.Pasaporte, number) is not null);

    [Fact]
    public void EmployeeDocumentsExplainTheWrongPosition() =>
        Assert.Equal("El pasaporte dominicano: la posición 8 debe ser un dígito; encontramos «A». Formato: RD1234567.",
            IdentificationTypes.Check(IdentificationTypes.Pasaporte, "RD12345A7").Problem);
}
