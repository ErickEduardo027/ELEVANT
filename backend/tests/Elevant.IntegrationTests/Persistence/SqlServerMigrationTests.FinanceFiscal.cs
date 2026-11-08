using System.Collections.Concurrent;
using System.Text;
using System.Text.Json;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Finance;
using Elevant.Application.Identity;
using Elevant.Domain.Entities.Commercial;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Finance;
using Elevant.Infrastructure.Persistence;
using Elevant.Infrastructure.Persistence.Seed;
using Elevant.Persistence.Finance;
using Microsoft.EntityFrameworkCore;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    [Fact]
    public async Task FinanceFiscalMissingTaxBlocksCreationWithoutDocumentOrIntent()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var invoice = await FiscalFixtureAsync(database, ct, configuredTax: false, taxRate: 20);
        var provider = new FiscalCountingProvider();
        await using var db = FiscalContext(database.ConnectionString);
        var store = new FinanceFiscalStore(db, new FiscalTestActors(invoice.Station), TimeProvider.System,
            new() { Mode = FiscalMode.LocalSimulation }, new FiscalTestArchive(), provider, new FinanceFiscalRejectCallbacks(), new FinanceFiscalArtifactBuilder());
        var result = await store.CreateAsync(FinanceAccount, new(Guid.NewGuid(), invoice.Invoice, FiscalSimulationOutcome.Accepted), ct);
        Assert.Equal(FinanceFiscalFailure.Invalid, result.Failure); Assert.False(result.IsSuccess); Assert.Null(result.DocumentId);
        Assert.Equal(0, await db.Set<FinanceFiscalDocument>().CountAsync(ct));
        Assert.Equal(0, await db.Set<FinanceFiscalIntent>().CountAsync(ct));
        Assert.Equal(0, await db.Set<FinanceFiscalArtifact>().CountAsync(ct));
        Assert.True(await db.Set<FinanceTaxPolicy>().AnyAsync(p => p.Status == FinanceTaxPolicyStatus.Published && p.Rate == 20, ct));
        Assert.Equal(0, provider.Calls);
    }

    [Fact]
    public async Task FinanceFiscalCanonicalUsesOnlyIssuedTaxAndCommercialSnapshotsAndAcceptanceIsStillSimulation()
    {
        var ct = TestContext.Current.CancellationToken; var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var fixture = await FiscalFixtureAsync(database, ct, taxRate: 20);
        string original;
        await using (var setup = FiscalContext(database.ConnectionString))
        {
            var invoice = await setup.NonFiscalInvoices.SingleAsync(i => i.PublicId == fixture.Invoice, ct);
            original = invoice.CommercialSnapshotJson!;
            var airline = await setup.Airlines.SingleAsync(a => a.Id == invoice.AirlineId, ct);
            var customer = await setup.Organizations.SingleAsync(o => o.Id == airline.OrganizationId, ct);
            customer.LegalName = "Current changed synthetic customer";
            var old = await setup.Set<FinanceTaxPolicy>().SingleAsync(ct);
            setup.Add(new FinanceTaxPolicy { PublicId = Guid.NewGuid(), AirlineId = old.AirlineId, StationId = old.StationId,
                CurrencyCode = old.CurrencyCode, ConceptKind = old.ConceptKind, ConceptCode = old.ConceptCode,
                Treatment = FinanceTaxTreatment.Taxable, Rate = 7, Basis = "Current changed synthetic policy",
                Status = FinanceTaxPolicyStatus.Published, ValidFrom = old.ValidFrom, ReplacesPolicyId = old.Id,
                CreatedByAccountId = old.CreatedByAccountId, CreatedAt = DateTimeOffset.UtcNow, UpdatedAt = DateTimeOffset.UtcNow });
            await setup.SaveChangesAsync(ct);
        }
        var archive = new FiscalTestArchive(); var provider = new FiscalCountingProvider();
        await using var db = FiscalContext(database.ConnectionString);
        var store = new FinanceFiscalStore(db, new FiscalTestActors(fixture.Station), TimeProvider.System,
            new() { Mode = FiscalMode.LocalSimulation }, archive, provider, new FinanceFiscalRejectCallbacks(), new FinanceFiscalArtifactBuilder());
        var input = new FiscalCreateInput(Guid.NewGuid(), fixture.Invoice, FiscalSimulationOutcome.Accepted);
        var created = await store.CreateAsync(FinanceAccount, input, ct); Assert.True(created.IsSuccess, created.Failure?.ToString());
        var detail = (await store.GetAsync(FinanceAccount, created.DocumentId!.Value, ct))!;
        using var canonical = JsonDocument.Parse(detail.CanonicalSnapshot); var root = canonical.RootElement;
        Assert.Equal(original, root.GetProperty("originalCommercialSnapshot").GetString());
        Assert.DoesNotContain("Current changed", detail.CanonicalSnapshot, StringComparison.Ordinal);
        var line = root.GetProperty("lines")[0]; Assert.Equal(100, line.GetProperty("net").GetDecimal());
        Assert.Equal(0, line.GetProperty("discount").GetDecimal()); Assert.Equal(20, line.GetProperty("tax").GetDecimal());
        Assert.Equal(120, line.GetProperty("gross").GetDecimal()); Assert.Equal(20, line.GetProperty("rate").GetDecimal());
        Assert.Equal("Taxable", line.GetProperty("treatment").GetString()); Assert.Equal("Synthetic frozen tax basis", line.GetProperty("basis").GetString());
        Assert.Equal(FinanceFiscalPolicy.Hash(detail.CanonicalSnapshot), detail.SnapshotHash);
        Assert.True((await store.CreateAsync(FinanceAccount, input, ct)).Replayed);
        Assert.True((await store.SimulateAsync(FinanceAccount, detail.Id, new(Guid.NewGuid(), detail.Version), ct)).IsSuccess);
        var accepted = (await store.GetAsync(FinanceAccount, detail.Id, ct))!;
        Assert.Equal("Accepted", accepted.State); Assert.Equal("LocalSimulation", accepted.Mode);
        Assert.Null(accepted.Encf); Assert.Null(accepted.DgiiResponseId); Assert.Equal(detail.CanonicalSnapshot, accepted.CanonicalSnapshot);
        Assert.Contains(FinanceFiscalPolicy.Disclaimer, accepted.CanonicalSnapshot, StringComparison.Ordinal);
        Assert.Equal(1, provider.Calls);
    }

    [Fact]
    public async Task FinanceFiscalPersistsBytesReplaysScopesCallbacksAndUnknownWithoutResend()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var invoice = await FiscalFixtureAsync(database, ct);
        var objects = new FiscalTestArchive();
        var simulator = new FiscalCountingProvider();
        var options = new FinanceFiscalOptions { Mode = FiscalMode.LocalSimulation };
        async Task<T> Run<T>(Func<IFinanceFiscalStore, Task<T>> action, FinanceFiscalOptions? config = null,
            FiscalTestActors? actor = null)
        {
            await using var db = FiscalContext(database.ConnectionString);
            return await action(new FinanceFiscalStore(db, actor ?? new(invoice.Station), TimeProvider.System,
                config ?? options, objects, simulator, new FiscalTestCallbackAuthenticator(), new FinanceFiscalArtifactBuilder()));
        }
        var input = new FiscalCreateInput(Guid.NewGuid(), invoice.Invoice, FiscalSimulationOutcome.Pending);
        Assert.Equal(FinanceFiscalFailure.Disabled, (await Run(s => s.CreateAsync(FinanceAccount, input, ct), new())).Failure);
        Assert.Equal(FinanceFiscalFailure.ProviderNotConfigured, (await Run(s => s.CreateAsync(FinanceAccount, input, ct),
            new() { Mode = FiscalMode.ProviderSandbox })).Failure);
        await using (var db = FiscalContext(database.ConnectionString))
            Assert.Equal(0, await db.Set<FinanceFiscalIntent>().CountAsync(ct));
        Assert.Equal(FinanceFiscalFailure.Forbidden, (await Run(s => s.CreateAsync(FinanceAccount, input, ct), actor: new(invoice.Station, false))).Failure);
        Assert.Equal(FinanceFiscalFailure.NotFound, (await Run(s => s.CreateAsync(FinanceAccount, input, ct), actor: new(Guid.NewGuid()))).Failure);
        var created = await Run(s => s.CreateAsync(FinanceAccount, input, ct));
        Assert.True(created.IsSuccess);
        var id = created.DocumentId!.Value;
        Assert.True((await Run(s => s.CreateAsync(FinanceAccount, input, ct))).Replayed);
        Assert.Equal(FinanceFiscalFailure.Conflict, (await Run(s => s.CreateAsync(FinanceAccount,
            input with { Outcome = FiscalSimulationOutcome.Accepted }, ct))).Failure);
        objects.FailWrites = true;
        var blockedInput = new FiscalSimulateInput(Guid.NewGuid(), created.Version!);
        var blocked = await Run(s => s.SimulateAsync(FinanceAccount, id, blockedInput, ct));
        Assert.Equal(FinanceFiscalFailure.ArchiveUnavailable, blocked.Failure);
        Assert.Equal(0, simulator.Calls);
        var detail = (await Run(s => s.GetAsync(FinanceAccount, id, ct)))!;
        Assert.Equal("ArchiveBlocked", detail.State);
        objects.FailWrites = false;
        var dispatch = new FiscalSimulateInput(Guid.NewGuid(), detail.Version);
        var sent = await Run(s => s.SimulateAsync(FinanceAccount, id, dispatch, ct));
        Assert.True(sent.IsSuccess);
        Assert.Equal(1, simulator.Calls);
        Assert.True((await Run(s => s.SimulateAsync(FinanceAccount, id, dispatch, ct))).Replayed);
        Assert.Equal(1, simulator.Calls);
        Assert.True((await Run(s => s.SimulateAsync(FinanceAccount, id, blockedInput, ct))).Replayed);
        Assert.Equal(1, simulator.Calls);
        detail = (await Run(s => s.GetAsync(FinanceAccount, id, ct)))!;
        Assert.Equal("Pending", detail.State);
        Assert.Equal("Complete", detail.ArtifactCompletion);
        Assert.Null(detail.Encf); Assert.Null(detail.DgiiResponseId);
        var canonical = Assert.Single(detail.Artifacts, a => a.Kind == "CanonicalJson");
        var content = await Run(s => s.DownloadAsync(FinanceAccount, id, canonical.Id, ct));
        Assert.Equal(Encoding.UTF8.GetBytes(detail.CanonicalSnapshot), content!.Bytes);
        Assert.Null(await Run(s => s.DownloadAsync(Guid.NewGuid(), id, canonical.Id, ct)));
        Assert.Null(await Run(s => s.GetAsync(FinanceAccount, id, ct), actor: new(Guid.NewGuid())));
        var bytes = Encoding.UTF8.GetBytes("  exact original callback bytes\r\n");
        var eventId = Guid.NewGuid();
        var callback = new FiscalCallbackInput("forged", bytes);
        Assert.Equal(FinanceFiscalFailure.Forbidden, (await Run(s => s.ApplyCallbackAsync(FinanceAccount, callback, ct))).Failure);
        FiscalTestCallbackAuthenticator.Next = new(id, "Development", eventId, 3, FiscalState.Accepted,
            detail.ProviderDocumentId, null, null);
        callback = new("synthetic-authenticated", bytes);
        Assert.True((await Run(s => s.ApplyCallbackAsync(FinanceAccount, callback, ct))).IsSuccess);
        Assert.True((await Run(s => s.ApplyCallbackAsync(FinanceAccount, callback, ct))).Replayed);
        Assert.Equal(FinanceFiscalFailure.Conflict, (await Run(s => s.ApplyCallbackAsync(FinanceAccount,
            callback with { OriginalBytes = Encoding.UTF8.GetBytes("changed original bytes") }, ct))).Failure);
        FiscalTestCallbackAuthenticator.Next = new(id, "Development", Guid.NewGuid(), 2, FiscalState.Rejected,
            detail.ProviderDocumentId, null, null);
        Assert.True((await Run(s => s.ApplyCallbackAsync(FinanceAccount, callback, ct))).IsSuccess);
        detail = (await Run(s => s.GetAsync(FinanceAccount, id, ct)))!;
        Assert.Equal("Accepted", detail.State);
        Assert.Contains(detail.History, e => e.Kind == "CallbackIgnored" && !e.Applied);
        var callbackArtifact = detail.Artifacts.First(a => a.Kind == "Callback");
        Assert.Equal(bytes, (await Run(s => s.DownloadAsync(FinanceAccount, id, callbackArtifact.Id, ct)))!.Bytes);
        await using (var db = FiscalContext(database.ConnectionString))
        {
            Assert.Equal(1, await db.Set<FinanceFiscalDocument>().CountAsync(ct));
            Assert.Equal(1, await db.Set<FinanceFiscalIntent>().CountAsync(ct));
            Assert.True(await db.AuditEntries.AnyAsync(a => a.Action.StartsWith("finance.fiscal."), ct));
            var frozen = await db.Set<FinanceFiscalDocument>().SingleAsync(ct);
            db.Entry(frozen).Property(d => d.Total).CurrentValue = 200m;
            await Assert.ThrowsAsync<InvalidOperationException>(() => db.SaveChangesAsync(ct));
        }
    }

    [Theory]
    [InlineData(FiscalSimulationOutcome.Timeout, false)]
    [InlineData(FiscalSimulationOutcome.Unknown, false)]
    [InlineData(FiscalSimulationOutcome.Pending, true)]
    public async Task FinanceFiscalUnknownDoesNotResendUnderReplayOrConcurrentDispatch(FiscalSimulationOutcome outcome, bool cancelledAfterClaim)
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection(); if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        var invoice = await FiscalFixtureAsync(database, ct);
        var archive = new FiscalTestArchive(); var provider = new FiscalCountingProvider { CancelOnSubmit = cancelledAfterClaim };
        async Task<FiscalResult> Run(Func<IFinanceFiscalStore, Task<FiscalResult>> action)
        {
            await using var db = FiscalContext(database.ConnectionString);
            return await action(new FinanceFiscalStore(db, new FiscalTestActors(invoice.Station), TimeProvider.System,
                new() { Mode = FiscalMode.LocalSimulation }, archive, provider, new FinanceFiscalRejectCallbacks(), new FinanceFiscalArtifactBuilder()));
        }
        var input = new FiscalCreateInput(Guid.NewGuid(), invoice.Invoice, outcome);
        var racedCreate = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Run(s => s.CreateAsync(FinanceAccount, input, ct))));
        var created = racedCreate.First(r => r.IsSuccess);
        Assert.Single(racedCreate.Select(r => r.DocumentId).Where(x => x.HasValue).Distinct());
        var requests = await Task.WhenAll(Enumerable.Range(0, 2).Select(_ => Run(s => s.SimulateAsync(FinanceAccount,
            created.DocumentId!.Value, new(Guid.NewGuid(), created.Version!), ct))));
        Assert.Equal(1, provider.Calls);
        Assert.Contains(requests, r => r.IsSuccess);
        await using var verify = FiscalContext(database.ConnectionString);
        var document = await verify.Set<FinanceFiscalDocument>().SingleAsync(ct);
        Assert.Equal(FiscalState.Unknown, document.State);
        Assert.Equal(FinanceFiscalFailure.Conflict, (await Run(s => s.SimulateAsync(FinanceAccount, document.PublicId,
            new(Guid.NewGuid(), Convert.ToBase64String(document.RowVersion)), ct))).Failure);
        Assert.Equal(1, provider.Calls);
    }

    private static ElevantDbContext FiscalContext(string connection) => new(new DbContextOptionsBuilder<ElevantDbContext>()
        .UseSqlServer(connection, ElevantSqlServerOptions.Configure).Options);

    // Exercise the reviewed shared migration chain; do not synthesize schema or suppress model drift.
    private static async Task<(Guid Invoice, Guid Station)> FiscalFixtureAsync(TemporaryDatabase database, CancellationToken ct,
        bool configuredTax = true, decimal taxRate = 0)
    {
        await using (var db = FiscalContext(database.ConnectionString))
            await db.Database.MigrateAsync(ct);
        await database.ConfigureDevelopmentSeederPermissionsAsync(ct);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var seed = new ElevantDbContext(new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(connection, ElevantSqlServerOptions.Configure).Options))
            await new DevelopmentDataSeeder(seed).SeedAsync(new DevelopmentAccountPasswords(InitialPasswords.AdminOcc,
                InitialPasswords.RampAgent, InitialPasswords.AirlineClient, InitialPasswords.HumanResources,
                InitialPasswords.Contracts, InitialPasswords.Finance, "Synthetic-SuperAdmin!789"), ct);
        await using var setup = FiscalContext(database.ConnectionString);
        var station = await setup.Stations.SingleAsync(s => s.Code == "PUJ", ct);
        var user = await setup.Users.SingleAsync(u => u.PublicId == FinanceAccount, ct);
        var airline = await setup.Airlines.FirstAsync(ct);
        var now = DateTimeOffset.UtcNow;
        var today = Elevant.Application.Common.BusinessCalendar.Today(now);
        var policy = new FinanceTaxPolicy { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id,
            CurrencyCode = "USD", ConceptKind = PreinvoiceLineKind.Adjustment, ConceptCode = "SIM-SERVICE",
            Treatment = FinanceTaxTreatment.Taxable, Rate = taxRate, Basis = "Synthetic frozen tax basis",
            Status = FinanceTaxPolicyStatus.Published, ValidFrom = today, CreatedByAccountId = user.Id, CreatedAt = now, UpdatedAt = now };
        setup.Add(policy);
        var pre = new Preinvoice { PublicId = Guid.NewGuid(), AirlineId = airline.Id, StationId = station.Id,
            CreatedByAccountId = user.Id, RequestId = Guid.NewGuid(), PayloadHash = new string('a', 64),
            From = today, To = today, CurrencyCode = "USD", Total = 100m, Status = PreinvoiceStatus.Invoiced,
            CreatedAt = now, UpdatedAt = now };
        setup.Add(pre); await setup.SaveChangesAsync(ct);
        var line = new PreinvoiceLine { PublicId = Guid.NewGuid(), PreinvoiceId = pre.Id, LineNumber = 1,
            Kind = PreinvoiceLineKind.Adjustment, AdjustmentReason = "Synthetic fiscal fixture", OperationCode = "SIM-OP",
            OperationDate = today, ServiceCode = "SIM-SERVICE", ServiceName = "Synthetic adjustment", ExecutedQuantity = 1m,
            BillingUnit = "operation", UnitPrice = 100m, Amount = 100m, CurrencyCode = "USD", CreatedAt = now, UpdatedAt = now };
        FinanceTaxCalculator.Capture(line, configuredTax ? policy : null, now);
        pre.Total = line.Amount;
        setup.Add(line); await setup.SaveChangesAsync(ct);
        var invoice = new NonFiscalInvoice { PublicId = Guid.NewGuid(), PreinvoiceId = pre.Id, AirlineId = pre.AirlineId,
            StationId = station.Id, IssuedByAccountId = user.Id, RequestId = Guid.NewGuid(), Number = "NF-" + Guid.NewGuid().ToString("N"),
            CurrencyCode = "USD", Total = line.Amount, NetTotal = line.NetAmount, DiscountTotal = line.DiscountAmount,
            TaxTotal = line.TaxAmount, TaxTreatmentsConfigured = configuredTax,
            CommercialSnapshotJson = JsonSerializer.Serialize(new { version = 1,
                issuer = new { legalName = "Synthetic frozen issuer", code = "SIM-ISSUER" },
                customer = new { legalName = "Synthetic frozen customer", code = "SIM-CUSTOMER" },
                currencyCode = "USD", net = line.NetAmount, discount = line.DiscountAmount, tax = line.TaxAmount, gross = line.Amount }),
            CreatedAt = now, UpdatedAt = now };
        setup.Add(invoice); await setup.SaveChangesAsync(ct);
        setup.Add(new NonFiscalInvoiceLine { PublicId = Guid.NewGuid(), InvoiceId = invoice.Id, PreinvoiceLineId = line.Id,
            LineNumber = 1, Kind = line.Kind, Reason = line.AdjustmentReason, OperationCode = "SIM-OP", OperationDate = Elevant.Application.Common.BusinessCalendar.Today(now),
            ServiceCode = "SIM-SERVICE", ServiceName = "Synthetic service", ExecutedQuantity = 1m, BillingUnit = "operation",
            UnitPrice = 100m, Amount = line.Amount, CurrencyCode = "USD", TaxTreatment = line.TaxTreatment,
            TaxPolicyPublicId = line.TaxPolicyPublicId, TaxRate = line.TaxRate, TaxBasis = line.TaxBasis,
            NetAmount = line.NetAmount, DiscountAmount = line.DiscountAmount, TaxAmount = line.TaxAmount,
            GrossAmount = line.GrossAmount, TaxCapturedAt = line.TaxCapturedAt, CreatedAt = now, UpdatedAt = now });
        await setup.SaveChangesAsync(ct);
        return (invoice.PublicId, station.PublicId);
    }

    private sealed class FiscalTestActors(Guid station, bool internalMember = true) : IActorContextResolver
    {
        public Task<ActorContext?> ResolveAsync(Guid id, CancellationToken cancellationToken = default) => Task.FromResult<ActorContext?>(
            id != FinanceAccount ? null : new(id, "synthetic@test.invalid", "Synthetic Finance", [],
                [new(Guid.NewGuid(), Guid.NewGuid(), "QA", "QA", OrganizationType.AviamOperator,
                    internalMember ? MembershipKind.InternalStaff : MembershipKind.AirlineClient)],
                [new(station, "PUJ")], new DepartmentAccess(DepartmentAssignmentKind.Member, Department.Finance,
                    new HashSet<string>(["finance.fiscal.read", "finance.fiscal.create", "finance.fiscal.simulate"]))));
    }
    private sealed class FiscalTestArchive : IFiscalArtifactArchive
    {
        private readonly ConcurrentDictionary<string, byte[]> bytes = new();
        public bool FailWrites { get; set; }
        public Task PutAsync(string key, byte[] content, CancellationToken cancellationToken = default)
        { if (FailWrites) throw new IOException("Synthetic archive failure"); bytes[key] = content.ToArray(); return Task.CompletedTask; }
        public Task<byte[]?> GetAsync(string key, CancellationToken cancellationToken = default) =>
            Task.FromResult(bytes.TryGetValue(key, out var value) ? value.ToArray() : null);
    }
    private sealed class FiscalCountingProvider : IFiscalProvider
    {
        private int calls; public int Calls => calls; public bool CancelOnSubmit { get; init; }
        public Task<FiscalProviderReply> SubmitAsync(FiscalProviderRequest request, CancellationToken cancellationToken = default)
        { Interlocked.Increment(ref calls); if (CancelOnSubmit) throw new OperationCanceledException("Synthetic provider cancellation");
          return new FinanceFiscalLocalSimulator().SubmitAsync(request, cancellationToken); }
    }
    private sealed class FiscalTestCallbackAuthenticator : IFiscalCallbackAuthenticator
    {
        public static FiscalAuthenticatedCallback? Next { get; set; }
        public Task<FiscalAuthenticatedCallback?> AuthenticateAsync(string environment, string credential, byte[] bytes,
            CancellationToken cancellationToken = default) => Task.FromResult(credential == "synthetic-authenticated" ? Next : null);
    }
}
