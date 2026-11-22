using System.Diagnostics;
using System.Globalization;
using System.Text;
using Elevant.Application.Abstractions.Commercial;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Commercial;
using Elevant.Application.Documents;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Entities.Reference;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed.History;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// Local measurement at the VPS's scale (not in CI): the whole <see cref="DevelopmentHistoryOptions.Default"/> history
/// over a Development database shaped like the VPS one (Punta Cana's stands loaded by «Cargar posiciones», an airline
/// with an active contract, a <c>CTR-2026</c> code and an issued E31 that predate the history), as the seeder login.
/// Set <c>ELEVANT_TEST_HISTORY_FULL=1</c> to run it; timings, volumes and report rows go to the test output.
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private const string PreexistingContractCode = "CTR-2026-0007";
    private const string PreexistingIata = "AA";

    /// <summary>Writes each line of the seeder's log with the time since the previous one.</summary>
    private sealed class ChunkTimingWriter : TextWriter
    {
        private readonly Stopwatch _watch = Stopwatch.StartNew();
        private TimeSpan _last;

        public List<(string Line, TimeSpan Elapsed)> Lines { get; } = [];

        public override Encoding Encoding => Encoding.UTF8;

        public override void WriteLine(string? value)
        {
            var now = _watch.Elapsed;
            Lines.Add((value ?? string.Empty, now - _last));
            _last = now;
        }
    }

    /// <summary>A real airline Contratos had already contracted on the VPS before the history (as dbo).</summary>
    private static async Task<long> InsertPreexistingContractedAirlineAsync(ElevantDbContext db, CancellationToken ct)
    {
        var at = new DateTimeOffset(2026, 5, 4, 15, 0, 0, TimeSpan.Zero);
        var station = await db.Stations.AsNoTracking().Where(item => item.Code == "PUJ").Select(item => item.Id).SingleAsync(ct);
        var contracts = await db.Users.AsNoTracking().Where(item => item.PublicId == HistoryAnchors.ContractsAccountId)
            .Select(item => item.Id).SingleAsync(ct);
        var organization = new Organization
        {
            PublicId = Guid.Parse("0f000000-0000-7000-8000-0000000aa001"), Code = "AIR-AAL",
            LegalName = "American Airlines, Inc.", DisplayName = "American Airlines", Type = OrganizationType.AirlineCustomer,
            Status = OrganizationStatus.Active, CreatedAt = at, UpdatedAt = at,
        };
        db.Add(organization);
        await db.SaveChangesAsync(ct);
        var airline = new Airline
        {
            PublicId = Guid.Parse("0f000000-0000-7000-8000-0000000aa002"), OrganizationId = organization.Id,
            IataCode = PreexistingIata, IcaoCode = "AAL", Name = "American Airlines", IsActive = true, CreatedAt = at,
            UpdatedAt = at,
        };
        db.Add(airline);
        await db.SaveChangesAsync(ct);
        var contract = new Contract
        {
            PublicId = Guid.Parse("0f000000-0000-7000-8000-0000000aa003"), AirlineId = airline.Id,
            ContractCode = PreexistingContractCode, Status = ContractStatus.Active, SignedOn = new DateOnly(2026, 5, 4),
            CreatedAt = at, UpdatedAt = at,
        };
        db.Add(contract);
        await db.SaveChangesAsync(ct);
        var version = new ContractVersion
        {
            PublicId = Guid.Parse("0f000000-0000-7000-8000-0000000aa004"), ContractId = contract.Id, VersionNumber = 1,
            Status = ContractVersionStatus.Approved, ValidFrom = new DateOnly(2026, 5, 4), ValidTo = new DateOnly(2027, 5, 3),
            CurrencyCode = "USD", Terms = "Contrato vigente antes del historial.", ApprovedAt = at,
            ApprovedByAccountId = contracts, CreatedAt = at, UpdatedAt = at,
        };
        db.Add(version);
        await db.SaveChangesAsync(ct);
        db.Add(new ContractVersionStation { ContractVersionId = version.Id, StationId = station });
        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
        return airline.Id;
    }

    /// <summary>Highest <c>id</c> of every table with one, in the schemas the seeder writes.</summary>
    private static async Task<Dictionary<string, long>> HistoryMaxIdsAsync(string connectionString, CancellationToken ct)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        var tables = new List<string>();
        await using (var list = connection.CreateCommand())
        {
            list.CommandText = """
                SELECT QUOTENAME(s.name) + N'.' + QUOTENAME(t.name)
                FROM sys.tables AS t INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
                WHERE s.name IN (N'iam', N'ref', N'hr', N'commercial', N'ops')
                  AND EXISTS (SELECT 1 FROM sys.columns AS c WHERE c.object_id = t.object_id AND c.name = N'id'
                      AND c.system_type_id = TYPE_ID(N'bigint'))
                ORDER BY 1;
                """;
            await using var reader = await list.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) tables.Add(reader.GetString(0));
        }
        await using var max = connection.CreateCommand();
        max.CommandText = string.Join(" UNION ALL ", tables.Select(table =>
            $"SELECT N'{table.Replace("'", "''", StringComparison.Ordinal)}', ISNULL(MAX([id]), 0) FROM {table}"));
        var ids = new Dictionary<string, long>(StringComparer.Ordinal);
        await using (var reader = await max.ExecuteReaderAsync(ct))
            while (await reader.ReadAsync(ct)) ids[reader.GetString(0)] = reader.GetInt64(1);
        return ids;
    }

    /// <summary>
    /// Every <c>datetimeoffset</c> of a row the history inserted (id above the baseline) whose local time at PUJ
    /// (UTC−4 all year) falls outside 05:30–22:30, by table and column.
    /// </summary>
    private static async Task<List<string>> InstantsOutsideTheOperatingDayAsync(string connectionString,
        Dictionary<string, long> baseline, CancellationToken ct)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        var columns = new List<(string Table, string Column)>();
        await using (var list = connection.CreateCommand())
        {
            list.CommandText = """
                SELECT QUOTENAME(s.name) + N'.' + QUOTENAME(t.name), c.name
                FROM sys.columns AS c
                INNER JOIN sys.tables AS t ON t.object_id = c.object_id
                INNER JOIN sys.schemas AS s ON s.schema_id = t.schema_id
                WHERE s.name IN (N'iam', N'ref', N'hr', N'commercial', N'ops') AND c.system_type_id = TYPE_ID(N'datetimeoffset')
                ORDER BY 1, 2;
                """;
            await using var reader = await list.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) columns.Add((reader.GetString(0), reader.GetString(1)));
        }
        var outside = new List<string>();
        foreach (var (table, column) in columns.Where(item => baseline.ContainsKey(item.Table)))
        {
            await using var command = connection.CreateCommand();
            command.CommandTimeout = 300;
            var local = $"CAST(SWITCHOFFSET([{column}], '-04:00') AS time)";
            command.CommandText = $"""
                SELECT COUNT_BIG(*), MIN(CONVERT(nvarchar(40), [{column}], 127))
                FROM {table} WHERE [id] > @baseline AND [{column}] IS NOT NULL
                  AND ({local} < '05:30' OR {local} > '22:30');
                """;
            command.Parameters.AddWithValue("@baseline", baseline[table]);
            await using var reader = await command.ExecuteReaderAsync(ct);
            await reader.ReadAsync(ct);
            var count = reader.GetInt64(0);
            if (count > 0) outside.Add($"{table}.{column}: {count} (first {reader.GetString(1)})");
        }
        return outside;
    }

    /// <summary>
    /// The seed-anchor block of <c>verify-development.sql</c> (from its <c>@seed_checks</c> table to THROW 52009), run
    /// as it is: it throws when an anchor of the base seed is missing, duplicated or changed.
    /// </summary>
    private static async Task VerifyDevelopmentSeedAnchorsAsync(string connectionString, CancellationToken ct)
    {
        var directory = new DirectoryInfo(AppContext.BaseDirectory);
        const string relative = "database/DevelopmentDB/scripts/diagnostics/verify-development.sql";
        while (directory is not null && !File.Exists(Path.Combine(directory.FullName, relative))) directory = directory.Parent;
        Assert.NotNull(directory);
        var script = await File.ReadAllTextAsync(Path.Combine(directory.FullName, relative), ct);
        var start = script.IndexOf("DECLARE @seed_checks table", StringComparison.Ordinal);
        var throwAt = script.IndexOf("THROW 52009", start, StringComparison.Ordinal);
        Assert.True(start >= 0 && throwAt > start, "verify-development.sql changed its seed-anchor block.");
        var end = script.IndexOf("END;", throwAt, StringComparison.Ordinal) + "END;".Length;
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        await using var command = connection.CreateCommand();
        command.CommandText = "SET NOCOUNT ON;\n" + script[start..end];
        await using var reader = await command.ExecuteReaderAsync(ct);
        var failed = new List<string>();
        do
            while (await reader.ReadAsync(ct)) failed.Add($"{reader.GetString(0)}: {reader.GetInt64(1)} ≠ {reader.GetInt64(2)}");
        while (await reader.NextResultAsync(ct));
        Assert.Empty(failed);
    }

    [Fact]
    public async Task DevelopmentHistoryFullScaleMatchesTheVps()
    {
        if (Environment.GetEnvironmentVariable("ELEVANT_TEST_HISTORY_FULL") != "1") return;
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        var output = TestContext.Current.TestOutputHelper;
        void Log(string line) => output?.WriteLine(line);
        var options = DevelopmentHistoryOptions.Default;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        // «Today» of the reports is the day after the window: 2026-11-22, 09:00 at PUJ.
        var today = new WorkforceHistoryClock(new DateTimeOffset(2026, 11, 22, 13, 0, 0, TimeSpan.Zero));
        await using var provider = await SeededFinanceProviderAsync(database, ct, today);

        // The VPS: Superadmin's «Cargar posiciones» loaded Punta Cana's stands.
        await using (var scope = provider.CreateAsyncScope())
        {
            var prepared = await scope.ServiceProvider.GetRequiredService<IDemoStationStore>()
                .PrepareAsync(SuperAdministratorAccount, SeededPujStation, Guid.NewGuid(), ct);
            Assert.Null(prepared.Failure);
            Assert.True(prepared.Value!.Complete);
        }
        long preexistingAirline;
        string prior;
        await using (var dbo = CreateContext(database.ConnectionString))
        {
            var standCount = await dbo.Stands.CountAsync(item => item.IsActive && dbo.Stations.Any(station =>
                station.Id == item.StationId && station.Code == "PUJ"), ct);
            Log($"PUJ active stands after «Cargar posiciones»: {standCount}");
            Assert.True(standCount >= 40, $"{standCount} stands.");
            preexistingAirline = await InsertPreexistingContractedAirlineAsync(dbo, ct);
            prior = await InsertPriorFiscalInvoiceAsync(dbo, ct);
        }
        var baseCounts = await HistoryTableCountsAsync(database.ConnectionString, ct);
        var baseline = await HistoryMaxIdsAsync(database.ConnectionString, ct);
        DateTimeOffset baseContractUpdatedAt;
        await using (var check = CreateContext(database.ConnectionString))
            baseContractUpdatedAt = await check.Contracts.AsNoTracking().Where(item => item.ContractCode == "DEV-CONTRACT-0001")
                .Select(item => item.UpdatedAt).SingleAsync(ct);

        // The whole history, as the seeder login, timed chunk by chunk.
        var timing = new ChunkTimingWriter();
        var allocated = GC.GetTotalAllocatedBytes(true);
        var watch = Stopwatch.StartNew();
        IReadOnlyList<string> ran;
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var context = CreateContext(connection))
        {
            context.Database.SetCommandTimeout(TimeSpan.FromMinutes(10));
            ran = await new DevelopmentHistorySeeder(context, timing).SeedAsync(options, ct);
        }
        watch.Stop();
        using (var process = Process.GetCurrentProcess())
            Log($"TOTAL {watch.Elapsed.TotalSeconds:0.0} s; allocated {(GC.GetTotalAllocatedBytes(true) - allocated) / 1048576.0:0} MiB; " +
                $"peak working set {process.PeakWorkingSet64 / 1048576.0:0} MiB");
        foreach (var (line, elapsed) in timing.Lines) Log($"  {elapsed.TotalSeconds,7:0.0} s  {line}");
        Assert.Equal(HistoryChunkRegistry.Build(options).Select(chunk => chunk.Name), ran);

        var complete = await HistoryTableCountsAsync(database.ConnectionString, ct);
        Log("Rows added per table:");
        foreach (var pair in complete.Where(pair => pair.Value != baseCounts[pair.Key]).OrderByDescending(pair => pair.Value - baseCounts[pair.Key]))
            Log($"  {pair.Key,-48} +{pair.Value - baseCounts[pair.Key]}");
        Assert.All(baseCounts, pair => Assert.True(complete[pair.Key] >= pair.Value, pair.Key));

        await using var db = CreateContext(database.ConnectionString);
        db.Database.SetCommandTimeout(TimeSpan.FromMinutes(5));
        var anchors = await HistoryAnchors.LoadAsync(db, ct);
        var catalog = await HistoryCatalog.LoadAsync(db, anchors, ct);
        var clock = new HistoryClock(anchors.Station.IanaTimeZone);

        // The pre-existing airline is skipped and the contract numbering continues after its code.
        Assert.Equal(options.AirlineCount, catalog.HistoryAirlines.Count());
        Assert.DoesNotContain(catalog.HistoryAirlines, airline => airline.IataCode == PreexistingIata);
        var codes = catalog.HistoryAirlines.SelectMany(airline => airline.Contracts).Select(contract => contract.Code)
            .Order(StringComparer.Ordinal).ToArray();
        Assert.Equal(Enumerable.Range(8, options.AirlineCount).Select(number => ContractValidity.FinalCode(2026, number)), codes);
        Assert.False(await db.Turnarounds.AnyAsync(item => item.AirlineId == preexistingAirline, ct));
        Assert.False(await db.NonFiscalInvoices.AnyAsync(item => item.AirlineId == preexistingAirline, ct));

        // E31: contiguous after the pre-existing invoice, in issue order within each pass: the invoices of the extra
        // operations (finance-extra, issued by a later chunk) are numbered after every regular one.
        var extraKeys = options.Days().SelectMany(day => Enumerable.Range(OperationsSchedule.ExtraSlotBase, 10).Select(slot =>
            HistoryKeys.Key(string.Create(CultureInfo.InvariantCulture, $"ops:{day:yyyy-MM-dd}:{slot:00}:turnaround"))))
            .ToArray();
        var extraCodes = new HashSet<string>(StringComparer.Ordinal);
        foreach (var page in extraKeys.Chunk(1000))
            extraCodes.UnionWith(await db.Turnarounds.AsNoTracking().Where(item => page.Contains(item.PublicId))
                .Select(item => item.OperationCode).ToArrayAsync(ct));
        Assert.NotEmpty(extraCodes);
        var invoiceRows = await db.NonFiscalInvoices.AsNoTracking()
            .Where(item => item.Id > baseline["[commercial].[non_fiscal_invoices]"])
            .Select(item => new { item.Id, item.FiscalNumber, item.CreatedAt, item.DueDate, item.Total }).ToArrayAsync(ct);
        var invoiceIds = invoiceRows.Select(item => item.Id).ToArray();
        var codesByInvoice = (await db.NonFiscalInvoiceLines.AsNoTracking().Where(line => invoiceIds.Contains(line.InvoiceId))
                .Select(line => new { line.InvoiceId, line.OperationCode }).ToArrayAsync(ct))
            .ToLookup(line => line.InvoiceId, line => line.OperationCode);
        var e31 = invoiceRows.Select(item => new
        {
            item.FiscalNumber, item.CreatedAt, item.DueDate, item.Total,
            Extra = codesByInvoice[item.Id].Any(code => code is not null && extraCodes.Contains(code)),
        }).ToArray();
        Assert.NotEmpty(e31);
        // An extra invoice holds only extra operations.
        Assert.All(invoiceRows.Where(item => codesByInvoice[item.Id].Any(code => code is not null && extraCodes.Contains(code))),
            item => Assert.All(codesByInvoice[item.Id].OfType<string>(), code => Assert.Contains(code, extraCodes)));
        var first = long.Parse(prior[3..], CultureInfo.InvariantCulture) + 1;
        var ordered = e31.OrderBy(item => item.Extra).ThenBy(item => item.CreatedAt)
            .ThenBy(item => item.FiscalNumber, StringComparer.Ordinal).ToArray();
        for (var index = 0; index < ordered.Length; index++)
            Assert.Equal(FinanceInvoicePolicy.FormatFiscalNumber(first + index), ordered[index].FiscalNumber);
        Log($"E31: {ordered[0].FiscalNumber} … {ordered[^1].FiscalNumber} ({ordered.Length}) after {prior}");
        var notes = await db.Set<FinanceTreasuryAdjustmentNote>().AsNoTracking()
            .Where(item => item.Id > baseline["[commercial].[finance_treasury_adjustment_notes]"]).ToArrayAsync(ct);
        Log($"Credit notes: {notes.Length} ({string.Join(", ", notes.Select(note => note.Number).Order(StringComparer.Ordinal))})");
        Assert.NotEmpty(notes);

        // Nothing between 22:30 and 05:30 local in any row the history inserted.
        var outside = await InstantsOutsideTheOperatingDayAsync(database.ConnectionString, baseline, ct);
        Assert.True(outside.Count == 0, string.Join(Environment.NewLine, outside));

        // Stands: closed and never two visits at once on one stand.
        var stands = await db.Set<StandAssignment>().AsNoTracking()
            .Where(item => item.Id > baseline["[ops].[stand_assignments]"])
            .Join(db.GroundOperations.AsNoTracking(), stand => stand.TurnaroundId, operation => operation.TurnaroundId,
                (stand, operation) => new { stand.StandId, stand.AssignedFrom, stand.AssignedTo, operation.CurrentStatus })
            .ToArrayAsync(ct);
        Assert.NotEmpty(stands);
        Assert.All(stands, stand => Assert.NotNull(stand.AssignedTo));
        Log($"Stand assignments: {stands.Length} over {stands.Select(stand => stand.StandId).Distinct().Count()} stands");
        foreach (var group in stands.Where(stand => stand.CurrentStatus != GroundOperationStatus.Cancelled).GroupBy(stand => stand.StandId))
        {
            var byStart = group.OrderBy(item => item.AssignedFrom).ToArray();
            for (var index = 1; index < byStart.Length; index++)
                Assert.True(byStart[index - 1].AssignedTo <= byStart[index].AssignedFrom,
                    $"Stand {group.Key} overlaps at {byStart[index].AssignedFrom:O}.");
        }

        // Documents: one current cycle per agent and type; shifts: one per agent and day.
        var cycles = await db.QualificationCycles.AsNoTracking().Select(item => new { item.RampAgentId, item.EquipmentTypeId, item.IsCurrent })
            .ToArrayAsync(ct);
        Assert.All(cycles.GroupBy(item => (item.RampAgentId, item.EquipmentTypeId)), group => Assert.Single(group, item => item.IsCurrent));
        var permits = await db.AirportPermitCycles.AsNoTracking().Select(item => new { item.RampAgentId, item.DocumentType, item.IsCurrent })
            .ToArrayAsync(ct);
        Assert.All(permits.GroupBy(item => (item.RampAgentId, item.DocumentType)), group => Assert.Single(group, item => item.IsCurrent));
        var shifts = await db.ShiftAssignments.AsNoTracking().Select(item => new { item.RampAgentId, item.WorkDate }).ToArrayAsync(ct);
        Assert.Equal(shifts.Length, shifts.Distinct().Count());

        // The reports, month by month.
        await using var reportScope = provider.CreateAsyncScope();
        var services = reportScope.ServiceProvider;
        var station = anchors.Station.PublicId;
        var occ = services.GetRequiredService<IOccReportStore>();
        var hr = services.GetRequiredService<IHumanResourcesReportStore>();
        var finance = services.GetRequiredService<IFinanceReportStore>();
        var contractsReports = services.GetRequiredService<IContractsReportStore>();
        var portalReports = new AirlinePortalReports(services.GetRequiredService<IActorContextResolver>(),
            services.GetRequiredService<IAirlinePortalReportStore>(), services.GetRequiredService<IFinanceTreasuryStore>(), today);
        var hrAccount = Guid.Parse("40000000-0000-7000-8000-000000000004");
        static string Iso(DateOnly day) => day.ToString("yyyy-MM-dd", CultureInfo.InvariantCulture);
        string[] financeKeys = ["revenue", "charges", "sales", "invoices", "receipts", "collections", "payables"];
        var header = new List<string> { "month" };
        header.AddRange(Enum.GetValues<OccReportKind>().Select(kind => "occ." + kind));
        header.AddRange(["hr.expirations", "hr.shifts", "hr.qualification"]);
        header.AddRange(financeKeys.Select(key => "fin." + key));
        header.AddRange(["portal.operations", "portal.invoices"]);
        var table = new List<string[]> { header.ToArray() };
        var empty = new List<string>();
        foreach (var month in options.Months())
        {
            var cells = new List<int>();
            foreach (var kind in Enum.GetValues<OccReportKind>())
            {
                var result = await occ.ReadAsync(HistoryOccAccount, kind, station, month.From, month.To, 1,
                    OccReportCatalog.MaxExportRows, OccReportFilters.None, ct);
                Assert.Null(result.Failure);
                cells.Add(result.Table!.TotalRows ?? result.Table.Rows.Count);
            }
            var expirations = await hr.ListExpirationsAsync(hrAccount, station, month.From, month.To, 1, 100, cancellationToken: ct);
            Assert.Null(expirations.Failure);
            cells.Add(expirations.Page!.Rows.Count);
            var distribution = await hr.ListStaffDistributionAsync(hrAccount, station, month.From, month.To, 1, 100, ct);
            Assert.Null(distribution.Failure);
            cells.Add(distribution.Page!.Rows.Count);
            var qualification = await hr.ListQualificationCoverageAsync(hrAccount, station, month.From, month.To, 1, 100, ct);
            Assert.Null(qualification.Failure);
            cells.Add(qualification.Page!.Rows.Count(row => row.EligibleAgents > 0));
            foreach (var key in financeKeys)
            {
                var report = await finance.GetAsync(FinanceAccount, key, new FinanceReportFilter(month.From, month.To, null, null, null), ct);
                Assert.NotNull(report);
                cells.Add(report.Rows.Count);
            }
            foreach (var key in new[] { "operations", "invoices" })
            {
                var definition = AirlinePortalReports.All.Find(key)!;
                var report = await portalReports.ReadAsync(NewReportsAirlineAccount, definition,
                    NewReportsQuery(definition, Iso(month.From), Iso(month.To)), ct);
                Assert.Null(report.Failure);
                cells.Add(report.Document!.Rows.Count);
            }
            // «Vencimientos» lists the current documents by their expiry date: one that expired in a past month was
            // renewed (the old cycle is no longer current), so only the recent months can have rows; checked below.
            for (var index = 0; index < cells.Count; index++)
                if (cells[index] == 0 && header[index + 1] != "hr.expirations") empty.Add($"{month.Name} {header[index + 1]}");
            table.Add([month.Name, .. cells.Select(cell => cell.ToString(CultureInfo.InvariantCulture))]);
        }
        Log("Report rows per month:");
        foreach (var column in Enumerable.Range(0, header.Count))
            Log("  " + string.Join(" | ", table.Select((row, index) => index == 0 ? row[column].PadRight(24) : row[column].PadLeft(7))));

        // Expired and expiring documents at «today»; CxC aging at 2026-11-21 in several buckets with overdue invoices.
        var expired = await hr.ListExpirationsAsync(hrAccount, station, new DateOnly(2026, 1, 1), new DateOnly(2026, 11, 21), 1, 100,
            validity: "Expired", cancellationToken: ct);
        Assert.NotEmpty(expired.Page!.Rows);
        var expiring = await hr.ListExpirationsAsync(hrAccount, station, new DateOnly(2026, 11, 22), new DateOnly(2026, 12, 22), 1, 100,
            cancellationToken: ct);
        Assert.NotEmpty(expiring.Page!.Rows);
        var nextYear = await hr.ListExpirationsAsync(hrAccount, station, new DateOnly(2026, 11, 22), new DateOnly(2027, 11, 21), 1, 100,
            cancellationToken: ct);
        Log($"HR: expired {expired.Page.Rows.Count}, expiring in 30 days {expiring.Page.Rows.Count}, " +
            $"expiring within a year {nextYear.Page!.Rows.Count}{(nextYear.Page.HasMore ? "+" : "")}");
        var cutoff = new DateOnly(2026, 11, 21);
        var aging = await finance.GetAsync(FinanceAccount, "receivables", new FinanceReportFilter(cutoff, cutoff, null, null, null), ct);
        Assert.NotNull(aging);
        Assert.NotEmpty(aging.Rows);
        string[] buckets = ["current", "d30", "d60", "d90", "d90plus"];
        var totals = buckets.ToDictionary(bucket => bucket, bucket => aging.Rows.Sum(row => Money(row[Column(aging, bucket)])));
        Log("CxC aging at 2026-11-21: " + string.Join(", ", totals.Select(pair => $"{pair.Key}={pair.Value:0.00}")) +
            $" over {aging.Rows.Count} airline/currency rows");
        foreach (var row in aging.Rows)
            Log("  " + string.Join(" | ", row));
        Assert.True(totals.Count(pair => pair.Value > 0) > 1, "The aging has one bucket only.");
        var overdue = await finance.GetAsync(FinanceAccount, "invoices",
            new FinanceReportFilter(new DateOnly(2026, 6, 1), cutoff, null, null, null) { Status = InvoiceStatusLabels.Overdue }, ct);
        Assert.NotEmpty(overdue!.Rows);
        var paid = await finance.GetAsync(FinanceAccount, "invoices",
            new FinanceReportFilter(new DateOnly(2026, 6, 1), cutoff, null, null, null) { Status = InvoiceStatusLabels.Paid }, ct);
        var pendingStatus = await finance.GetAsync(FinanceAccount, "invoices",
            new FinanceReportFilter(new DateOnly(2026, 6, 1), cutoff, null, null, null) { Status = InvoiceStatusLabels.Pending }, ct);
        Log($"Invoices at 2026-11-21: overdue {overdue.Rows.Count}, pending {pendingStatus!.Rows.Count}, paid {paid!.Rows.Count}");

        // Contratos, the portal statement and «Por facturar» of 16–21 November.
        foreach (var definition in ContractsReportCatalog.All)
        {
            var result = await contractsReports.ReadAsync(ContractsAccount, definition,
                NewReportsQuery(definition, definition.Period == ReportPeriod.AsOf ? null : "2026-04-01",
                    "2026-11-21"), ct);
            Assert.Null(result.Failure);
            Log($"Contratos {definition.Key}: {result.Document!.Rows.Count}");
            Assert.NotEmpty(result.Document.Rows);
        }
        var statementDefinition = AirlinePortalReports.All.Find("statement")!;
        var statement = await portalReports.ReadAsync(NewReportsAirlineAccount, statementDefinition,
            NewReportsQuery(statementDefinition, null, "2026-11-21"), ct);
        Assert.Null(statement.Failure);
        Log($"Portal statement: {statement.Document!.Rows.Count}");
        Assert.NotEmpty(statement.Document.Rows);
        Assert.Equal(new DateOnly(2026, 11, 15), FinanceHistory.InvoicedThrough(options));
        var pending = await services.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
            new GetFinancePendingOperationsQuery(FinanceAccount, station, new DateOnly(2026, 11, 16), cutoff, null, null, 100), ct);
        Assert.NotNull(pending);
        Log($"Por facturar 16–21 nov: {pending.Operations.Count} (ready {pending.Operations.Count(item => item.Ready)})");
        Assert.NotEmpty(pending.Operations);

        Assert.True(empty.Count == 0, "Empty reports: " + string.Join(", ", empty));

        // A second run is the fast path: nothing is written.
        var fast = Stopwatch.StartNew();
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var context = CreateContext(connection))
            Assert.Empty(await new DevelopmentHistorySeeder(context).SeedAsync(options, ct));
        Log($"Second run: {fast.Elapsed.TotalMilliseconds:0} ms");
        Assert.Equal(complete, await HistoryTableCountsAsync(database.ConnectionString, ct));

        // The base seed's anchors are what verify-development.sql certifies, and untouched.
        await VerifyDevelopmentSeedAnchorsAsync(database.ConnectionString, ct);
        Assert.Equal(baseContractUpdatedAt, await db.Contracts.AsNoTracking()
            .Where(item => item.ContractCode == "DEV-CONTRACT-0001").Select(item => item.UpdatedAt).SingleAsync(ct));
        Assert.True(await db.Turnarounds.AnyAsync(item => item.OperationCode == "DEV-TAT-0001", ct));
    }
}
