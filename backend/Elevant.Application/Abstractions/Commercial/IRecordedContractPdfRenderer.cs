namespace Elevant.Application.Abstractions.Commercial;

/// <summary>The frozen, server-owned data rendered into one contract version.</summary>
public sealed record ContractPdfSnapshot(
    Guid ContractId, Guid VersionId, Guid RequestId,
    string ContractCode, string RequestCode, int VersionNumber,
    DateTimeOffset GeneratedAtUtc,
    string AviamLegalName, string AirlineLegalName, string AirlineCode,
    string AviamSignerName, string AviamSignerEmail,
    string AirlineSignerName, string AirlineSignerTitle, string AirlineSignerEmail,
    DateOnly ValidFrom, DateOnly? ValidTo, string CurrencyCode, string Terms,
    IReadOnlyList<ContractPdfStation> Stations,
    IReadOnlyList<ContractPdfService> Services,
    IReadOnlyList<ContractPdfPackage> Packages);

public sealed record ContractPdfStation(string Code, string Name);

public sealed record ContractPdfService(Guid ServiceId, string Code, string Name,
    string BillingUnit, decimal UnitPrice, decimal MinimumQuantity);

public sealed record ContractPdfPackage(Guid PackageVersionId, string Code,
    string Name, int VersionNumber, decimal BasePrice, string Scope,
    IReadOnlyList<ContractPdfPackageComponent> Components);

public sealed record ContractPdfPackageComponent(Guid ServiceId, string Code,
    string Name, string BillingUnit, decimal IncludedQuantity,
    decimal ExcessBlockSize, decimal ExcessBlockPrice);

/// <summary>Acceptance recorded by ELEVANT, not a certified provider signature.</summary>
public sealed record ContractAcceptanceEvidence(Guid ActorAccountId,
    string Party, string Name, string Email, DateTimeOffset AcceptedAtUtc,
    string DraftSha256);

public interface IRecordedContractPdfRenderer
{
    string TemplateVersion { get; }
    string TemplateSha256 { get; }
    byte[] RenderDraft(ContractPdfSnapshot snapshot);
    byte[] RenderFinal(byte[] draftPdf, ContractAcceptanceEvidence aviam,
        ContractAcceptanceEvidence airline);
    byte[] RenderEvidence(ContractPdfSnapshot snapshot, string draftSha256,
        ContractAcceptanceEvidence aviam, ContractAcceptanceEvidence airline);
}
