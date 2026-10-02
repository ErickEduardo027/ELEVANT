using System.Net.Mail;
using Elevant.Application.Abstractions.Commercial;

namespace Elevant.Application.Commercial;

public sealed record SubmitCommercialRequestCommand(
    Guid RequestId, Guid AirlineProfileId, IReadOnlyList<Guid> ServiceIds,
    string RepresentativeName, string RepresentativeTitle,
    string RepresentativeEmail, string RepresentativePhone, bool AuthorityDeclared,
    string? RepresentativeNationalityCode = null,
    string? RepresentativeAddress = null,
    string? RepresentativeCountry = null,
    string? RepresentativeProvince = null,
    string? RepresentativeMunicipality = null,
    string? RepresentativeDocumentType = null,
    string? RepresentativeDocumentNumber = null);

public enum CommercialSubmissionFailure
{
    InvalidRequest,
    AirlineUnavailable,
    ServiceUnavailable,
    Conflict,
}

public sealed record CommercialSubmissionResult(
    string? Reference, bool Replayed, CommercialSubmissionFailure? Failure)
{
    public bool IsSuccess => Reference is not null && Failure is null;
    public static CommercialSubmissionResult Success(string reference, bool replayed) =>
        new(reference, replayed, null);
    public static CommercialSubmissionResult Failed(CommercialSubmissionFailure failure) =>
        new(null, false, failure);
}

public sealed class SubmitCommercialRequestHandler(ICommercialIntakeStore store)
{
    public Task<CommercialSubmissionResult> HandleAsync(
        SubmitCommercialRequestCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        if (command.RequestId == Guid.Empty || command.AirlineProfileId == Guid.Empty ||
            command.ServiceIds is null or { Count: < 1 or > 20 } ||
            command.ServiceIds.Any(id => id == Guid.Empty) ||
            command.ServiceIds.Distinct().Count() != command.ServiceIds.Count ||
            !command.AuthorityDeclared ||
            !ValidText(command.RepresentativeName, 160) ||
            !ValidText(command.RepresentativeTitle, 120) ||
            !ValidText(command.RepresentativePhone, 32) ||
            !ValidText(command.RepresentativeEmail, 256) ||
            !ValidEmail(command.RepresentativeEmail) ||
            !ValidPhone(command.RepresentativePhone) ||
            !ValidNationality(command.RepresentativeNationalityCode) ||
            !OptionalText(command.RepresentativeAddress, 250) ||
            !OptionalText(command.RepresentativeCountry, 80) ||
            !OptionalText(command.RepresentativeProvince, 80) ||
            !OptionalText(command.RepresentativeMunicipality, 80) ||
            !ValidDocument(command.RepresentativeDocumentType,
                command.RepresentativeDocumentNumber))
            return Task.FromResult(CommercialSubmissionResult.Failed(
                CommercialSubmissionFailure.InvalidRequest));

        return store.SubmitAsync(command, cancellationToken);
    }

    private static bool ValidText(string? value, int maxLength) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= maxLength;

    private static bool OptionalText(string? value, int maxLength) =>
        string.IsNullOrWhiteSpace(value) || value.Trim().Length <= maxLength;

    private static bool ValidNationality(string? value) =>
        string.IsNullOrWhiteSpace(value) ||
        value.Length == 2 && value.All(char.IsAsciiLetterUpper);

    private static bool ValidPhone(string value)
    {
        var phone = value.Trim();
        if (!phone.StartsWith('+') ||
            phone.Skip(1).Any(character => !char.IsAsciiDigit(character) &&
                character is not (' ' or '-' or '(' or ')')))
            return false;
        var digits = phone.Count(char.IsAsciiDigit);
        return digits is >= 8 and <= 15 && phone.Length <= 32;
    }

    private static bool ValidDocument(string? type, string? number)
    {
        if (string.IsNullOrWhiteSpace(type) && string.IsNullOrWhiteSpace(number))
            return true;
        if (type is not ("NationalId" or "Passport" or "Other") ||
            string.IsNullOrWhiteSpace(number)) return false;
        var value = number.Trim();
        return value.Length is >= 3 and <= 40 &&
            value.All(character => char.IsAsciiLetterOrDigit(character) ||
                character is ' ' or '-' or '/');
    }

    private static bool ValidEmail(string email) =>
        MailAddress.TryCreate(email.Trim(), out var address) &&
        string.Equals(address.Address, email.Trim(), StringComparison.OrdinalIgnoreCase);
}
