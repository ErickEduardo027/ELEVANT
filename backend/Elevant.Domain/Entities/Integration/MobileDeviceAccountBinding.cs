namespace Elevant.Domain.Entities.Integration;

public sealed class MobileDeviceAccountBinding : Entity<long>
{
    public long MobileDeviceId { get; set; }

    public long AccountId { get; set; }

    public DateTimeOffset BoundAt { get; set; }

    public DateTimeOffset? UnboundAt { get; set; }
}
