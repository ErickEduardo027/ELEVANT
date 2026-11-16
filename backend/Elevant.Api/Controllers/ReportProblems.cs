using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Elevant.Api.Controllers;

/// <summary>
/// Problem Details of the OCC and Gestión Humana reports (phase 3, block E, 3-N13): a Spanish title and the stable
/// <c>code</c> the screens translate. A malformed or out-of-range query is 400 <c>invalid_report_query</c>, an unknown
/// report 404 <c>report_not_found</c>, a station outside the caller's scope or no longer active 404
/// <c>station_unavailable</c>, and an export over its row limit 422 <c>report_too_large</c>: the file is never cut. A
/// 401 or a refused permission (403) carries no code. Titles are Spanish; the screens never show them.
/// </summary>
internal static class ReportProblems
{
    public const string InvalidQueryCode = "invalid_report_query";
    public const string NotFoundCode = "report_not_found";
    public const string StationUnavailableCode = "station_unavailable";
    public const string TooLargeCode = "report_too_large";

    public static ObjectResult Coded(ControllerBase controller, int status, string code)
    {
        var problem = new ProblemDetails
        {
            Status = status, Title = TitleOf(code), Instance = controller.HttpContext.Request.Path,
        };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }

    /// <summary>400 <c>invalid_report_query</c>: the period, the page, the format or a filter is not valid.</summary>
    public static ObjectResult InvalidQuery(ControllerBase controller) =>
        Coded(controller, StatusCodes.Status400BadRequest, InvalidQueryCode);

    /// <summary>404 <c>report_not_found</c>: the catalog has no report with that key.</summary>
    public static ObjectResult NotFound(ControllerBase controller) =>
        Coded(controller, StatusCodes.Status404NotFound, NotFoundCode);

    /// <summary>404 <c>station_unavailable</c>: the station is outside the caller's scope or no longer active.</summary>
    public static ObjectResult StationUnavailable(ControllerBase controller) =>
        Coded(controller, StatusCodes.Status404NotFound, StationUnavailableCode);

    /// <summary>422 <c>report_too_large</c>: the export would exceed its row limit; nothing is rendered or audited.</summary>
    public static ObjectResult TooLarge(ControllerBase controller) =>
        Coded(controller, StatusCodes.Status422UnprocessableEntity, TooLargeCode);

    private static string TitleOf(string code) => code switch
    {
        InvalidQueryCode => "La consulta del reporte no es válida.",
        NotFoundCode => "El reporte no existe.",
        StationUnavailableCode => "La estación no está disponible para esta cuenta.",
        TooLargeCode => "El reporte supera el máximo de filas exportables: acote el período o los filtros.",
        _ => "No se pudo generar el reporte.",
    };
}

/// <summary>
/// Answers the model-binding failures of a report controller (a missing station, a malformed date, a missing format)
/// with 400 <c>invalid_report_query</c> instead of the framework's uncoded validation problem. It runs before the
/// <c>[ApiController]</c> model-state filter (order −2000), so that filter never answers first.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
internal sealed class ReportProblemDetailsAttribute : Attribute, IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (!context.ModelState.IsValid && context.Controller is ControllerBase controller)
            context.Result = ReportProblems.InvalidQuery(controller);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
