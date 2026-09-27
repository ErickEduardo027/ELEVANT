using System.Linq.Expressions;
using Elevant.Domain.Entities.Reference;

namespace Elevant.Persistence.Commercial;

internal static class PublicCommercialServiceVisibility
{
    // One predicate governs both what anonymous visitors see and what they may request.
    internal static readonly Expression<Func<ServiceDefinition, bool>> PublishedActive =
        service => service.IsActive && service.IsPublic;
}
