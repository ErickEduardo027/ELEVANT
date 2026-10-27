using System.Net.Mail;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Reference;
using Elevant.Domain.Validation;

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
    string? RepresentativeDocumentNumber = null,
    IReadOnlyList<Guid>? PackageVersionIds = null,
    string? RepresentativeDistrict = null);

public sealed record SubmitAdditionalServiceRequestCommand(
    Guid RequestId, IReadOnlyList<Guid> ServiceIds,
    string RepresentativeName, string RepresentativeTitle,
    string RepresentativeEmail, string RepresentativePhone, bool AuthorityDeclared,
    IReadOnlyList<Guid>? PackageVersionIds = null);

public enum CommercialSubmissionFailure
{
    InvalidRequest,
    AirlineUnavailable,
    ServiceUnavailable,
    Conflict,
    ReceiptNotFound,
    Forbidden,
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
    public Task<CommercialSubmissionResult> HandleAdditionalAsync(Guid actorId,
        SubmitAdditionalServiceRequestCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (actorId == Guid.Empty || !IsValid(new SubmitCommercialRequestCommand(
                command.RequestId, new Guid("00000000-0000-0000-0000-000000000001"),
                command.ServiceIds, command.RepresentativeName, command.RepresentativeTitle,
                command.RepresentativeEmail, command.RepresentativePhone,
                command.AuthorityDeclared, PackageVersionIds: command.PackageVersionIds)))
            return Task.FromResult(CommercialSubmissionResult.Failed(
                CommercialSubmissionFailure.InvalidRequest));
        return store.SubmitAdditionalAsync(actorId, command, cancellationToken);
    }
    public Task<CommercialSubmissionResult> HandleAsync(
        SubmitCommercialRequestCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        var canonical = Canonical(command);
        if (canonical is null)
            return Task.FromResult(CommercialSubmissionResult.Failed(
                CommercialSubmissionFailure.InvalidRequest));

        return store.SubmitAsync(canonical, cancellationToken);
    }

    public async Task<CommercialSubmissionResult> LookupReceiptAsync(
        SubmitCommercialRequestCommand command,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        cancellationToken.ThrowIfCancellationRequested();
        var canonical = Canonical(command);
        if (canonical is null)
            return CommercialSubmissionResult.Failed(CommercialSubmissionFailure.InvalidRequest);
        var reference = await store.LookupReceiptAsync(canonical, cancellationToken);
        return reference is null
            ? CommercialSubmissionResult.Failed(CommercialSubmissionFailure.ReceiptNotFound)
            : CommercialSubmissionResult.Success(reference, true);
    }

    /// <summary>
    /// Validates the request and returns it with the phone in E.164 and the document number
    /// in its canonical form, so equal submissions typed differently are stored the same way.
    /// </summary>
    private static SubmitCommercialRequestCommand? Canonical(SubmitCommercialRequestCommand command)
    {
        if (!IsValid(command)) return null;
        var phone = PhoneNumbers.Normalize(command.RepresentativePhone);
        if (phone is null) return null;
        var document = CanonicalDocument(command.RepresentativeDocumentType,
            command.RepresentativeDocumentNumber, command.RepresentativeNationalityCode);
        if (document is { Valid: false }) return null;
        return command with
        {
            RepresentativePhone = phone,
            RepresentativeDocumentNumber = document?.Number,
        };
    }

    private static (bool Valid, string? Number)? CanonicalDocument(string? type, string? number,
        string? nationality)
    {
        if (string.IsNullOrWhiteSpace(type) && string.IsNullOrWhiteSpace(number)) return null;
        if (string.IsNullOrWhiteSpace(number)) return (false, null);
        var canonical = type switch
        {
            "NationalId" => IdentityDocuments.Normalize(IdentityDocumentKind.Cedula, number),
            "Passport" => IdentityDocuments.Normalize(IdentityDocumentKind.Passport, number, nationality),
            "Other" => OtherDocument(number),
            _ => null,
        };
        return (canonical is not null, canonical);
    }

    private static string? OtherDocument(string number)
    {
        var value = number.Trim();
        return value.Length is >= 3 and <= 40 &&
            value.All(character => char.IsAsciiLetterOrDigit(character) ||
                character is ' ' or '-' or '/') ? value : null;
    }

    private static bool IsValid(SubmitCommercialRequestCommand command) =>
        command.RequestId != Guid.Empty && command.AirlineProfileId != Guid.Empty &&
        !(
            command.ServiceIds is null or { Count: > 20 } ||
            command.ServiceIds.Any(id => id == Guid.Empty) ||
            command.ServiceIds.Distinct().Count() != command.ServiceIds.Count ||
            command.PackageVersionIds is { Count: > 10 } ||
            command.PackageVersionIds?.Any(id => id == Guid.Empty) == true ||
            command.PackageVersionIds?.Distinct().Count() != command.PackageVersionIds?.Count ||
            (command.ServiceIds.Count == 0 && (command.PackageVersionIds?.Count ?? 0) == 0) ||
            !command.AuthorityDeclared ||
            !ValidText(command.RepresentativeName, 160) ||
            !ValidText(command.RepresentativeTitle, 120) ||
            !ValidText(command.RepresentativePhone, 32) ||
            !ValidText(command.RepresentativeEmail, 256) ||
            !ValidEmail(command.RepresentativeEmail) ||
            !ValidNationality(command.RepresentativeNationalityCode) ||
            !OptionalText(command.RepresentativeAddress, 250) ||
            !OptionalText(command.RepresentativeCountry, 80) ||
            !OptionalText(command.RepresentativeProvince, 80) ||
            !OptionalText(command.RepresentativeMunicipality, 80) ||
            !OptionalText(command.RepresentativeDistrict, 80) ||
            !ValidLocation(command));

    /// <summary>Dominican addresses must name a real province, municipality and municipal district.</summary>
    private static bool ValidLocation(SubmitCommercialRequestCommand command) =>
        !DominicanTerritory.IsDominicanRepublic(command.RepresentativeCountry)
            ? string.IsNullOrWhiteSpace(command.RepresentativeDistrict)
            : DominicanTerritory.IsValidLocation(command.RepresentativeProvince,
                command.RepresentativeMunicipality, command.RepresentativeDistrict);

    private static bool ValidText(string? value, int maxLength) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= maxLength;

    private static bool OptionalText(string? value, int maxLength) =>
        string.IsNullOrWhiteSpace(value) || value.Trim().Length <= maxLength;

    private static bool ValidNationality(string? value) =>
        string.IsNullOrWhiteSpace(value) ||
        value.Length == 2 && value.All(char.IsAsciiLetterUpper);

    private static bool ValidEmail(string email) =>
        MailAddress.TryCreate(email.Trim(), out var address) &&
        string.Equals(address.Address, email.Trim(), StringComparison.OrdinalIgnoreCase);
}
