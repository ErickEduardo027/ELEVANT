using System.Text;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Persistence.Finance;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Migrations;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private const string FinancePlatformPreviousMigration = "20261009172055_AddEmployeesPositionsRequisitions";
    private const string FinancePlatformMigration = "20261019033625_AddFinanceCommercialPlatform";
    private const string FinancePlatformTaxMigration = "20261019041554_AddFinanceTaxSnapshotsAndCorrections";
    private static readonly Guid FinancePlatformLegacyInvoiceId = Guid.Parse("62000000-0000-7000-8000-000000000001");

    [Fact]
    public async Task FinancePlatformMigrationsUpgradePreviousDevelopmentWithoutChangingFinancialHistory()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var context = CreateContext(database.ConnectionString);
        var chain = context.Database.GetMigrations().ToArray();
        var priorIndex = Array.IndexOf(chain, FinancePlatformPreviousMigration);
        Assert.True(priorIndex >= 0);
        Assert.Equal([FinancePlatformMigration, FinancePlatformTaxMigration],
            chain.Skip(priorIndex + 1).Take(2).ToArray());
        Assert.False(context.Database.HasPendingModelChanges());

        var migrator = context.GetService<IMigrator>();
        await migrator.MigrateAsync(FinancePlatformPreviousMigration, ct);
        Assert.Equal(FinancePlatformPreviousMigration, (await context.Database.GetAppliedMigrationsAsync(ct)).Last());
        await SeedFinancePlatformPreviousHistoryAsync(database.ConnectionString, ct);
        var before = await CaptureFinancePlatformLegacyAsync(database.ConnectionString, ct);

        // Actual upgrade: the fixture was inserted under the prior schema, before either new migration.
        await migrator.MigrateAsync(FinancePlatformTaxMigration, ct);
        Assert.Equal(chain.Take(priorIndex + 3), await context.Database.GetAppliedMigrationsAsync(ct));
        await AssertFinancePlatformLegacyAsync(database.ConnectionString, before, ct);
        Assert.False(context.Database.HasPendingModelChanges());

        // Only the columns of this upgrade step: later migrations add more (e.g. the e-CF of ADR-0035).
        var invoice = await context.NonFiscalInvoices.AsNoTracking().Select(item => new
        {
            item.Id, item.PublicId, item.PreinvoiceId, item.AirlineId, item.StationId, item.IssuedByAccountId, item.Total,
            item.NetTotal, item.DiscountTotal, item.TaxTotal, item.TaxTreatmentsConfigured, item.CommercialSnapshotJson,
        }).SingleAsync(ct);
        var invoiceLine = await context.NonFiscalInvoiceLines.AsNoTracking().SingleAsync(ct);
        var draft = await context.Preinvoices.AsNoTracking().SingleAsync(ct);
        var draftLine = await context.PreinvoiceLines.AsNoTracking().SingleAsync(ct);
        var payment = await context.NonFiscalPayments.AsNoTracking().SingleAsync(ct);
        Assert.Equal(FinancePlatformLegacyInvoiceId, invoice.PublicId);
        Assert.Equal(draft.Id, invoice.PreinvoiceId);
        Assert.Equal(draft.Id, draftLine.PreinvoiceId);
        Assert.Equal(draftLine.Id, invoiceLine.PreinvoiceLineId);
        Assert.Equal(invoice.Id, invoiceLine.InvoiceId);
        Assert.Equal(invoice.Id, payment.InvoiceId);
        Assert.Equal(PreinvoiceStatus.Invoiced, draft.Status);
        Assert.Equal(1000.1234m, draft.Total);
        Assert.Equal(1000.1234m, invoice.Total);
        Assert.Equal(1000.1234m, invoiceLine.Amount);
        Assert.Equal(300.0123m, payment.Amount);
        Assert.Equal(700.1111m, await FinanceTreasuryBalances.BalanceAsync(context, invoice.Id, invoice.Total, ct));

        // Additive defaults preserve the legacy contract's pricing semantics and unknown tax, not zero tax.
        Assert.Equal(0, await context.ContractVersions.Select(v => v.PricingPolicyVersion).SingleAsync(ct));
        Assert.Null(draftLine.CalculationJson);
        Assert.Null(draftLine.ComputedIsExcluded);
        Assert.Equal(FinanceTaxTreatment.Unconfigured, draftLine.TaxTreatment);
        Assert.Null(draftLine.TaxPolicyPublicId);
        Assert.Null(draftLine.TaxCapturedAt);
        Assert.Null(draftLine.TaxRate);
        Assert.Null(draftLine.TaxBasis);
        Assert.Null(draftLine.NetAmount);
        Assert.Null(draftLine.DiscountAmount);
        Assert.Null(draftLine.TaxAmount);
        Assert.Null(draftLine.GrossAmount);
        Assert.Equal(FinanceTaxTreatment.Unconfigured, invoiceLine.TaxTreatment);
        Assert.Null(invoiceLine.TaxPolicyPublicId);
        Assert.Null(invoiceLine.TaxCapturedAt);
        Assert.Null(invoiceLine.TaxRate);
        Assert.Null(invoiceLine.TaxBasis);
        Assert.Null(invoiceLine.NetAmount);
        Assert.Null(invoiceLine.DiscountAmount);
        Assert.Null(invoiceLine.TaxAmount);
        Assert.Null(invoiceLine.GrossAmount);
        Assert.False(invoice.TaxTreatmentsConfigured);
        Assert.Null(invoice.CommercialSnapshotJson);
        Assert.Null(invoice.NetTotal);
        Assert.Null(invoice.DiscountTotal);
        Assert.Null(invoice.TaxTotal);
        Assert.False(FinanceTaxSnapshotWriter.HasConfiguredIssuedTreatments(new NonFiscalInvoice
        {
            Total = invoice.Total, TaxTotal = invoice.TaxTotal, TaxTreatmentsConfigured = invoice.TaxTreatmentsConfigured,
            CommercialSnapshotJson = invoice.CommercialSnapshotJson,
        }, [invoiceLine]));
        Assert.Empty(await context.Set<FinanceTreasuryReceipt>().ToArrayAsync(ct));
        Assert.Empty(await context.Set<FinanceTreasuryMovement>().ToArrayAsync(ct));
        Assert.Empty(await context.Set<FinanceFiscalDocument>().ToArrayAsync(ct));
        Assert.Empty(await context.Set<FinanceTaxPolicy>().ToArrayAsync(ct));
        Assert.Single(await context.PreinvoiceDisputeResolutions.ToArrayAsync(ct));

        // A newly retained policy must stop Down before its table or any issued history can be removed.
        var policy = new FinanceTaxPolicy
        {
            PublicId = Guid.CreateVersion7(), AirlineId = invoice.AirlineId, StationId = invoice.StationId,
            CreatedByAccountId = invoice.IssuedByAccountId, PublishedByAccountId = invoice.IssuedByAccountId,
            CurrencyCode = "USD", ConceptKind = PreinvoiceLineKind.Adjustment, ConceptCode = "MIGRATION",
            Treatment = FinanceTaxTreatment.Exempt, Basis = "Synthetic migration regression only",
            ValidFrom = new DateOnly(2026, 10, 1), Status = FinanceTaxPolicyStatus.Published,
            PublishedAt = new DateTimeOffset(2026, 10, 3, 12, 34, 56, TimeSpan.Zero),
        };
        context.Add(policy);
        await context.SaveChangesAsync(ct);
        var retainedPolicy = await CaptureFinancePlatformTableAsync(database.ConnectionString, "commercial.finance_tax_policies", ct);
        var failure = await Assert.ThrowsAsync<SqlException>(() => migrator.MigrateAsync(FinancePlatformMigration, ct));
        Assert.Equal(51081, failure.Number);
        Assert.Equal(FinancePlatformTaxMigration, (await context.Database.GetAppliedMigrationsAsync(ct)).Last());
        await AssertFinancePlatformLegacyAsync(database.ConnectionString, before, ct);
        await AssertFinancePlatformLegacyAsync(database.ConnectionString, [retainedPolicy], ct);
    }

    [Fact]
    public async Task FinancePlatformMigrationsDownGuardRetainsTreasuryAndPreviousFinancialHistory()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var context = CreateContext(database.ConnectionString);
        Assert.False(context.Database.HasPendingModelChanges());
        var migrator = context.GetService<IMigrator>();
        await migrator.MigrateAsync(FinancePlatformPreviousMigration, ct);
        await SeedFinancePlatformPreviousHistoryAsync(database.ConnectionString, ct);
        var before = await CaptureFinancePlatformLegacyAsync(database.ConnectionString, ct);
        // Stop before the tax migration so guard 51080 is reached without deleting tax history.
        await migrator.MigrateAsync(FinancePlatformMigration, ct);
        await using (var connection = new SqlConnection(database.ConnectionString))
        {
            await connection.OpenAsync(ct);
            using var command = connection.CreateCommand();
            command.CommandText = """
                INSERT INTO [commercial].[finance_treasury_receipts]
                    ([airline_id], [station_id], [actor_account_id], [request_id], [reference],
                     [currency_code], [method], [received_on], [amount], [reason])
                SELECT [airline_id], [station_id], [issued_by_account_id], NEWID(), N'UPGRADE-RECEIPT',
                    N'USD', N'Transfer', '2026-10-03', 25.4321, N'Synthetic retained receipt'
                FROM [commercial].[non_fiscal_invoices] WHERE [public_id] = @invoice;
                """;
            command.Parameters.AddWithValue("@invoice", FinancePlatformLegacyInvoiceId);
            Assert.Equal(1, await command.ExecuteNonQueryAsync(ct));
        }
        var retainedReceipt = await CaptureFinancePlatformTableAsync(database.ConnectionString, "commercial.finance_treasury_receipts", ct);
        var failure = await Assert.ThrowsAsync<SqlException>(() => migrator.MigrateAsync(FinancePlatformPreviousMigration, ct));
        Assert.Equal(51080, failure.Number);
        Assert.Equal(FinancePlatformMigration, (await context.Database.GetAppliedMigrationsAsync(ct)).Last());
        Assert.DoesNotContain(FinancePlatformTaxMigration, await context.Database.GetAppliedMigrationsAsync(ct));
        await AssertFinancePlatformLegacyAsync(database.ConnectionString, before, ct);
        await AssertFinancePlatformLegacyAsync(database.ConnectionString, [retainedReceipt], ct);
    }

    // Only existing columns and INSERTs: no current-model seeder or schema repair runs against the prior schema.
    private static async Task SeedFinancePlatformPreviousHistoryAsync(string connectionString, CancellationToken ct)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        using var command = connection.CreateCommand();
        command.CommandText = """
            SET XACT_ABORT ON;
            BEGIN TRANSACTION;
            DECLARE @at datetimeoffset(3) = '2026-10-03T12:34:56.789+00:00';
            DECLARE @organization bigint, @person bigint, @account bigint, @airport bigint,
                @station bigint, @airline bigint, @contract bigint, @draft bigint,
                @line bigint, @invoice bigint, @dispute bigint;

            INSERT INTO [iam].[organizations]
                ([code], [legal_name], [display_name], [type], [status], [created_at], [updated_at])
            VALUES (N'UPGRADE-AIR', N'Synthetic Upgrade Airline', N'Synthetic Upgrade Airline',
                N'AirlineOperator', N'Active', @at, @at);
            SET @organization = SCOPE_IDENTITY();

            INSERT INTO [iam].[persons]
                ([first_name], [last_name], [identification_type], [identification_number], [created_at], [updated_at])
            VALUES (N'Synthetic', N'Upgrade Fixture', N'Other', N'MIGRATION-ONLY', @at, @at);
            SET @person = SCOPE_IDENTITY();
            INSERT INTO [iam].[accounts]
                ([person_id], [user_name], [normalized_user_name], [email_confirmed], [phone_number_confirmed],
                 [two_factor_enabled], [lockout_enabled], [access_failed_count], [status], [invitation_status],
                 [created_at], [updated_at])
            VALUES (@person, N'upgrade-fixture', N'UPGRADE-FIXTURE', 1, 0, 0, 1, 0, N'Active', N'Accepted', @at, @at);
            SET @account = SCOPE_IDENTITY();

            INSERT INTO [ref].[airports]
                ([iata_code], [icao_code], [name], [city], [country_code], [created_at], [updated_at])
            VALUES ('ZZZ', 'ZZZZ', N'Synthetic Upgrade Airport', N'Synthetic City', 'DO', @at, @at);
            SET @airport = SCOPE_IDENTITY();
            INSERT INTO [ref].[stations]
                ([airport_id], [code], [name], [iana_time_zone], [is_active], [created_at], [updated_at])
            VALUES (@airport, N'UPGRADE', N'Synthetic Upgrade Station', N'America/Santo_Domingo', 1, @at, @at);
            SET @station = SCOPE_IDENTITY();
            INSERT INTO [ref].[airlines]
                ([organization_id], [iata_code], [icao_code], [name], [is_active], [created_at], [updated_at])
            VALUES (@organization, 'ZZ', 'ZZZ', N'Synthetic Upgrade Airline', 1, @at, @at);
            SET @airline = SCOPE_IDENTITY();

            INSERT INTO [commercial].[contracts]
                ([airline_id], [contract_code], [status], [signed_on], [created_at], [updated_at])
            VALUES (@airline, N'UPGRADE-CONTRACT', N'Active', '2026-10-01', @at, @at);
            SET @contract = SCOPE_IDENTITY();
            INSERT INTO [commercial].[contract_versions]
                ([contract_id], [version_number], [valid_from], [valid_to], [currency_code], [status],
                 [terms], [approved_by_account_id], [approved_at], [created_at], [updated_at])
            VALUES (@contract, 1, '2026-10-01', '2026-12-31', 'USD', N'Approved',
                N'Pre-platform synthetic terms', @account, @at, @at, @at);

            INSERT INTO [commercial].[preinvoices]
                ([airline_id], [station_id], [created_by_account_id], [request_id], [payload_hash],
                 [from], [to], [currency_code], [total], [status], [created_at], [updated_at])
            VALUES (@airline, @station, @account, NEWID(), REPLICATE('A', 64),
                '2026-10-02', '2026-10-03', 'USD', 1000.1234, N'Invoiced', @at, @at);
            SET @draft = SCOPE_IDENTITY();
            INSERT INTO [commercial].[preinvoice_lines]
                ([preinvoice_id], [line_number], [operation_code], [operation_date], [service_code],
                 [service_name], [executed_quantity], [billing_unit], [unit_price], [currency_code],
                 [amount], [kind], [computed_quantity], [computed_amount], [is_excluded],
                 [adjustment_reason], [edited_by_account_id], [edited_at], [created_at], [updated_at])
            VALUES (@draft, 1, N'UPGRADE-OP', '2026-10-02', N'MIGRATION', N'Synthetic legacy adjustment',
                2, N'unit', 500.0617, 'USD', 1000.1234, N'Adjustment', 2, 999.1234, 0,
                N'Synthetic preexisting adjustment reason', @account, @at, @at, @at);
            SET @line = SCOPE_IDENTITY();

            INSERT INTO [commercial].[preinvoice_disputes]
                ([preinvoice_id], [submitted_by_account_id], [request_id], [payload_hash],
                 [subject], [description], [created_at], [updated_at])
            VALUES (@draft, @account, NEWID(), REPLICATE('B', 64), N'Synthetic historical dispute',
                N'Synthetic historical description', @at, @at);
            SET @dispute = SCOPE_IDENTITY();
            INSERT INTO [commercial].[preinvoice_dispute_lines]
                ([dispute_id], [preinvoice_line_id], [created_at], [updated_at])
            VALUES (@dispute, @line, @at, @at);
            INSERT INTO [commercial].[preinvoice_dispute_resolutions]
                ([dispute_id], [resolved_by_account_id], [request_id], [payload_hash],
                 [decision], [reason], [created_at], [updated_at])
            VALUES (@dispute, @account, NEWID(), REPLICATE('C', 64),
                N'Maintain', N'Synthetic historical resolution', @at, @at);

            INSERT INTO [commercial].[non_fiscal_invoices]
                ([public_id], [preinvoice_id], [airline_id], [station_id], [issued_by_account_id], [request_id],
                 [number], [currency_code], [total], [payment_term_days], [due_date], [created_at], [updated_at])
            VALUES (@invoicePublicId, @draft, @airline, @station, @account, NEWID(),
                N'NF-' + REPLACE(CONVERT(nvarchar(36), @invoicePublicId), '-', ''), 'USD',
                1000.1234, 30, '2026-11-02', @at, @at);
            SET @invoice = SCOPE_IDENTITY();
            INSERT INTO [commercial].[non_fiscal_invoice_lines]
                ([invoice_id], [preinvoice_line_id], [line_number], [operation_code], [operation_date],
                 [service_code], [service_name], [executed_quantity], [billing_unit], [unit_price],
                 [currency_code], [amount], [kind], [reason], [created_at], [updated_at])
            VALUES (@invoice, @line, 1, N'UPGRADE-OP', '2026-10-02', N'MIGRATION',
                N'Synthetic legacy adjustment', 2, N'unit', 500.0617, 'USD', 1000.1234, N'Adjustment',
                N'Synthetic preexisting adjustment reason', @at, @at);
            INSERT INTO [commercial].[non_fiscal_payments]
                ([invoice_id], [recorded_by_account_id], [request_id], [reference], [currency_code],
                 [amount], [method], [paid_on], [created_at], [updated_at])
            VALUES (@invoice, @account, NEWID(), N'UPGRADE-PAYMENT', 'USD', 300.0123,
                N'Transfer', '2026-10-03', @at, @at);
            INSERT INTO [audit].[audit_entries]
                ([actor_account_id], [actor_type], [action], [entity_type], [entity_public_id], [correlation_id],
                 [source], [occurred_at], [reason], [metadata_json], [station_id], [organization_id])
            VALUES (@account, N'Account', N'finance.payment.recorded', N'NonFiscalInvoice', @invoicePublicId,
                NEWID(), N'migration-regression', @at, N'Synthetic legacy audit',
                N'{"fixture":"finance-upgrade","originalAmount":300.0123}', @station, @organization);
            COMMIT TRANSACTION;
            """;
        command.Parameters.AddWithValue("@invoicePublicId", FinancePlatformLegacyInvoiceId);
        await command.ExecuteNonQueryAsync(ct);
    }

    private sealed record FinancePlatformLegacyTable(string Name, string Columns, string Json);

    private static async Task<FinancePlatformLegacyTable[]> CaptureFinancePlatformLegacyAsync(string connectionString, CancellationToken ct)
    {
        string[] tables =
        [
            "iam.organizations", "iam.persons", "iam.accounts", "ref.airports", "ref.stations", "ref.airlines",
            "commercial.contracts", "commercial.contract_versions", "commercial.preinvoices", "commercial.preinvoice_lines",
            "commercial.non_fiscal_invoices", "commercial.non_fiscal_invoice_lines", "commercial.non_fiscal_payments",
            "commercial.preinvoice_disputes", "commercial.preinvoice_dispute_lines", "commercial.preinvoice_dispute_resolutions",
            "audit.audit_entries",
        ];
        var snapshots = new List<FinancePlatformLegacyTable>();
        foreach (var table in tables) snapshots.Add(await CaptureFinancePlatformTableAsync(connectionString, table, ct));
        return snapshots.ToArray();
    }

    private static async Task<FinancePlatformLegacyTable> CaptureFinancePlatformTableAsync(string connectionString, string table, CancellationToken ct)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        var columns = new List<string>();
        using (var command = connection.CreateCommand())
        {
            // Compare every original business column, including IDs, amounts, timestamps and audit payloads.
            // SQL rowversion is an engine concurrency token, not a financial/history value.
            command.CommandText = "SELECT [name] FROM sys.columns WHERE [object_id] = OBJECT_ID(@table) AND [name] <> N'row_version' ORDER BY [column_id]";
            command.Parameters.AddWithValue("@table", table);
            await using var reader = await command.ExecuteReaderAsync(ct);
            while (await reader.ReadAsync(ct)) columns.Add("[" + reader.GetString(0).Replace("]", "]]") + "]");
        }
        Assert.NotEmpty(columns);
        var columnList = string.Join(", ", columns);
        var json = await ReadFinancePlatformTableAsync(connection, table, columnList, ct);
        Assert.NotEqual("[]", json);
        return new(table, columnList, json);
    }

    private static async Task AssertFinancePlatformLegacyAsync(string connectionString, FinancePlatformLegacyTable[] snapshots, CancellationToken ct)
    {
        await using var connection = new SqlConnection(connectionString);
        await connection.OpenAsync(ct);
        foreach (var snapshot in snapshots)
            Assert.Equal(snapshot.Json, await ReadFinancePlatformTableAsync(connection, snapshot.Name, snapshot.Columns, ct));
    }

    private static async Task<string> ReadFinancePlatformTableAsync(SqlConnection connection, string table, string columns, CancellationToken ct)
    {
        // Names/columns come only from the hardcoded fixture tables and SQL metadata, never application input.
        var qualified = string.Join(".", table.Split('.').Select(part => "[" + part.Replace("]", "]]") + "]"));
        using var command = connection.CreateCommand();
        command.CommandText = $"SELECT {columns} FROM {qualified} ORDER BY [id] FOR JSON PATH, INCLUDE_NULL_VALUES";
        await using var reader = await command.ExecuteReaderAsync(ct);
        var json = new StringBuilder();
        while (await reader.ReadAsync(ct)) json.Append(reader.GetString(0));
        return json.ToString();
    }
}
