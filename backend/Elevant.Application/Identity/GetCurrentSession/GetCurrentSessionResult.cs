namespace Elevant.Application.Identity.GetCurrentSession;

/// <summary>The safe outcome of resolving the current effective actor.</summary>
public sealed class GetCurrentSessionResult
{
    private GetCurrentSessionResult(ActorContext? actor)
    {
        Actor = actor;
    }

    public ActorContext? Actor { get; }

    public bool IsSuccess => Actor is not null;

    internal static GetCurrentSessionResult Succeeded(ActorContext actor)
    {
        ArgumentNullException.ThrowIfNull(actor);
        return new(actor);
    }

    internal static GetCurrentSessionResult InvalidSession() => new(null);
}
