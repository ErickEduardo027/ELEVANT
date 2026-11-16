using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Elevant.Api.Controllers;

/// <summary>
/// Problem Details of the simplified Finance (phase 4, block B): every refusal carries the stable <c>code</c> the
/// screens explain in Spanish. Titles stay in English and no client shows them, except the 410 of a retired route,
/// whose title names the way that replaced it. A 401 carries no code, like the other Finance controllers: the session
/// is renewed, never explained.
/// </summary>
internal static class FinanceResults
{
    public const string LegacyRouteRetiredCode = "legacy_finance_route_retired";
    public const string InvalidInvoiceQueryCode = "invalid_invoice_query";
    public const string InvalidHomeQueryCode = "invalid_finance_home_query";
    public const string UnknownReportCode = "unknown_finance_report";
    public const string InvalidExportFormatCode = "invalid_report_export_format";
    /// <summary>A Finance report's period or currency is not valid: the code the other reports answer (3-N13).</summary>
    public const string InvalidReportQueryCode = "invalid_report_query";

    public static ObjectResult Coded(ControllerBase controller, int status, string title, string code) =>
        GovernanceResults.Coded(controller, status, title, code);

    public static ObjectResult Unauthorized(ControllerBase controller)
    {
        controller.Response.Headers.WWWAuthenticate = "Bearer";
        return new ObjectResult(new ProblemDetails
        {
            Status = StatusCodes.Status401Unauthorized, Title = "Authentication failed.",
            Instance = controller.HttpContext.Request.Path,
        }) { StatusCode = StatusCodes.Status401Unauthorized, ContentTypes = { "application/problem+json" } };
    }

    public static ObjectResult Forbidden(ControllerBase controller, string title = "Finance access is forbidden.") =>
        Coded(controller, StatusCodes.Status403Forbidden, title, GovernanceResults.ForbiddenCode);

    public static ObjectResult NotFound(ControllerBase controller, string title) =>
        Coded(controller, StatusCodes.Status404NotFound, title, GovernanceResults.NotFoundCode);

    /// <summary>
    /// 4-N12: a legacy Finance write that bypassed «Por facturar», «Cobros» or the adjustment notes. An old client
    /// still reaching it learns the new way; nothing is read or written, whatever permissions the caller holds.
    /// </summary>
    public static ObjectResult LegacyRetired(ControllerBase controller, string title) =>
        Coded(controller, StatusCodes.Status410Gone, title, LegacyRouteRetiredCode);
}

/// <summary>
/// Answers a malformed query of a Finance read (a station that is not a GUID, a page that is not a number…) with a
/// coded 400 instead of the framework's uncoded validation problem. It runs before the <c>[ApiController]</c>
/// model-state filter (order −2000), so that filter never answers first.
/// </summary>
[AttributeUsage(AttributeTargets.Method)]
internal sealed class FinanceQueryProblemAttribute(string code) : Attribute, IActionFilter, IOrderedFilter
{
    public string Code { get; } = code;

    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (context.ModelState.IsValid || context.Controller is not ControllerBase controller) return;
        context.Result = FinanceResults.Coded(controller, StatusCodes.Status400BadRequest, "The query is invalid.", Code);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
