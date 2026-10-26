namespace Elevant.Application.Abstractions.Commercial;

/// <summary>Adobe PDF Services boundary. The JSON is composed only from server-owned SQL data.</summary>
public interface IContractDocumentGenerator
{
    Task<byte[]> GenerateAsync(byte[] templateDocx, string mergeJson,
        CancellationToken cancellationToken = default);
}

public sealed record SigningAgreementState(string Status,
    IReadOnlyList<string> SignerEmails);

/// <summary>Acrobat Sign boundary; production uses OAuth and the account's regional API URL.</summary>
public interface IContractSignGateway
{
    Task<string?> FindByExternalIdAsync(string externalId,
        CancellationToken cancellationToken = default);
    Task<string> CreateAsync(string externalId, string title, byte[] pdf,
        string aviamEmail, string airlineEmail,
        CancellationToken cancellationToken = default);
    Task<SigningAgreementState> GetStateAsync(string agreementId,
        CancellationToken cancellationToken = default);
    Task<Uri?> GetSigningUrlAsync(string agreementId, string email,
        CancellationToken cancellationToken = default);
    Task<byte[]> GetSignedPdfAsync(string agreementId,
        CancellationToken cancellationToken = default);
    Task<byte[]> GetAuditPdfAsync(string agreementId,
        CancellationToken cancellationToken = default);
}
