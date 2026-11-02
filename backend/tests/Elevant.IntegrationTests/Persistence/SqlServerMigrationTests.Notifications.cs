using Elevant.Application.Abstractions.Identity;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    private static readonly Guid OccAdministrator = Guid.Parse("40000000-0000-7000-8000-000000000001");
    private static readonly Guid HumanResourcesAdministrator = Guid.Parse("40000000-0000-7000-8000-000000000004");
    private static readonly Guid FinanceAdministrator = Guid.Parse("40000000-0000-7000-8000-000000000006");
    private static readonly Guid SuperAdministrator = Guid.Parse("40000000-0000-7000-8000-000000000007");

    /// <summary>Every alert kind the API raises, its department, the permission that opens its source, and who must get it.</summary>
    public static TheoryData<string, Department, string, string> NotificationKinds => new()
    {
        { "access_request", Department.HumanResources, "human_resources.access_requests.read", "hr" },
        { "requisition", Department.HumanResources, "human_resources.requisitions.read", "hr" },
        { "availability_request", Department.HumanResources, "human_resources.availability.read", "hr" },
        { "commercial_request", Department.Contracts, "contracts.requests.read", "contracts" },
        { "draft_comment", Department.Contracts, "contracts.drafts.read", "contracts" },
        { "service_closure", Department.Contracts, "contracts.service_closures.read", "contracts" },
        { "contract_signed", Department.Contracts, "contracts.agreements.read", "contracts" },
        { "permit_submitted", Department.Contracts, "contracts.permits.read", "contracts" },
        { "permit_expiring", Department.Contracts, "contracts.permits.read", "contracts" },
        { "contract_activated", Department.Contracts, "contracts.agreements.read", "contracts" },
        { "contract_suspended", Department.Contracts, "contracts.agreements.read", "contracts" },
        { "contract_expired", Department.Contracts, "contracts.agreements.read", "contracts" },
        { "contract_expiring", Department.Contracts, "contracts.agreements.read", "contracts" },
        { "contract_lifecycle", Department.Contracts, "contracts.agreements.read", "contracts" },
        { "contract_approval", Department.Finance, "finance.contract_approvals.read", "finance" },
        { "preinvoice_accepted", Department.Finance, "finance.preinvoices.read", "finance" },
        { "preinvoice_disputed", Department.Finance, "finance.preinvoices.read", "finance" },
    };

    [Theory]
    [MemberData(nameof(NotificationKinds))]
    public async Task EachAlertKindReachesOnlyItsDepartmentAndCanBeReadAndRaisedAgain(string kind, Department department,
        string sourcePermission, string recipient)
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using var provider = await SeededFinanceProviderAsync(database, ct);
        await using var scope = provider.CreateAsyncScope();
        var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
        var store = scope.ServiceProvider.GetRequiredService<IDepartmentNotificationStore>();
        var accounts = new Dictionary<string, Guid>
        {
            ["hr"] = HumanResourcesAdministrator, ["contracts"] = ContractsAdministrator, ["finance"] = FinanceAdministrator,
            ["occ"] = OccAdministrator, ["super"] = SuperAdministrator,
        };
        async Task<DepartmentNotificationData[]> AlertsAsync(Guid account) =>
            (await store.ListAsync(account, ct)).Value?.Notifications.Where(item => item.Kind == kind).ToArray() ?? [];

        var source = Guid.CreateVersion7();
        var outboxBefore = await context.OutboxMessages.CountAsync(ct);
        var first = DateTimeOffset.UtcNow.AddMinutes(-5);
        await DepartmentNotificationWriter.NotifyAsync(context, department, sourcePermission, kind, source, "Asunto de prueba", first, ct);
        await context.SaveChangesAsync(ct);

        var alert = Assert.Single(await AlertsAsync(accounts[recipient]));
        Assert.Equal((source, "Asunto de prueba", (DateTimeOffset?)null), (alert.SourceId, alert.Subject, alert.ReadAt));
        foreach (var other in accounts.Where(pair => pair.Key != recipient))
            Assert.Empty(await AlertsAsync(other.Value));
        // The change feed announces it so the bell re-reads at once.
        Assert.True(await context.OutboxMessages.CountAsync(ct) > outboxBefore);

        // Read, then raised again by the same source: one row, unread again, newer time.
        Assert.NotNull((await store.SetReadAsync(accounts[recipient], alert.Id, true, ct)).Value!.ReadAt);
        await DepartmentNotificationWriter.NotifyAsync(context, department, sourcePermission, kind, source, "Asunto nuevo", first.AddMinutes(3), ct);
        await context.SaveChangesAsync(ct);
        var again = Assert.Single(await AlertsAsync(accounts[recipient]));
        Assert.Equal((alert.Id, "Asunto nuevo", (DateTimeOffset?)null), (again.Id, again.Subject, again.ReadAt));
        Assert.True(again.OccurredAt > alert.OccurredAt);

        // Another account cannot mark it.
        Assert.False((await store.SetReadAsync(accounts[recipient == "hr" ? "finance" : "hr"], alert.Id, true, ct)).IsSuccess);

        // A station-scoped source skips recipients without that station.
        var recipientId = await context.Users.Where(user => user.PublicId == accounts[recipient]).Select(user => user.Id).SingleAsync(ct);
        var outside = await context.Stations.AsNoTracking().Where(station => !context.AccountStationScopes.Any(item =>
                item.AccountId == recipientId && item.StationId == station.Id && item.RevokedAt == null))
            .Select(station => (long?)station.Id).FirstOrDefaultAsync(ct);
        if (outside is { } station)
        {
            var scoped = Guid.CreateVersion7();
            await DepartmentNotificationWriter.NotifyAsync(context, department, sourcePermission, kind, scoped, null,
                DateTimeOffset.UtcNow, ct, station);
            await context.SaveChangesAsync(ct);
            Assert.DoesNotContain(await AlertsAsync(accounts[recipient]), item => item.SourceId == scoped);
        }
    }
}
