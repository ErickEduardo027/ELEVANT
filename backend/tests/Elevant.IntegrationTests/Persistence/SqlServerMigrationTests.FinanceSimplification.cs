using System.Data;
using System.Globalization;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Entities.Identity;
using Elevant.Domain.Entities.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Domain.Governance;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Finance;
using Elevant.Persistence.Identity;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Storage;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

/// <summary>
/// The simplified Finance (phase 4, block B): no preinvoice (4-A), «Por facturar», its PDF and «Inicio» governed by
/// Facturación (4-N02), the e-NCF wherever an invoice is named (4-N19) and «Facturas» searched and paged (4-N21).
/// </summary>
public sealed partial class SqlServerMigrationTests
{
    private static readonly string[] InvoicingOnlyTemplate = ["finance.home.read", "finance.invoicing.read", "finance.invoicing.issue"];

    /// <summary>
    /// 4-N02: a template with only «Inicio» and «Facturación» lists «Por facturar», issues, opens what it issued and sees
    /// its summary; it does not read «Facturas», which is another module.
    /// </summary>
    [Fact]
    public async Task FinanceSimplificationInvoicingOnlyTemplateInvoicesReadsWhatItIssuedAndSeesItsHome()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        await AssignFinanceTemplateAsync(setup, FinanceAccount, "Solo facturación", InvoicingOnlyTemplate, ct);
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        async Task<T> Run<T>(Func<IServiceProvider, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider);
        }
        var actor = (await Run(services => new EfActorContextResolver(services.GetRequiredService<ElevantDbContext>(),
            TimeProvider.System).ResolveAsync(FinanceAccount, ct)))!;
        Assert.Equal(InvoicingOnlyTemplate.Order(StringComparer.Ordinal),
            actor.EffectiveAccess!.Permissions.Order(StringComparer.Ordinal));

        var before = (await Run(services => services.GetRequiredService<IFinanceHomeStore>().GetAsync(FinanceAccount, station, ct)))!;
        Assert.NotNull(before.ToInvoice);
        Assert.NotNull(before.InvoicedThisMonth);
        Assert.Null(before.Receivables);
        Assert.Null(before.CardCollectionsThisMonth);
        Assert.Null(before.PendingContractApprovals);
        Assert.Null(before.ChartersAwaitingPrepayment);
        var pending = (await Run(services => services.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
            new GetFinancePendingOperationsQuery(FinanceAccount, station, null, null, null, null), ct)))!;
        Assert.Contains(pending.Operations, item => item.OperationId == operation);
        Assert.Equal(pending.TotalPending, before.ToInvoice.Operations);

        var issued = await Run(services => Handler(services).HandleAsync(
            new IssueInvoiceRequest(FinanceAccount, station, [operation], Guid.NewGuid()), ct));
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        var invoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == issued.InvoiceId, ct);
        var draft = await setup.Preinvoices.AsNoTracking().Where(item => item.Id == invoice.PreinvoiceId)
            .Select(item => item.PublicId).SingleAsync(ct);
        // What «Por facturar» issued, it opens: the PDF's reader and the email status.
        Assert.Equal(invoice.Number, (await Run(services => services.GetRequiredService<INonFiscalInvoiceReadStore>()
            .GetForFinanceAsync(FinanceAccount, draft, ct)))?.Number);
        Assert.NotNull(await Run(services => services.GetRequiredService<IInvoiceEmailStatusStore>()
            .ListAsync(FinanceAccount, invoice.PublicId, ct)));
        // «Facturas» is not in the template.
        Assert.Null(await Run(services => services.GetRequiredService<IFinanceInvoiceLedgerStore>()
            .ListAsync(FinanceAccount, station, null, null, 1, 25, cancellationToken: ct)));

        var after = (await Run(services => services.GetRequiredService<IFinanceHomeStore>().GetAsync(FinanceAccount, station, ct)))!;
        Assert.Equal(before.ToInvoice.Operations - 1, after.ToInvoice!.Operations);
        var month = Assert.Single(after.InvoicedThisMonth!, item => item.CurrencyCode == invoice.CurrencyCode);
        var earlier = before.InvoicedThisMonth.SingleOrDefault(item => item.CurrencyCode == invoice.CurrencyCode);
        Assert.Equal(((earlier?.Count ?? 0) + 1, (earlier?.Amount ?? 0m) + invoice.Total), (month.Count, month.Amount));

        // Without «Inicio» the summary is refused; a station outside the account's scope too.
        await AssignFinanceTemplateAsync(setup, FinanceAccount, "Sin inicio", ["finance.invoicing.read"], ct);
        Assert.Null(await Run(services => services.GetRequiredService<IFinanceHomeStore>().GetAsync(FinanceAccount, station, ct)));
        await AssignFinanceTemplateAsync(setup, FinanceAccount, "Inicio", ["finance.home.read"], ct);
        var bare = (await Run(services => services.GetRequiredService<IFinanceHomeStore>().GetAsync(FinanceAccount, station, ct)))!;
        Assert.Null(bare.ToInvoice);
        Assert.Null(bare.InvoicedThisMonth);
        Assert.Null(bare.Receivables);
        Assert.Null(bare.CardCollectionsThisMonth);
        Assert.Null(bare.PendingContractApprovals);
        Assert.Null(bare.ChartersAwaitingPrepayment);
        Assert.Null(await Run(services => services.GetRequiredService<IFinanceHomeStore>()
            .GetAsync(FinanceAccount, Guid.Parse("20000000-0000-7000-8000-000000000013"), ct)));
        Assert.Null(await Run(services => services.GetRequiredService<IFinanceHomeStore>().GetAsync(ContractsAccount, station, ct)));
    }

    /// <summary>
    /// 4-A: a template saved before the preinvoice left keeps what it did, read from its stored rows: reading and
    /// issuing invoices. Editing preinvoices, the legacy payments, tax treatments and fiscal documents grant nothing, and
    /// the seeded «Analista de facturación» holds no retired code.
    /// </summary>
    [Fact]
    public async Task FinanceSimplificationStoredPreinvoiceGrantsResolveToInvoicingAndRetiredCodesToNothing()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        string[] retired = ["finance.approved_services.create", "finance.preinvoices.update", "finance.reconciliation.create",
            "finance.taxes.read", "finance.taxes.manage", "finance.fiscal.read", "finance.fiscal.simulate"];
        await AssignFinanceTemplateAsync(setup, FinanceAccount, "Plantilla anterior",
            ["finance.home.read", "finance.approved_services.read", "finance.preinvoices.read", "finance.preinvoices.issue",
                .. retired], ct);
        await using (var scope = provider.CreateAsyncScope())
        {
            var actor = (await new EfActorContextResolver(scope.ServiceProvider.GetRequiredService<ElevantDbContext>(),
                TimeProvider.System).ResolveAsync(FinanceAccount, ct))!;
            Assert.Equal(["finance.home.read", "finance.invoicing.issue", "finance.invoicing.read"],
                actor.EffectiveAccess!.Permissions.Order(StringComparer.Ordinal));
            Assert.All(retired, code => Assert.False(actor.HasPermission(code)));
            Assert.NotNull(await scope.ServiceProvider.GetRequiredService<IFinancePendingOperationsReadStore>().GetAsync(
                new GetFinancePendingOperationsQuery(FinanceAccount, Guid.Parse("20000000-0000-7000-8000-000000000003"),
                    null, null, null, null), ct));
        }

        var analyst = await setup.AccessProfiles.AsNoTracking()
            .SingleAsync(item => item.PublicId == Guid.Parse("44000000-0000-7000-8000-000000000001"), ct);
        Assert.Equal(Department.Finance, analyst.Department);
        var grants = await setup.AccessProfileGrants.AsNoTracking().Where(item => item.AccessProfileId == analyst.Id)
            .Select(item => item.PermissionCode).ToArrayAsync(ct);
        Assert.All(grants, code => Assert.True(DepartmentPermissionCatalog.IsKnown(code), code));
        var granted = DepartmentPermissionCatalog.Normalize(grants);
        Assert.Contains("finance.invoicing.issue", granted);
        Assert.Contains("finance.charters.confirm", granted);
        Assert.Contains("finance.notifications.read", granted);
        Assert.DoesNotContain(granted, code => code.StartsWith("finance.preinvoices.", StringComparison.Ordinal) ||
            code.StartsWith("finance.approved_services.", StringComparison.Ordinal));
    }

    /// <summary>
    /// 4-A: «Inicio» counts what waits, what was invoiced and collected by card in the business month of Santo Domingo,
    /// what is owed and overdue, and the charters waiting for their prepayment; nothing is stored.
    /// </summary>
    [Fact]
    public async Task FinanceSimplificationHomeCountsTheBusinessMonthOfSantoDomingo()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        // 22:00 of 31 October in Santo Domingo.
        var clock = new MovableTimeProvider(new DateTimeOffset(2026, 11, 1, 2, 0, 0, TimeSpan.Zero));
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct, clock);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.Where(item => item.Code == "PUJ").Select(item => item.PublicId).SingleAsync(ct);
        async Task<FinanceHomeData> HomeAsync()
        {
            await using var scope = provider.CreateAsyncScope();
            return (await scope.ServiceProvider.GetRequiredService<IFinanceHomeStore>().GetAsync(FinanceAccount, station, ct))!;
        }

        var start = await HomeAsync();
        Assert.Equal((station, new DateOnly(2026, 10, 31)), (start.StationId, start.BusinessDate));
        var operation = await ApproveForInvoicingAsync(setup, "DEV-TAT-0001", ct);
        var operationDate = await (from item in setup.GroundOperations
                                   join turnaround in setup.Turnarounds on item.TurnaroundId equals turnaround.Id
                                   where item.PublicId == operation
                                   select turnaround.OperationDate).SingleAsync(ct);
        var waiting = await HomeAsync();
        Assert.Equal(start.ToInvoice!.Operations + 1, waiting.ToInvoice!.Operations);
        Assert.True(waiting.ToInvoice.Airlines >= 1);
        Assert.True(waiting.ToInvoice.OldestOperationDate <= operationDate);

        IssueInvoiceResult issued;
        await using (var scope = provider.CreateAsyncScope())
            issued = await Handler(scope.ServiceProvider).HandleAsync(
                new IssueInvoiceRequest(FinanceAccount, station, [operation], Guid.NewGuid()), ct);
        Assert.True(issued.IsSuccess, $"{issued.Failure} {issued.Reason}");
        var total = issued.Total!.Value;
        var currency = issued.CurrencyCode!;
        var invoiced = await HomeAsync();
        Assert.Equal(start.ToInvoice.Operations, invoiced.ToInvoice!.Operations);
        var month = Assert.Single(invoiced.InvoicedThisMonth!, item => item.CurrencyCode == currency);
        Assert.Equal((1, total), (month.Count, month.Amount));
        var owed = Assert.Single(invoiced.Receivables!, item => item.CurrencyCode == currency);
        Assert.Equal((1, total, 0, 0m), (owed.OpenInvoices, owed.Open, owed.OverdueInvoices, owed.Overdue));
        await setup.NonFiscalInvoices.Where(item => item.PublicId == issued.InvoiceId)
            .ExecuteUpdateAsync(set => set.SetProperty(item => item.DueDate, new DateOnly(2026, 10, 30)), ct);
        var overdue = Assert.Single((await HomeAsync()).Receivables!, item => item.CurrencyCode == currency);
        Assert.Equal((1, total), (overdue.OverdueInvoices, overdue.Overdue));

        // The airline pays the whole balance by card the same evening.
        await using (var context = CreateContext(database.ConnectionString))
        {
            var paid = await new EfCardPaymentStore(context, clock, new SimulatedCardGateway()).PayAsync(
                new PayInvoiceByCardRequest(Guid.Parse("40000000-0000-7000-8000-000000000003"), issued.InvoiceId!.Value,
                    Guid.NewGuid(), "Casey Airline", "4111111111111111", 12, 2030, "123", total), ct);
            Assert.True(paid.IsSuccess, string.Join(",", paid.Reasons));
            Assert.Equal("Approved", paid.Attempt!.Status);
        }
        var collected = await HomeAsync();
        var card = Assert.Single(collected.CardCollectionsThisMonth!, item => item.CurrencyCode == currency);
        Assert.Equal((1, total), (card.Count, card.Amount));
        Assert.DoesNotContain(collected.Receivables!, item => item.CurrencyCode == currency);

        // 01:00 of 1 November in Santo Domingo: a new business month.
        clock.Now = new DateTimeOffset(2026, 11, 1, 5, 0, 0, TimeSpan.Zero);
        var november = await HomeAsync();
        Assert.Equal(new DateOnly(2026, 11, 1), november.BusinessDate);
        Assert.DoesNotContain(november.InvoicedThisMonth!, item => item.CurrencyCode == currency);
        Assert.DoesNotContain(november.CardCollectionsThisMonth!, item => item.CurrencyCode == currency);

        // A charter of the station waiting for its prepayment.
        var charterTurnaround = await setup.Turnarounds.SingleAsync(item => item.OperationCode == "DEV-TAT-0002", ct);
        var financeId = await setup.Users.Where(item => item.PublicId == FinanceAccount).Select(item => item.Id).SingleAsync(ct);
        setup.Set<CharterAgreement>().Add(new CharterAgreement
        {
            PublicId = Guid.NewGuid(), TurnaroundId = charterTurnaround.Id, AirlineId = charterTurnaround.AirlineId, CurrencyCode = "USD",
            PrepaymentStatus = CharterPrepaymentStatus.Pending, CreatedByAccountId = financeId,
            CreatedAt = clock.Now, UpdatedAt = clock.Now,
        });
        await setup.SaveChangesAsync(ct);
        Assert.Equal(november.ChartersAwaitingPrepayment + 1, (await HomeAsync()).ChartersAwaitingPrepayment);
        Assert.NotNull(november.PendingContractApprovals);
    }

    /// <summary>
    /// 4-N21: «Facturas» pages and finds an invoice by the start of its e-NCF or number or by part of its airline. 4-N19:
    /// the statement names each invoice by its e-NCF, and an invoice issued before ADR-0035 by its number.
    /// </summary>
    [Fact]
    public async Task FinanceSimplificationInvoicesAreSearchedAndPagedAndTheStatementNamesTheEcf()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var setup = CreateContext(database.ConnectionString);
        var station = await setup.Stations.SingleAsync(item => item.Code == "PUJ", ct);
        var issued = new List<IssueInvoiceResult>();
        foreach (var code in new[] { "DEV-TAT-0001", "DEV-TAT-0002" })
        {
            var operation = await ApproveForInvoicingAsync(setup, code, ct);
            await using var scope = provider.CreateAsyncScope();
            var result = await Handler(scope.ServiceProvider).HandleAsync(
                new IssueInvoiceRequest(FinanceAccount, station.PublicId, [operation], Guid.NewGuid()), ct);
            Assert.True(result.IsSuccess, $"{result.Failure} {result.Reason}");
            issued.Add(result);
        }
        // An invoice issued before ADR-0035 has no e-NCF.
        setup.ChangeTracker.Clear();
        var legacyInvoice = await LegacyInvoiceAsync(setup, station.Id, ct);

        await using var read = provider.CreateAsyncScope();
        var ledger = read.ServiceProvider.GetRequiredService<IFinanceInvoiceLedgerStore>();
        Task<FinanceInvoicePageData?> ListAsync(int page, int limit, string? search = null) =>
            ledger.ListAsync(FinanceAccount, station.PublicId, null, null, page, limit, search, ct);
        var first = (await ListAsync(1, 2))!;
        Assert.Equal((2, true), (first.Invoices.Count, first.HasMore));
        var second = (await ListAsync(2, 2))!;
        Assert.Equal((1, false), (second.Invoices.Count, second.HasMore));
        Assert.Empty(first.Invoices.Select(item => item.Id).Intersect(second.Invoices.Select(item => item.Id)));

        var byFiscalNumber = Assert.Single((await ListAsync(1, 25, issued[0].FiscalNumber))!.Invoices);
        Assert.Equal((issued[0].InvoiceId!.Value, issued[0].FiscalNumber), (byFiscalNumber.Id, byFiscalNumber.FiscalNumber));
        Assert.Equal(legacyInvoice.PublicId, Assert.Single((await ListAsync(1, 25, legacyInvoice.Number[..12]))!.Invoices).Id);
        Assert.Equal(2, (await ListAsync(1, 25, "E31"))!.Invoices.Count);
        var airlines = await setup.NonFiscalInvoices.AsNoTracking().Where(item => item.StationId == station.Id)
            .Join(setup.Airlines.AsNoTracking(), item => item.AirlineId, airline => airline.Id, (item, airline) => airline.Name)
            .ToArrayAsync(ct);
        var name = airlines[0];
        var part = name.Length > 4 ? name.Substring(1, 4).ToLowerInvariant() : name.ToLowerInvariant();
        Assert.Equal(airlines.Count(item => item.Contains(part, StringComparison.OrdinalIgnoreCase)),
            (await ListAsync(1, 25, part))!.Invoices.Count);
        var none = (await ListAsync(1, 25, "ZZ-NO-INVOICE"))!;
        Assert.Equal((0, false), (none.Invoices.Count, none.HasMore));
        Assert.Null(await ListAsync(1, 25, new string('E', 41)));

        // The statement of the airline names the e-CF invoice by its e-NCF and the legacy one by its number.
        var treasury = read.ServiceProvider.GetRequiredService<IFinanceTreasuryStore>();
        var today = Elevant.Application.Common.BusinessCalendar.Today(DateTimeOffset.UtcNow);
        var invoice = await setup.NonFiscalInvoices.AsNoTracking().SingleAsync(item => item.PublicId == issued[0].InvoiceId, ct);
        var airlineId = await setup.Airlines.AsNoTracking().Where(item => item.Id == invoice.AirlineId).Select(item => item.PublicId)
            .SingleAsync(ct);
        var statement = (await treasury.StatementAsync(FinanceAccount, today, station.PublicId, airlineId, ct))!;
        var named = Assert.Single(statement.Invoices, item => item.Id == invoice.PublicId);
        Assert.Equal((invoice.FiscalNumber, invoice.Number), (named.FiscalNumber, named.Number));
        Assert.Equal(invoice.FiscalNumber, Assert.Single(statement.Movements,
            item => item.InvoiceId == invoice.PublicId && item.Kind == "Invoice").Reference);
        var legacyAirline = await setup.Airlines.AsNoTracking().Where(item => item.Id == legacyInvoice.AirlineId)
            .Select(item => item.PublicId).SingleAsync(ct);
        var legacyStatement = (await treasury.StatementAsync(FinanceAccount, today, station.PublicId, legacyAirline, ct))!;
        var legacy = Assert.Single(legacyStatement.Invoices, item => item.Id == legacyInvoice.PublicId);
        Assert.Null(legacy.FiscalNumber);
        Assert.Equal(legacyInvoice.Number, Assert.Single(legacyStatement.Movements,
            item => item.InvoiceId == legacyInvoice.PublicId && item.Kind == "Invoice").Reference);
    }

    /// <summary>A non-fiscal invoice of 100 USD issued before ADR-0035 (no e-NCF), with its draft.</summary>
    private static async Task<NonFiscalInvoice> LegacyInvoiceAsync(ElevantDbContext db, long stationId, CancellationToken ct)
    {
        var airline = await db.Airlines.AsNoTracking().OrderBy(item => item.Id).FirstAsync(ct);
        var account = await db.Users.AsNoTracking().Where(item => item.PublicId == FinanceAccount).Select(item => item.Id)
            .SingleAsync(ct);
        var issuedAt = DateTimeOffset.UtcNow.AddDays(-1);
        var day = Elevant.Application.Common.BusinessCalendar.Today(issuedAt);
        var draft = new Preinvoice
        {
            PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = stationId, CreatedByAccountId = account,
            RequestId = Guid.NewGuid(), PayloadHash = new string('c', 64), From = day, To = day, CurrencyCode = "USD",
            Total = 100m, Status = PreinvoiceStatus.Invoiced, CreatedAt = issuedAt, UpdatedAt = issuedAt,
        };
        db.Preinvoices.Add(draft);
        await db.SaveChangesAsync(ct);
        var id = Guid.NewGuid();
        var invoice = new NonFiscalInvoice
        {
            PublicId = id, PreinvoiceId = draft.Id, AirlineId = airline.Id, StationId = stationId, IssuedByAccountId = account,
            RequestId = Guid.NewGuid(), Number = $"NF-{id:N}", CurrencyCode = "USD", Total = 100m, DueDate = day.AddDays(30),
            CreatedAt = issuedAt, UpdatedAt = issuedAt,
        };
        db.NonFiscalInvoices.Add(invoice);
        await db.SaveChangesAsync(ct);
        return invoice;
    }

    /// <summary>
    /// Makes the account a member of Finance whose permissions come from a new template with <paramref name="codes"/>,
    /// stored as given: the catalog resolves retired codes when the access is read.
    /// </summary>
    private static async Task AssignFinanceTemplateAsync(ElevantDbContext db, Guid accountId, string name,
        IReadOnlyList<string> codes, CancellationToken ct)
    {
        db.ChangeTracker.Clear();
        var account = await db.Users.AsNoTracking().Where(item => item.PublicId == accountId).Select(item => item.Id)
            .SingleAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var profile = new AccessProfile
        {
            PublicId = Guid.CreateVersion7(), Department = Department.Finance, Name = $"{name} {Guid.NewGuid():N}",
            IsActive = true, CreatedByAccountId = account, CreatedAt = now, UpdatedAt = now,
        };
        db.AccessProfiles.Add(profile);
        await db.SaveChangesAsync(ct);
        db.AccessProfileGrants.AddRange(codes.Select(code => new AccessProfileGrant
        {
            AccessProfileId = profile.Id, PermissionCode = code,
        }));
        var assignment = await db.DepartmentAssignments.SingleAsync(item => item.AccountId == account, ct);
        assignment.Kind = DepartmentAssignmentKind.Member;
        assignment.Department = Department.Finance;
        assignment.AccessProfileId = profile.Id;
        assignment.UpdatedAt = now;
        await db.SaveChangesAsync(ct);
        db.ChangeTracker.Clear();
    }

    /// <summary>
    /// 4-A (ADR-0035, block 3): the internal draft that values the approved services of an issuance, run alone in its
    /// own serializable transaction, so the valuation tests keep asserting packages, minimums and charges before ITBIS. A
    /// refusal rolls back and leaves no reservation; a concurrent reservation of the same services is a conflict.
    /// </summary>
    private static async Task<PreinvoiceDraftResult> ValuationDraftAsync(IServiceProvider services,
        CreatePreinvoiceDraftCommand command, CancellationToken ct)
    {
        var context = services.GetRequiredService<ElevantDbContext>();
        var drafts = services.GetRequiredService<EfPreinvoiceDraftStore>();
        var strategy = context.Database.CreateExecutionStrategy();
        try
        {
            return await strategy.ExecuteAsync(async () =>
            {
                context.ChangeTracker.Clear();
                await using var transaction = await context.Database.BeginTransactionAsync(IsolationLevel.Serializable, ct);
                var result = await drafts.DraftForInvoiceAsync(command, ct);
                if (result.IsSuccess)
                {
                    await transaction.CommitAsync(ct);
                    return result;
                }
                await transaction.RollbackAsync(ct);
                context.ChangeTracker.Clear();
                return result;
            });
        }
        catch (Exception exception) when (exception is DbUpdateException or RetryLimitExceededException or SqlException &&
            exception.GetBaseException() is SqlException { Number: 2601 or 2627 or 1205 or 1222 or 3960 })
        {
            context.ChangeTracker.Clear();
            return PreinvoiceDraftResult.Failed(PreinvoiceDraftFailure.Conflict);
        }
    }

    /// <summary>The total and the lines of an internal draft, as valued.</summary>
    private static async Task<(decimal Total, PreinvoiceLine[] Lines)> ValuationOfAsync(ElevantDbContext db, Guid draftId,
        CancellationToken ct)
    {
        var draft = await db.Preinvoices.AsNoTracking().SingleAsync(item => item.PublicId == draftId, ct);
        var lines = await db.PreinvoiceLines.AsNoTracking().Where(item => item.PreinvoiceId == draft.Id)
            .OrderBy(item => item.LineNumber).ToArrayAsync(ct);
        return (draft.Total, lines);
    }

    /// <summary>An amount as the Finance reports print it.</summary>
    private static string ReportMoney(decimal value) =>
        decimal.Round(value, 2, MidpointRounding.AwayFromZero).ToString("0.00", CultureInfo.InvariantCulture);
}
