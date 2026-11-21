namespace Elevant.Application.Identity;

/// <summary>
/// The audit trail in Spanish for the reports (ADR-0048, «Reportes nuevos»): what an action code means («Inició
/// sesión», «Trasladó un empleado») and what it acted on («Empleado», «Cuenta»). The known codes are the ones
/// «Trazabilidad / Auditoría» translates (<c>activityPanelMessages.js</c>); any other is read from its parts
/// («finance.report.exported» → «Exportó un reporte»), never written raw.
/// </summary>
public static class AuditActionLabels
{
    public static IReadOnlyDictionary<string, string> Known { get; } = new Dictionary<string, string>(StringComparer.Ordinal)
    {
        ["auth.session.created"] = "Inició sesión",
        ["auth.session.failed"] = "Intento de inicio de sesión fallido",
        ["identity.password.changed"] = "Cambió su contraseña",
        ["hr.employee.created"] = "Registró un empleado",
        ["hr.employee.updated"] = "Actualizó un expediente",
        ["hr.employee.transferred"] = "Trasladó un empleado",
        ["hr.employee.terminated"] = "Dio de baja a un empleado",
        ["hr.employee.registered"] = "Registró el expediente de una cuenta existente",
        ["hr.position.created"] = "Creó un puesto",
        ["hr.position.updated"] = "Actualizó un puesto",
        ["hr.requisition.created"] = "Pidió personal",
        ["hr.requisition.status_changed"] = "Cambió una requisición",
        ["hr.ramp_profile.created"] = "Creó un perfil de rampa",
        ["hr.ramp_profile.updated"] = "Actualizó un perfil de rampa",
        ["hr.qualification.recorded"] = "Registró una habilitación",
        ["hr.permit.recorded"] = "Registró un carnet o permiso",
        ["hr.availability.recorded"] = "Registró una solicitud de disponibilidad",
        ["hr.availability.approved"] = "Aprobó una solicitud de disponibilidad",
        ["hr.availability.rejected"] = "Rechazó una solicitud de disponibilidad",
        ["hr.availability.cancelled"] = "Canceló una solicitud de disponibilidad",
        ["governance.access_request.requested"] = "Solicitó un acceso",
        ["governance.access_request.validated"] = "Validó un acceso",
        ["governance.access_request.rejected"] = "Rechazó un acceso",
        ["governance.access_request.cancelled"] = "Canceló una solicitud de acceso",
        ["governance.department_user.created"] = "Creó una cuenta",
        ["governance.department_user.administrator_created"] = "Nombró un administrador",
        ["governance.department_user.updated"] = "Editó un usuario",
        ["governance.department_user.deactivated"] = "Desactivó una cuenta",
        ["governance.department_user.reactivated"] = "Reactivó una cuenta",
        ["governance.department_user.password_reset"] = "Restableció una contraseña",
        ["governance.access_profile.created"] = "Creó una plantilla",
        ["governance.access_profile.updated"] = "Editó una plantilla",
        ["governance.access_profile.deactivated"] = "Desactivó una plantilla",
        ["governance.position.suggested_profile_set"] = "Cambió el perfil sugerido de un puesto",
        ["human-resources.report.exported"] = "Exportó un reporte de Gestión Humana",
        ["operations.report.exported"] = "Exportó un reporte de OCC",
        ["finance.report.exported"] = "Exportó un reporte de Finanzas",
        ["contracts.report.exported"] = "Exportó un reporte de Contratos",
        ["airline-portal.report.exported"] = "Exportó un reporte del portal de aerolíneas",
    };

