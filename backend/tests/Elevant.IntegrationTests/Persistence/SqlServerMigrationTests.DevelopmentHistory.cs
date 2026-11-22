using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Commercial;
using Elevant.Application.Documents;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed.History;
using Elevant.Persistence.Commercial;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly string[] HistorySchemas = ["iam", "ref", "hr", "commercial", "ops"];

    /// <summary>Runs the history as the Development seeder login (SELECT + INSERT only), on a fresh context.</summary>
    private static async Task<IReadOnlyList<string>> SeedHistoryAsSeederAsync(TemporaryDatabase database,
        DevelopmentHistoryOptions options, CancellationToken cancellationToken)
    {
        await using var connection = await database.OpenAsDevelopmentSeederAsync(cancellationToken);
        await using var context = CreateContext(connection);
        context.ChangeTracker.AutoDetectChangesEnabled = false;
        return await new DevelopmentHistorySeeder(context).SeedAsync(options, cancellationToken);
    }

    /// <summary>Exact row count of every table in the schemas the seeder writes.</summary>
    private static async Task<Dictionary<string, long>> HistoryTableCountsAsync(string connectionString,
        CancellationToken cancellationToken)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(cancellationToken);
        var tables = new List<string>();
        await using (var list = connection.CreateCommand())
        {
            list.CommandText = """
                SELECT QUOTENAME(s.name) + N'.' + QUOTENAME(t.name)
                FROM sys.tables AS t INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
                WHERE s.name IN (N'iam', N'ref', N'hr', N'commercial', N'ops')
                ORDER BY 1;
                """;
            await using var reader = await list.ExecuteReaderAsync(cancellationToken);
            while (await reader.ReadAsync(cancellationToken)) tables.Add(reader.GetString(0));
        }
        Assert.NotEmpty(tables);
        var counts = new Dictionary<string, long>(StringComparer.Ordinal);
        await using var count = connection.CreateCommand();
        count.CommandText = string.Join(" UNION ALL ",
            tables.Select(table => $"SELECT N'{table.Replace("'", "''", StringComparison.Ordinal)}', COUNT_BIG(*) FROM {table}"));
        await using (var reader = await count.ExecuteReaderAsync(cancellationToken))
            while (await reader.ReadAsync(cancellationToken)) counts[reader.GetString(0)] = reader.GetInt64(1);
        Assert.All(HistorySchemas, schema => Assert.Contains(counts.Keys, key => key.StartsWith($"[{schema}]", StringComparison.Ordinal)));
        return counts;
    }

    [Fact]
    public async Task DevelopmentHistoryResumesAfterAnInterruptedChunkAndASecondRunWritesNothing()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var baseCounts = await HistoryTableCountsAsync(database.ConnectionString, ct);
        var options = DevelopmentHistoryOptions.Small;
        var registered = HistoryChunkRegistry.Build(options).Select(chunk => chunk.Name).ToArray();
        Assert.Equal(["commercial", WorkforceHistory.ChunkName, WorkforceHistory.CoverageChunkName, "fx"], registered.Take(4));

        // Interrupted right after the first chunk committed: a consistent prefix with its sentinel, nothing more.
        var interrupted = await Assert.ThrowsAsync<DevelopmentHistoryInterruptedException>(() =>
            SeedHistoryAsSeederAsync(database, options with { FailAfterChunk = "commercial" }, ct));
        Assert.Equal("commercial", interrupted.Chunk);
        await using (var check = CreateContext(database.ConnectionString))
        {
            Assert.True(await HistoryChunkRunner.IsCompleteAsync(check, "commercial", ct));
            Assert.False(await HistoryChunkRunner.IsCompleteAsync(check, "fx", ct));
            Assert.Equal(options.AirlineCount, await check.Organizations.CountAsync(item =>
                item.Code.StartsWith(HistoryCatalog.HistoryOrganizationPrefix), ct));
        }
        var afterInterruption = await HistoryTableCountsAsync(database.ConnectionString, ct);

        // The next run resumes with the missing chunks only and does not duplicate the committed one.
        Assert.Equal(registered.Skip(1), await SeedHistoryAsSeederAsync(database, options, ct));
        var complete = await HistoryTableCountsAsync(database.ConnectionString, ct);
        Assert.All(afterInterruption, pair => Assert.True(complete[pair.Key] >= pair.Value, pair.Key));
        Assert.Equal(afterInterruption["[iam].[organizations]"], complete["[iam].[organizations]"]);
        Assert.Equal(afterInterruption["[commercial].[contracts]"], complete["[commercial].[contracts]"]);
        Assert.Equal(baseCounts["[commercial].[exchange_rates]"] + options.Days().Count(day => day != new DateOnly(2026, 8, 18)),
            complete["[commercial].[exchange_rates]"]);

        // Fast path: the final sentinel exists, so a second complete run writes nothing at all.
        Assert.Empty(await SeedHistoryAsSeederAsync(database, options, ct));
        Assert.Equal(complete, await HistoryTableCountsAsync(database.ConnectionString, ct));

        // Insert-only: every base row is still there, and only the expected tables grew.
        Assert.All(baseCounts, pair => Assert.True(complete[pair.Key] >= pair.Value, pair.Key));
        Assert.Equal(baseCounts["[ops].[turnarounds]"], complete["[ops].[turnarounds]"]);
        Assert.Equal(baseCounts["[hr].[ramp_agents]"] + options.AgentCount, complete["[hr].[ramp_agents]"]);
        await using var verify = CreateContext(database.ConnectionString);
        Assert.Equal(new DateTimeOffset(2026, 8, 17, 12, 0, 0, TimeSpan.Zero), await verify.Contracts.AsNoTracking()
            .Where(item => item.ContractCode == "DEV-CONTRACT-0001").Select(item => item.UpdatedAt).SingleAsync(ct));
    }

    [Fact]
    public async Task DevelopmentHistoryContractsGovernOncePerDateCarryTheSignedHashAndFeedTheContractsReports()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        var options = DevelopmentHistoryOptions.Small;
        Assert.NotEmpty(await SeedHistoryAsSeederAsync(database, options, ct));

        await using var db = CreateContext(database.ConnectionString);
        var anchors = await HistoryAnchors.LoadAsync(db, ct);
        var catalog = await HistoryCatalog.LoadAsync(db, anchors, ct);
        var clock = new HistoryClock(anchors.Station.IanaTimeZone);
        var airlines = catalog.HistoryAirlines.ToArray();
        Assert.Equal(options.AirlineCount, airlines.Length);
        Assert.NotNull(catalog.Demo);
        Assert.All(airlines, airline => Assert.Single(airline.Contracts));
        var codes = airlines.Select(airline => airline.Contracts[0].Code).ToArray();
        Assert.All(codes, code => Assert.StartsWith("CTR-2026-", code, StringComparison.Ordinal));
        Assert.Equal(codes.Length, codes.Distinct(StringComparer.Ordinal).Count());

        // The catalog's notion of «governs» is exactly the API's (GoverningContractVersions, 2-C).
        var versionIds = airlines.SelectMany(airline => airline.Contracts).SelectMany(contract => contract.Versions)
            .Select(version => version.Id).ToArray();
        var governing = await GoverningContractVersions.Of(db).AsNoTracking()
            .Where(version => versionIds.Contains(version.Id)).Select(version => version.Id).ToArrayAsync(ct);
        Assert.Equal(versionIds.Order(), governing.Order());

        // Exactly one governing version per airline, PUJ and date; none after the termination; Demo Airlines covered.
        var terminated = Assert.Single(airlines, airline => airline.Contracts[0].Status == ContractStatus.Terminated);
        Assert.Equal(CommercialHistory.TerminationDate, terminated.Contracts[0].TerminatedOn);
        Assert.Equal(2, airlines.Count(airline => airline.Contracts[0].Versions.Count == 2));
        foreach (var day in DevelopmentHistoryOptions.Default.Days())
        {
            foreach (var airline in airlines)
            {
                var matches = airline.Contracts.Where(contract => contract.Covers(day))
                    .SelectMany(contract => contract.Versions)
                    .Count(version => version.Governs && version.CoversPuj && version.ValidFrom <= day &&
                        (version.ValidTo is null || version.ValidTo >= day));
                var expected = airline.Id == terminated.Id && day >= CommercialHistory.TerminationDate ? 0 : 1;
                Assert.True(expected == matches, $"{airline.IataCode} on {day:yyyy-MM-dd}: {matches} governing versions.");
                if (expected == 1)
                    Assert.Equal(day >= CommercialHistory.AmendmentStart && airline.Contracts[0].Versions.Count == 2 ? 2 : 1,
                        catalog.GoverningVersion(airline.Id, day)!.Number);
            }
            Assert.NotNull(catalog.GoverningVersion(catalog.Demo!.Id, day));
        }

        // Both parties signed the real document hash: today's content for the version in force, the content before
        // its end moved for a superseded v1.
        foreach (var version in airlines.SelectMany(airline => airline.Contracts).SelectMany(contract => contract.Versions))
        {
            var signatures = await db.ContractSignatures.AsNoTracking().Where(item => item.ContractVersionId == version.Id)
                .ToArrayAsync(ct);
            Assert.Equal(2, signatures.Length);
            Assert.Single(signatures.Select(item => item.DocumentSha256).Distinct());
            Assert.All(signatures, signature => Assert.True(clock.IsOperatingTime(signature.SignedAt)));
            var document = await ContractDocuments.LoadAsync(db, version.Id, ct);
            Assert.NotNull(document.Validity);
            Assert.NotNull(document.Pricing);
            Assert.NotNull(document.SignedOn);
            var signed = version.Status == ContractVersionStatus.Superseded
                ? (document with { ValidTo = CommercialHistory.ContractEnd }).ContentSha256 : document.ContentSha256;
            Assert.Equal(signed, signatures[0].DocumentSha256);
        }

        // The signers can neither sign in nor receive mail; nobody gets a billing email.
        var signerIds = airlines.Select(airline => airline.SignerAccountId!.Value).ToArray();
        Assert.All(await db.Users.AsNoTracking().Where(user => signerIds.Contains(user.Id)).ToArrayAsync(ct), user =>
        {
            Assert.Equal(AccountLifecycleStatus.Disabled, user.Status);
            Assert.Null(user.PasswordHash);
            Assert.EndsWith("@dev.elevant.test", user.Email, StringComparison.Ordinal);
        });
        var airlineIds = airlines.Select(airline => airline.Id).ToArray();
        Assert.Equal(airlineIds.Length, await db.AirlineBillingProfiles.CountAsync(item =>
            airlineIds.Contains(item.AirlineId) && item.BillingEmail == null, ct));
        Assert.All(airlines, airline => Assert.Contains(airline.PaymentTermDays, new[] { 15, 30, 45 }));
        Assert.All(options.Days(), day => Assert.True(catalog.UsdToDop.ContainsKey(day)));
        Assert.All(await db.Set<ServiceRequestStatusEvent>().AsNoTracking().Select(item => item.OccurredAt).ToArrayAsync(ct),
            at => Assert.True(clock.IsOperatingTime(at), $"{at:O}"));

        // The Contratos reports are populated by the history.
        await using var scope = provider.CreateAsyncScope();
        var store = scope.ServiceProvider.GetRequiredService<IContractsReportStore>();
        var reports = ContractsReportCatalog.All;
        async Task<ReportDocument> ReadAsync(string key, string? from = null, string? to = null)
        {
            var definition = reports.Find(key)!;
            var result = await store.ReadAsync(ContractsAccount, definition, NewReportsQuery(definition, from, to), ct);
            Assert.Null(result.Failure);
            return result.Document!;
        }
        var agreements = await ReadAsync("agreements", to: "2026-11-21");
        Assert.All(codes, code => Assert.Contains(agreements.Rows, row => row[1].Text == code));
        var rates = await ReadAsync("rates");
        Assert.All(codes, code => Assert.Contains(rates.Rows, row => row[0].Text == code));
        var permits = await ReadAsync("permits", to: "2026-11-21");
        Assert.Contains(permits.Rows, row => row[6].Text == "Vencido");
        Assert.Contains(permits.Rows, row => row[6].Text == "Vence en 30 días");
        Assert.Contains(permits.Rows, row => row[7].Text == "Rechazado");
        Assert.Contains(permits.Rows, row => row[7].Text == "Pendiente de revisión");
        var requests = await ReadAsync("requests", "2026-04-01", "2026-11-21");
        Assert.True(requests.Rows.Count >= options.AirlineCount + 12, $"{requests.Rows.Count} requests.");
        foreach (var label in new[] { "Aprobada", "Rechazada", "Cancelada", "Recibida", "En revisión" })
            Assert.Contains(requests.Rows, row => row[4].Text == label);
    }
}
