using System.Text.Json;
using Elevant.Domain.Entities.Infrastructure;
using Elevant.Infrastructure.Persistence;

namespace Elevant.Persistence.Realtime;

/// <summary>Tracks a recipient-specific invalidation in the source command's transaction.</summary>
internal static class AccountChangeOutboxWriter
{
    private const string EventType = "account.changed.v1";
    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);

    public static void Add(
        ElevantDbContext context,
        long recipientAccountId,
        long? stationId,
        string resource,
        Guid resourceId,
        DateTimeOffset occurredAt)
    {
        ArgumentNullException.ThrowIfNull(context);
        var payload = new AccountChangeOutboxPayload(
            recipientAccountId, stationId, resource, resourceId);
        Validate(payload);
        context.OutboxMessages.Add(new OutboxMessage
        {
            PublicId = Guid.CreateVersion7(),
            OccurredAt = occurredAt.ToUniversalTime(),
            EventType = EventType,
            PayloadJson = JsonSerializer.Serialize(payload, JsonOptions),
        });
    }

    public static AccountChangeOutboxPayload Decode(OutboxMessage message)
    {
        ArgumentNullException.ThrowIfNull(message);
        if (message.EventType != EventType || message.PublicId == Guid.Empty)
            throw new InvalidDataException("The account change outbox event is invalid.");

        AccountChangeOutboxPayload? payload;
        try
        {
            payload = JsonSerializer.Deserialize<AccountChangeOutboxPayload>(
                message.PayloadJson, JsonOptions);
        }
        catch (JsonException exception)
        {
            throw new InvalidDataException("The account change outbox payload is invalid.", exception);
        }

        if (payload is null)
            throw new InvalidDataException("The account change outbox payload is empty.");
        Validate(payload);
        return payload;
    }

    private static void Validate(AccountChangeOutboxPayload payload)
    {
        if (payload.RecipientAccountId <= 0 ||
            payload.StationId is <= 0 ||
            payload.ResourceId == Guid.Empty ||
            string.IsNullOrEmpty(payload.Resource) ||
            payload.Resource.Length > 64 ||
            payload.Resource.Any(character => character is not
                (>= 'a' and <= 'z' or >= '0' and <= '9' or '_' or '-')))
        {
            throw new InvalidDataException("The account change outbox payload has invalid fields.");
        }
    }
}

internal sealed record AccountChangeOutboxPayload(
    long RecipientAccountId,
    long? StationId,
    string Resource,
    Guid ResourceId);
