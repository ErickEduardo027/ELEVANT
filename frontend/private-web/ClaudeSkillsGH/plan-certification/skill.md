CONTEXTO DE CONTINUIDAD — LEE ANTES DE EMPEZAR:

Ya existen en el proyecto:

ENTORNO ADMINISTRADOR/OCC:
- Dashboard
- AppShell / Sidebar
- Monitoreo de Vuelos
- Revisión
- Reportes
- Notificaciones
- Chat Interno
- Mapa de Posiciones

ENTORNO GESTIÓN HUMANA:
- Home / Sidebar
- Dashboard
- Gestión de Usuarios y Cuentas

Antes de crear o modificar cualquier cosa, inspecciona el proyecto actual.

Revisa especialmente:

- El Dashboard de Gestión Humana y su panel "Vencimientos próximos".
- El semáforo de estados vigente / próximo a vencer / vencido.
- El UserDetailPanel de Gestión de Usuarios, especialmente el tab "Habilitaciones".
- KpiCard.
- StatusBadge.
- Tablas existentes.
- Drawers y paneles de detalle.
- Formularios existentes.
- Modales y confirmaciones.
- Toasts.
- Patrones de loading, empty y error states.
- Sistema de rutas.
- Hooks y servicios existentes.
- Arquitectura utilizada para mocks/API.

Este módulo es la versión completa y gestionable de la información resumida en el Dashboard y el UserDetailPanel.

NO reconstruyas AppShell, Sidebar, Topbar ni componentes globales que ya existan.

Integra el módulo como nueva ruta dentro del shell actual de Gestión Humana, accesible desde "Habilitaciones y certificaciones".

---

ACTÚA COMO:

Senior Frontend Engineer + Product Designer especializado en aplicaciones enterprise.

Construye el módulo de:

"Habilitaciones y Certificaciones"

para el entorno Gestión Humana de ELEVANT, plataforma de gestión de operaciones de ground handling para AVIAM Ltd. en el aeropuerto de Punta Cana (PUJ).

Usa el skill de frontend-design disponible antes de generar código.

Mantén coherencia absoluta con el lenguaje visual existente de ELEVANT.

---

CONTEXTO FUNCIONAL:

Cada agente de rampa requiere certificaciones específicas para poder operar determinados equipos.

Las habilitaciones son otorgadas y renovadas por la escuela de entrenamiento interna ALC, avalada por IDAC.

Ejemplos de equipos:

- Puente de abordaje
- Cinta transportadora / Belt Loader
- Loader
- Escaleras de pasajeros
- Club Car
- Tractor / Pushback
- Baggage Cart
- Dollies
- GPU
- ACU
- ASU
- Otros equipos que puedan agregarse posteriormente

Sin una habilitación vigente, el agente no debe poder ser asignado a una operación o posición que requiera dicha habilitación.

Actualmente este seguimiento se realiza manualmente mediante una bitácora Excel con semáforo:

- Verde = vigente
- Amarillo = próximo a vencer
- Rojo = vencido

Este módulo digitaliza ese proceso.

IMPORTANTE:

El frontend debe representar el estado de habilitación y dejar preparada la estructura para que posteriormente el backend pueda utilizar esta información para validar/bloquear asignaciones.

NO implementar una lógica de bloqueo de operaciones dentro de este módulo si esa responsabilidad corresponde a otro servicio/backend.

En su lugar, exponer claramente el estado y dejar preparada la información necesaria para que otros módulos puedan consultarla posteriormente.

---

OBJETIVOS DEL MÓDULO:

Gestión Humana debe poder:

1. Consultar las habilitaciones de todos los agentes.
2. Identificar rápidamente vencimientos.
3. Ver qué equipos puede operar cada agente.
4. Registrar nuevas habilitaciones.
5. Registrar renovaciones.
6. Consultar historial.
7. Identificar agentes con certificaciones vencidas.
8. Identificar riesgos de cobertura por tipo de equipo.
9. Consultar el estado de una habilitación individual.
10. Preparar la información para futuras validaciones de asignación operativa.

---

