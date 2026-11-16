using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Operations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>
/// Stations of the platform (2-A), kept by the superadministrator: a database that was never seeded, like
/// Production, starts here. Every command takes an Idempotency-Key; updates also the version the caller saw.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/governance/stations")]
public sealed class StationCatalogController(IStationCatalogStore store) : ControllerBase
{
    [HttpGet(Name = "ListGovernanceStations")]
    [ProducesResponseType<StationCatalogData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    public async Task<IActionResult> List(CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        var catalog = await store.ListAsync(actorId, cancellationToken);
        return catalog is null
            ? MasterDataHttp.Coded(this, 403, "Solo el superadministrador gestiona las estaciones.", "forbidden")
            : Ok(catalog);
    }

    /// <summary>A new station; its code is the IATA code of its airport (a new airport needs its data).</summary>
    [HttpPost(Name = "CreateGovernanceStation")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<StationCatalogItemData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<StationCatalogItemData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Create([FromBody, BindRequired] CreateStationInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        return MasterDataHttp.Created(this, await store.CreateAsync(actorId, input, idempotencyKey, cancellationToken),
            "La estación");
    }

    /// <summary>Renames the station, changes its time zone while it has no history, deactivates or reactivates it.</summary>
    [HttpPut("{stationId:guid}", Name = "UpdateGovernanceStation")]
    [RequestSizeLimit(4096)]
    [Consumes("application/json")]
    [ProducesResponseType<StationCatalogItemData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> Update(Guid stationId, [FromBody, BindRequired] UpdateStationInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        return MasterDataHttp.Answer(this, await store.UpdateAsync(actorId, stationId, input, idempotencyKey, cancellationToken),
            "La estación");
    }
}

/// <summary>
/// OCC master data (2-A) under <c>operations.master_data.*</c>: terminals and stands of a station in scope and
/// the shared aircraft types. Something in use is never deactivated; nothing is deleted.
/// </summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/occ")]
public sealed class OccMasterDataController(IOccMasterDataStore store) : ControllerBase
{
    [HttpGet("master-data", Name = "GetOccMasterData")]
    [ProducesResponseType<OccMasterData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<IActionResult> Read([FromQuery, BindRequired] Guid stationId, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        return MasterDataHttp.Answer(this, await store.ReadAsync(actorId, stationId, cancellationToken), "La estación");
    }

    [HttpPost("terminals", Name = "CreateOccTerminal")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<MasterTerminalData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<MasterTerminalData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> CreateTerminal([FromBody, BindRequired] CreateTerminalInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        return MasterDataHttp.Created(this, await store.CreateTerminalAsync(actorId, input, idempotencyKey, cancellationToken),
            "La terminal");
    }

    [HttpPut("terminals/{terminalId:guid}", Name = "UpdateOccTerminal")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<MasterTerminalData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> UpdateTerminal(Guid terminalId, [FromBody, BindRequired] UpdateTerminalInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        return MasterDataHttp.Answer(this,
            await store.UpdateTerminalAsync(actorId, terminalId, input, idempotencyKey, cancellationToken), "La terminal");
    }

    [HttpPost("stands", Name = "CreateOccStand")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<MasterStandData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<MasterStandData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> CreateStand([FromBody, BindRequired] CreateStandInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        return MasterDataHttp.Created(this, await store.CreateStandAsync(actorId, input, idempotencyKey, cancellationToken),
            "La posición");
    }

    [HttpPut("stands/{standId:guid}", Name = "UpdateOccStand")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<MasterStandData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> UpdateStand(Guid standId, [FromBody, BindRequired] UpdateStandInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        return MasterDataHttp.Answer(this, await store.UpdateStandAsync(actorId, standId, input, idempotencyKey, cancellationToken),
            "La posición");
    }

    [HttpPost("aircraft-types", Name = "CreateOccAircraftType")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<MasterAircraftTypeData>(StatusCodes.Status201Created, "application/json")]
    [ProducesResponseType<MasterAircraftTypeData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> CreateAircraftType([FromBody, BindRequired] CreateAircraftTypeInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        return MasterDataHttp.Created(this, await store.CreateAircraftTypeAsync(actorId, input, idempotencyKey, cancellationToken),
            "El tipo de avión");
    }

    [HttpPut("aircraft-types/{aircraftTypeId:guid}", Name = "UpdateOccAircraftType")]
    [RequestSizeLimit(2048)]
    [Consumes("application/json")]
    [ProducesResponseType<MasterAircraftTypeData>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<IActionResult> UpdateAircraftType(Guid aircraftTypeId, [FromBody, BindRequired] UpdateAircraftTypeInput input,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey, CancellationToken cancellationToken)
    {
        if (!MasterDataHttp.TryActor(User, out var actorId)) return MasterDataHttp.Unauthenticated(this);
        return MasterDataHttp.Answer(this,
            await store.UpdateAircraftTypeAsync(actorId, aircraftTypeId, input, idempotencyKey, cancellationToken),
            "El tipo de avión");
    }
}

/// <summary>Problem Details of the master-data endpoints: a stable code and a Spanish title (2-A).</summary>
internal static class MasterDataHttp
{
    public static bool TryActor(ClaimsPrincipal user, out Guid actorId) =>
        Guid.TryParse(user.FindFirstValue(JwtRegisteredClaimNames.Sub), out actorId) && actorId != Guid.Empty;

    public static IActionResult Unauthenticated(ControllerBase controller)
    {
        controller.Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails
        {
            Status = 401, Title = "Authentication failed.", Instance = controller.HttpContext.Request.Path,
        }) { StatusCode = 401 };
    }

    /// <summary>201 for the first creation, 200 when the Idempotency-Key replays it.</summary>
    public static IActionResult Created<T>(ControllerBase controller, MasterDataResult<T> result, string subject)
        where T : class =>
        result.Failure is null
            ? new ObjectResult(result.Value) { StatusCode = result.Replayed ? 200 : 201 }
            : Failure(controller, result.Failure.Value, result.Code, subject);

    public static IActionResult Answer<T>(ControllerBase controller, MasterDataResult<T> result, string subject)
        where T : class =>
        result.Failure is null ? controller.Ok(result.Value) : Failure(controller, result.Failure.Value, result.Code, subject);

    public static ObjectResult Coded(ControllerBase controller, int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }

    private static ObjectResult Failure(ControllerBase controller, MasterDataFailure failure, string? code, string subject) =>
        failure switch
        {
            MasterDataFailure.Forbidden => Coded(controller, 403, "No tiene permiso para gestionar estos datos maestros.",
                code ?? "forbidden"),
            MasterDataFailure.NotFound => Coded(controller, 404, $"{subject} ya no existe o no está en su alcance.",
                code ?? "not_found"),
            MasterDataFailure.Invalid => Coded(controller, 400, "Los datos no son válidos.", code ?? "invalid_master_data"),
            _ => Coded(controller, 409, $"{subject} cambió o no admite este cambio. Vuelva a cargar los datos.",
                code ?? "version_conflict"),
        };
}
