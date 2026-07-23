using Elevant.Domain.DomainEvents;
using Elevant.Domain.Entities;

namespace Elevant.UnitTests.Domain;

public sealed class EntityTests
{
    [Fact]
    public void DomainEventsCanBeRecordedAndCleared()
    {
        var entity = new TestEntity(Guid.NewGuid());
        var domainEvent = new TestDomainEvent();

        entity.Record(domainEvent);

        var recordedEvent = Assert.Single(entity.DomainEvents);
        Assert.Same(domainEvent, recordedEvent);

        entity.ClearDomainEvents();

        Assert.Empty(entity.DomainEvents);
    }

    private sealed class TestEntity(Guid id) : Entity<Guid>(id)
    {
        public void Record(IDomainEvent domainEvent) => RaiseDomainEvent(domainEvent);
    }

    private sealed record TestDomainEvent : IDomainEvent;
}
