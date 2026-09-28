using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Commercial;
using Elevant.Contracts.Commercial;
using Elevant.Contracts.Finance;
using Elevant.Application.Finance;
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
    GetAirlineOperationHandler operationHandler,
    GetAirlineOperationalRequestsHandler requestsHandler,
    GetAirlinePreinvoicesHandler preinvoicesHandler,
    AcceptAirlinePreinvoiceHandler acceptanceHandler,
    DisputeAirlinePreinvoiceHandler disputeHandler,
    GetNonFiscalInvoiceHandler invoiceReader) : ControllerBase
{
    [HttpGet("preinvoices/{preinvoiceId:guid}/invoice", Name = "GetAirlineInvoiceByPreinvoice")]
    [ProducesResponseType<NonFiscalInvoiceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<NonFiscalInvoiceResponse>> GetInvoice(
        Guid preinvoiceId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<NonFiscalInvoiceResponse>(401, "Authentication failed.");
        }
        var result = await invoiceReader.GetForAirlineAsync(
            accountId, preinvoiceId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == 401) Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<NonFiscalInvoiceResponse>(statusCode, title);
        }
        return Ok(NonFiscalInvoiceResponseMapper.Map(result.Invoice!));
    }

    [HttpGet("preinvoices/{preinvoiceId:guid}/disputes", Name = "GetAirlinePreinvoiceDisputes")]
    [ProducesResponseType<PreinvoiceDisputeListResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<PreinvoiceDisputeListResponse>> GetPreinvoiceDisputes(
        Guid preinvoiceId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<PreinvoiceDisputeListResponse>(401, "Authentication failed.");
        }
        var result = await preinvoicesHandler.HandleDisputesAsync(
            accountId, preinvoiceId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == 401) Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<PreinvoiceDisputeListResponse>(statusCode, title);
        }
        return Ok(new PreinvoiceDisputeListResponse(preinvoiceId,
            result.Disputes!.Select(item => new PreinvoiceDisputeResponse(
                item.Id, item.Subject, item.Description, item.CreatedAt, item.LineIds)).ToArray()));
    }

    [HttpPost("preinvoices/{preinvoiceId:guid}/dispute", Name = "DisputeAirlinePreinvoice")]
    [RequestSizeLimit(8192)]
    [Consumes("application/json")]
    [ProducesResponseType<DisputeAirlinePreinvoiceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<DisputeAirlinePreinvoiceResponse>> DisputePreinvoice(
        Guid preinvoiceId, [FromBody] DisputeAirlinePreinvoiceRequest request,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<DisputeAirlinePreinvoiceResponse>(
                StatusCodes.Status401Unauthorized, "Authentication failed.");
        }
        var result = await disputeHandler.HandleAsync(accountId, preinvoiceId,
            request.RequestId, request.Subject, request.Description,
            request.LineIds, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = result.Failure!.Value switch
            {
                DisputeAirlinePreinvoiceFailure.Unauthorized => (401, "Authentication failed."),
                DisputeAirlinePreinvoiceFailure.Forbidden => (403, "Airline access is forbidden."),
                DisputeAirlinePreinvoiceFailure.InvalidRequest => (400, "Invalid dispute request."),
                DisputeAirlinePreinvoiceFailure.NotFound => (404, "Preinvoice was not found."),
                DisputeAirlinePreinvoiceFailure.Conflict => (409, "Preinvoice state conflicts with dispute."),
                _ => throw new InvalidOperationException("Unsupported dispute failure."),
            };
            if (statusCode == StatusCodes.Status401Unauthorized)
                Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<DisputeAirlinePreinvoiceResponse>(statusCode, title);
        }
        return Ok(new DisputeAirlinePreinvoiceResponse(
            result.PreinvoiceId!.Value, result.DisputeId!.Value, "Disputed", result.Replayed));
    }

    [HttpPost("preinvoices/{preinvoiceId:guid}/accept", Name = "AcceptAirlinePreinvoice")]
    [RequestSizeLimit(1024)]
    [Consumes("application/json")]
    [ProducesResponseType<AcceptAirlinePreinvoiceResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    public async Task<ActionResult<AcceptAirlinePreinvoiceResponse>> AcceptPreinvoice(
        Guid preinvoiceId, [FromBody] AcceptAirlinePreinvoiceRequest request,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AcceptAirlinePreinvoiceResponse>(
                StatusCodes.Status401Unauthorized, "Authentication failed.");
        }
        var result = await acceptanceHandler.HandleAsync(
            accountId, preinvoiceId, request.RequestId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = result.Failure!.Value switch
            {
                AcceptAirlinePreinvoiceFailure.Unauthorized => (401, "Authentication failed."),
                AcceptAirlinePreinvoiceFailure.Forbidden => (403, "Airline access is forbidden."),
                AcceptAirlinePreinvoiceFailure.InvalidRequest => (400, "Invalid acceptance request."),
                AcceptAirlinePreinvoiceFailure.NotFound => (404, "Preinvoice was not found."),
                AcceptAirlinePreinvoiceFailure.Conflict => (409, "Preinvoice state conflicts with acceptance."),
                _ => throw new InvalidOperationException("Unsupported acceptance failure."),
            };
            if (statusCode == StatusCodes.Status401Unauthorized)
                Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AcceptAirlinePreinvoiceResponse>(statusCode, title);
        }
        return Ok(new AcceptAirlinePreinvoiceResponse(
            result.PreinvoiceId!.Value, "Accepted", result.Replayed));
    }

    [HttpGet("preinvoices/{preinvoiceId:guid}", Name = "GetAirlinePreinvoice")]
    [ProducesResponseType<AirlinePreinvoiceDetailResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlinePreinvoiceDetailResponse>> GetPreinvoice(
        Guid preinvoiceId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlinePreinvoiceDetailResponse>(
                StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await preinvoicesHandler.HandleDetailAsync(
            accountId, preinvoiceId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == StatusCodes.Status401Unauthorized)
                Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlinePreinvoiceDetailResponse>(statusCode, title);
        }

        var detail = result.Detail!;
        return Ok(new AirlinePreinvoiceDetailResponse(detail.Id,
            detail.StationId, detail.StationCode, detail.From, detail.To,
            detail.CurrencyCode, detail.Total, detail.Status, detail.CreatedAt,
            detail.Lines.Select(line => new AirlinePreinvoiceLineResponse(
                line.Id, line.OperationCode, line.OperationDate,
                line.ServiceCode, line.ServiceName, line.ExecutedQuantity,
                line.BillingUnit, line.UnitPrice, line.Amount)).ToArray()));
    }

    [HttpGet("preinvoices", Name = "GetAirlinePreinvoices")]
    [ProducesResponseType<AirlinePreinvoicePageResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlinePreinvoicePageResponse>> GetPreinvoices(
        [FromQuery] int page = 1, [FromQuery] int limit = 20,
        CancellationToken cancellationToken = default)
    {
        if (page is < 1 or > 10_000 || limit is < 1 or > 50)
            return ProblemResult<AirlinePreinvoicePageResponse>(
                StatusCodes.Status400BadRequest, "Invalid preinvoice page.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlinePreinvoicePageResponse>(
                StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await preinvoicesHandler.HandleAsync(
            accountId, page, limit, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == StatusCodes.Status401Unauthorized)
                Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlinePreinvoicePageResponse>(statusCode, title);
        }

        return Ok(new AirlinePreinvoicePageResponse(page, limit, result.Page!.HasMore,
            result.Page.Preinvoices.Select(item => new AirlinePreinvoiceResponse(
                item.Id, item.StationId, item.StationCode, item.From, item.To,
                item.CurrencyCode, item.Total, item.Status, item.CreatedAt)).ToArray()));
    }

    [HttpGet("requests", Name = "GetAirlineOperationalRequests")]
    [ProducesResponseType<AirlineOperationalRequestPageResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlineOperationalRequestPageResponse>> GetRequests(
        [FromQuery] int page = 1, [FromQuery] int limit = 20,
        CancellationToken cancellationToken = default)
    {
        if (page is < 1 or > 10_000 || limit is < 1 or > 50)
            return ProblemResult<AirlineOperationalRequestPageResponse>(
                StatusCodes.Status400BadRequest, "Invalid request page.");
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineOperationalRequestPageResponse>(
                StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await requestsHandler.HandleAsync(
            accountId, page, limit, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == StatusCodes.Status401Unauthorized)
                Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineOperationalRequestPageResponse>(statusCode, title);
        }

        return Ok(new AirlineOperationalRequestPageResponse(page, limit,
            result.Page!.HasMore, result.Page.Requests.Select(request =>
                new AirlineOperationalRequestResponse(request.Id, request.StationId,
                    request.StationCode, request.ServiceName, request.Description,
                    request.Status, request.RequestedAt, request.NeededAt,
                    request.OperationId, request.OperationCode, request.ResolvedAt))
                .ToArray()));
    }

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
