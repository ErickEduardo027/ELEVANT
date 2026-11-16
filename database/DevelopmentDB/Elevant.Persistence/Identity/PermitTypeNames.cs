using Elevant.Domain.Enumerations;
using Elevant.Infrastructure.Persistence;
using Microsoft.EntityFrameworkCore;

namespace Elevant.Persistence.Identity;

/// <summary>
/// The Spanish name of every permit type code (ADR-0045): the two system types and every custom type of
/// <c>ref.permit_document_types</c>, active or not, so a cycle or a requirement of a deactivated type keeps its name.
/// </summary>
internal static class PermitTypeNames
{
    /// <summary>What a code no catalog knows is called.</summary>
    public const string Fallback = "Permiso";

    public static async Task<IReadOnlyDictionary<string, string>> LoadAsync(ElevantDbContext context,
        CancellationToken cancellationToken)
    {
        var names = PermitDocumentTypes.System.ToDictionary(item => item.Code, item => item.Name, StringComparer.Ordinal);
        foreach (var type in await context.PermitTypeDefinitions.AsNoTracking()
                     .Select(item => new { item.Code, item.Name }).ToArrayAsync(cancellationToken))
            names.TryAdd(type.Code, type.Name);
        return names;
    }

    public static string Name(IReadOnlyDictionary<string, string> names, string code) =>
        names.TryGetValue(code, out var name) ? name : Fallback;
}
