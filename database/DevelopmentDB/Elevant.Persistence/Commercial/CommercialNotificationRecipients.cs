using Elevant.Infrastructure.Persistence;
using Elevant.Persistence.Identity;

namespace Elevant.Persistence.Commercial;

internal static class CommercialNotificationRecipients
{
    /// <summary>Active AVIAM staff that hold any of the department permissions.</summary>
    public static async Task<long[]> WithPermissionAsync(ElevantDbContext context,
        string permissionCode, CancellationToken cancellationToken) =>
        await DepartmentAccessQueries.AccountsWithPermissionAsync(context, permissionCode, cancellationToken);

    public static async Task<long[]> WithAnyPermissionAsync(ElevantDbContext context,
        IEnumerable<string> permissionCodes, CancellationToken cancellationToken)
    {
        var recipients = new SortedSet<long>();
        foreach (var code in permissionCodes)
            recipients.UnionWith(await DepartmentAccessQueries.AccountsWithPermissionAsync(context, code, cancellationToken));
        return recipients.ToArray();
    }
}
