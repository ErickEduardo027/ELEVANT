using System.Security.Claims;
using Asp.Versioning;
using Elevant.Api.Configuration;
using Elevant.Application.Operations;
using Elevant.Application.Operations.GetRampOperationChecklist;
using Elevant.Application.Operations.SubmitRampOperationChecklist;
using Elevant.Contracts.Operations;
using Elevant.Domain.Enumerations;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.AspNetCore.Mvc.ModelBinding;
using Microsoft.IdentityModel.JsonWebTokens;

namespace Elevant.Api.Controllers;

/// <summary>Reads and submits the authenticated ramp agent's operation checklist.</summary>
[ApiController]
[ApiVersion("1.0")]
[Authorize]
[PrivateResponse]
[Route("api/v{version:apiVersion}/ramp/operations")]
public sealed class RampOperationChecklistsController(
    GetRampOperationChecklistHandler getHandler,
    SubmitRampOperationChecklistHandler submitHandler) : ControllerBase
{
    private const long ChecklistSubmissionBodyLimitBytes = 512 * 1024;

    /// <summary>Returns the canonical checklist assigned to one accessible operation.</summary>
    [HttpGet("{operationId:guid}/checklist", Name = "GetRampOperationChecklist")]
    [ProducesResponseType<GetRampOperationChecklistResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<GetRampOperationChecklistResponse>> GetChecklist(
        [FromRoute] Guid operationId,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            return UnauthorizedResult<GetRampOperationChecklistResponse>();
        }

        var result = await getHandler.HandleAsync(
            new GetRampOperationChecklistQuery(accountId, operationId),
            cancellationToken);
        if (!result.IsSuccess)
        {
            return FailureResult<GetRampOperationChecklistResponse>(result.Failure!.Value);
        }

        return Ok(Map(result.Checklist!));
    }

    /// <summary>Atomically submits every answer in one operation checklist.</summary>
    [RequestSizeLimit(ChecklistSubmissionBodyLimitBytes)]
    [HttpPost("{operationId:guid}/checklist/submit", Name = "SubmitRampOperationChecklist")]
    [Consumes("application/json")]
    [ProducesResponseType<RampChecklistSubmissionResponse>(StatusCodes.Status200OK, "application/json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status400BadRequest, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status401Unauthorized, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status403Forbidden, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status404NotFound, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status409Conflict, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status413PayloadTooLarge, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status415UnsupportedMediaType, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status429TooManyRequests, "application/problem+json")]
    [ProducesResponseType<ProblemDetails>(StatusCodes.Status500InternalServerError, "application/problem+json")]
    public async Task<ActionResult<RampChecklistSubmissionResponse>> SubmitChecklist(
        [FromRoute] Guid operationId,
        [FromHeader(Name = "X-Elevant-Installation-Id"), BindRequired] Guid installationId,
        [FromHeader(Name = "Idempotency-Key"), BindRequired] Guid idempotencyKey,
        [FromBody, BindRequired] SubmitRampOperationChecklistRequest request,
        CancellationToken cancellationToken)
    {
        if (!TryGetAccountId(out var accountId))
        {
            return UnauthorizedResult<RampChecklistSubmissionResponse>();
        }

        if (!TryMapAnswers(request.Answers, out var answers))
        {
            return ProblemResult<RampChecklistSubmissionResponse>(
                StatusCodes.Status400BadRequest,
                "The ramp checklist submission is invalid.");
        }

        var result = await submitHandler.HandleAsync(
            new SubmitRampOperationChecklistCommand(
                accountId,
                operationId,
                request.ChecklistId,
                answers,
                installationId,
                idempotencyKey,
                idempotencyKey,
                HttpContext.TraceIdentifier),
            cancellationToken);
        if (!result.IsSuccess)
        {
            return FailureResult<RampChecklistSubmissionResponse>(result.Failure!.Value);
        }

        var submission = result.Submission!;
        return Ok(new RampChecklistSubmissionResponse(
            submission.ReceiptId,
            new RampChecklistSubmissionSummaryResponse(
                submission.Checklist.Id,
                submission.Checklist.Status,
                submission.Checklist.StartedAt,
                submission.Checklist.SubmittedAt,
                submission.Checklist.AnswerCount)));
    }

    private static bool TryMapAnswers(
        IReadOnlyList<RampChecklistAnswerRequest>? requests,
        out IReadOnlyCollection<RampChecklistAnswerWriteData> answers)
    {
        if (requests is null)
        {
            answers = [];
            return false;
        }

        var mapped = new RampChecklistAnswerWriteData[requests.Count];
        for (var index = 0; index < requests.Count; index++)
        {
            var request = requests[index];
            if (request is null ||
                !Enum.TryParse<ChecklistAnswerValue>(
                    request.Value,
                    ignoreCase: false,
                    out var value) ||
                !Enum.IsDefined(value))
            {
                answers = [];
                return false;
            }

            mapped[index] = new RampChecklistAnswerWriteData(
                request.ItemId,
                value,
                request.Note);
        }

        answers = mapped;
        return true;
    }

    private bool TryGetAccountId(out Guid accountId) =>
        Guid.TryParse(User.FindFirstValue(JwtRegisteredClaimNames.Sub), out accountId) &&
        accountId != Guid.Empty;

    private ActionResult<T> FailureResult<T>(RampOperationsFailure failure) => failure switch
    {
        RampOperationsFailure.Unauthorized => UnauthorizedResult<T>(),
        RampOperationsFailure.Forbidden => ProblemResult<T>(
            StatusCodes.Status403Forbidden,
            "Access to the ramp operation checklist is forbidden."),
        RampOperationsFailure.InvalidRequest => ProblemResult<T>(
            StatusCodes.Status400BadRequest,
            "The ramp checklist request is invalid."),
        RampOperationsFailure.NotFound => ProblemResult<T>(
            StatusCodes.Status404NotFound,
            "The ramp operation checklist was not found."),
        RampOperationsFailure.Conflict => ProblemResult<T>(
            StatusCodes.Status409Conflict,
            "The ramp checklist request conflicts with current operational data."),
        _ => throw new ArgumentOutOfRangeException(
            nameof(failure),
            failure,
            "Unsupported failure."),
    };

    private ActionResult<T> UnauthorizedResult<T>()
    {
        Response.Headers.WWWAuthenticate = "Bearer";
        return ProblemResult<T>(
            StatusCodes.Status401Unauthorized,
            "Authentication failed.");
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

    private static GetRampOperationChecklistResponse Map(
        RampOperationChecklistData checklist) =>
        new(
            checklist.OperationId,
            new RampChecklistResponse(
                checklist.Id,
                checklist.Status,
                checklist.StartedAt,
                checklist.SubmittedAt,
                new RampChecklistTemplateResponse(
                    checklist.Template.Code,
                    checklist.Template.Name,
                    checklist.Template.Version),
                checklist.Sections.Select(section => new RampChecklistSectionResponse(
                    section.Name,
                    section.Items.Select(item => new RampChecklistItemResponse(
                        item.Id,
                        item.Code,
                        item.Label,
                        item.SortOrder,
                        item.IsRequired,
                        item.RequiresNoteWhenNotOk,
                        item.Answer is null
                            ? null
                            : new RampChecklistAnswerResponse(
                                item.Answer.Value,
                                item.Answer.Note,
                                item.Answer.AnsweredAt))).ToArray())).ToArray()));
}
