using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Integration;
using Elevant.Application.Operations;
using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;

namespace Elevant.IntegrationTests.Persistence;

public sealed partial class SqlServerMigrationTests
{
    /// <summary>
    /// ADR-0029: a chat message reaches the other side in real time (not only the sender), the
    /// read cursor gives unread counts and «visto», and conversations name the assigned agent.
    /// </summary>
    [Fact]
    public async Task ChatReachesEveryParticipantWithUnreadCountsAndSeenMarks()
    {
        var ct = TestContext.Current.CancellationToken;
        var master = ResolveMasterConnection();
        if (master is null) return;
        await using var database = await TemporaryDatabase.CreateAsync(master, "Development", ct);
        await using (var migration = CreateContext(database.ConnectionString))
            await migration.Database.MigrateAsync(ct);
        await database.ConfigureDevelopmentSeederPermissionsAsync(ct);
        await using (var connection = await database.OpenAsDevelopmentSeederAsync(ct))
        await using (var seeder = CreateContext(connection))
            await new Elevant.Infrastructure.Persistence.Seed.DevelopmentDataSeeder(seeder).SeedAsync(InitialPasswords, ct);
        var occId = Guid.Parse("40000000-0000-7000-8000-000000000001");
        var agentId = Guid.Parse("40000000-0000-7000-8000-000000000002");
        var stationId = Guid.Parse("20000000-0000-7000-8000-000000000003");
        var operationId = Guid.Parse("70000000-0000-7000-8000-000000000005");
        var installationId = Guid.Parse("81000000-0000-7000-8000-000000000061");
        var occ = new OperationalAccess(occId, "occ", [stationId]);
        var agent = new OperationalAccess(agentId, "agent", [stationId]);
        await using var provider = CreateAuthenticationProvider(database.ConnectionString, new PasswordHashCounter());
        await using (var scope = provider.CreateAsyncScope())
            Assert.True((await scope.ServiceProvider.GetRequiredService<IMobileDeviceCommandStore>()
                .RegisterAsync(new MobileDeviceRegistrationWriteRequest(agentId, installationId, MobilePlatform.Android,
                    "1.2.3", "Realtime SQL test tablet", "Android 16"), ct)).IsSuccess);

        async Task<T> Store<T>(Func<IOperationalCommunicationStore, Task<T>> action)
        {
            await using var scope = provider.CreateAsyncScope();
            return await action(scope.ServiceProvider.GetRequiredService<IOperationalCommunicationStore>());
        }
        async Task<string[]> HintsFor(Guid accountId, string resource)
        {
            await using var scope = provider.CreateAsyncScope();
            var context = scope.ServiceProvider.GetRequiredService<ElevantDbContext>();
            var account = await context.Users.AsNoTracking().Where(user => user.PublicId == accountId)
                .Select(user => user.Id).SingleAsync(ct);
            return (await context.OutboxMessages.AsNoTracking().ToArrayAsync(ct))
                .Select(AccountChangeOutboxWriter.Decode)
                .Where(payload => payload.RecipientAccountId == account && payload.Resource == resource)
                .Select(payload => payload.ResourceId.ToString()).ToArray();
        }

        // The agent writes: OCC (not only the sender) gets the hint, and sees one unread message.
        var fromAgent = (await Store(store => store.SendMessageAsync(new SendOperationMessageCommand(agent, operationId,
            Guid.NewGuid(), installationId, "Avión bloqueado en A01"), ct))).Value!;
        Assert.Contains(fromAgent.Id.ToString(), await HintsFor(occId, "operation_messages"));
        var occList = (await Store(store => store.GetConversationsAsync(occ, stationId, ct))).Value!;
        var thread = Assert.Single(occList.Conversations, item => item.OperationId == operationId);
        Assert.Equal(1, thread.UnreadCount);
        Assert.False(string.IsNullOrWhiteSpace(thread.AgentName));
        Assert.Null(thread.OthersReadUpTo);

        // OCC answers: the agent gets the hint.
        var fromOcc = (await Store(store => store.SendMessageAsync(new SendOperationMessageCommand(occ, operationId,
            Guid.NewGuid(), null, "Recibido, vamos con el puente"), ct))).Value!;
        Assert.Contains(fromOcc.Id.ToString(), await HintsFor(agentId, "operation_messages"));

        // OCC reads up to its own reply: no unread left, and the agent sees «visto» up to that message.
        Assert.True((await Store(store => store.MarkReadAsync(occ, operationId, fromOcc.Id, ct))).IsSuccess);
        Assert.Equal(0, Assert.Single((await Store(store => store.GetConversationsAsync(occ, stationId, ct))).Value!
            .Conversations, item => item.OperationId == operationId).UnreadCount);
        var agentView = (await Store(store => store.GetMessagesAsync(agent, operationId, ct))).Value!;
        Assert.Equal(fromOcc.SentAt, agentView.OthersReadUpTo);
        Assert.Equal(1, Assert.Single((await Store(store => store.GetConversationsAsync(agent, stationId, ct))).Value!
            .Conversations, item => item.OperationId == operationId).UnreadCount);

        // The cursor only moves forward, and an unknown message is not found.
        Assert.True((await Store(store => store.MarkReadAsync(occ, operationId, fromAgent.Id, ct))).IsSuccess);
        Assert.Equal(fromOcc.SentAt, (await Store(store => store.GetMessagesAsync(agent, operationId, ct))).Value!.OthersReadUpTo);
        Assert.Equal(OperationalCommunicationFailure.NotFound,
            (await Store(store => store.MarkReadAsync(occ, operationId, Guid.NewGuid(), ct))).Failure);
    }
}
