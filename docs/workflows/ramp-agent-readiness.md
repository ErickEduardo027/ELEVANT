# Perfil de rampa y acceso móvil

Gestión Humana registra el perfil operativo del agente en **Agentes de rampa** de Private Web: nombre, número de empleado, categoría, fecha de ingreso, estado y estaciones. El API guarda `Person`, `RampAgent` y los scopes de estación de forma transaccional. Crear un perfil **no** crea credenciales.

Superadministración, en **Usuarios**, elige el rol protegido `RAMP_AGENT` y selecciona un perfil activo sin cuenta y con al menos una estación vigente. El API reutiliza esa persona, crea una sola cuenta interna con contraseña temporal, vincula el rol móvil y concede los scopes de cuenta correspondientes. La app móvil necesita rol, membresía AVIAM y scope de estación. Desactivar el perfil desde Gestión Humana revoca los scopes de cuenta y deshabilita la cuenta vinculada. La reactivación de una cuenta deshabilitada se resuelve en Superadministración, después de revisar el perfil.

## Guía de asignación para OCC

El perfil y la cuenta son requisitos de acceso, **no** una habilitación global para cualquier servicio. OCC calcula elegibilidad para una operación y posición concreta mediante `OccAgentEligibilityPolicy` y sus lecturas canónicas. Puede rechazar la asignación por:

1. perfil inactivo, cuenta móvil ausente o scope de estación/terminal faltante;
2. posición operativa no disponible o cualificación vigente faltante para esa posición y su equipo;
3. carnet aeroportuario o licencia de conducción en rampa no vigentes;
4. turno incompatible, ausencia/restricción aprobada en la fecha local o
   conflicto con otra asignación.

Gestión Humana debe preparar y mantener los datos laborales antes de la planificación. OCC confirma la elegibilidad para la escala, estación, terminal, fecha y posición seleccionadas; no la infiere del título de “agente de rampa” ni del mero inicio de sesión. La interfaz restringida de Gestión Humana registra cualificaciones y permisos contra la API canónica y consulta los turnos. Solo OCC puede registrar un turno mediante el `PUT` heredado durante la transición a su calendario. Un día libre o restricción aprobada bloquea la asignación en las fechas cubiertas, incluido el inicio de un turno nocturno; un cambio de turno aprobado no equivale por sí solo a ausencia. La API registra solicitudes pendientes y decisiones auditadas: no permite aprobar una ausencia que choque con una operación aún asignada. El calendario OCC de 15 días todavía requiere implementación.

Fuentes: [`OccAgentEligibilityPolicy`](../../backend/Elevant.Application/Operations/OccAgentEligibilityPolicy.cs), [`EfOccPlanningReadStore`](../../database/DevelopmentDB/Elevant.Persistence/Operations/EfOccPlanningReadStore.cs), [`EfRampProfileStore`](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfRampProfileStore.cs), [`EfGovernanceStore`](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfGovernanceStore.cs).
