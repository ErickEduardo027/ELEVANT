using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>Maps governance outcomes to HTTP; a failure code travels as the Problem Details <c>code</c> extension.</summary>
internal static class GovernanceResults
{
    public static IActionResult ToAction(this ControllerBase controller, GovernanceResult result,
        int successStatus = StatusCodes.Status200OK)
    {
        if (result.Failure is null) return controller.StatusCode(successStatus, new CommercialIdResponse(result.Id!.Value));
        if (result.Failure == GovernanceFailure.Forbidden) return controller.Forbid();
        var (status, title) = result.Failure switch
        {
            GovernanceFailure.NotFound => (StatusCodes.Status404NotFound, "Governance record not found."),
            GovernanceFailure.Invalid => (StatusCodes.Status400BadRequest, "Invalid governance data."),
            GovernanceFailure.Conflict => (StatusCodes.Status409Conflict, "Governance record conflicts with current state."),
            GovernanceFailure.Protected => (StatusCodes.Status409Conflict, "This protected user or role cannot be changed."),
            _ => throw new InvalidOperationException(),
        };
        var problem = new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path };
        if (result.Code is { } code) problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }
}
