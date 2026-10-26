using Elevant.Domain.Validation;

namespace Elevant.UnitTests.Domain;

public sealed class IdentityValidationTests
{
    [Theory]
    [InlineData("849-246-3371", "+18492463371")]
    [InlineData("8492463371", "+18492463371")]
    [InlineData("(809) 555 0100", "+18095550100")]
    [InlineData("1-829-555-0100", "+18295550100")]
    [InlineData("+1 849 246 3371", "+18492463371")]
    [InlineData("+34 600 123 456", "+34600123456")]
    [InlineData("0034 600 123 456", "+34600123456")]
    public void NormalizesDominicanAndInternationalPhones(string input, string expected) =>
        Assert.Equal(expected, PhoneNumbers.Normalize(input));

    [Theory]
    [InlineData("305-555-0100")]
    [InlineData("555-0100")]
    [InlineData("+1 849 246 337")]
    [InlineData("849-ABC-3371")]
    [InlineData("+0 123 4567 89")]
    [InlineData("")]
    public void RejectsAmbiguousOrMalformedPhones(string input) =>
        Assert.Null(PhoneNumbers.Normalize(input));

    [Fact]
    public void AcceptsCedulasWithAValidCheckDigitInAnyLayout()
    {
        var cedula = WithLuhnDigit("0011234567");
        Assert.Equal(cedula, IdentityDocuments.Normalize(IdentityDocumentKind.Cedula, cedula));
        Assert.Equal(cedula, IdentityDocuments.Normalize(IdentityDocumentKind.Cedula,
            $"{cedula[..3]}-{cedula[3..10]}-{cedula[10]}"));
        var wrong = cedula[..10] + (char)('0' + (cedula[10] - '0' + 1) % 10);
        Assert.Null(IdentityDocuments.Normalize(IdentityDocumentKind.Cedula, wrong));
        Assert.Null(IdentityDocuments.Normalize(IdentityDocumentKind.Cedula, "0000000000"));
        Assert.Null(IdentityDocuments.Normalize(IdentityDocumentKind.Cedula, "00000000000"));
        Assert.Null(IdentityDocuments.Normalize(IdentityDocumentKind.Residence, "50505050RD"));
    }

    [Theory]
    [InlineData("RD1234567", "DO", true)]
    [InlineData("rd 123 4567", "DO", true)]
    [InlineData("5050505050RD", "DO", false)]
    [InlineData("1234567RD", "DO", false)]
    [InlineData("RD12345678", "DO", false)]
    [InlineData("X1234567", "ES", true)]
    [InlineData("123456789", "US", true)]
    [InlineData("AAAAAA", null, false)]
    [InlineData("1111111", null, false)]
    [InlineData("5050505050RD", null, false)]
    public void ValidatesPassportsByNationality(string number, string? nationality, bool valid) =>
        Assert.Equal(valid, IdentityDocuments.Normalize(IdentityDocumentKind.Passport, number, nationality) is not null);

    [Fact]
    public void ValidatesRncCheckDigit()
    {
        var rnc = WithRncDigit("10112345");
        Assert.Equal(rnc, IdentityDocuments.Normalize(IdentityDocumentKind.Rnc, $"{rnc[0]}-{rnc[1..3]}-{rnc[3..8]}-{rnc[8]}"));
        Assert.Null(IdentityDocuments.Normalize(IdentityDocumentKind.Rnc, rnc[..8] + (char)('0' + (rnc[8] - '0' + 1) % 10)));
        Assert.Null(IdentityDocuments.Normalize(IdentityDocumentKind.Rnc, "12345"));
    }

    [Fact]
    public void ExplainsTheExpectedFormat()
    {
        Assert.Contains("2 letras", IdentityDocuments.Example(IdentityDocumentKind.Passport, "DO"));
        Assert.Contains("11 dígitos", IdentityDocuments.Example(IdentityDocumentKind.Cedula));
    }

    /// <summary>Builds a cédula whose last digit satisfies the Luhn rule used by the JCE.</summary>
    public static string WithLuhnDigit(string tenDigits)
    {
        var sum = 0;
        for (var index = 0; index < 10; index++)
        {
            var product = (tenDigits[index] - '0') * (index % 2 == 0 ? 1 : 2);
            sum += product > 9 ? product - 9 : product;
        }
        return tenDigits + (char)('0' + (10 - sum % 10) % 10);
    }

    private static string WithRncDigit(string eightDigits)
    {
        int[] weights = [7, 9, 8, 6, 5, 4, 3, 2];
        var sum = 0;
        for (var index = 0; index < 8; index++) sum += (eightDigits[index] - '0') * weights[index];
        var remainder = sum % 11;
        return eightDigits + (char)('0' + (remainder switch { 0 => 2, 1 => 1, _ => 11 - remainder }));
    }
}
