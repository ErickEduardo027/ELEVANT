# Perfil de rampa y acceso móvil

Gestión Humana registra el perfil operativo del agente en **Agentes de rampa** de Private Web: nombre, número de empleado, categoría, fecha de ingreso, estado y estaciones. El API guarda `Person`, `RampAgent` y los scopes de estación de forma transaccional. Crear un perfil **no** crea credenciales.

Superadministración, en **Usuarios**, elige el rol protegido `RAMP_AGENT` y selecciona un perfil activo sin cuenta y con al menos una estación vigente. El API reutiliza esa persona, crea una sola cuenta interna con contraseña temporal, vincula el rol móvil y concede los scopes de cuenta correspondientes. La app móvil necesita rol, membresía AVIAM y scope de estación. Desactivar el perfil desde Gestión Humana revoca los scopes de cuenta y deshabilita la cuenta vinculada. La reactivación de una cuenta deshabilitada se resuelve en Superadministración, después de revisar el perfil.

## Guía de asignación para OCC

El perfil y la cuenta son requisitos de acceso, **no** una habilitación global para cualquier servicio. OCC calcula elegibilidad para una operación y posición concreta mediante `OccAgentEligibilityPolicy` y sus lecturas canónicas. Puede rechazar la asignación por:

1. perfil inactivo, cuenta móvil ausente o scope de estación/terminal faltante;
2. posición operativa no disponible o cualificación vigente faltante para esa posición y su equipo;
3. carnet aeroportuario o licencia de conducción en rampa no vigentes;
4. turno incompatible o conflicto con otra asignación.

Gestión Humana debe preparar y mantener los datos laborales antes de la planificación. OCC confirma la elegibilidad para la escala, estación, terminal, fecha y posición seleccionadas; no la infiere del título de “agente de rampa” ni del mero inicio de sesión. La interfaz de perfiles de esta entrega administra perfil base y estaciones. El registro de terminales, turnos, permisos y cualificaciones usa los modelos canónicos y las reglas OCC, pero todavía requiere una interfaz de Gestión Humana conectada al API antes de que se puedan gestionar allí; las pantallas heredadas de esas áreas no acreditan persistencia real.

Fuentes: [`OccAgentEligibilityPolicy`](../../backend/Elevant.Application/Operations/OccAgentEligibilityPolicy.cs), [`EfOccPlanningReadStore`](../../database/DevelopmentDB/Elevant.Persistence/Operations/EfOccPlanningReadStore.cs), [`EfRampProfileStore`](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfRampProfileStore.cs), [`EfGovernanceStore`](../../database/DevelopmentDB/Elevant.Persistence/Identity/EfGovernanceStore.cs).
