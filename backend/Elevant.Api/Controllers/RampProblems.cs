using Elevant.Application.Operations;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Elevant.Api.Controllers;

/// <summary>
/// Problem Details of the ramp (tablet) controllers with a stable <c>code</c> the tablet explains (phase 3, blocks B and
/// C). The deployed APK ignores a code it does not know and keeps explaining the failure by its status, so a coded
/// failure keeps the status the old one had: 400 <c>invalid_ramp_command</c>, 404 <c>not_found</c> and 409 with the
/// rule the command broke, <c>idempotency_conflict</c> for a reused key or <c>ramp_operation_state_conflict</c>. A
/// 401 or a 403 carries no code. Titles are Spanish; the screens never show them.
/// </summary>
internal static class RampProblems
{
    public static ObjectResult Coded(ControllerBase controller, int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }

    /// <summary>
    /// The coded Problem Details of a refused ramp command: <c>code</c> is the rule a 409 broke (or the reason a 400 is
    /// invalid); null uses the status's default code.
    /// </summary>
    public static ObjectResult Failure(ControllerBase controller, RampOperationsFailure failure, string? code = null)
    {
        switch (failure)
        {
            case RampOperationsFailure.Unauthorized:
                controller.Response.Headers.WWWAuthenticate = "Bearer";
                return Uncoded(controller, StatusCodes.Status401Unauthorized, "Autenticación fallida.");
            case RampOperationsFailure.Forbidden:
                return Uncoded(controller, StatusCodes.Status403Forbidden, "La cuenta no tiene acceso a las operaciones de rampa.");
            case RampOperationsFailure.InvalidRequest:
                return Coded(controller, StatusCodes.Status400BadRequest, TitleOf(code ?? RampProblemCodes.InvalidCommand),
                    code ?? RampProblemCodes.InvalidCommand);
            case RampOperationsFailure.NotFound:
                return Coded(controller, StatusCodes.Status404NotFound, TitleOf(RampProblemCodes.NotFound),
                    RampProblemCodes.NotFound);
            default:
                var rule = code ?? RampProblemCodes.StateConflict;
                return Coded(controller, StatusCodes.Status409Conflict, TitleOf(rule), rule);
        }
    }

    /// <summary>A model-binding failure (missing header, unknown field, malformed JSON) of a ramp command.</summary>
    public static ObjectResult InvalidCommand(ControllerBase controller) =>
        Failure(controller, RampOperationsFailure.InvalidRequest);

    private static ObjectResult Uncoded(ControllerBase controller, int status, string title) =>
        new(new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path })
            { StatusCode = status };

    private static string TitleOf(string code) => code switch
    {
        RampProblemCodes.InvalidCommand => "La solicitud de rampa no es válida.",
        RampProblemCodes.NotFound => "La operación de rampa no existe o ya no está asignada a esta cuenta.",
        RampProblemCodes.IdempotencyConflict => "La clave de idempotencia ya se usó con otro contenido.",
        RampProblemCodes.TimeOutsideOperationWindow => "La hora queda fuera de la ventana de la operación.",
        RampProblemCodes.MilestoneOutOfOrder => "El bloqueo debe ser anterior al push-back.",
        RampProblemCodes.ServiceTimeOutOfOrder => "La hora es anterior a la última transición del servicio.",
        "contract_not_in_force" => "El contrato de la aerolínea no está vigente: la operación no puede iniciar.",
        RampExecutionCodes.AircraftTypeUnavailable => "El tipo de avión ya no está disponible.",
        RampExecutionCodes.AircraftTypeLocked => "El tipo de avión ya no se puede cambiar: la operación ya se entregó.",
        CharterCodes.PrepaymentConfirmed => "El prepago del charter está confirmado: Finanzas debe reabrir la cotización.",
        _ => "La operación cambió y no admite este registro en su estado actual.",
    };
}

/// <summary>
/// Answers the model-binding failures of a ramp controller (a missing header, an unknown field, malformed JSON) with
/// 400 <c>invalid_ramp_command</c> instead of the framework's uncoded validation problem. It runs before the
/// <c>[ApiController]</c> model-state filter (order −2000), so that filter never answers first.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
internal sealed class RampProblemDetailsAttribute : Attribute, IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (!context.ModelState.IsValid && context.Controller is ControllerBase controller)
            context.Result = RampProblems.InvalidCommand(controller);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
