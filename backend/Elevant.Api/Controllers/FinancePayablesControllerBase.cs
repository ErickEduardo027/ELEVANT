using System.Security.Claims;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Finance;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.Filters;
using Microsoft.IdentityModel.JsonWebTokens;
using static Elevant.Api.Controllers.FinancePayablesContractMapper;
namespace Elevant.Api.Controllers;

[PayablesProblemDetails]
public abstract class FinancePayablesControllerBase : ControllerBase
{
    protected Guid ActorId => Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id) ? id : Guid.Empty;
    protected IActionResult Respond<T, TDto>(FinancePayablesResult<T> result, Func<T, TDto> map) =>
        result.IsSuccess ? Ok(map(result.Value!)) : Coded(result.Failure!);

    /// <summary>
    /// 4-N27: every refusal of suppliers, payables and expenses is Problem Details with a stable <c>code</c> whose status
    /// comes from <see cref="FinancePayablesProblems.StatusOf"/>. The clients explain the code; the title stays technical.
    /// </summary>
    protected internal ObjectResult Coded(string code)
    {
        var status = FinancePayablesProblems.StatusOf(code);
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        var problem = new ProblemDetails { Status = status, Title = TitleOf(code), Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }

    private static string TitleOf(string code) => code switch
    {
        FinancePayablesProblems.Unauthorized => "Authentication is required.",
        FinancePayablesProblems.Forbidden => "This action is not permitted.",
        FinancePayablesProblems.SegregationOfDuties => "Another person must approve or pay this document.",
        FinancePayablesProblems.NotFound => "Resource not found.",
        FinancePayablesProblems.VersionConflict => "The document changed after it was read.",
        FinancePayablesProblems.IdempotencyConflict => "The request id was already used with another body.",
        FinancePayablesProblems.ReceiptRequired => "A private receipt is required before submission.",
        FinancePayablesProblems.Unavailable => "Attachment bytes are unavailable.",
        _ when FinancePayablesProblems.StatusOf(code) == 409 => "The request conflicts with the document's current state.",
        _ => "The request could not be completed.",
    };

    protected async Task<IActionResult> UploadAsync(IFinancePayablesStore store, Guid id, bool expense, Guid requestId,
        string expectedVersion, IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length is < 1 or > 8 * 1024 * 1024) return Coded(FinancePayablesProblems.InvalidAttachment);
        await using var input = file.OpenReadStream(); using var output = new MemoryStream(); await input.CopyToAsync(output, ct);
        return Respond(await store.UploadAttachmentAsync(ActorId, id, expense, requestId, expectedVersion, file.ContentType, output.ToArray(), ct), ToDto);
    }
    protected async Task<IActionResult> DownloadAsync(IFinancePayablesStore store, Guid id, bool expense, Guid attachmentId, CancellationToken ct)
    {
        var result = await store.DownloadAttachmentAsync(ActorId, id, expense, attachmentId, ct);
        if (!result.IsSuccess) return Coded(result.Failure!);
        Response.Headers["X-Content-Type-Options"] = "nosniff"; Response.Headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
        Response.Headers["Cache-Control"] = "private, no-store";
        var data = result.Value!; return File(data.Bytes, data.ContentType, data.ContentType switch { "application/pdf" => "receipt.pdf", "image/png" => "receipt.png", _ => "receipt.jpg" });
    }
}

/// <summary>
/// 4-N27: a body, form or query the framework cannot bind (malformed JSON, a GUID that is not one, a missing file) is
/// answered with the module's coded 400 — <c>invalid_attachment</c> for an upload, <c>invalid</c> otherwise — before the
/// <c>[ApiController]</c> model-state filter (order −2000) answers an uncoded validation problem.
/// </summary>
[AttributeUsage(AttributeTargets.Class)]
internal sealed class PayablesProblemDetailsAttribute : Attribute, IActionFilter, IOrderedFilter
{
    public int Order => -3000;

    public void OnActionExecuting(ActionExecutingContext context)
    {
        if (context.ModelState.IsValid || context.Controller is not FinancePayablesControllerBase controller) return;
        var upload = context.ActionDescriptor.Parameters.Any(parameter => parameter.ParameterType == typeof(IFormFile));
        context.Result = controller.Coded(upload ? FinancePayablesProblems.InvalidAttachment : FinancePayablesProblems.Invalid);
    }

    public void OnActionExecuted(ActionExecutedContext context)
    {
    }
}
