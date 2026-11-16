using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Commercial;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Route("api/v{version:apiVersion}/media")]
public sealed class CommercialMediaController(ICommercialMediaStore store) : ControllerBase
{
    [Authorize]
    [PrivateResponse]
    [HttpPost(Name = "UploadCommercialMedia")]
    [Consumes("multipart/form-data")]
    [RequestSizeLimit(26 * 1024 * 1024)]
    [ProducesResponseType<MediaAssetData>(StatusCodes.Status201Created, "application/json")]
    public async Task<IActionResult> Upload([FromForm] string purpose, IFormFile file,
        CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var actorId))
            return Unauthorized();
        if (file is null || file.Length == 0 || file.Length > 24 * 1024 * 1024)
            return Problem(statusCode: 400, title: "Invalid media file.");
        await using var content = file.OpenReadStream();
        var asset = await store.UploadAsync(actorId, purpose, file.ContentType, content,
            file.Length, cancellationToken);
        return asset is null ? Problem(statusCode: 400, title: "Media type, size or permission is invalid.")
            : StatusCode(StatusCodes.Status201Created, asset);
    }

    [AllowAnonymous]
    [HttpGet("{id:guid}", Name = "GetPublishedCommercialMedia")]
    public async Task<IActionResult> Get(Guid id, CancellationToken cancellationToken)
    {
        var actorId = Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var subject)
            ? subject : (Guid?)null;
        var asset = await store.GetReadableAsync(id, actorId, cancellationToken);
        if (asset is null) return NotFound();
        Response.Headers["X-Content-Type-Options"] = "nosniff";
        Response.Headers["Content-Security-Policy"] = "default-src 'none'; sandbox";
        Response.Headers["Accept-Ranges"] = "bytes";
        Response.Headers["Cache-Control"] = actorId.HasValue ? "private, no-store" : "public, max-age=300";

        long? start = null;
        long? end = null;
        if (Request.Headers.Range.Count > 0)
        {
            var range = Request.Headers.Range.ToString();
            var match = System.Text.RegularExpressions.Regex.Match(range, @"^bytes=(\d+)-(\d*)$");
            if (!match.Success || !long.TryParse(match.Groups[1].Value, out var first))
                return StatusCode(StatusCodes.Status416RangeNotSatisfiable);
            var last = match.Groups[2].Success && match.Groups[2].Length > 0 &&
                long.TryParse(match.Groups[2].Value, out var parsed) ? parsed : asset.Length - 1;
            if (first >= asset.Length || last < first)
                return StatusCode(StatusCodes.Status416RangeNotSatisfiable);
            start = first;
            end = Math.Min(last, asset.Length - 1);
            Response.Headers["Content-Range"] = $"bytes {start}-{end}/{asset.Length}";
            Response.StatusCode = StatusCodes.Status206PartialContent;
        }
        await using var stream = await store.OpenAsync(asset.ObjectKey, start, end, cancellationToken);
        Response.ContentType = asset.ContentType;
        Response.ContentLength = end is null ? asset.Length : end - start!.Value + 1;
        await stream.CopyToAsync(Response.Body, cancellationToken);
        return new EmptyResult();
    }
}
