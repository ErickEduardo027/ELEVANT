using Elevant.Domain.Entities.Infrastructure;
using Elevant.Domain.Entities.Operations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Operations;
using Elevant.Persistence.Realtime;
using Microsoft.EntityFrameworkCore;

namespace Elevant.IntegrationTests.Persistence;

public sealed class AccountChangeOutboxWriterTests
{
    private static readonly Guid ResourceId = Guid.Parse("848e5a30-145f-4ca0-bd9d-c40547ee5165");

    [Fact]
    public void TracksAccountHintWithoutMessageContent()
    {
        using var context = CreateContext();

        AccountChangeOutboxWriter.Add(
            context, 41, 8, "notifications", ResourceId,
            new DateTimeOffset(2026, 9, 26, 5, 0, 0, TimeSpan.Zero));

        var message = Assert.Single(context.ChangeTracker.Entries<OutboxMessage>()).Entity;
        Assert.NotEqual(Guid.Empty, message.PublicId);
        Assert.Equal("account.changed.v1", message.EventType);
        Assert.Null(message.ProcessedAt);
        Assert.Equal(0, message.AttemptCount);
        Assert.DoesNotContain("ramp chat secret", message.PayloadJson, StringComparison.Ordinal);
        var payload = AccountChangeOutboxWriter.Decode(message);
        Assert.Equal(41, payload.RecipientAccountId);
        Assert.Equal(8, payload.StationId);
        Assert.Equal("notifications", payload.Resource);
        Assert.Equal(ResourceId, payload.ResourceId);
    }

    [Fact]
    public void DecoderRejectsInvalidRecipientAndWrongEventType()
    {
        var message = new OutboxMessage
        {
            PublicId = Guid.NewGuid(),
            EventType = "account.changed.v1",
            PayloadJson = "{\"recipientAccountId\":0,\"stationId\":8,\"resource\":\"notifications\",\"resourceId\":\"848e5a30-145f-4ca0-bd9d-c40547ee5165\"}",
        };

        Assert.Throws<InvalidDataException>(() => AccountChangeOutboxWriter.Decode(message));
        message.EventType = "unrelated.event";
        Assert.Throws<InvalidDataException>(() => AccountChangeOutboxWriter.Decode(message));
    }

    [Fact]
    public void OperationalNotificationsTrackOneHintPerRecipient()
    {
        using var context = CreateContext();
        var occurredAt = new DateTimeOffset(2026, 9, 26, 5, 0, 0, TimeSpan.Zero);

        OperationalNotificationWriter.AddForRecipients(
            context, [41L, 42L], 8, 100, ResourceId, "occ_message", occurredAt);

        var notifications = context.ChangeTracker.Entries<OperationalNotification>()
            .Select(entry => entry.Entity).ToArray();
        var hints = context.ChangeTracker.Entries<OutboxMessage>()
            .Select(entry => AccountChangeOutboxWriter.Decode(entry.Entity)).ToArray();
        Assert.Equal(2, notifications.Length);
        Assert.Equal(2, hints.Length);
        Assert.Equal([41L, 42L], hints.Select(hint => hint.RecipientAccountId).Order());
        Assert.All(hints, hint =>
        {
            Assert.Equal(8, hint.StationId);
            Assert.Equal("notifications", hint.Resource);
        });
        Assert.Equivalent(
            notifications.Select(notification => notification.PublicId).Order(),
            hints.Select(hint => hint.ResourceId).Order());
    }

    [Fact]
    public void NewMessageTracksSenderHintWithoutContent()
    {
        using var context = CreateContext();
        var clientMessageId = Guid.Parse("f2b53f6e-4ff5-4f50-8c75-2d9b21a3d6cb");
        var occurredAt = new DateTimeOffset(2026, 9, 26, 5, 1, 0, TimeSpan.Zero);

        var message = OperationMessageChangeWriter.Add(
            context, 100, 8, 41, null, clientMessageId,
            "occ", "ramp chat secret", occurredAt);

        Assert.Equal(message, Assert.Single(context.ChangeTracker.Entries<OperationMessage>()).Entity);
        Assert.Equal(clientMessageId, message.ClientMessageId);
        var hint = Assert.Single(context.ChangeTracker.Entries<OutboxMessage>()).Entity;
        Assert.DoesNotContain(message.Content, hint.PayloadJson, StringComparison.Ordinal);
        var payload = AccountChangeOutboxWriter.Decode(hint);
        Assert.Equal(41, payload.RecipientAccountId);
        Assert.Equal(8, payload.StationId);
        Assert.Equal("operation_messages", payload.Resource);
        Assert.Equal(message.PublicId, payload.ResourceId);
    }

    private static ElevantDbContext CreateContext()
    {
        var options = new DbContextOptionsBuilder<ElevantDbContext>()
            .UseSqlServer(
                "Server=localhost;Initial Catalog=ElevantDevelopmentDb;Integrated Security=true;",
                ElevantSqlServerOptions.Configure)
            .Options;
        return new ElevantDbContext(options);
    }
}
