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
    GetNonFiscalPaymentHandler paymentReader,
    GetAirlineInvoiceStatementHandler statementReader,
    GetAirlinePortalStandingHandler standingHandler) : ControllerBase
{
    /// <summary>
    /// Where the airline stands with AVIAM (2-N32, 2-N35): overall status, read-only when no contract covers a
    /// station today, the stations a contract in force covered or covers (all within the treasury scope) and why
    /// each contract that never activated is still waiting. The bootstrap keeps describing only what is in force today.
    /// </summary>
    [HttpGet("standing", Name = "GetAirlinePortalStanding")]
    [ProducesResponseType<AirlinePortalStandingResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlinePortalStandingResponse>> GetStanding(CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return CodedProblem<AirlinePortalStandingResponse>(StatusCodes.Status401Unauthorized,
                "La sesión expiró. Vuelva a iniciar sesión.", "unauthorized");
        }
        var result = await standingHandler.HandleAsync(accountId, cancellationToken);
        if (!result.IsSuccess)
        {
            if (result.Failure == AirlinePortalFailure.Unauthorized) Response.Headers.WWWAuthenticate = "Bearer";
            return result.Failure switch
            {
                AirlinePortalFailure.Unauthorized => CodedProblem<AirlinePortalStandingResponse>(
                    StatusCodes.Status401Unauthorized, "La sesión expiró. Vuelva a iniciar sesión.", "unauthorized"),
                AirlinePortalFailure.Forbidden => CodedProblem<AirlinePortalStandingResponse>(
                    StatusCodes.Status403Forbidden, "Su cuenta no tiene acceso al portal de la aerolínea.", "forbidden"),
                _ => CodedProblem<AirlinePortalStandingResponse>(StatusCodes.Status404NotFound,
                    "No se encontró la aerolínea de la sesión.", "not_found"),
            };
        }
        var standing = result.Standing!;
        return Ok(new AirlinePortalStandingResponse(standing.OrganizationId, standing.Status, standing.ReadOnly,
            standing.Stations.Select(station => new AirlinePortalStandingStationResponse(station.Id, station.Code,
                station.Name, station.IanaTimeZone, station.Current)).ToArray(),
            standing.Contracts.Select(contract => new AirlinePortalStandingContractResponse(contract.Id, contract.Code,
                contract.Status, contract.PendingReason, contract.VersionsAwaitingSignatures)).ToArray()));
    }

    [HttpGet("invoices/{invoiceId:guid}/statement", Name = "GetAirlineInvoiceStatement")]
    [ProducesResponseType<AirlineInvoiceStatementResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlineInvoiceStatementResponse>> GetStatement(
        Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineInvoiceStatementResponse>(401, "Authentication failed.");
        }
        var result = await statementReader.HandleAsync(accountId, invoiceId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == 401) Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineInvoiceStatementResponse>(statusCode, title);
        }
        var statement = result.Statement!;
        return Ok(new AirlineInvoiceStatementResponse(statement.InvoiceId, statement.Number, statement.PreinvoiceId,
            statement.CurrencyCode, statement.Total, statement.Paid, statement.Credited, statement.Balance,
            statement.IssuedAt, statement.DueDate, statement.Status, statement.DaysOverdue,
            statement.Lines.Select(line => new AirlineInvoiceStatementLineResponse(line.LineNumber, line.Kind,
                line.ParentLineNumber, line.OperationCode, line.OperationDate, line.ServiceCode, line.ServiceName,
                line.Quantity, line.BillingUnit, line.UnitPrice, line.Amount, line.Reason)).ToArray(),
            statement.Payments.Select(payment => new AirlineInvoiceStatementPaymentResponse(payment.Reference,
                payment.Method, payment.PaidOn, payment.Amount, payment.RecordedAt)).ToArray(),
            statement.CreditNotes.Select(note => new AirlineInvoiceStatementCreditNoteResponse(note.Number,
                note.Amount, note.Reason, note.IssuedAt)).ToArray()));
    }

    [HttpGet("invoices/{invoiceId:guid}/payment", Name = "GetAirlinePaymentByInvoice")]
    [ProducesResponseType<NonFiscalPaymentLookupResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<NonFiscalPaymentLookupResponse>> GetPayment(
        Guid invoiceId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<NonFiscalPaymentLookupResponse>(401, "Authentication failed.");
        }
        var result = await paymentReader.GetForAirlineAsync(
            accountId, invoiceId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == 401) Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<NonFiscalPaymentLookupResponse>(statusCode, title);
        }
        return Ok(NonFiscalPaymentResponseMapper.Map(result.Lookup!));
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

    [HttpGet("operations/{operationId:guid}/approved-evidence",
        Name = "GetAirlineApprovedOperationEvidence")]
    [ProducesResponseType<AirlineApprovedOperationEvidenceResponse>(
        StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    public async Task<ActionResult<AirlineApprovedOperationEvidenceResponse>> GetApprovedEvidence(
        Guid operationId, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var accountId))
        {
            Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineApprovedOperationEvidenceResponse>(
                StatusCodes.Status401Unauthorized, "Authentication failed.");
        }

        var result = await operationHandler.HandleEvidenceAsync(
            accountId, operationId, cancellationToken);
        if (!result.IsSuccess)
        {
            var (statusCode, title) = MapFailure(result.Failure!.Value);
            if (statusCode == StatusCodes.Status401Unauthorized)
                Response.Headers.WWWAuthenticate = "Bearer";
            return ProblemResult<AirlineApprovedOperationEvidenceResponse>(statusCode, title);
        }

        var evidence = result.Evidence!;
        return Ok(new AirlineApprovedOperationEvidenceResponse(
            evidence.OperationId, evidence.Available, evidence.ApprovedAt,
            evidence.ActualStartAt, evidence.ActualEndAt, evidence.IncidentCount,
            evidence.Services.Select(service => new AirlineApprovedServiceResponse(
                service.Id, service.Code, service.Name, service.Status,
                service.ContractedQuantity, service.ExecutedQuantity,
                service.BillingUnit)).ToArray()));
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

    /// <summary>A Problem Details with a Spanish title and a stable code (phase 2 convention).</summary>
    private ActionResult<T> CodedProblem<T>(int statusCode, string title, string code)
    {
        var problem = new ProblemDetails { Status = statusCode, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = statusCode };
    }

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
