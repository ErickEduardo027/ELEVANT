using Elevant.Domain.Entities.Operations;
using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Realtime;

namespace Elevant.Persistence.Operations;

/// <summary>Tracks a new message and its sender-side change in one unit of work.</summary>
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
}
