namespace Elevant.Domain.Entities.Identity;

public sealed class AccountStationScope : Entity<long>
{
    public long AccountId { get; set; }

    public long StationId { get; set; }

    public DateTimeOffset GrantedAt { get; set; }

    public DateTimeOffset? RevokedAt { get; set; }
}
