using System.Globalization;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Commercial;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

/// <summary>
/// Withdrawal of an approved version that both parties have not signed (2-N10), used by the withdrawal
/// command and by a termination, which closes such versions (2-N15). The version becomes
/// <c>Rejected</c> and keeps <c>ApprovedAt</c>; a one-party signature is voided in the audit trail and
/// never deleted; <c>RenewalStartedAt</c> of the version it renewed is not reset.
/// </summary>
internal static class ContractVersionWithdrawal
{
    /// <summary>Days after a trimmed end that are tried to find the end its signatures accepted.</summary>
    private const int RestorationHorizonDays = 3660;

    /// <param name="actor">The account that withdraws, or null for the sweep that ends a scheduled termination.</param>
    public static async Task WithdrawAsync(ElevantDbContext context, ContractVersion version, long? actor, string reason,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        version.Status = ContractVersionStatus.Rejected;
        version.UpdatedAt = now;
        CommercialAuditWriter.Add(context, actor, "commercial.contract.version_withdrawn", "commercial.contract_versions",
            version.PublicId, reason, new AuditFieldChangeData("version.status", nameof(ContractVersionStatus.Approved),
                nameof(ContractVersionStatus.Rejected)));
        foreach (var signature in await context.ContractSignatures.AsNoTracking()
                     .Where(item => item.ContractVersionId == version.Id).Select(item => item.PublicId)
                     .ToArrayAsync(cancellationToken))
            CommercialAuditWriter.Add(context, actor, "commercial.contract.signature_voided", "commercial.contract_signatures",
                signature, reason);
        await RestoreLegacyEndsAsync(context, version, actor, now, cancellationToken);
    }

    /// <summary>
    /// Before 2-C, Finance approval ended the version a renewal or amendment replaced the day before its
    /// start. When that replacement is withdrawn unsigned, the replaced version gets back the end its two
    /// signatures accepted: the one date that reproduces their content hash. A version without both
    /// signatures has nothing to prove its end and keeps it.
    /// </summary>
    private static async Task RestoreLegacyEndsAsync(ElevantDbContext context, ContractVersion withdrawn, long? actor,
        DateTimeOffset now, CancellationToken cancellationToken)
    {
        var dayBefore = withdrawn.ValidFrom.AddDays(-1);
        var trimmed = await context.ContractVersions.Where(item => item.ContractId == withdrawn.ContractId &&
                item.Id != withdrawn.Id && item.Status == ContractVersionStatus.Superseded && item.ValidTo == dayBefore)
            .ToArrayAsync(cancellationToken);
        foreach (var candidate in trimmed)
        {
            // Another approved version starting that day is the real replacement: the end stays.
            if (await context.ContractVersions.AnyAsync(other => other.ContractId == withdrawn.ContractId &&
                    other.Id != withdrawn.Id && other.Id != candidate.Id && other.ValidFrom == withdrawn.ValidFrom &&
                    (other.Status == ContractVersionStatus.Approved || other.Status == ContractVersionStatus.Superseded),
                    cancellationToken))
                continue;
            if (await SignedEndAsync(context, candidate, cancellationToken) is not { } signed) continue;
            CommercialAuditWriter.Add(context, actor, "commercial.contract.version_end_restored", "commercial.contract_versions",
                candidate.PublicId, null,
                new AuditFieldChangeData("version.valid_to", Text(candidate.ValidTo), Text(signed.End)),
                new AuditFieldChangeData("version.status", nameof(ContractVersionStatus.Superseded),
                    nameof(ContractVersionStatus.Approved)));
            candidate.Status = ContractVersionStatus.Approved;
            candidate.ValidTo = signed.End;
            candidate.UpdatedAt = now;
        }
    }

    private readonly record struct SignedEnd(DateOnly? End);

    private static async Task<SignedEnd?> SignedEndAsync(ElevantDbContext context, ContractVersion version,
        CancellationToken cancellationToken)
    {
        var signatures = await GoverningContractVersions.SignaturesAsync(context, version.Id, cancellationToken);
        if (!ContractVersionGovernance.SignedByBoth(signatures) || version.ValidTo is not { } trimmedEnd) return null;
        var hashes = signatures.Select(item => item.DocumentSha256.ToLowerInvariant()).ToHashSet(StringComparer.Ordinal);
        var document = await ContractDocuments.LoadAsync(context, version.Id, cancellationToken);
        if (hashes.Contains((document with { ValidTo = null }).ContentSha256)) return new SignedEnd(null);
        for (var day = trimmedEnd.AddDays(1); day <= trimmedEnd.AddDays(RestorationHorizonDays); day = day.AddDays(1))
            if (hashes.Contains((document with { ValidTo = day }).ContentSha256)) return new SignedEnd(day);
        return null;
    }

    private static string? Text(DateOnly? day) => day?.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
}
