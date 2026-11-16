using Elevant.Application.Abstractions.Identity;
using Microsoft.AspNetCore.Mvc;

namespace Elevant.Api.Controllers;

/// <summary>
/// Maps governance outcomes to HTTP. Every failure carries a stable Problem Details <c>code</c> (2-N39): the one the
/// store named or the default of its kind, with a Spanish title; the clients explain the code, never the title.
/// </summary>
internal static class GovernanceResults
{
    /// <summary>Default codes of the failures a store did not name.</summary>
    public const string ForbiddenCode = "forbidden";
    public const string NotFoundCode = "not_found";
    public const string InvalidCode = "invalid_governance_data";
    public const string ConflictCode = "governance_conflict";
    public const string ProtectedCode = "protected_user";

    public static IActionResult ToAction(this ControllerBase controller, GovernanceResult result,
        int successStatus = StatusCodes.Status200OK) =>
        result.Failure is { } failure
            ? Failed(controller, failure, result.Code)
            : controller.StatusCode(successStatus, new CommercialIdResponse(result.Id!.Value));

    /// <summary>
    /// A refused governance command: the Spanish title of its kind and the store's code or the kind's default.
    /// </summary>
    public static ObjectResult Failed(ControllerBase controller, GovernanceFailure failure, string? code)
    {
        var (status, title, fallback) = failure switch
        {
            GovernanceFailure.Forbidden => (StatusCodes.Status403Forbidden, "No tiene permiso para esta acción.", ForbiddenCode),
            GovernanceFailure.NotFound => (StatusCodes.Status404NotFound,
                "El registro ya no existe o no está en su alcance.", NotFoundCode),
            GovernanceFailure.Invalid => (StatusCodes.Status400BadRequest, "Los datos no son válidos.", InvalidCode),
            GovernanceFailure.Conflict => (StatusCodes.Status409Conflict,
                "El registro cambió o no admite este cambio. Vuelva a cargarlo.", ConflictCode),
            GovernanceFailure.Protected => (StatusCodes.Status409Conflict,
                "Este usuario o rol está protegido y no se puede cambiar.", ProtectedCode),
            _ => throw new InvalidOperationException(),
        };
        return Coded(controller, status, title, code ?? fallback);
    }

    public static ObjectResult Coded(ControllerBase controller, int status, string title, string code)
    {
        var problem = new ProblemDetails { Status = status, Title = title, Instance = controller.HttpContext.Request.Path };
        problem.Extensions["code"] = code;
        return new ObjectResult(problem) { StatusCode = status, ContentTypes = { "application/problem+json" } };
    }

    /// <summary>
    /// 2-N38: the role editor and the direct creation of accounts were retired. Departments request their employees'
    /// access and Gestión Humana validates it; the super administrator names administrators from employees.
    /// </summary>
    public static ObjectResult LegacyRetired(ControllerBase controller) => Coded(controller, StatusCodes.Status410Gone,
        "Esta función de gobernanza se retiró: use las solicitudes de acceso por empleado.", "legacy_governance_retired");
}
