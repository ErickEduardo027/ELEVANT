using Elevant.Domain.Enumerations;

namespace Elevant.Domain.Governance;

/// <summary>Column of the permission matrix an action belongs to.</summary>
public static class PermissionKinds
{
    public const string Read = "read";
    public const string Create = "create";
    public const string Update = "update";
    public const string Delete = "delete";

    /// <summary>Workflow actions that are not plain CRUD (approve, validate, export…).</summary>
    public const string Other = "other";
}

/// <summary>An action a member can be granted inside a menu option.</summary>
public sealed record PermissionAction(string Code, string Action, string Label, string Kind);

/// <summary>
/// One menu option of a department and the actions it offers. <paramref name="Section"/> is the
/// sidebar group it is shown under; <paramref name="Parent"/> names the option that contains it
/// when it is a function inside another screen (closures inside «Servicios»…).
/// </summary>
public sealed record PermissionModule(string Key, string Label, string Section, string? Parent,
    IReadOnlyList<PermissionAction> Actions);

/// <summary>
/// Code-defined catalog of department permissions, one module per menu option with the standard
/// actions Ver/Crear/Modificar/Eliminar plus its own workflow actions (ADR-0019). It is the single
/// source for validating grants and for rendering the matrix, so it works in every environment
/// without seeded catalog rows. A code is <c>&lt;department&gt;.&lt;module&gt;.&lt;action&gt;</c>.
/// </summary>
public static class DepartmentPermissionCatalog
{
    private static (string Action, string Label, string Kind) Read(string label = "Ver") => ("read", label, PermissionKinds.Read);
    private static (string Action, string Label, string Kind) Create(string label = "Crear") => ("create", label, PermissionKinds.Create);
    private static (string Action, string Label, string Kind) Update(string label = "Modificar") => ("update", label, PermissionKinds.Update);
    private static (string Action, string Label, string Kind) Delete(string label = "Eliminar") => ("delete", label, PermissionKinds.Delete);
    private static (string Action, string Label, string Kind) Other(string action, string label) => (action, label, PermissionKinds.Other);

