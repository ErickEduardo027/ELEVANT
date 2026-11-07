using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>
/// Problem Details of the ramp (tablet) controllers with a stable <c>code</c> the tablet explains (3-B). The deployed
/// APK ignores a code it does not know and keeps explaining the failure by its status, so a coded failure keeps the
/// status the old one had.
/// </summary>
internal static class RampProblems
{
    public static ObjectResult Coded(ControllerBase controller, int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status };
    }
}
