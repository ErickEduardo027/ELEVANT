using System.Net.Mail;
using Elevant.Application.Abstractions.Commercial;

namespace Elevant.Application.Commercial;

public sealed record SubmitCommercialRequestCommand(
    Guid RequestId, Guid AirlineProfileId, IReadOnlyList<Guid> ServiceIds,
    string RepresentativeName, string RepresentativeTitle,
    string RepresentativeEmail, string RepresentativePhone, bool AuthorityDeclared);

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
            !ValidEmail(command.RepresentativeEmail))
            return Task.FromResult(CommercialSubmissionResult.Failed(
                CommercialSubmissionFailure.InvalidRequest));

        return store.SubmitAsync(command, cancellationToken);
    }

    private static bool ValidText(string? value, int maxLength) =>
        !string.IsNullOrWhiteSpace(value) && value.Trim().Length <= maxLength;

    private static bool ValidEmail(string email) =>
        MailAddress.TryCreate(email.Trim(), out var address) &&
        string.Equals(address.Address, email.Trim(), StringComparison.OrdinalIgnoreCase);
}
