using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Governance;

/// <summary>An action a member can be granted inside a department module.</summary>
public sealed record PermissionAction(string Code, string Action, string Label);

/// <summary>A department module and the actions it offers.</summary>
public sealed record PermissionModule(string Key, string Label, IReadOnlyList<PermissionAction> Actions);

/// <summary>
/// Code-defined catalog of department permissions. It is the single source for
/// validating grants and for rendering the module x action matrix, so it works in
/// every environment without seeded catalog rows. A code is
/// <c>&lt;department&gt;.&lt;module&gt;.&lt;action&gt;</c>.
/// </summary>
public static class DepartmentPermissionCatalog
{
    private static readonly IReadOnlyDictionary<Department, IReadOnlyList<PermissionModule>> Modules =
        new Dictionary<Department, IReadOnlyList<PermissionModule>>
        {
            [Department.Operations] =
            [
                Module("operations", "dashboard", "Dashboard", ("read", "Ver")),
                Module("operations", "planning", "Planificación operativa",
                    ("read", "Ver"), ("manage", "Crear y editar escalas"), ("assign", "Asignar agentes, posiciones y turnos")),
                Module("operations", "flight_monitoring", "Monitoreo de vuelos", ("read", "Ver")),
                Module("operations", "positions_map", "Mapa de posiciones", ("read", "Ver")),
                Module("operations", "attendance", "Asistencia OCC", ("read", "Ver"), ("record", "Registrar observaciones")),
                Module("operations", "review", "Revisión", ("read", "Ver"), ("decide", "Aprobar o devolver entregas")),
                Module("operations", "reports", "Reportes", ("read", "Ver"), ("export", "Exportar")),
                Module("operations", "notifications", "Notificaciones", ("read", "Ver")),
                Module("operations", "chat", "Chat interno", ("read", "Ver"), ("send", "Enviar mensajes")),
                Module("operations", "service_closures", "Clausura de servicios", ("read", "Ver"), ("request", "Solicitar clausura")),
            ],
            [Department.HumanResources] =
            [
                Module("human_resources", "dashboard", "Dashboard", ("read", "Ver")),
                Module("human_resources", "ramp_profiles", "Agentes de rampa", ("read", "Ver")),
                Module("human_resources", "qualifications", "Habilitaciones y certificaciones", ("read", "Ver"), ("manage", "Registrar y renovar")),
                Module("human_resources", "permits", "Carnets y permisos aeroportuarios", ("read", "Ver"), ("manage", "Registrar y renovar")),
                Module("human_resources", "schedules", "Horarios y disponibilidad", ("read", "Ver"), ("manage", "Programar turnos")),
                Module("human_resources", "availability", "Solicitudes de disponibilidad", ("read", "Ver"), ("decide", "Aprobar o rechazar")),
                Module("human_resources", "attendance", "Revisión de asistencia", ("read", "Ver"), ("validate", "Validar asistencia")),
                Module("human_resources", "reports", "Reportes", ("read", "Ver"), ("export", "Exportar")),
                Module("human_resources", "audit", "Trazabilidad / Auditoría", ("read", "Ver")),
                Module("human_resources", "notifications", "Notificaciones", ("read", "Ver")),
                Module("human_resources", "access_requests", "Validaciones de acceso", ("read", "Ver"), ("validate", "Validar o rechazar altas")),
            ],
            [Department.Contracts] =
            [
                Module("contracts", "home", "Inicio", ("read", "Ver")),
                Module("contracts", "agreements", "Contratos y servicios pactados", ("read", "Ver")),
                Module("contracts", "drafts", "Borradores", ("read", "Ver"), ("edit", "Editar"), ("activate", "Activar contrato")),
                Module("contracts", "requests", "Solicitudes", ("read", "Ver"), ("verify", "Verificar aerolínea"),
                    ("approve", "Aprobar"), ("reject", "Rechazar")),
                Module("contracts", "catalog", "Servicios", ("read", "Ver"), ("create", "Crear"), ("edit", "Editar"), ("retire", "Retirar")),
                Module("contracts", "service_closures", "Clausura de servicios", ("read", "Ver"), ("decide", "Aprobar o denegar"),
                    ("reopen", "Republicar")),
                Module("contracts", "reports", "Reportes", ("read", "Ver")),
            ],
            [Department.Finance] =
            [
                Module("finance", "home", "Inicio", ("read", "Ver")),
                Module("finance", "approved_services", "Servicios aprobados", ("read", "Ver"), ("preinvoice", "Generar prefacturas")),
                Module("finance", "preinvoices", "Pre-facturación", ("read", "Ver"), ("manage", "Publicar y facturar")),
                Module("finance", "reconciliation", "Seguimiento", ("read", "Ver"), ("record", "Registrar pagos")),
                Module("finance", "tariffs", "Tarifas", ("read", "Ver")),
                Module("finance", "reports", "Reportes", ("read", "Ver"), ("export", "Exportar")),
            ],
        };

    private static readonly IReadOnlyDictionary<string, Department> Owners = Modules
        .SelectMany(entry => entry.Value.SelectMany(module => module.Actions)
            .Select(action => (action.Code, Department: entry.Key)))
        .ToDictionary(item => item.Code, item => item.Department, StringComparer.Ordinal);

    public static IReadOnlyList<Department> Departments { get; } =
        [Department.HumanResources, Department.Contracts, Department.Operations, Department.Finance];

    public static IReadOnlyList<PermissionModule> ModulesOf(Department department) => Modules[department];

    /// <summary>Every permission code of a department: the effective set of its administrators.</summary>
    public static IReadOnlyList<string> CodesOf(Department department) =>
        Modules[department].SelectMany(module => module.Actions).Select(action => action.Code).ToArray();

    public static bool IsKnown(string code) => Owners.ContainsKey(code);

    public static Department? DepartmentOf(string code) =>
        Owners.TryGetValue(code, out var department) ? department : null;

    public static bool Belongs(string code, Department department) =>
        Owners.TryGetValue(code, out var owner) && owner == department;

    /// <summary>
    /// Adds the module's <c>read</c> action whenever another action of that module is
    /// granted, so a member can always see what they are allowed to change.
    /// </summary>
    public static IReadOnlyList<string> Normalize(IEnumerable<string> codes)
    {
        var result = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var code in codes)
        {
            if (!IsKnown(code)) continue;
            result.Add(code);
            var read = code[..code.LastIndexOf('.')] + ".read";
            if (IsKnown(read)) result.Add(read);
        }
        return result.ToArray();
    }

    private static PermissionModule Module(string department, string key, string label, params (string Action, string Label)[] actions) =>
        new(key, label, actions.Select(action => new PermissionAction($"{department}.{key}.{action.Action}", action.Action, action.Label)).ToArray());
}