ESTILO VISUAL:

Mantener exactamente el lenguaje visual existente:

- Premium
- Corporativo
- Minimalista
- Enterprise
- Glassmorphism moderado
- Modo claro/oscuro
- Iconografía de línea fina
- Cero emojis
- Cero iconografía decorativa tipo consumer app

No inventar un nuevo lenguaje visual.

---

PALETA:

Primario:
#0B1F3F

Azul:
#145DC4

Naranja:
#F2661E

Verde:
#1E9E6B

Ámbar:
#D9A441

Rojo:
#C4453C

Light:
#F7F9FB
#FFFFFF

Dark:
#0A1220
rgba(11,31,63,0.55)

---

ESTADOS:

Vigente:
#1E9E6B

Próxima a vencer:
#D9A441

Vencida:
#C4453C

Los estados deben utilizar los mismos badges y semáforo visual existentes en el Dashboard de Gestión Humana.

---

ESTRUCTURA DEL MÓDULO:

El módulo tendrá dos vistas principales mediante tabs:

1. "Por agente"
2. "Por tipo de equipo"

La vista "Por agente" será la vista predeterminada.

---

1. RESUMEN SUPERIOR

Mostrar una fila de KPIs reutilizando KpiCard.

KPIs:

- Habilitaciones vigentes
- Próximas a vencer
- Vencidas
- Agentes con alguna habilitación vencida

El KPI de vencidas debe tener mayor peso visual si el valor es mayor que cero.

No crear un KpiCard nuevo si el existente puede reutilizarse.

---

2. VISTA "POR AGENTE"

Tabla principal.

Columnas:

- Agente
- Identificación / código
- Terminal
- Habilitaciones vigentes
- Próximas a vencer
- Vencidas
- Próxima expiración
- Estado general
- Última actualización
- Acciones

Los conteos deben utilizar mini-badges consistentes con el semáforo.

Ejemplo:

Vigentes: 7
Próximas: 1
Vencidas: 0

Estado general:

- Vigente
- Atención
- Requiere acción

---

FILTROS:

Implementar filtros combinables:

- Buscador por nombre/código/identificación.
- Terminal:
  - Todas
  - Terminal A
  - Terminal B
- Estado:
  - Todos
  - Vigentes
  - Próximas a vencer
  - Vencidas
- Tipo de equipo.

Agregar botón:

"Limpiar filtros"

La tabla debe actualizarse sin recargar la página.

---

ORDENAMIENTO:

Permitir ordenar por:

- Agente
- Terminal
- Habilitaciones vigentes
- Próximo vencimiento
- Cantidad de vencidas
- Última actualización

Orden inicial:

1. Vencidos
2. Próximos a vencer
3. Vigentes

---

DETALLE DEL AGENTE:

Al seleccionar un agente, abrir un drawer/panel de detalle reutilizando el patrón existente.

El panel debe mostrar:

### Información del agente

- Nombre
- Identificación
- Código de empleado
- Terminal
- Fecha de ingreso
- Estado
- Última actualización

### Resumen

- Total de habilitaciones
- Vigentes
- Próximas a vencer
- Vencidas

### Habilitaciones

Cada registro debe mostrar:

- Equipo
- Estado
- Fecha de obtención
- Fecha de vencimiento
- Entidad certificadora
- Última renovación
- Acciones

Entidad certificadora por defecto:

ALC

Pero debe ser un dato configurable proveniente del modelo, no un texto rígido dentro del componente.

---

DETALLE DE HABILITACIÓN:

Permitir visualizar:

- Tipo de equipo
- Estado
- Fecha de entrenamiento
- Fecha de obtención
- Fecha de vencimiento
- Entidad certificadora
- Instructor/evaluador
- Observaciones
- Documento de soporte, si existe
- Historial

---

HISTORIAL:

Mostrar timeline de eventos:

- Habilitación creada
- Entrenamiento completado
- Renovación
- Cambio de estado
- Vencimiento
- Revalidación

Cada evento debe incluir:

- Fecha
- Tipo de evento
- Descripción
- Usuario responsable, si la API posteriormente lo proporciona