    private static readonly IReadOnlyDictionary<Department, IReadOnlyList<PermissionModule>> Modules =
        new Dictionary<Department, IReadOnlyList<PermissionModule>>
        {
            [Department.Operations] =
            [
                Module("operations", "dashboard", "Dashboard", "Monitoreo", null, Read()),
                Module("operations", "flight_monitoring", "Monitoreo de vuelos", "Monitoreo", null, Read()),
                Module("operations", "positions_map", "Mapa de posiciones", "Monitoreo", null, Read(),
                    Other("assign", "Registrar llegadas y asignar o liberar posiciones")),
                Module("operations", "planning", "Planificación operativa", "Operación", null,
                    Read(), Create("Crear escalas"), Other("assign", "Asignar agentes, posiciones y turnos")),
                Module("operations", "coverage", "Cobertura de posiciones", "Operación", null, Read(),
                    Other("assign", "Asignar posiciones por turno"), Update("Configurar posiciones y combinaciones")),
                Module("operations", "attendance", "Asistencia OCC", "Operación", "planning",
                    Read(), Create("Registrar observaciones")),
                Module("operations", "review", "Revisión", "Operación", null, Read(), Other("decide", "Aprobar o devolver entregas")),
                Module("operations", "service_closures", "Clausura de servicios", "Operación", "review",
                    Read(), Create("Solicitar clausura")),
                Module("operations", "reports", "Reportes", "Operación", null, Read(), Other("export", "Exportar")),
                Module("operations", "notifications", "Notificaciones", "Comunicación", null, Read()),
                Module("operations", "chat", "Chat interno", "Comunicación", null, Read(), Create("Enviar mensajes")),
            ],
            [Department.HumanResources] =
            [
                Module("human_resources", "dashboard", "Dashboard", "Inicio", null, Read()),
                Module("human_resources", "employees", "Empleados", "Personal", null,
                    Read(), Create("Registrar empleados"), Update("Editar expedientes"), Delete("Dar de baja y trasladar")),
                Module("human_resources", "positions", "Puestos", "Personal", null,
                    Read(), Create(), Update("Modificar y desactivar")),
                Module("human_resources", "requisitions", "Requisiciones de personal", "Personal", null,
                    Read(), Other("attend", "Atender requisiciones")),
                Module("human_resources", "ramp_profiles", "Agentes de rampa", "Personal", null,
                    Read(), Update("Editar perfiles operativos")),
                Module("human_resources", "qualifications", "Habilitaciones y certificaciones", "Habilitación", null,
                    Read(), Create("Registrar primer ciclo"), Update("Renovar")),
                Module("human_resources", "permits", "Carnets y permisos aeroportuarios", "Habilitación", null,
                    Read(), Create("Registrar primer ciclo"), Update("Renovar")),
                Module("human_resources", "schedules", "Horarios y disponibilidad", "Horarios", null, Read(),
                    Other("write", "Programar turnos")),
                Module("human_resources", "availability", "Solicitudes de disponibilidad", "Horarios", "schedules",
                    Read(), Create("Registrar solicitudes"), Other("decide", "Aprobar, rechazar o cancelar")),
                Module("human_resources", "attendance", "Revisión de asistencia", "Horarios", null,
                    Read(), Other("validate", "Validar asistencia")),
                Module("human_resources", "reports", "Reportes", "Control", null, Read(), Other("export", "Exportar")),
                Module("human_resources", "audit", "Trazabilidad / Auditoría", "Control", null, Read()),
                Module("human_resources", "notifications", "Notificaciones", "Control", null, Read()),
                Module("human_resources", "access_requests", "Validaciones de acceso", "Control", null,
                    Read(), Other("validate", "Validar o rechazar altas")),
            ],
            [Department.Contracts] =
            [
                Module("contracts", "home", "Inicio", "Gestión contractual", null, Read()),
                Module("contracts", "agreements", "Contratos", "Gestión contractual", null,
                    Read(), Other("sign", "Firmar por AVIAM"),
                    Other("lifecycle", "Suspender, reactivar, terminar y renovar"),
                    Other("validity", "Fijar vigencia y renovación")),
                Module("contracts", "permits", "Permisos de aerolíneas", "Gestión contractual", null,
                    Read(), Other("verify", "Verificar o rechazar permisos")),
                Module("contracts", "agreed_services", "Servicios pactados", "Gestión contractual", null, Read()),
                Module("contracts", "drafts", "Borradores", "Gestión contractual", null,
                    Read(), Update("Editar borradores"), Other("activate", "Activar contrato")),
                Module("contracts", "requests", "Solicitudes", "Gestión contractual", null, Read(),
                    Other("verify", "Verificar aerolínea"), Other("approve", "Aprobar"), Other("reject", "Rechazar")),
                Module("contracts", "catalog", "Servicios", "Oferta", null,
                    Read(), Create(), Update(), Delete("Retirar")),
                Module("contracts", "service_closures", "Solicitudes de clausura", "Oferta", "catalog",
                    Read(), Other("decide", "Aprobar o denegar"), Other("reopen", "Republicar")),
                Module("contracts", "reports", "Reportes", "Análisis", null, Read()),
                Module("contracts", "notifications", "Notificaciones", "Análisis", null, Read()),
            ],
            [Department.Finance] =
            [
                Module("finance", "home", "Inicio", "Inicio", null, Read()),
                Module("finance", "packages", "Paquetes", "Comercial", null,
                    Read(), Create(), Update(), Other("publish", "Publicar paquetes")),
                Module("finance", "contract_approvals", "Aprobación de contratos", "Comercial", null,
                    Read(), Other("decide", "Aprobar o devolver contratos")),
                Module("finance", "approved_services", "Servicios aprobados", "Comercial", null,
                    Read(), Create("Generar prefacturas")),
                Module("finance", "charters", "Charters sin contrato", "Comercial", null,
                    Read(), Other("confirm", "Confirmar el prepago de un charter")),
                Module("finance", "close_rules", "Reglas de cierre", "Comercial", null,
                    Read(), Update("Configurar tiempos en tierra y festivos")),
                Module("finance", "preinvoices", "Pre-facturación", "Facturación", null,
                    Read(), Update("Editar importes, ajustes y disputas"), Other("issue", "Publicar y facturar")),
                Module("finance", "reconciliation", "Facturas", "Facturación", null,
                    Read(), Create("Registrar pagos y notas de crédito")),
                Module("finance", "adjustments", "Notas de ajuste", "Facturación", "reconciliation",
                    Read(), Create("Emitir notas de crédito y débito")),
                Module("finance", "tariffs", "Tarifario de servicios", "Tarifarios", null,
                    Read(), Create("Crear borradores"), Update("Editar borradores"), Delete("Eliminar borradores"),
                    Other("publish", "Publicar tarifas")),
                Module("finance", "charges", "Tarifario de cargos", "Tarifarios", null,
                    Read(), Create(), Update(), Delete("Eliminar borradores"), Other("publish", "Publicar importes")),
                Module("finance", "exchange_rates", "Tasas de cambio", "Tarifarios", null,
                    Read(), Create("Registrar tasas"), Update("Corregir tasas")),
                Module("finance", "billing_units", "Unidades de cobro", "Tarifarios", null,
                    Read(), Create(), Update("Modificar y desactivar")),
                Module("finance", "receipts", "Cobros y aplicaciones", "Tesorería", null,
                    Read(), Create("Registrar cobros"), Other("apply", "Aplicar cobros"),
                    Other("reverse", "Revertir movimientos"), Other("refund", "Registrar devoluciones")),
                Module("finance", "statements", "Estados de cuenta", "Tesorería", null, Read()),
                Module("finance", "suppliers", "Proveedores", "Pagos", null, Read(), Create(), Update(), Delete("Retirar")),
                Module("finance", "payables", "Cuentas por pagar", "Pagos", null,
                    Read(), Create("Registrar facturas"), Update("Editar y enviar facturas"),
                    Other("approve", "Aprobar facturas"), Other("pay", "Registrar pagos")),
                Module("finance", "expenses", "Gastos de empleados", "Pagos", null,
                    Read(), Create("Registrar gastos"), Update("Editar gastos"),
                    Other("approve", "Revisar gastos"), Other("pay", "Registrar reembolsos")),
                Module("finance", "taxes", "Tratamientos tributarios", "Fiscal", null,
                    Read("Consultar"), Create("Configurar tratamientos"), Update("Modificar vigencias")),
                Module("finance", "fiscal", "Documentos fiscales", "Fiscal", null,
                    Read(), Create("Preparar documentos"), Other("simulate", "Ejecutar simulación")),
                Module("finance", "reports", "Reportes", "Análisis", null, Read(), Other("export", "Exportar")),
                Module("finance", "notifications", "Notificaciones", "Análisis", null, Read()),
            ],
        };

