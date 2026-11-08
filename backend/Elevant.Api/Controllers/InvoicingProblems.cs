using Elevant.Application.Finance;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;

namespace Elevant.Api.Controllers;

/// <summary>
/// Problem Details of invoicing (phase 4, block A): every refusal carries the stable <c>code</c> the screens explain in
/// Spanish, and the issuance keeps <c>reasons</c> with the same code for older clients. Titles stay in English; no
/// client shows them.
/// </summary>
internal static class InvoicingProblems
{
    public static ObjectResult Coded(ControllerBase controller, int status, string title, string? code,
        bool withReasons = false)
    {
        if (status == StatusCodes.Status401Unauthorized) controller.Response.Headers.WWWAuthenticate = "Bearer";
        var problem = new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path };
        if (code is not null)
        {
            problem.Extensions["code"] = code;
            if (withReasons) problem.Extensions["reasons"] = new[] { code };
        }
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }

    /// <summary>The status, title and fallback code of each invoicing failure.</summary>
    public static (int Status, string Title, string? Code) Of(IssueInvoiceFailure? failure) => failure switch
    {
        IssueInvoiceFailure.Unauthorized => (StatusCodes.Status401Unauthorized, "Authentication failed.", null),
        IssueInvoiceFailure.Forbidden => (StatusCodes.Status403Forbidden, "Invoicing is forbidden in this station.",
            InvoicingCodes.Forbidden),
        IssueInvoiceFailure.InvalidRequest => (StatusCodes.Status400BadRequest, "The invoicing request is invalid.",
            InvoicingCodes.InvalidRequest),
        IssueInvoiceFailure.NotFound => (StatusCodes.Status404NotFound, "An operation was not found in the station.",
            InvoicingCodes.NotFound),
        IssueInvoiceFailure.Conflict => (StatusCodes.Status409Conflict,
            "The operations changed, were already invoiced or the key was used with another request.",
            InvoicingCodes.StateChanged),
        _ => (StatusCodes.Status422UnprocessableEntity, "The operations cannot be invoiced as they stand.",
            InvoicingCodes.InvalidRequest),
    };
}

/// <summary>
/// Answers the model-binding failures of an invoicing controller (a missing or malformed Idempotency-Key, a reason
/// beyond its length, an unknown field, malformed JSON or query) with a coded 400 instead of the framework's uncoded
/// validation problem. It runs before the <c>[ApiController]</c> model-state filter (order −2000), so that filter
/// never answers first.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
internal sealed class InvoicingProblemDetailsAttribute : Attribute, IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (context.ModelState.IsValid || context.Controller is not ControllerBase controller) return;
        var failed = context.ModelState.Where(entry => entry.Value?.Errors.Count > 0)
            .Select(entry => entry.Key.TrimStart('$', '.')).ToArray();
        bool Failed(params string[] fields) => failed.Any(key =>
            fields.Any(field => string.Equals(key, field, StringComparison.OrdinalIgnoreCase)));
        var code = Failed("Idempotency-Key", "idempotencyKey") ? InvoicingCodes.IdempotencyKeyRequired
            // The reason of a no-charge closure takes 5 to 500 characters, whichever bound it breaks.
            : Failed("Reason") ? InvoicingCodes.ReasonRequired
            : HttpMethods.IsGet(context.HttpContext.Request.Method) ? InvoicingCodes.InvalidPendingQuery
            : InvoicingCodes.InvalidRequest;
        context.Result = InvoicingProblems.Coded(controller, StatusCodes.Status400BadRequest,
            "The invoicing request is invalid.", code);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