    private static readonly Dictionary<string, string> Verbs = new(StringComparer.Ordinal)
    {
        ["created"] = "Creó", ["updated"] = "Actualizó", ["update"] = "Actualizó", ["deleted"] = "Eliminó",
        ["approved"] = "Aprobó", ["rejected"] = "Rechazó", ["cancelled"] = "Canceló", ["recorded"] = "Registró",
        ["exported"] = "Exportó", ["submitted"] = "Envió", ["verified"] = "Verificó", ["revoked"] = "Revocó",
        ["published"] = "Publicó", ["retired"] = "Retiró", ["archived"] = "Archivó", ["signed"] = "Firmó",
        ["issued"] = "Emitió", ["reversed"] = "Reversó", ["refunded"] = "Devolvió", ["applied"] = "Aplicó",
        ["requested"] = "Solicitó", ["decided"] = "Decidió", ["returned"] = "Devolvió", ["reopened"] = "Reabrió",
        ["assigned"] = "Asignó", ["released"] = "Liberó", ["discarded"] = "Descartó", ["corrected"] = "Corrigió",
        ["linked"] = "Vinculó", ["confirmed"] = "Confirmó", ["denied"] = "Denegó", ["sent"] = "Envió",
        ["commented"] = "Comentó", ["replied"] = "Respondió", ["uploaded"] = "Subió", ["paid"] = "Pagó",
        ["changed"] = "Cambió", ["deactivated"] = "Desactivó", ["reactivated"] = "Reactivó",
    };

    private static readonly Dictionary<string, string> Entities = new(StringComparer.Ordinal)
    {
        ["employee"] = "Empleado", ["position"] = "Puesto", ["requisition"] = "Requisición", ["ramp_profile"] = "Perfil de rampa",
        ["qualification"] = "Habilitación", ["permit"] = "Permiso", ["availability"] = "Solicitud de disponibilidad",
        ["access_request"] = "Solicitud de acceso", ["department_user"] = "Cuenta", ["access_profile"] = "Plantilla de acceso",
        ["user"] = "Cuenta", ["users"] = "Cuenta", ["session"] = "Sesión", ["password"] = "Contraseña", ["report"] = "Reporte",
        ["reports"] = "Reporte", ["airline"] = "Aerolínea", ["airline_account"] = "Cuenta de aerolínea",
        ["catalog"] = "Servicio del catálogo", ["contract"] = "Contrato", ["draft"] = "Borrador de contrato",
        ["request"] = "Solicitud comercial", ["service_closure"] = "Clausura de servicio", ["invoice"] = "Factura",
        ["receipt"] = "Cobro", ["note"] = "Nota de ajuste", ["charge"] = "Cargo", ["charge_tariff"] = "Tarifario de cargos",
        ["tariff"] = "Tarifa", ["package"] = "Paquete", ["exchange_rate"] = "Tasa de cambio", ["billing_unit"] = "Unidad de cobro",
        ["charter"] = "Charter", ["expense"] = "Gasto", ["supplier"] = "Proveedor", ["operation"] = "Operación",
        ["turnaround"] = "Vuelo", ["coverage"] = "Cobertura", ["assignment"] = "Asignación", ["shift"] = "Turno",
        ["incident"] = "Incidencia", ["station"] = "Estación", ["terminal"] = "Terminal", ["stand"] = "Posición",
        ["device"] = "Tablet", ["demo_flight"] = "Vuelo de demostración", ["organization"] = "Organización",
        ["membership"] = "Membresía", ["role"] = "Rol", ["media"] = "Archivo",
    };

    /// <summary>«Inició sesión», «Exportó un reporte»… the Spanish of an action code.</summary>
    public static string Label(string action)
    {
        if (Known.TryGetValue(action, out var known)) return known;
        var parts = action.Split('.', StringSplitOptions.RemoveEmptyEntries);
        if (parts.Length >= 2 && Verbs.TryGetValue(parts[^1], out var verb))
            return Entities.TryGetValue(parts[^2], out var entity) ? $"{verb}: {entity.ToLowerInvariant()}" : verb;
        return "Acción registrada";
    }

    /// <summary>«Empleado», «Cuenta»… what an entry acted on, from its entity type («hr.employee», «iam.users»).</summary>
    public static string Target(string? entityType)
    {
        if (string.IsNullOrWhiteSpace(entityType)) return "—";
        var last = entityType.Split('.', StringSplitOptions.RemoveEmptyEntries).LastOrDefault() ?? entityType;
        if (Entities.TryGetValue(last, out var entity)) return entity;
        var singular = last.EndsWith('s') ? last[..^1] : last;
        return Entities.TryGetValue(singular, out var found) ? found : "Registro";
    }
}
