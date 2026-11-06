using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>One party's acceptance of a version and the content hash it accepted.</summary>
public readonly record struct ContractSignatureFact(ContractSignatureParty Party, string DocumentSha256);

/// <summary>
/// Which contract version governs prices, services, stations, surcharges and packages (2-C): an
/// approved version signed by both parties over the same content, from its <c>ValidFrom</c>. A
/// superseded version keeps governing the dates it kept. Finance approval alone never changes what is
/// billed: the previous version is replaced at the second signature, not at the approval. The first
/// approved version of a contract that already left Draft keeps governing as a legacy exemption: such
/// a contract activated with it before signatures existed (ADR-0024), or before both signatures had to
/// be over the same content (2-N28), and a later one-party signature does not take its coverage away.
/// </summary>
public static class ContractVersionGovernance
{
    /// <summary>Both parties accepted exactly the same content hash.</summary>
    public static bool SignedByBoth(IEnumerable<ContractSignatureFact> signatures)
    {
        ArgumentNullException.ThrowIfNull(signatures);
        var facts = signatures.ToArray();
        return facts.Any(airline => airline.Party == ContractSignatureParty.Airline &&
            facts.Any(aviam => aviam.Party == ContractSignatureParty.Aviam &&
                string.Equals(aviam.DocumentSha256, airline.DocumentSha256, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>
    /// Whether a version governs the dates it covers. <paramref name="firstApproved"/> is true when no
    /// earlier version of the contract was approved (Approved or Superseded). A new contract activates
    /// only with a version both parties signed, so the exemption never covers one that is still a draft.
    /// </summary>
    public static bool Governs(ContractVersionStatus status, bool signedByBoth, bool firstApproved,
        ContractStatus contractStatus) =>
        status == ContractVersionStatus.Superseded ||
        status == ContractVersionStatus.Approved &&
        (signedByBoth || firstApproved && contractStatus != ContractStatus.Draft);

    /// <summary>
    /// End a replaced version keeps when the next one gets its second signature: never longer than it
    /// was, and the day before the new start so the two never overlap.
    /// </summary>
    public static DateOnly SupersededEnd(DateOnly? currentEnd, DateOnly nextStart)
    {
        var dayBefore = nextStart.AddDays(-1);
        return currentEnd is { } end && end < dayBefore ? end : dayBefore;
    }
}
