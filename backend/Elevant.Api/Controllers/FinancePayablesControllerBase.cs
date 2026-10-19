using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Contracts.Finance;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;
using static Elevant.Api.Controllers.FinancePayablesContractMapper;
namespace Elevant.Api.Controllers;

public abstract class FinancePayablesControllerBase : ControllerBase
{
    protected Guid ActorId => Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var id) ? id : Guid.Empty;
    protected IActionResult Respond<T, TDto>(Elevant.Application.Finance.FinancePayablesResult<T> result, Func<T, TDto> map)
    {
        if (result.IsSuccess) return Ok(map(result.Value!));
        var status = result.Failure switch { "unauthorized" => 401, "forbidden" => 403, "not_found" => 404, "conflict" => 409, "unavailable" => 503, _ => 400 };
        if (status == 401) Response.Headers.WWWAuthenticate = "Bearer";
        return Problem(statusCode: status, title: result.Failure switch { "not_found" => "Resource not found.", "conflict" => "The version, command or balance conflicts with persisted data.",
            "forbidden" => "This action is not permitted.", "receipt_required" => "A private receipt is required before submission.", "unavailable" => "Attachment bytes are unavailable.", _ => "The request could not be completed." });
    }
    protected async Task<IActionResult> UploadAsync(IFinancePayablesStore store, Guid id, bool expense, Guid requestId,
        string expectedVersion, IFormFile file, CancellationToken ct)
    {
        if (file is null || file.Length is < 1 or > 8 * 1024 * 1024) return Problem(statusCode: 400, title: "Receipt size is invalid.");
        await using var input = file.OpenReadStream(); using var output = new MemoryStream(); await input.CopyToAsync(output, ct);
        return Respond(await store.UploadAttachmentAsync(ActorId, id, expense, requestId, expectedVersion, file.ContentType, output.ToArray(), ct), ToDto);
    }
    protected async Task<IActionResult> DownloadAsync(IFinancePayablesStore store, Guid id, bool expense, Guid attachmentId, CancellationToken ct)
    {
        var result = await store.DownloadAttachmentAsync(ActorId, id, expense, attachmentId, ct);
        if (!result.IsSuccess) return Respond(result, x => new { x.Sha256 });
        Response.Headers["X-Content-Type-Options"] = "nosniff"; Response.Headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
        Response.Headers["Cache-Control"] = "private, no-store";
        var data = result.Value!; return File(data.Bytes, data.ContentType, data.ContentType switch { "application/pdf" => "receipt.pdf", "image/png" => "receipt.png", _ => "receipt.jpg" });
    }
}
