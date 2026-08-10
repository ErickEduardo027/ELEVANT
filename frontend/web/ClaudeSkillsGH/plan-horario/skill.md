CONTEXTO:
Estamos en la rama de Gestión Humana de ELEVANT. Ya existen Home/Sidebar, Dashboard, Gestión de Usuarios, Habilitaciones y Certificaciones y Carnets/Permisos. Inspecciona estos módulos antes de implementar y reutiliza sus componentes, tokens y patrones (KpiCard, StatusBadge, tablas, drawers, modales, filtros y estados).

Usa frontend-design skill antes de generar código. No dupliques componentes ni reconstruyas patrones existentes.

OBJETIVO:
Implementar "Horarios y Disponibilidad" para planificar turnos rotativos de 8 horas, asignar agentes por terminal/posición y detectar problemas de cobertura.

CONTEXTO OPERATIVO:
Actualmente hay ~54 agentes, con crecimiento previsto a 84 bajo el modelo de un agente por posición. La planificación parte de itinerarios de temporada → itinerario semanal confirmado → horario del personal. La demanda cambia durante el día, por lo que la cobertura debe analizarse por franja horaria y terminal.

VISTAS:

1. CALENDARIO DE TURNOS — principal
Crear una vista semanal donde:
- columnas = días
- filas = agentes
- cada celda muestra turno (ej. 06:00–14:00), terminal y posición si aplica
- diferenciar visualmente Terminal A/B
- distinguir "sin turno" de "no disponible" mediante patrón sutil
- navegación semana anterior/siguiente
- filtros por terminal, agente y semana
- clic en una celda abre modal/popover para crear o editar asignación

Resumen superior usando KpiCard:
- agentes programados
- agentes en turno de madrugada
- alertas de cobertura

2. COBERTURA POR POSICIÓN
Crear vista por franjas horarias mostrando:
- agentes disponibles
- posiciones requeridas
- cobertura por Terminal A/B
- estado: completa, parcial/en riesgo o crítica

Permitir detectar visualmente déficits, especialmente franjas donde pocos agentes cubren ambas terminales.

3. SOLICITUDES DE DISPONIBILIDAD
Sección secundaria para solicitudes de cambio/restricciones de agentes:
- agente
- fecha/turno solicitado
- motivo
- estado
- aprobar/rechazar

ASIGNACIÓN DE TURNO:
Modal reutilizable con:
- agente
- fecha
- horario
- terminal
- posición inicial si aplica

Validar antes de guardar:
- disponibilidad del agente
- conflictos de horario
- habilitación necesaria para la posición, cuando corresponda.

Mostrar advertencia o impedir la asignación según la gravedad del conflicto.

ESTADOS:
Implementar:
- loading/skeleton
- semana con cobertura completa
- semana con déficit
- franja crítica
- modal de asignación abierto
- solicitud pendiente
- semana sin turnos

MICROINTERACCIONES:
- transición suave al crear/editar turno
- toast de confirmación
- highlight sutil para déficit
- fade al cambiar de vista
- transición lateral al cambiar de semana

RESPONSIVE:
Desktop prioritario.
Tablet: permitir scroll horizontal del calendario o vista diaria.
Mobile no prioritario.

DATOS/API:
Usar mocks realistas, pero separar claramente UI, types y capa de datos para poder sustituirlos posteriormente por API REST sin rehacer componentes. No inventar endpoints reales.

REUTILIZAR:
KpiCard, StatusBadge, filtros, modales/drawers y patrones existentes.
Nuevos componentes solo si realmente son necesarios:
ShiftCalendar, ShiftCell, ShiftAssignmentModal, CoverageByPositionView, AvailabilityRequestsPanel.

REGLAS:
- Mantener exactamente los tokens y diseño de Gestión Humana.
- Modo claro/oscuro.
- Cero emojis.
- Cero librerías innecesarias.
- No modificar módulos anteriores salvo por reutilización/refactor mínimo.
- Mantener rutas y navegación existentes.
- Verificar TypeScript, lint/build al finalizar.

Implementa directamente la ruta de Horarios y Disponibilidad dentro del shell existente de Gestión Humana.