    /// <summary>
    /// Codes stored before ADR-0019 and what they grant now, so existing templates and accounts keep
    /// their access: «manage» became the create/update/delete it covered and shared menu options got
    /// their own module. Read when grants are resolved; never written.
    /// </summary>
    private static readonly IReadOnlyDictionary<string, string[]> Aliases = new Dictionary<string, string[]>(StringComparer.Ordinal)
    {
        ["operations.planning.manage"] = ["operations.planning.create"],
        ["operations.attendance.record"] = ["operations.attendance.create"],
        ["operations.service_closures.request"] = ["operations.service_closures.create"],
        ["operations.chat.send"] = ["operations.chat.create"],
        ["human_resources.employees.manage"] = ["human_resources.employees.create", "human_resources.employees.update"],
        ["human_resources.employees.terminate"] = ["human_resources.employees.delete"],
        ["human_resources.positions.manage"] = ["human_resources.positions.create", "human_resources.positions.update"],
        ["human_resources.ramp_profiles.manage"] = ["human_resources.ramp_profiles.update"],
        ["human_resources.qualifications.manage"] = ["human_resources.qualifications.create", "human_resources.qualifications.update"],
        ["human_resources.permits.manage"] = ["human_resources.permits.create", "human_resources.permits.update"],
        ["human_resources.availability.decide"] = ["human_resources.availability.create"],
        // Reading contracts also shows the permits that condition them (ADR-0024).
        ["contracts.agreements.read"] = ["contracts.agreed_services.read", "contracts.permits.read"],
        ["contracts.drafts.edit"] = ["contracts.drafts.update"],
        ["contracts.catalog.edit"] = ["contracts.catalog.update"],
        ["contracts.catalog.retire"] = ["contracts.catalog.delete"],
        ["finance.preinvoices.manage"] = ["finance.preinvoices.update", "finance.preinvoices.issue"],
        ["finance.reconciliation.record"] = ["finance.reconciliation.create"],
        ["finance.adjustments.issue"] = ["finance.adjustments.create"],
        ["finance.approved_services.preinvoice"] = ["finance.approved_services.create"],
        ["finance.tariffs.read"] = ["finance.billing_units.read"],
        ["finance.tariffs.manage"] = ["finance.tariffs.create", "finance.tariffs.update", "finance.tariffs.delete",
            "finance.tariffs.publish", "finance.billing_units.create", "finance.billing_units.update"],
        ["finance.charges.manage"] = ["finance.charges.create", "finance.charges.update", "finance.charges.delete",
            "finance.charges.publish"],
        ["finance.exchange_rates.manage"] = ["finance.exchange_rates.create", "finance.exchange_rates.update"],
        ["finance.taxes.manage"] = ["finance.taxes.create", "finance.taxes.update"],
        ["finance.packages.manage"] = ["finance.packages.create", "finance.packages.update", "finance.packages.publish"],
        ["finance.receipts.read"] = ["finance.statements.read"],
        ["finance.receipts.manage"] = ["finance.receipts.create"],
        ["finance.suppliers.manage"] = ["finance.suppliers.create", "finance.suppliers.update", "finance.suppliers.delete"],
        ["finance.payables.manage"] = ["finance.payables.create", "finance.payables.update"],
        ["finance.expenses.manage"] = ["finance.expenses.create", "finance.expenses.update"],
        ["finance.fiscal.manage"] = ["finance.fiscal.create"],
    };

