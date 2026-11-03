using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>One contract version that covers an airline at a station on a date.</summary>
/// <remarks>A member-initialized class (not a positional record) so callers can keep composing the query.</remarks>
internal sealed class ApplicableContractRow
{
    public long ContractId { get; init; }
    public Guid ContractPublicId { get; init; }
    public string ContractCode { get; init; } = string.Empty;
    public long AirlineId { get; init; }
    public long VersionId { get; init; }
    public Guid VersionPublicId { get; init; }
    public int VersionNumber { get; init; }
    public DateOnly ValidFrom { get; init; }
    public DateOnly? ValidTo { get; init; }
    public string CurrencyCode { get; init; } = string.Empty;
}

/// <summary>
/// The single rule for «which contract covers this flight» (ADR-0027): an active contract signed
/// on or before the date and not terminated before it, whose version Finance approved for that
/// date at that station. A <c>Superseded</c> version still covers the dates it kept: approval of
/// the next version trims its end, so the two never overlap. Planning, manual flights and agent
/// assignment all use this query.
/// </summary>
internal static class ApplicableContracts
{
    public static IQueryable<ApplicableContractRow> For(ElevantDbContext context, long? airlineId, long stationId,
        DateOnly date) =>
        from contract in context.Contracts.AsNoTracking()
        join version in context.ContractVersions.AsNoTracking() on contract.Id equals version.ContractId
        where (airlineId == null || contract.AirlineId == airlineId) &&
              contract.Status == ContractStatus.Active &&
              (contract.SignedOn == null || contract.SignedOn <= date) &&
              (contract.TerminatedOn == null || contract.TerminatedOn >= date) &&
              (version.Status == ContractVersionStatus.Approved || version.Status == ContractVersionStatus.Superseded) &&
              version.ValidFrom <= date && (version.ValidTo == null || version.ValidTo >= date) &&
              context.Set<ContractVersionStation>().AsNoTracking()
                  .Any(link => link.ContractVersionId == version.Id && link.StationId == stationId)
        select new ApplicableContractRow
        {
            ContractId = contract.Id, ContractPublicId = contract.PublicId, ContractCode = contract.ContractCode,
            AirlineId = contract.AirlineId, VersionId = version.Id, VersionPublicId = version.PublicId,
            VersionNumber = version.VersionNumber, ValidFrom = version.ValidFrom, ValidTo = version.ValidTo,
            CurrencyCode = version.CurrencyCode,
        };
}
