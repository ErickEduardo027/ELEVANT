using Elevant.Application.Abstractions.Identity;
using Elevant.Application.Abstractions.Integration;
using Elevant.Application.Abstractions.Operations;

namespace Elevant.Application.Integration.DemoFlights;

/// <summary>
/// The demo flights of the superadministrator (ADR-0041). Every request is checked in this order before the store
/// runs: the caller is the superadministrator (<c>forbidden</c>; the reads answer null); demo flights are on in this
/// environment (<c>demo_flights_unavailable</c>; the reads answer <c>enabled: false</c> with nothing to choose); the
/// command carries its Idempotency-Key and a request the rules accept (<c>invalid_demo_flight</c>).
/// </summary>
public sealed class DemoFlightHandler(IDemoFlightStore store, IActorContextResolver actors,
    DemoFlightAvailability availability, TimeProvider time)
{
    /// <summary>
    /// What the trigger form offers for the visit of <paramref name="query"/>, which
    /// <see cref="DemoFlightRules.OptionsQuery"/> built; null when the caller is not the superadministrator.
    /// </summary>
    public async Task<DemoFlightOptionsData?> OptionsAsync(Guid actorId, DemoFlightOptionsQuery query,
        CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(query);
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return null;
        return availability.Enabled
            ? await store.OptionsAsync(actorId, query, cancellationToken)
            : DemoFlightOptionsData.Disabled(time.GetUtcNow());
    }

    /// <summary>The recent demo flights; null when the caller is not the superadministrator.</summary>
    public async Task<DemoFlightListData?> ListAsync(Guid actorId, Guid? stationId,
        CancellationToken cancellationToken = default)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken)) return null;
        return availability.Enabled
            ? await store.ListAsync(actorId, stationId, cancellationToken)
            : DemoFlightListData.Disabled(time.GetUtcNow());
    }

    public async Task<MasterDataResult<DemoFlightData>> CreateAsync(Guid actorId, CreateDemoFlightCommand command,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(command);
        if (await RefusalAsync(actorId, idempotencyKey, cancellationToken) is { } refusal) return refusal;
        return DemoFlightRules.Normalize(command) is { } input
            ? await store.CreateAsync(actorId, input, idempotencyKey, cancellationToken)
            : Invalid(DemoFlightCodes.Invalid);
    }

    /// <summary>
    /// «Cancelar vuelo» or «Terminar demo»: <paramref name="intent"/> is the exact name of a
    /// <see cref="DemoFlightIntent"/>.
    /// </summary>
    public async Task<MasterDataResult<DemoFlightData>> CancelAsync(Guid actorId, Guid demoFlightId, string? intent,
        Guid idempotencyKey, CancellationToken cancellationToken = default)
    {
        if (await RefusalAsync(actorId, idempotencyKey, cancellationToken) is { } refusal) return refusal;
        return demoFlightId != Guid.Empty && DemoFlightRules.ParseIntent(intent) is { } parsed
            ? await store.CancelAsync(actorId, demoFlightId, parsed, idempotencyKey, cancellationToken)
            : Invalid(DemoFlightCodes.Invalid);
    }

    /// <summary>Why a command stops before its request is read, or null when it may go on.</summary>
    private async Task<MasterDataResult<DemoFlightData>?> RefusalAsync(Guid actorId, Guid idempotencyKey,
        CancellationToken cancellationToken)
    {
        if (!await IsSuperAdministratorAsync(actorId, cancellationToken))
            return MasterDataResult<DemoFlightData>.Failed(MasterDataFailure.Forbidden, "forbidden");
        if (!availability.Enabled)
            return MasterDataResult<DemoFlightData>.Failed(MasterDataFailure.Conflict, DemoFlightCodes.Unavailable);
        return idempotencyKey == Guid.Empty ? Invalid("idempotency_key_required") : null;
    }

    private async Task<bool> IsSuperAdministratorAsync(Guid actorId, CancellationToken cancellationToken) =>
        actorId != Guid.Empty &&
        (await actors.ResolveAsync(actorId, cancellationToken))?.EffectiveAccess?.IsSuperAdministrator == true;

    private static MasterDataResult<DemoFlightData> Invalid(string code) =>
        MasterDataResult<DemoFlightData>.Failed(MasterDataFailure.Invalid, code);
}
