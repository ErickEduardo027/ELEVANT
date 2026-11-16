namespace Elevant.Contracts.Common;

/// <summary>A page of public API results.</summary>
public sealed record PagedResponse<T>(
    IReadOnlyCollection<T> Items,
    int Page,
    int PageSize,
    long TotalCount)
{
    /// <summary>Gets the number of pages for the supplied total.</summary>
    public long TotalPages => PageSize <= 0 ? 0 : (long)Math.Ceiling(TotalCount / (double)PageSize);
}
