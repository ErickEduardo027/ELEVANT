namespace Elevant.Application.Abstractions.Finance;

/// <summary>Finance edit of a draft line: a new billed amount, or the line excluded. A reason is always required.</summary>
public sealed record EditPreinvoiceLineInput(decimal? Amount, bool Exclude, string Reason, string ExpectedVersion);

/// <summary>Manual charge (positive) or discount (negative), optionally attached to a service line.</summary>
public sealed record AddPreinvoiceAdjustmentInput(string Description, decimal Amount, string Reason,
    string ExpectedVersion, Guid? ParentLineId = null);

/// <summary>
/// Lets Finance change what a draft preinvoice bills before sending it to the
/// airline. Computed values are kept; the total is recalculated and audited.
/// </summary>
public interface IPreinvoiceLineEditStore
{
    Task<FinanceCatalogResult> EditLineAsync(Guid actorId, Guid preinvoiceId, Guid lineId, EditPreinvoiceLineInput input,
        CancellationToken cancellationToken = default);

    Task<FinanceCatalogResult> AddAdjustmentAsync(Guid actorId, Guid preinvoiceId, AddPreinvoiceAdjustmentInput input,
        CancellationToken cancellationToken = default);
}
