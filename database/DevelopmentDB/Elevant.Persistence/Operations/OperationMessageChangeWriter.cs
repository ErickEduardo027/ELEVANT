using Elevant.Domain.Entities.Operations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;

namespace Elevant.Persistence.Operations;

/// <summary>
/// Tracks a new message and announces it, in the same unit of work, to every participant of the
/// thread: the sender, OCC of the station and the agents assigned to the operation (ADR-0029).
/// </summary>
internal static class OperationMessageChangeWriter
{
    public static OperationMessage Add(
        ElevantDbContext context,
        long operationId,
        long stationId,
        long senderAccountId,
        long? mobileDeviceId,
        Guid clientMessageId,
        string senderRole,
        string content,
        DateTimeOffset occurredAt)
    {
        var message = new OperationMessage
        {
            PublicId = Guid.CreateVersion7(),
            GroundOperationId = operationId,
            SenderAccountId = senderAccountId,
            MobileDeviceId = mobileDeviceId,
            ClientMessageId = clientMessageId,
            SenderRole = senderRole,
            Content = content,
            SentAt = occurredAt,
            CreatedAt = occurredAt,
            UpdatedAt = occurredAt,
        };
        context.OperationMessages.Add(message);
        AccountChangeOutboxWriter.Add(context, senderAccountId, stationId,
            "operation_messages", message.PublicId, occurredAt);
        return message;
    }

    /// <summary>Announces the message to the other participants: OCC of the station and the assigned agents.</summary>
    public static async Task AnnounceToParticipantsAsync(ElevantDbContext context, OperationMessage message,
        long stationId, CancellationToken cancellationToken)
    {
        var recipients = new HashSet<long>(await OperationalNotificationWriter.OccRecipientsAsync(context, stationId,
            message.SentAt, message.SenderAccountId, cancellationToken));
        recipients.UnionWith(await OperationalNotificationWriter.AssignedAgentRecipientsAsync(context, stationId,
            message.GroundOperationId, message.SentAt, message.SenderAccountId, cancellationToken));
        foreach (var recipient in recipients)
            AccountChangeOutboxWriter.Add(context, recipient, stationId, "operation_messages", message.PublicId,
                message.SentAt);
    }
}
