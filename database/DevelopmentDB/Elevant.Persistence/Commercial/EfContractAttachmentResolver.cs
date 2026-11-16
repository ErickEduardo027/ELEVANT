using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Messaging;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Resolves <c>contract-version:{publicId}</c> to the signed contract PDF when the activation
/// email is sent (ADR-0025), so the outbox never stores the file.
/// </summary>
internal sealed class EfContractAttachmentResolver(EfContractDocumentStore documents, IContractPdfRenderer renderer)
    : IEmailAttachmentResolver
{
    public async Task<EmailAttachment?> ResolveAsync(string reference, CancellationToken cancellationToken = default)
    {
        if (!reference.StartsWith(EfContractDocumentStore.AttachmentPrefix, StringComparison.Ordinal) ||
            !Guid.TryParse(reference[EfContractDocumentStore.AttachmentPrefix.Length..], out var versionId)) return null;
        var document = await documents.SystemDocumentAsync(versionId, cancellationToken);
        return document is null ? null
            : new EmailAttachment($"contrato-{document.ContractCode}-v{document.VersionNumber}.pdf", "application/pdf",
                renderer.Render(document));
    }
}
