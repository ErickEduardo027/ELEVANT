using System.Security.Claims;
using System.Text;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Abstractions.Finance;
using Elevant.Application.Abstractions.Identity;
using Elevant.Contracts.Finance;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/finance/fiscal-xml")]
public sealed class FinanceFiscalXmlValidationController(IOfficialEcfXmlValidator validator, IActorContextResolver actors) : ControllerBase
{
    private const int MaxXmlBytes = 2 * 1024 * 1024;
    private const int MaxBase64Characters = ((MaxXmlBytes + 2) / 3) * 4;
    // JSON escaping can take six bytes per original UTF-8 byte. The decoded
    // content has its own smaller hard limit; base64 uses less envelope space.
    private const int MaxJsonBytes = MaxXmlBytes * 6 + 4096;
    private static readonly UTF8Encoding StrictUtf8 = new(false, true);

    [HttpPost("validate")]
    [Consumes("application/json")]
    [RequestSizeLimit(MaxJsonBytes)]
    [ProducesResponseType<FinanceFiscalXmlValidationResponse>(StatusCodes.Status200OK)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge)]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status503ServiceUnavailable)]
    public async Task<ActionResult<FinanceFiscalXmlValidationResponse>> Validate(
        [FromBody] FinanceFiscalXmlValidationRequest request, CancellationToken cancellationToken)
    {
        if (!Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out var account) || account == Guid.Empty)
            return Failure(401, "Authentication failed.", "Unauthorized");
        var actor = await actors.ResolveAsync(account, cancellationToken);
        if (actor is null || !actor.HasPermission("finance.fiscal.read") || !actor.Memberships.Any(m =>
            m.OrganizationType == OrganizationType.AviamOperator && m.Kind == MembershipKind.InternalStaff))
            return Failure(403, "Fiscal XML validation access is forbidden.", "Forbidden");

        OfficialEcfDocumentType? type = request.DocumentType switch
        {
            "E31" => OfficialEcfDocumentType.E31,
            "E32" => OfficialEcfDocumentType.E32,
            "E33" => OfficialEcfDocumentType.E33,
            "E34" => OfficialEcfDocumentType.E34,
            _ => null,
        };
        if (type is null)
            return Failure(400, "Select E31, E32, E33 or E34.", "InvalidDocumentType");
        if ((request.XmlUtf8 is null) == (request.XmlBase64 is null))
            return Failure(400, "Provide exactly one XML representation: xmlUtf8 or xmlBase64.", "InvalidXmlInput");
        if (request.XmlUtf8?.Length > MaxXmlBytes || request.XmlBase64?.Length > MaxBase64Characters)
            return TooLarge();

        byte[] bytes;
        try
        {
            if (request.XmlUtf8 is not null)
            {
                if (StrictUtf8.GetByteCount(request.XmlUtf8) > MaxXmlBytes)
                    return TooLarge();
                bytes = StrictUtf8.GetBytes(request.XmlUtf8);
            }
            else
            {
                bytes = Convert.FromBase64String(request.XmlBase64!);
                if (bytes.Length > MaxXmlBytes)
                    return TooLarge();
                _ = StrictUtf8.GetCharCount(bytes); // Reject invalid UTF-8, retaining original bytes.
            }
        }
        catch (Exception exception) when (exception is EncoderFallbackException or DecoderFallbackException or FormatException)
        {
            return Failure(400, "Provide XML as valid UTF-8 text or base64 of UTF-8 bytes.", "InvalidXmlEncoding");
        }
        if (bytes.Length == 0)
            return Failure(400, "XML content is required.", "InvalidXmlInput");
        if (bytes.Contains((byte)0))
            return Failure(400, "The XML input must be UTF-8.", "InvalidXmlEncoding");

        cancellationToken.ThrowIfCancellationRequested();
        OfficialEcfXmlValidationResult result;
        try
        {
            result = validator.Validate(type.Value, bytes);
        }
        catch (InvalidOperationException)
        {
            // Resource/compilation configuration failure. Never echo its details
            // or uploaded XML, persist the upload, or infer schema success.
            return Failure(503, "Official XML validation is temporarily unavailable.", "SchemaUnavailable");
        }

        return Ok(new FinanceFiscalXmlValidationResponse(result.SchemaId, result.SchemaVersion, result.SchemaSha256,
            result.SchemaValidation.ToString(), result.IsStructurallyValid,
            result.StructuralErrors.Select(e => new FinanceFiscalXmlValidationErrorResponse(e.Code, e.Message, e.LineNumber, e.LinePosition)).ToArray(),
            result.SignatureElementPresent, result.CryptographicValidation.ToString(), "NotPerformed"));
    }

    private ObjectResult TooLarge() => Failure(413, "Decoded XML must not exceed 2 MiB.", "DocumentTooLarge");

    private ObjectResult Failure(int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return StatusCode(status, problem);
    }
}
