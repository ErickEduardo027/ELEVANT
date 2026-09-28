using Elevant.Application.Commercial;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Commercial;

internal static class PreinvoiceDisputeReader
{
    public static async Task<IReadOnlyList<PreinvoiceDisputeData>> ReadAsync(
        ElevantDbContext context, long preinvoiceId,
        CancellationToken cancellationToken)
    {
        var rows = await context.PreinvoiceDisputes.AsNoTracking()
            .Where(item => item.PreinvoiceId == preinvoiceId)
            .OrderBy(item => item.CreatedAt).ThenBy(item => item.Id)
            .Select(item => new { item.Id, item.PublicId, item.Subject,
                item.Description, item.CreatedAt })
            .ToArrayAsync(cancellationToken);
        if (rows.Length == 0) return [];

        var ids = rows.Select(item => item.Id).ToArray();
        var selected = await (
            from selection in context.PreinvoiceDisputeLines.AsNoTracking()
            join line in context.PreinvoiceLines.AsNoTracking()
                on selection.PreinvoiceLineId equals line.Id
            where ids.Contains(selection.DisputeId) && line.PreinvoiceId == preinvoiceId
            select new { selection.DisputeId, line.PublicId })
            .ToArrayAsync(cancellationToken);
        var resolutions = await context.PreinvoiceDisputeResolutions.AsNoTracking()
            .Where(item => ids.Contains(item.DisputeId))
            .Select(item => new { item.DisputeId, item.PublicId,
                item.Decision, item.Reason, item.CreatedAt })
            .ToDictionaryAsync(item => item.DisputeId, cancellationToken);
        return rows.Select(item => new PreinvoiceDisputeData(
            item.PublicId, item.Subject, item.Description, item.CreatedAt,
            selected.Where(line => line.DisputeId == item.Id)
                .Select(line => line.PublicId).OrderBy(id => id).ToArray(),
            resolutions.TryGetValue(item.Id, out var resolution)
                ? new PreinvoiceDisputeResolutionData(resolution.PublicId,
                    resolution.Decision, resolution.Reason, resolution.CreatedAt)
                : null)).ToArray();
    }
}
