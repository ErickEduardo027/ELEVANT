using Elevant.Application.Finance;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Finance;

/// <summary>
/// The active billing units of <c>ref.billing_units</c>, loaded once per command or read. The cycle
/// stores unit codes (1-E); a legacy Spanish name («operación») is translated when read and when
/// saved, and stored rows are never rewritten in bulk.
/// </summary>
internal sealed class BillingUnitCodes
{
    private readonly IReadOnlyCollection<BillingUnitName> active;

    private BillingUnitCodes(IReadOnlyCollection<BillingUnitName> active) => this.active = active;

    public static async Task<BillingUnitCodes> LoadAsync(ElevantDbContext context, CancellationToken cancellationToken) =>
        new(await context.BillingUnits.AsNoTracking().Where(unit => unit.IsActive)
            .Select(unit => new BillingUnitName(unit.Code, unit.Name)).ToArrayAsync(cancellationToken));

    /// <summary>The active code <paramref name="text"/> names, or null.</summary>
    public string? Resolve(string? text) => BillingUnitNames.Resolve(text, active);

    /// <summary>For reads: the code <paramref name="text"/> names, else the stored text as it is.</summary>
    public string Normalize(string? text) => Resolve(text) ?? text?.Trim() ?? string.Empty;

    /// <summary>For a new rate or request line: the code it names, else the default active unit.</summary>
    public string CodeOrDefault(string? text) => BillingUnitNames.CodeOrDefault(text, active);
}
