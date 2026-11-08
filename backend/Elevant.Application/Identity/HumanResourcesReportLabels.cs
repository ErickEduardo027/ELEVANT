using Elevant.Application.Abstractions.Identity;

namespace Elevant.Application.Identity;

/// <summary>
/// Spanish labels of the Gestión Humana report exports (3-N16), with the vocabulary of the permit, qualification and
/// report screens. Only the exported files are translated: the JSON pages keep their codes, which are contract and
/// filters (<c>documentKind</c>, <c>validity</c>), and the export audit keeps them too. An unknown code is written as
/// it is.
/// </summary>
public static class HumanResourcesReportLabels
{
    /// <summary>The title of a report, as the screen and the PDF name it.</summary>
    public static string Title(HumanResourcesReportKind kind) => kind switch
    {
        HumanResourcesReportKind.Expirations => "Vigencias de habilitaciones y permisos",
        HumanResourcesReportKind.AccountMovements => "Movimientos de cuenta",
        HumanResourcesReportKind.StaffDistribution => "Distribución de turnos",
        HumanResourcesReportKind.QualificationCoverage => "Cobertura de habilitaciones",
        _ => kind.ToString(),
    };

    /// <summary>The class of an expiring document: «Habilitación» or «Permiso».</summary>
    public static string DocumentKind(string? kind) => kind switch
    {
        "Qualification" => "Habilitación",
        "Permit" => "Permiso",
        _ => kind ?? string.Empty,
    };

    /// <summary>The «Clase» filter of the expirations report: «Habilitaciones», «Permisos» or «Todas».</summary>
    public static string DocumentKindFilter(string? kind) => kind switch
    {
        null or "" => "Todas",
        "Qualification" => "Habilitaciones",
        "Permit" => "Permisos",
        _ => kind,
    };

    /// <summary>The «Vigencia» filter of the expirations report: «Vigentes», «Vencidas» or «Todas».</summary>
    public static string Validity(string? validity) => validity switch
    {
        null or "" => "Todas",
        "Current" => "Vigentes",
        "Expired" => "Vencidas",
        _ => validity,
    };

    /// <summary>An airport permit by its document type: «Carnet aeroportuario» or «Licencia de conducir en rampa».</summary>
    public static string PermitType(string? code) => code switch
    {
        "AirportId" => "Carnet aeroportuario",
        "RampDriverLicense" => "Licencia de conducir en rampa",
        _ => code ?? string.Empty,
    };

    /// <summary>An account movement: «Alta de cuenta», «Cuenta desactivada» or «Cuenta reactivada».</summary>
    public static string Movement(string? kind) => kind switch
    {
        "Created" => "Alta de cuenta",
        "Deactivated" => "Cuenta desactivada",
        "Reactivated" => "Cuenta reactivada",
        _ => kind ?? string.Empty,
    };
}
