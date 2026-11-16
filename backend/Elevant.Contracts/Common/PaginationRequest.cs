namespace Elevant.Contracts.Common;

/// <summary>Common paging input for list endpoints.</summary>
public sealed record PaginationRequest(int Page = 1, int PageSize = 25)
{
    /// <summary>Maximum page size accepted by future endpoints.</summary>
    public const int MaximumPageSize = 200;
}
