using Elevant.Domain.DomainEvents;

namespace Elevant.Domain.Entities;

/// <summary>
/// Minimal base for entities that own an identity and collect domain events.
/// </summary>
/// <typeparam name="TId">The identity type selected by the concrete entity.</typeparam>
public abstract class Entity<TId>
    where TId : notnull
{
    private readonly List<IDomainEvent> _domainEvents = [];

    /// <summary>Initializes an entity that will receive its identity from persistence.</summary>
    protected Entity()
    {
    }

    protected Entity(TId id)
    {
        Id = id;
    }

    /// <summary>Gets the entity identity.</summary>
    public TId Id { get; protected set; } = default!;

    /// <summary>Gets the events raised since the entity was loaded or last cleared.</summary>
    public IReadOnlyCollection<IDomainEvent> DomainEvents => _domainEvents.AsReadOnly();

    /// <summary>Records a domain event for later dispatch by the application boundary.</summary>
    protected void RaiseDomainEvent(IDomainEvent domainEvent)
    {
        ArgumentNullException.ThrowIfNull(domainEvent);
        _domainEvents.Add(domainEvent);
    }

    /// <summary>Clears events after the persistence boundary has captured them.</summary>
    public void ClearDomainEvents() => _domainEvents.Clear();
}
