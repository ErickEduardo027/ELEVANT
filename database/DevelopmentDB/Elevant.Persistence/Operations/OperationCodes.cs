using Elevant.Application.Operations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Issues the readable operation code of a new turnaround (3-N27, <see cref="OperationCodeFormat"/>) inside the
/// caller's serializable transaction. The issued codes of the station and day are read with UPDLOCK and HOLDLOCK over
/// their prefix of the unique index, so two entries of the same day wait for each other instead of taking the same
/// number; a residual collision still fails on the unique index (2601) and the command answers a conflict.
/// </summary>
internal static class OperationCodes
{
    public static async Task<string> NextAsync(ElevantDbContext context, string stationCode, DateOnly localDate,
        CancellationToken cancellationToken)
    {
        var prefix = OperationCodeFormat.Prefix(stationCode, localDate);
        // Station codes are letters and the date digits: the prefix carries no LIKE wildcard.
        var pattern = $"{prefix}%";
        var issued = await context.Turnarounds.FromSqlInterpolated($"""
                SELECT * FROM [ops].[turnarounds] WITH (UPDLOCK, HOLDLOCK)
                WHERE [operation_code] LIKE {pattern}
                """)
            .AsNoTracking()
            .Select(turnaround => turnaround.OperationCode)
            .ToArrayAsync(cancellationToken);
        return OperationCodeFormat.Next(stationCode, localDate, issued);
    }
}
