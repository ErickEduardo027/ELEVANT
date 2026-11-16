namespace Elevant.Application.Operations;

/// <summary>
/// The one rule of the permits a stand requires (ADR-0045), shared by the coverage and the assignment policies: a
/// required permit counts as held only with a current cycle of its code (the store decides «current» for the work
/// date or window, as it does for the airport permit).
/// </summary>
public static class RequiredPermitRules
{
    public static IReadOnlyList<RequiredPermitFact> Missing(IEnumerable<RequiredPermitFact> required,
        IReadOnlyCollection<string>? currentCodes)
    {
        ArgumentNullException.ThrowIfNull(required);
        var held = currentCodes ?? [];
        return required.DistinctBy(permit => permit.Code, StringComparer.Ordinal)
            .Where(permit => !held.Contains(permit.Code, StringComparer.Ordinal)).ToArray();
    }
}
