using Elevant.Domain.Entities.Commercial;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Infrastructure.Persistence.Seed.History;

/// <summary>
/// Chunk <c>fx</c>: one current USD→DOP rate per day of the window, recorded by Finance at 08:30, skipping the dates
/// that already have one (the base seed's 2026-08-18, a rate Finance entered by hand). The rate is a function of the
/// date alone (a drift from 58.60 on 2026-06-01 to 60.40 on 2026-11-21 plus a small daily wobble), so a shorter
/// window gets the same rate for the same day.
/// </summary>
internal static class ExchangeRateHistory
{
    public const string ChunkName = "fx";
    public const string Source = "BCRD · tasa de referencia (sintética, Development)";

    private static readonly DateOnly DriftStart = new(2026, 6, 1);
    private static readonly DateOnly DriftEnd = new(2026, 11, 21);
    private const decimal StartRate = 58.60m;
    private const decimal EndRate = 60.40m;

    public static IEnumerable<HistoryChunk> Chunks(DevelopmentHistoryOptions options)
    {
        ArgumentNullException.ThrowIfNull(options);
        yield return HistoryChunk.Create(ChunkName, RunAsync);
    }

    /// <summary>The synthetic USD→DOP rate of a date (6 decimals, as the column stores it).</summary>
    public static decimal RateOn(DateOnly date)
    {
        var span = DriftEnd.DayNumber - DriftStart.DayNumber;
        var progress = Math.Clamp((decimal)(date.DayNumber - DriftStart.DayNumber) / span, 0m, 1m);
        var wobble = HistoryRandom.For($"fx:{date:yyyy-MM-dd}").Decimal(-0.12m, 0.12m, 4);
        return Math.Round(StartRate + (EndRate - StartRate) * progress + wobble, 4, MidpointRounding.AwayFromZero);
    }

    private static async Task RunAsync(HistoryChunkContext chunk, CancellationToken cancellationToken)
    {
        var options = chunk.Options;
        var existing = (await chunk.Db.ExchangeRates.AsNoTracking()
                .Where(item => item.IsCurrent && item.FromCurrency == "USD" && item.ToCurrency == "DOP" &&
                    item.RateDate >= options.WindowStart && item.RateDate <= options.WindowEnd)
                .Select(item => item.RateDate).ToArrayAsync(cancellationToken))
            .ToHashSet();
        var rows = options.Days().Where(day => !existing.Contains(day))
            .Select(day => HistoryChunkContext.Stamp(new ExchangeRate
            {
                RateDate = day, FromCurrency = "USD", ToCurrency = "DOP", Rate = RateOn(day), Source = Source,
                RecordedByAccountId = chunk.Anchors.Finance.Id, IsCurrent = true,
            }, $"fx:USD:DOP:{day:yyyy-MM-dd}", chunk.Clock.At(day, new TimeOnly(8, 30))))
            .ToArray();
        await chunk.InsertAsync(rows, cancellationToken);
    }
}