No eliminar registros históricos al renovar.

Una renovación debe generar un nuevo evento de historial.

---

3. VISTA "POR TIPO DE EQUIPO"

Crear una vista enfocada en cobertura operativa.

Mostrar tarjetas o tabla para cada equipo:

Ejemplos:

- Puente de abordaje
- Cinta transportadora
- Loader
- Escaleras de pasajeros
- Club Car
- Tractor / Pushback
- GPU
- ACU
- ASU

Cada equipo debe mostrar:

- Total de agentes habilitados
- Vigentes
- Próximos a vencer
- Vencidos
- Porcentaje de cobertura, si los datos disponibles lo permiten
- Terminal

Ejemplo conceptual:

Puente de abordaje

Terminal B

12 agentes habilitados
9 vigentes
2 próximos a vencer
1 vencido

La interfaz debe permitir identificar rápidamente riesgos de cobertura.

Si existe un equipo con pocos agentes habilitados, destacarlo de manera sutil como:

"Cobertura limitada"

No utilizar colores agresivos innecesariamente.

---

DETALLE DE EQUIPO:

Al hacer clic en un equipo:

Mostrar lista filtrada de agentes con esa habilitación.

Columnas:

- Agente
- Terminal
- Estado
- Fecha de vencimiento
- Última renovación
- Acciones

Permitir abrir el detalle del agente.

---

4. REGISTRAR NUEVA HABILITACIÓN

Desde el detalle del agente:

Botón:

"+ Agregar habilitación"

Abrir drawer/modal reutilizando los patrones de formularios existentes.

Campos:

- Agente
- Tipo de equipo
- Fecha de entrenamiento
- Fecha de obtención
- Fecha de vencimiento
- Entidad certificadora
- Instructor/evaluador
- Observaciones
- Documento de soporte opcional

ALC debe aparecer como valor predeterminado de entidad certificadora cuando corresponda, pero debe poder cambiarse si la API permite otras entidades.

---

5. REGISTRAR RENOVACIÓN

Cada habilitación debe tener:

"Registrar renovación"

Formulario corto:

- Nueva fecha de obtención/renovación
- Nueva fecha de vencimiento
- Entidad certificadora
- Instructor/evaluador
- Observaciones
- Documento de soporte opcional

Al guardar:

- Actualizar estado visual.
- Crear evento en historial.
- Mostrar toast.
- Actualizar KPIs.
- Actualizar tabla.
- Actualizar cobertura por equipo.

No borrar el historial anterior.

---

PREPARACIÓN PARA FUTURA API — MUY IMPORTANTE:

La implementación debe ser API-ready.

NO colocar mocks directamente dentro de componentes visuales.

Separar:

UI
→ hooks
→ services/API
→ data provider/mock

La arquitectura debe permitir sustituir los mocks por API REST sin reconstruir los componentes.

Preparar servicios/hooks conceptualmente similares a:

- getQualifications()
- getAgentQualifications(agentId)
- getEquipmentCoverage()
- getQualificationById(id)
- createQualification()
- updateQualification()
- renewQualification()
- getQualificationHistory(id)

Adaptar los nombres a la arquitectura real del proyecto si ya existe una convención.

NO inventar endpoints definitivos del backend.

NO colocar URLs hardcodeadas en los componentes.

Utilizar la configuración existente para API/base URL si ya existe.

Los mocks deben respetar exactamente la misma estructura de datos que utilizaría la UI.

---

MODELO DE DATOS FRONTEND:

Preparar interfaces/types similares a:

AgentQualification:

- id
- agentId
- agentName
- equipmentId
- equipmentName
- terminal
- status
- obtainedAt
- expiresAt
- certifyingEntity
- instructor
- notes
- supportDocument
- updatedAt

QualificationHistory:

- id
- qualificationId
- eventType
- description
- occurredAt
- performedBy

EquipmentCoverage:

- equipmentId
- equipmentName
- terminal
- totalAgents
- active
- expiringSoon
- expired

Los nombres pueden adaptarse a los tipos ya existentes en el proyecto.

