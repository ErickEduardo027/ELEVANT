namespace Elevant.Domain.Enumerations;

/// <summary>AVIAM forms generated from one ramp operation (ADR-0032).</summary>
public enum OperationDocumentKind
{
    /// <summary>Orden de Servicio en Rampa, F-RAM-AVL-MAG 04.</summary>
    ServiceOrder,

    /// <summary>Reporte de Vuelo, F-OCC-AVL-6.2.12/A9.</summary>
    FlightReport,

    /// <summary>Check-List y Reporte Diario Puente Abordaje, F-MGO-AVL 8.14.1/A1 y A2.</summary>
    BridgeChecklist,

    /// <summary>Solicitud de Servicio y Descargo de Responsabilidad e Indemnización: the charter's agreement (ADR-0033).</summary>
    CharterServiceRequest,
}

/// <summary>Who signs a form; each form asks for its own set of roles.</summary>
public enum OperationSignatureRole
{
    AirlineRepresentative,
    AviamAgent,
    Coordinator,
    BridgeOperator,
}

/// <summary>Finance's confirmation that a charter carrier paid in advance (ADR-0033).</summary>
public enum CharterPrepaymentStatus
{
    Pending,
    Confirmed,
}
