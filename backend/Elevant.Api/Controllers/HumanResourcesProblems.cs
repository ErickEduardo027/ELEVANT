using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>
/// Problem Details of the Gestión Humana commands of phase 2 (block D): a Spanish title and the stable
/// <c>code</c> extension the clients translate. A refused permission stays a bare 403.
/// </summary>
internal static class HumanResourcesProblems
{
    public static ObjectResult Coded(ControllerBase controller, int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }

    /// <summary>The title of a failure by its status; the code tells the rule.</summary>
    public static ObjectResult Failure(ControllerBase controller, int status, string? code, string fallbackCode) =>
        Coded(controller, status, status switch
        {
            StatusCodes.Status400BadRequest => "Los datos no son válidos.",
            StatusCodes.Status404NotFound => "El registro ya no existe o no está en su alcance.",
            _ => "El registro cambió o no admite este cambio. Vuelva a cargar los datos.",
        }, code ?? fallbackCode);
}
