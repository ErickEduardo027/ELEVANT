using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// The rule of <see cref="ContractVersionGovernance"/> as composable queries (2-C): which versions
/// govern prices, services, stations, surcharges and packages. Coverage, expiry, activation,
/// renewal and amendment all read versions through here, so Finance approval alone never changes
/// what is billed. The queries never call <c>AsNoTracking</c>: as a subquery of a tracked query that call
/// would make the whole query untracked, and the sweep would lose the changes it makes. A caller that
/// reads versions from here adds it.
/// </summary>
internal static class GoverningContractVersions
{
    /// <summary>
    /// Superseded versions (for the dates they kept), approved versions signed by both parties over
    /// the same content, and the first approved version of a contract that already left Draft (the
    /// legacy exemption of <see cref="ContractVersionGovernance.Governs"/>).
    /// </summary>
    public static IQueryable<ContractVersion> Of(ElevantDbContext context) =>
        context.ContractVersions.Where(version =>
            version.Status == ContractVersionStatus.Superseded ||
            version.Status == ContractVersionStatus.Approved &&
            (context.ContractSignatures.Any(airline => airline.ContractVersionId == version.Id &&
                 airline.Party == ContractSignatureParty.Airline &&
                 context.ContractSignatures.Any(aviam => aviam.ContractVersionId == version.Id &&
                     aviam.Party == ContractSignatureParty.Aviam && aviam.DocumentSha256 == airline.DocumentSha256)) ||
             context.Contracts.Any(contract => contract.Id == version.ContractId && contract.Status != ContractStatus.Draft) &&
             !context.ContractVersions.Any(earlier => earlier.ContractId == version.ContractId &&
                 earlier.VersionNumber < version.VersionNumber &&
                 (earlier.Status == ContractVersionStatus.Approved || earlier.Status == ContractVersionStatus.Superseded))));

    /// <summary>Approved versions both parties signed over the same content: the only ones that activate a contract.</summary>
    public static IQueryable<ContractVersion> SignedByBoth(ElevantDbContext context) =>
        context.ContractVersions.Where(version =>
            version.Status == ContractVersionStatus.Approved &&
            context.ContractSignatures.Any(airline => airline.ContractVersionId == version.Id &&
                airline.Party == ContractSignatureParty.Airline &&
                context.ContractSignatures.Any(aviam => aviam.ContractVersionId == version.Id &&
                    aviam.Party == ContractSignatureParty.Aviam && aviam.DocumentSha256 == airline.DocumentSha256)));

    /// <summary>
    /// Approved versions that do not govern yet because they wait for both signatures: a renewal or
    /// an amendment cannot start while one exists (version_awaiting_signatures, 2-N01, 2-N03).
    /// </summary>
    public static IQueryable<ContractVersion> AwaitingSignatures(ElevantDbContext context)
    {
        // A queryable captured in a closure is inlined as a subquery; a method call inside the lambda is not.
        var governing = Of(context);
        return context.ContractVersions.Where(version =>
            version.Status == ContractVersionStatus.Approved && !governing.Any(item => item.Id == version.Id));
    }

    /// <summary>The signatures of a version as facts of the pure rule.</summary>
    public static async Task<ContractSignatureFact[]> SignaturesAsync(ElevantDbContext context, long versionId,
        CancellationToken cancellationToken) =>
        await context.ContractSignatures.AsNoTracking().Where(item => item.ContractVersionId == versionId)
            .Select(item => new ContractSignatureFact(item.Party, item.DocumentSha256)).ToArrayAsync(cancellationToken);

    /// <summary>
    /// When each version got its second signature over the same content (2-C, 2-N05): the frontier of
    /// package valuation and the date a version counts as signed. Versions without both signatures are absent.
    /// </summary>
    public static async Task<IReadOnlyDictionary<long, DateTimeOffset>> SecondSignatureAtAsync(ElevantDbContext context,
        IReadOnlyCollection<long> versionIds, CancellationToken cancellationToken)
    {
        if (versionIds.Count == 0) return new Dictionary<long, DateTimeOffset>();
        var rows = await context.ContractSignatures.AsNoTracking().Where(item => versionIds.Contains(item.ContractVersionId))
            .Select(item => new { item.ContractVersionId, item.Party, item.DocumentSha256, item.SignedAt })
            .ToArrayAsync(cancellationToken);
        return rows.GroupBy(item => item.ContractVersionId)
            .Where(group => ContractVersionGovernance.SignedByBoth(group.Select(item =>
                new ContractSignatureFact(item.Party, item.DocumentSha256))))
            .ToDictionary(group => group.Key, group => group.Max(item => item.SignedAt));
    }
}