    private static readonly IReadOnlyDictionary<string, Department> Owners = Modules
        .SelectMany(entry => entry.Value.SelectMany(module => module.Actions)
            .Select(action => (action.Code, Department: entry.Key)))
        .ToDictionary(item => item.Code, item => item.Department, StringComparer.Ordinal);

    /// <summary>Option prefix of a sub-window ('contracts.service_closures') → the option that contains it.</summary>
    private static readonly IReadOnlyDictionary<string, string> Parents = Modules
        .SelectMany(entry => entry.Value.Where(module => module.Parent is not null).Select(module =>
            (Child: module.Actions[0].Code[..module.Actions[0].Code.LastIndexOf('.')],
             Parent: module.Actions[0].Code[..module.Actions[0].Code.IndexOf('.')] + "." + module.Parent)))
        .ToDictionary(item => item.Child, item => item.Parent, StringComparer.Ordinal);

    public static IReadOnlyList<Department> Departments { get; } =
        [Department.HumanResources, Department.Contracts, Department.Operations, Department.Finance];

    public static IReadOnlyList<PermissionModule> ModulesOf(Department department) => Modules[department];

    /// <summary>Every permission code of a department: the effective set of its administrators.</summary>
    public static IReadOnlyList<string> CodesOf(Department department) =>
        Modules[department].SelectMany(module => module.Actions).Select(action => action.Code).ToArray();

    public static bool IsKnown(string code) => Owners.ContainsKey(code);

    public static Department? DepartmentOf(string code) =>
        Owners.TryGetValue(code, out var department) ? department : null;

    /// <summary>True when the code, or every code a legacy code stands for, belongs to the department.</summary>
    public static bool Belongs(string code, Department department) =>
        Owners.TryGetValue(code, out var owner) ? owner == department
            : Aliases.TryGetValue(code, out var current) && current.All(item => Owners.TryGetValue(item, out var target) && target == department);

    /// <summary>Current codes a stored code grants: itself when known plus what a legacy code became.</summary>
    public static IEnumerable<string> Expand(string code)
    {
        if (IsKnown(code)) yield return code;
        if (Aliases.TryGetValue(code, out var current))
            foreach (var item in current)
                if (IsKnown(item)) yield return item;
    }

    /// <summary>
    /// Translates legacy codes and adds the option's <c>read</c> action whenever another action
    /// of that option is granted, so a member can always see what they are allowed to change. A
    /// sub-window also grants <c>read</c> of the screen that contains it, which is the only way to
    /// reach it; forbidding that screen therefore forbids its sub-windows.
    /// </summary>
    public static IReadOnlyList<string> Normalize(IEnumerable<string> codes)
    {
        var result = new SortedSet<string>(StringComparer.Ordinal);
        foreach (var code in codes.SelectMany(Expand))
        {
            result.Add(code);
            var option = code[..code.LastIndexOf('.')];
            if (IsKnown(option + ".read")) result.Add(option + ".read");
            for (var parent = Parents.GetValueOrDefault(option); parent is not null; parent = Parents.GetValueOrDefault(parent))
                if (IsKnown(parent + ".read")) result.Add(parent + ".read");
        }
        return result.ToArray();
    }

    private static PermissionModule Module(string department, string key, string label, string section, string? parent,
        params (string Action, string Label, string Kind)[] actions) =>
        new(key, label, section, parent, actions.Select(action =>
            new PermissionAction($"{department}.{key}.{action.Action}", action.Action, action.Label, action.Kind)).ToArray());
}