No duplicar modelos si ya existe uno compatible.

---

ESTADO "PRÓXIMA A VENCER":

No hardcodear una fecha fija.

Crear una utilidad reutilizable para determinar el estado a partir de:

expiresAt
+
fecha actual
+
ventana configurable

Ejemplo conceptual:

expirationThresholdDays = 30

Pero no asumir que 30 días será necesariamente la regla definitiva del backend.

La API podrá proporcionar posteriormente el estado oficial.

---

INTEGRACIÓN FUTURA CON ASIGNACIONES:

El modelo de habilitación debe permitir identificar:

agentId
equipmentId
status
expiresAt

para que otros módulos puedan consultar posteriormente:

"¿Este agente está habilitado para operar este equipo?"

No implementar esa lógica dentro de este módulo si pertenece al backend o al módulo de operaciones.

Solo asegurar que la estructura de datos permita esa integración.

---

MICROINTERACCIONES:

- Fade suave al cambiar entre tabs.
- Hover sutil en filas.
- Highlight muy ligero para vencidos.
- Toast al registrar/renovar.
- Transición del badge al cambiar de estado.
- Drawer con transición suave.
- Loading skeleton.
- Empty states claros.
- Confirmación antes de acciones destructivas.

No utilizar animaciones agresivas.

---

ESTADOS A SOPORTAR:

Implementar:

1. Loading.
2. Datos normales.
3. Vencimientos próximos.
4. Vencidos.
5. Estado todo vigente.
6. Sin resultados por filtros.
7. Sin agentes.
8. Detalle de agente.
9. Detalle con habilitaciones mixtas.
10. Nueva habilitación.
11. Renovación.
12. Historial.
13. Vista por tipo de equipo.
14. Equipo con cobertura limitada.
15. Error de carga de datos.

---

RESPONSIVE:

Desktop 1440px+:

- KPIs superiores.
- Tabla completa.
- Drawer aproximadamente 50% del ancho.

Tablet 1024px:

- Reducir columnas secundarias.
- Mantener filtros.
- Drawer/overlay de pantalla completa.

Mobile:

No prioritario, pero evitar overflow y ruptura del layout.

---

COMPONENTES:

Reutilizar primero:

- KpiCard
- StatusBadge
- tablas
- filtros
- drawers
- modales
- toast
- skeleton

Solo crear componentes nuevos si realmente no existen.

Posibles componentes:

- QualificationSummary
- QualificationFilters
- QualificationsTable
- AgentQualificationDrawer
- EquipmentCoverageView
- EquipmentDetailPanel
- QualificationFormDrawer
- QualificationHistoryTimeline
- ExpirationIndicator

No duplicar componentes existentes.

---

ENTREGABLES:

Implementar:

1. Vista "Por agente".
2. Vista "Por tipo de equipo".
3. KPIs.
4. Filtros.
5. Buscador.
6. Ordenamiento.
7. Detalle del agente.
8. Detalle de habilitaciones.
9. Registro de nueva habilitación.
10. Registro de renovación.
11. Historial.
12. Cobertura por equipo.
13. Estados de vencimiento.
14. Loading.
15. Empty.
16. Error.
17. Light mode.
18. Dark mode.
19. Integración con Sidebar/ruta.
20. Arquitectura preparada para futura API REST.

---

RESTRICCIONES:

- Cero emojis.
- Cero iconografía decorativa.
- No introducir nuevos colores fuera de los tokens.
- No reconstruir componentes globales.
- No modificar módulos existentes innecesariamente.
- No hardcodear datos dentro de componentes.
- No acoplar UI a mocks.
- No inventar endpoints definitivos.
- No colocar secretos.
- No implementar llamadas directas a base de datos.
- Mantener separación entre UI, lógica y acceso a datos.
- Mantener compatibilidad con la arquitectura actual.
- Mantener exactamente el lenguaje visual de ELEVANT.

Al finalizar, verifica que el módulo funcione con mocks y que sustituir posteriormente el provider/mock por la API REST real no requiera reconstruir la interfaz.