using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Operations;
using Elevant.Application.Operations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Operations;

/// <summary>Reference data a ramp agent's tablet reads (3-B): the active aircraft types of the shared catalog.</summary>
internal sealed class EfRampReferenceStore(ElevantDbContext context, IActorContextResolver actors) : IRampReferenceStore
{
    public async Task<IReadOnlyList<RampAircraftTypeData>?> ListAircraftTypesAsync(Guid actorId,
        CancellationToken cancellationToken = default)
    {
        var actor = await actors.ResolveAsync(actorId, cancellationToken);
        if (actor is null || actor.AccountId != actorId || !RampOperationsAccess.IsAuthorized(actor)) return null;
        return await context.AircraftTypes.AsNoTracking().Where(type => type.IsActive)
            .OrderBy(type => type.Manufacturer).ThenBy(type => type.Model).ThenBy(type => type.IcaoCode)
            .Select(type => new RampAircraftTypeData(type.PublicId, type.IcaoCode, type.IataCode, type.Manufacturer, type.Model))
            .ToArrayAsync(cancellationToken);
    }
}
