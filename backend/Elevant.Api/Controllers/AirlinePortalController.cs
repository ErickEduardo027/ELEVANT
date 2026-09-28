using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Commercial;
using Elevant.Contracts.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Exposes a tenant-scoped bootstrap for the airline portal.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/airline/portal")]
public sealed class AirlinePortalController(
    GetAirlinePortalBootstrapHandler bootstrapHandler,
    GetAirlineContractsHandler contractsHandler,
    GetAirlineOperationsHandler operationsHandler,
    GetAirlineOperationHandler operationHandler) : ControllerBase
{
    [HttpGet("operations/{operationId:guid}", Name = "GetAirlineOperation")]
    [ProducesResponseType<AirlinePortalOperationResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlinePortalOperationResponse>> GetOperation(
        Guid operationId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlinePortalOperationResponse>(
                StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await operationHandler.HandleAsync(
            accountId, operationId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == StatusCodes.Status401Unauthorized)
                Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlinePortalOperationResponse>(statusCode, title);
        }

        var operation = result.Operation!;
        return Ok(new AirlinePortalOperationResponse(operation.Id, operation.Code,
            operation.StationId, operation.StationCode, operation.OperationDate,
            operation.Status, operation.ArrivalFlightNumber,
            operation.DepartureFlightNumber, operation.PlannedStartAt,
            operation.PlannedEndAt));
    }

    [HttpGet("operations", Name = "GetAirlineOperations")]
    [ProducesResponseType<AirlineOperationPageResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlineOperationPageResponse>> GetOperations(
        [FromQuery] int page = 1, [FromQuery] int limit = 20,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || page > 10_000 || limit is < 1 or > 50)
            return ProblemResult<AirlineOperationPageResponse>(
                StatusCodes.Status400BadRequest, "Invalid operation page.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineOperationPageResponse>(
                StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await operationsHandler.HandleAsync(
            accountId, page, limit, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == StatusCodes.Status401Unauthorized)
                Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineOperationPageResponse>(statusCode, title);
        }

        return Ok(new AirlineOperationPageResponse(page, limit, result.Page!.HasMore,
            result.Page.Operations.Select(operation => new AirlinePortalOperationResponse(
                operation.Id, operation.Code, operation.StationId,
                operation.StationCode, operation.OperationDate, operation.Status,
                operation.ArrivalFlightNumber, operation.DepartureFlightNumber,
                operation.PlannedStartAt, operation.PlannedEndAt)).ToArray()));
    }

    [HttpGet("contracts", Name = "GetAirlineContracts")]
    [ProducesResponseType<AirlineContractPageResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlineContractPageResponse>> GetContracts(
        [FromQuery] int page = 1, [FromQuery] int limit = 20,
        CancellationToken cancellationToken = default)
    {
        if (page < 1 || page > 10_000 || limit is < 1 or > 50)
            return ProblemResult<AirlineContractPageResponse>(
                StatusCodes.Status400BadRequest, "Invalid contract page.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineContractPageResponse>(
                StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await contractsHandler.HandleAsync(
            accountId, page, limit, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == StatusCodes.Status401Unauthorized)
                Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineContractPageResponse>(statusCode, title);
        }

        return Ok(new AirlineContractPageResponse(page, limit, result.Page!.HasMore,
            result.Page.Contracts.Select(contract => new AirlineContractResponse(
                contract.Id, contract.Code, contract.Status, contract.SignedOn,
                contract.TerminatedOn, contract.ApprovedVersions.Select(version =>
                    new AirlineContractVersionResponse(
                        version.Id, version.VersionNumber, version.ValidFrom, version.ValidTo,
                        version.CurrencyCode, version.Stations.Select(station =>
                            new AirlineContractStationResponse(
                                station.Id, station.Code, station.Name)).ToArray(),
                        version.Rates.Select(rate => new AirlineContractRateResponse(
                            rate.Id, rate.ServiceCode, rate.ServiceName, rate.BillingUnit,
                            rate.UnitPrice, rate.MinimumQuantity)).ToArray())).ToArray()))
                .ToArray()));
    }

    [HttpGet("bootstrap", Name = "GetAirlinePortalBootstrap")]
    [ProducesResponseType<AirlinePortalBootstrapResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlinePortalBootstrapResponse>> GetBootstrap(
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlinePortalBootstrapResponse>(StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await bootstrapHandler.HandleAsync(accountId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == StatusCodes.Status401Unauthorized)
            {
                Response.Headers.WWWAuthenticate = "Bearer";
            }
            return ProblemResult<AirlinePortalBootstrapResponse>(statusCode, title);
        }

        var bootstrap = result.Bootstrap!;
        return Ok(new AirlinePortalBootstrapResponse(
            bootstrap.AirlineId,
            bootstrap.OrganizationId,
            bootstrap.IataCode,
            bootstrap.IcaoCode,
            bootstrap.Name,
            bootstrap.Stations.Select(station => new AirlinePortalStationResponse(
                station.Id,
                station.Code,
                station.Name,
                station.IanaTimeZone)).ToArray(),
            bootstrap.CurrentOperations.Select(operation => new AirlinePortalOperationResponse(
                operation.Id,
                operation.Code,
                operation.StationId,
                operation.StationCode,
                operation.OperationDate,
                operation.Status,
                operation.ArrivalFlightNumber,
                operation.DepartureFlightNumber,
                operation.PlannedStartAt,
                operation.PlannedEndAt)).ToArray()));
    }

    private static (int StatusCode, string Title) MapFailure(AirlinePortalFailure failure) => failure switch
    {
        AirlinePortalFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed."),
        AirlinePortalFailure.Forbidden => (StatusCodes.Status403Forbidden, "Airline portal access is forbidden."),
        AirlinePortalFailure.NotFound => (StatusCodes.Status404NotFound, "Airline portal context was not found."),
        _ => throw new InvalidOperationException("Unsupported airline portal failure."),
    };

    private ActionResult<T> ProblemResult<T>(int statusCode, string title) =>
        new ObjectResult(new ProblemDetails
        {
            Status = statusCode,
            Title = title,
            Instance = HttpContext.Request.Path,
        })
        {
            StatusCode = statusCode,
        };
}
