using Elevant.Application.Documents;
using Elevant.Domain.Enumerations;

namespace Elevant.Application.Commercial;

/// <summary>
/// The tabular reports of Contratos (ADR-0048, «Reportes nuevos»): contracts and their validity, the agreed rates, the
/// commercial requests and the airlines' permits. Every one reads with <c>contracts.reports.read</c>; Contratos has no
/// separate «Exportar» option, so the same permission exports.
/// </summary>
public static class ContractsReportCatalog
{
    public const string Area = "Contratos";
    public const string ReadPermission = "contracts.reports.read";

    public static readonly ReportFilterDefinition ContractStatus = ReportFilterDefinition.Select("status", "Estado", "status",
        new("Draft", "Borrador"), new("Active", "Activo"), new("Suspended", "Suspendido"), new("Terminated", "Terminado"),
        new("Expired", "Vencido"));

    public static readonly ReportFilterDefinition ExpiresWithin =
        ReportFilterDefinition.Days("expiresWithinDays", "Vence en", "expiresWithinDays");

    public static readonly ReportFilterDefinition RequestStatus = ReportFilterDefinition.Select("status", "Estado", "status",
        new("Pending", "Recibida"), new("InReview", "En revisión"), new("Approved", "Aprobada"), new("Rejected", "Rechazada"),
        new("Cancelled", "Cancelada"));

    public static readonly ReportFilterDefinition PermitReview = ReportFilterDefinition.Select("review", "Revisión", "review",
        new("Submitted", "Pendiente de revisión"), new("Verified", "Verificado"), new("Rejected", "Rechazado"),
        new("Revoked", "Revocado"));

    public static readonly ReportFilterDefinition PermitValidity = ReportFilterDefinition.Select("validity", "Vencimiento",
        "validity", new("current", "Vigente"), new("expiring", "Vence en 30 días"), new("expired", "Vencido"));

    /// <summary>Days ahead a permit or contract counts as «vence pronto».</summary>
    public const int ExpiringDays = 30;

    public static IReadOnlyList<TabularReportDefinition> All { get; } =
    [
        new("agreements", "Contratos y vigencias",
            "Cada contrato con la versión que lo rige (o la más reciente), su vigencia, los días para vencer, las " +
            "estaciones que cubre, la moneda y cuántas tarifas pacta.",
            [ReportColumn.Text("Aerolínea"), ReportColumn.Text("Código"), ReportColumn.Number("Versión"),
                ReportColumn.Text("Estado"), ReportColumn.Text("Estado de la versión"), new("Vigente desde", ReportColumnType.Date),
                new("Vigente hasta", ReportColumnType.Date), ReportColumn.Number("Días para vencer"),
                ReportColumn.Text("Estaciones"), ReportColumn.Text("Moneda"), ReportColumn.Number("Tarifas", summable: true),
                new("Creado", ReportColumnType.Date)],
            ReportPeriod.None,
            [ReportFilterDefinition.Airline(), ContractStatus, ReportFilterDefinition.Station(), ExpiresWithin]),
        new("rates", "Tarifas pactadas",
            "Las tarifas de las versiones aprobadas de cada contrato: servicio, unidad de cobro, precio, cantidad mínima " +
            "y vigencia.",
            [ReportColumn.Text("Contrato"), ReportColumn.Text("Aerolínea"), ReportColumn.Number("Versión"),
                ReportColumn.Text("Servicio"), ReportColumn.Text("Unidad"), ReportColumn.Text("Moneda"),
                new ReportColumn("Precio", ReportColumnType.Money) { CurrencyColumn = 5 },
                ReportColumn.Number("Mínimo"), new("Vigente desde", ReportColumnType.Date),
                new("Vigente hasta", ReportColumnType.Date)],
            ReportPeriod.None,
            [ReportFilterDefinition.Airline(), ReportFilterDefinition.Service()]),
        new("requests", "Solicitudes comerciales",
            "Las solicitudes de servicio recibidas en el período (hora de Santo Domingo): referencia, aerolínea, " +
            "representante, estado, quién y cuándo decidió, y los servicios pedidos.",
            [ReportColumn.Text("Referencia"), ReportColumn.Text("Aerolínea"), ReportColumn.Text("Representante"),
                new("Recibida", ReportColumnType.DateTime), ReportColumn.Text("Estado"),
                new("Decidida el", ReportColumnType.DateTime), ReportColumn.Text("Decidida por"),
                ReportColumn.Text("Servicios")],
            ReportPeriod.Range,
            [RequestStatus, ReportFilterDefinition.Airline()]),
        new("permits", "Permisos de aerolíneas",
            "Los permisos y certificados que las aerolíneas presentaron: tipo, número, emisor, vigencia, revisión de " +
            "Contratos y quién la hizo.",
            [ReportColumn.Text("Aerolínea"), ReportColumn.Text("Tipo"), ReportColumn.Text("Número"),
                ReportColumn.Text("Emisor"), new("Emitido", ReportColumnType.Date), new("Vence", ReportColumnType.Date),
                ReportColumn.Text("Vigencia"), ReportColumn.Text("Revisión"), new("Revisado el", ReportColumnType.DateTime),
                ReportColumn.Text("Revisado por"), new("Presentado", ReportColumnType.DateTime)],
            ReportPeriod.None,
            [PermitReview, PermitValidity, ReportFilterDefinition.Airline()]),
    ];

    public static string Status(ContractStatus status) => status switch
    {
        Domain.Enumerations.ContractStatus.Draft => "Borrador",
        Domain.Enumerations.ContractStatus.Active => "Activo",
        Domain.Enumerations.ContractStatus.Suspended => "Suspendido",
        Domain.Enumerations.ContractStatus.Terminated => "Terminado",
        Domain.Enumerations.ContractStatus.Expired => "Vencido",
        _ => status.ToString(),
    };

    public static string VersionStatus(ContractVersionStatus status) => status switch
    {
        ContractVersionStatus.Draft => "Borrador",
        ContractVersionStatus.PendingFinanceApproval => "Pendiente de Finanzas",
        ContractVersionStatus.Approved => "Aprobada",
        ContractVersionStatus.Superseded => "Reemplazada",
        ContractVersionStatus.Rejected => "Descartada",
        _ => status.ToString(),
    };

    public static string RequestStatusLabel(CommercialRequestStatus status) => RequestStatus.LabelOf(status.ToString());

    public static string PermitKind(AirlinePermitKind kind) => kind switch
    {
        AirlinePermitKind.OperatingPermit => "Permiso de operación (JAC)",
        AirlinePermitKind.AirOperatorCertificate => "Certificado de operador aéreo",
        AirlinePermitKind.Insurance => "Póliza de seguro",
        _ => "Otro",
    };

    public static string Review(AirlinePermitReview review) => PermitReview.LabelOf(review.ToString());

    /// <summary>«Vigente», «Vence en 30 días» or «Vencido» at <paramref name="today"/>.</summary>
    public static string Validity(DateOnly expiresOn, DateOnly today) =>
        expiresOn < today ? "Vencido" : expiresOn.DayNumber - today.DayNumber <= ExpiringDays ? "Vence en 30 días" : "Vigente";

    /// <summary>The code of <see cref="Validity"/>: <c>current</c>, <c>expiring</c> or <c>expired</c>.</summary>
    public static string ValidityCode(DateOnly expiresOn, DateOnly today) =>
        expiresOn < today ? "expired" : expiresOn.DayNumber - today.DayNumber <= ExpiringDays ? "expiring" : "current";
}
