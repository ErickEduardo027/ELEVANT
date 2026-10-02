namespace Elevant.Persistence.Commercial;

// New uploads must be linked before the cleanup window. The one-day gap
// prevents a save from racing cleanup as an upload reaches its expiry.
internal static class CommercialMediaLinkPolicy
{
    internal static DateTimeOffset LinkCutoff(DateTimeOffset now) => now.AddDays(-6);

    internal static DateTimeOffset CleanupCutoff(DateTimeOffset now) => now.AddDays(-7);
}
