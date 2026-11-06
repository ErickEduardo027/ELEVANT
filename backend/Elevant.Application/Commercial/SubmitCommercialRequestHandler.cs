using System.Net.Mail;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Domain.Reference;
using Elevant.Domain.Validation;

namespace Elevant.Application.Commercial;

/// <summary>
/// Public application. It names a catalog profile with <paramref name="AirlineProfileId"/>, or proposes
/// an airline that is not listed with <paramref name="ProposedAirline"/> (and an empty profile ID).
/// </summary>
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
    string? RepresentativeDistrict = null,
    CommercialAirlineProposal? ProposedAirline = null);

/// <summary>
/// Airline the applicant could not find in the public catalog (1-N25). Only the ICAO designator is
/// required: an operator without IATA omits it. Contratos verifies it before any approval.
/// </summary>
public sealed record CommercialAirlineProposal(string Name, string CountryCode, string? IataCode,
    string IcaoCode, string? WebsiteUrl = null);

public enum CommercialSubmissionFailure
{
    InvalidRequest,
    AirlineUnavailable,
    ServiceUnavailable,
    Conflict,
    ReceiptNotFound,
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
        var proposal = command.ProposedAirline is { } proposed ? CanonicalProposal(proposed) : null;
        if (command.ProposedAirline is not null && proposal is null) return null;
        return command with
        {
            RepresentativePhone = phone,
            RepresentativeDocumentNumber = document?.Number,
            ProposedAirline = proposal,
        };
    }

    /// <summary>Trimmed, upper-case designators; an HTTPS website without credentials when given.</summary>
    private static CommercialAirlineProposal? CanonicalProposal(CommercialAirlineProposal proposal)
    {
        var name = proposal.Name?.Trim();
        var country = proposal.CountryCode?.Trim().ToUpperInvariant();
        var iata = string.IsNullOrWhiteSpace(proposal.IataCode) ? null : proposal.IataCode.Trim().ToUpperInvariant();
        var icao = proposal.IcaoCode?.Trim().ToUpperInvariant();
        var website = string.IsNullOrWhiteSpace(proposal.WebsiteUrl) ? null : proposal.WebsiteUrl.Trim();
        if (name is not { Length: >= 2 and <= 160 } || !AirlineCodes.IsCountry(country) ||
            iata is not null && !AirlineCodes.IsIata(iata) || !AirlineCodes.IsIcao(icao) ||
            website is not null && !IsPublicHttpsUrl(website, 512))
            return null;
        return new CommercialAirlineProposal(name, country!, iata, icao!, website);
    }

    internal static bool IsPublicHttpsUrl(string value, int maxLength) =>
        value.Length <= maxLength && Uri.TryCreate(value, UriKind.Absolute, out var uri) &&
        uri.Scheme == Uri.UriSchemeHttps && uri.UserInfo.Length == 0 && uri.Host.Contains('.');

    /// <summary>
    /// The representative identifies with a Dominican cédula or a passport whose nationality is
    /// given; every character is checked in its position (ADR-0020). «Otro» is no longer accepted.
    /// </summary>
    private static (bool Valid, string? Number)? CanonicalDocument(string? type, string? number,
        string? nationality)
    {
        if (string.IsNullOrWhiteSpace(type) || string.IsNullOrWhiteSpace(number)) return (false, null);
        var canonical = type switch
        {
            "NationalId" when string.IsNullOrWhiteSpace(nationality) ||
                string.Equals(nationality.Trim(), "DO", StringComparison.OrdinalIgnoreCase) =>
                IdentityDocuments.Normalize(IdentityDocumentKind.Cedula, number),
            "Passport" when !string.IsNullOrWhiteSpace(nationality) =>
                IdentityDocuments.Normalize(IdentityDocumentKind.Passport, number, nationality),
            _ => null,
        };
        return (canonical is not null, canonical);
    }

    private static bool IsValid(SubmitCommercialRequestCommand command) =>
        command.RequestId != Guid.Empty &&
        // Either a catalog profile or a proposed airline, never both.
        (command.AirlineProfileId != Guid.Empty) != (command.ProposedAirline is not null) &&
        !(
            command.ServiceIds is null or { Count: < 1 or > 20 } ||
            command.ServiceIds.Any(id => id == Guid.Empty) ||
            command.ServiceIds.Distinct().Count() != command.ServiceIds.Count ||
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
