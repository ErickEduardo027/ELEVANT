using Elevant.Application.Operations;

namespace Elevant.UnitTests.Operations;

public sealed class OperationalPresenceTests
{
    private readonly Clock clock = new();
    private readonly Guid account = Guid.NewGuid();
    private readonly Guid client = Guid.NewGuid();

    [Fact]
    public void OpeningAConnectionWithoutActivityDoesNotInventActivePresence()
    {
        var registry = new OperationalPresenceRegistry(clock);
        Assert.Equal("unknown", registry.Read(account).State);
        Assert.True(registry.Write(account, new(client, 1, "foreground", false)));
        Assert.Equal("away", registry.Read(account).State);
        Assert.Null(registry.Read(account).LastActivityAt);
    }

    [Fact]
    public void HeartbeatsAndActivityHaveIndependentLifetimes()
    {
        var registry = new OperationalPresenceRegistry(clock);
        registry.Write(account, new(client, 1, "foreground", true));
        Assert.Equal("active", registry.Read(account).State);
        clock.Advance(TimeSpan.FromSeconds(90));
        Assert.Equal("offline", registry.Read(account).State);
        registry.Write(account, new(client, 2, "foreground", false));
        Assert.Equal("active", registry.Read(account).State);
        clock.Advance(TimeSpan.FromMinutes(4));
        registry.Write(account, new(client, 3, "foreground", false));
        Assert.Equal("away", registry.Read(account).State);
        Assert.NotNull(registry.Read(account).LastActivityAt);
    }

    [Fact]
    public void MultipleDevicesAndLatePacketsCannotResurrectAClosedLease()
    {
        var registry = new OperationalPresenceRegistry(clock);
        var other = Guid.NewGuid();
        registry.Write(account, new(client, 1, "foreground", true));
        registry.Write(account, new(other, 1, "background", false));
        registry.Write(account, new(client, 3, "closed", false));
        registry.Write(account, new(client, 2, "foreground", true));
        Assert.Equal("away", registry.Read(account).State);
        registry.Write(account, new(other, 2, "foreground", true));
        Assert.Equal("active", registry.Read(account).State);
        registry.Write(account, new(other, 3, "closed", false));
        Assert.Equal("offline", registry.Read(account).State);
        Assert.Equal("unknown", registry.Read(Guid.NewGuid()).State);
    }

    [Fact]
    public void RetentionAndRestartProduceUnknownRatherThanOffline()
    {
        var registry = new OperationalPresenceRegistry(clock);
        registry.Write(account, new(client, 1, "foreground", true));
        clock.Advance(TimeSpan.FromHours(24));
        Assert.Equal("unknown", registry.Read(account).State);
        Assert.Null(registry.Read(account).LastActivityAt);
        Assert.Equal("unknown", new OperationalPresenceRegistry(clock).Read(account).State);
    }

    [Fact]
    public void InvalidLeasesDoNotCreatePresence()
    {
        var registry = new OperationalPresenceRegistry(clock);
        Assert.False(registry.Write(Guid.Empty, new(client, 1, "foreground", true)));
        Assert.False(registry.Write(account, new(Guid.Empty, 1, "foreground", true)));
        Assert.False(registry.Write(account, new(client, -1, "foreground", true)));
        Assert.False(registry.Write(account, new(client, 1, "available", true)));
        Assert.Equal("unknown", registry.Read(account).State);
    }

    [Fact]
    public void ChosenAvailabilityIsPublishedOnlyWhileConnected()
    {
        var registry = new OperationalPresenceRegistry(clock);
        Assert.True(registry.SetStatus(account, new("busy", "  Atendiendo operaciones de Arajet  ")));
        Assert.Equal(new OwnPresence("unknown", "busy", "Atendiendo operaciones de Arajet"), registry.ReadOwn(account));
        Assert.Null(registry.Read(account).Availability);
        registry.Write(account, new(client, 1, "foreground", true));
        Assert.Equal("busy", registry.Read(account).Availability);
        Assert.Equal("Atendiendo operaciones de Arajet", registry.Read(account).Message);
        clock.Advance(TimeSpan.FromSeconds(90));
        Assert.Equal("offline", registry.Read(account).State);
        Assert.Null(registry.Read(account).Availability);
        Assert.True(registry.SetStatus(account, new(null, null)));
        Assert.Equal(new OwnPresence("offline", null, null), registry.ReadOwn(account));
    }

    [Fact]
    public void AppearOfflineHidesTheConnectionFromOthersButNotFromItsOwner()
    {
        var registry = new OperationalPresenceRegistry(clock);
        registry.Write(account, new(client, 1, "foreground", true));
        registry.SetStatus(account, new("appearOffline", null));
        var seen = registry.Read(account);
        Assert.Equal("offline", seen.State);
        Assert.Null(seen.LastActivityAt);
        Assert.Null(seen.Availability);
        Assert.Equal(new OwnPresence("active", "appearOffline", null), registry.ReadOwn(account));
        clock.Advance(TimeSpan.FromHours(24));
        Assert.Equal(new OwnPresence("unknown", null, null), registry.ReadOwn(account));
    }

    [Fact]
    public void InvalidStatusesAreRejected()
    {
        var registry = new OperationalPresenceRegistry(clock);
        Assert.False(registry.SetStatus(Guid.Empty, new("busy", null)));
        Assert.False(registry.SetStatus(account, new("active", null)));
        Assert.False(registry.SetStatus(account, new(null, new string('x', 81))));
        Assert.False(registry.SetStatus(account, new(null, "line\nbreak")));
        Assert.Equal(new OwnPresence("unknown", null, null), registry.ReadOwn(account));
    }

    private sealed class Clock : TimeProvider
    {
        private DateTimeOffset now = new(2026, 10, 30, 12, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => now;
        public void Advance(TimeSpan value) => now += value;
    }
}
