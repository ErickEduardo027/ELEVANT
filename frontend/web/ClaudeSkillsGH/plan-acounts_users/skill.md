CONTEXTO DE CONTINUIDAD — LEE ANTES DE EMPEZAR:

Estamos trabajando en una rama independiente para el entorno de Gestión Humana.

Ya existe:
- El entorno completo de Administrador/OCC en la rama `feat/adminocc`
- Home/Sidebar de Gestión Humana
- Dashboard de Gestión Humana

ANTES DE CREAR NADA:

Inspecciona primero el proyecto actual y la rama `feat/adminocc`.

Busca y analiza específicamente:
- AppShell
- Sidebar
- SidebarItem
- Topbar
- KpiCard
- StatusBadge
- tablas
- drawers
- modales
- formularios
- paneles de detalle
- patrones de búsqueda/filtros
- patrones de auditoría
- sistema de rutas
- tokens de diseño
- componentes reutilizables
- tipos/interfaces
- servicios/API existentes
- cualquier componente relacionado con usuarios, roles, permisos o autenticación

No copies código innecesariamente desde `feat/adminocc`.

Reutiliza componentes existentes cuando sea posible y generalízalos si son suficientemente genéricos para ser compartidos entre entornos.

El entorno Gestión Humana debe mantener exactamente el mismo lenguaje visual y sistema de diseño de ELEVANT.

USA EL SKILL DE FRONTEND-DESIGN antes de generar código.

--------------------------------------------------
MÓDULO
--------------------------------------------------

Construye el módulo:

"Gestión de usuarios y cuentas"

Ruta sugerida:

`/gestion-humana/usuarios`

Debe integrarse dentro del AppShell/Sidebar de Gestión Humana ya existente.

NO reconstruyas:
- AppShell
- Sidebar
- Topbar
- sistema de tema
- navegación general

Solo construye el contenido de este módulo y su integración con la ruta existente.

--------------------------------------------------
CONTEXTO FUNCIONAL — MUY IMPORTANTE
--------------------------------------------------

Este módulo es el punto central de IDENTIDAD Y ACCESO de todo ELEVANT.

Desde Gestión Humana se crean y administran las cuentas que posteriormente permitirán a los usuarios acceder a los diferentes entornos de la plataforma.

ELEVANT tendrá un LOGIN GENERAL o mecanismos de acceso asociados según el tipo de usuario.

Los tipos de acceso contemplados son:

1. Administrador/OCC
2. Contratos
3. Gestión Humana
4. Finanzas
5. Agente de Rampa
6. Cliente / Aerolínea

La arquitectura contempla:

### Back-office

Comparten el portal general de administración:

- Administrador/OCC
- Contratos
- Gestión Humana
- Finanzas

### Agente de Rampa

El usuario utilizará principalmente la aplicación móvil nativa.

La cuenta y credencial se originan igualmente desde Gestión Humana.

### Cliente / Aerolínea

El usuario utilizará el portal web de la aerolínea.

La cuenta debe quedar vinculada a una aerolínea/empresa cliente específica.

Por tanto, este módulo NO debe tratar a todos los usuarios como si fueran empleados internos iguales.

El formulario debe adaptarse dinámicamente según el tipo de usuario/rol seleccionado.

--------------------------------------------------
MODELO CONCEPTUAL
--------------------------------------------------

Mantén separadas conceptualmente estas tres capas:

IDENTIDAD
Quién es la persona.

CUENTA
Si posee una cuenta y cuál es su estado.

ACCESO
A qué portal puede acceder y qué rol/permisos tiene.

Ejemplo:

María Rodríguez
→ identidad

Cuenta activa
→ cuenta

Gestión Humana
→ portal

Gestión Humana
→ rol

Consultar / Editar / Administrar
→ permisos

La UI debe reflejar esta separación.

--------------------------------------------------
SEGURIDAD — MUY IMPORTANTE
--------------------------------------------------

Este es un módulo FRONTEND.

NO implementes desde React:

- hashing de contraseñas
- generación real de JWT
- autenticación real
- autorización backend
- acceso directo a SQL Server
- almacenamiento de contraseñas
- secretos
- credenciales reales
- lógica de seguridad que corresponda al backend

El frontend debe quedar preparado para consumir los servicios reales.

Las contraseñas NUNCA deben mostrarse ni almacenarse en estado de React.

El flujo recomendado es:

Crear cuenta
→ backend crea identidad/cuenta
→ backend envía invitación o enlace temporal
→ usuario establece su contraseña
→ usuario utiliza el mecanismo de login correspondiente
→ backend determina sus roles/permisos/portales

La interfaz debe soportar este flujo.

--------------------------------------------------
ESTILO VISUAL
--------------------------------------------------

Mantener exactamente el lenguaje visual ELEVANT:

Premium
Corporativo
Minimalista
Enterprise
Glassmorphism moderado
Modo claro/oscuro
Cero emojis
Iconografía de línea fina

Paleta:

- Navy: #0B1F3F
- Azul: #145DC4
- Naranja: #F2661E

Light:

- Background: #F7F9FB
- Cards: #FFFFFF
- Main text: #0B1F3F
- Secondary text: #6B7684

Dark:

- Background: #0A1220
- Cards: rgba(11,31,63,0.55)
- Main text: #F4F6F9
- Secondary text: #94A3B8

Estados:

- Activa: #1E9E6B
- Pendiente de activación: #D9A441
- Invitación enviada: #145DC4
- Deshabilitada: #6B7684
- Bloqueada/crítica: #C4453C

--------------------------------------------------
ESTRUCTURA DEL MÓDULO
--------------------------------------------------

Construye una vista MASTER-DETAIL.

--------------------------------------------------
1. HEADER
--------------------------------------------------

Título:

"Gestión de usuarios y cuentas"

Descripción:

"Administra las cuentas, roles y accesos de los usuarios de ELEVANT."

A la derecha:

Botón principal:

"Crear usuario"

Utilizar el componente de botón existente si ya está disponible.

--------------------------------------------------
2. RESUMEN / KPIs
--------------------------------------------------

Crear una fila compacta de KPIs:

- Usuarios activos
- Cuentas pendientes de activación
- Cuentas deshabilitadas
- Usuarios por portal

Reutilizar `KpiCard` de `feat/adminocc` si existe y es reutilizable.

--------------------------------------------------
3. TABLA DE USUARIOS
--------------------------------------------------

Construir una tabla enterprise.

Columnas:

- Usuario
  - nombre
  - avatar/iniciales
  - correo
- Identificación
- Tipo de usuario
- Portal
- Rol
- Estación/departamento/aerolínea vinculada
- Estado
- Fecha de creación
- Último acceso
- Acciones

Las columnas pueden adaptarse según el ancho de pantalla.

Los roles deben utilizar badges visualmente consistentes.

--------------------------------------------------
4. TIPOS DE USUARIO / PORTALES
--------------------------------------------------

Contemplar:

### Administrador/OCC
Portal:
Back-office

### Contratos
Portal:
Back-office

### Gestión Humana
Portal:
Back-office

### Finanzas
Portal:
Back-office

### Agente de Rampa
Portal:
Aplicación móvil de Agente

### Cliente / Aerolínea
Portal:
Portal web de Aerolínea

No asumir que todos los usuarios poseen múltiples portales.

Sin embargo, la estructura debe soportar múltiples accesos si el backend lo permite.

--------------------------------------------------
5. FILTROS
--------------------------------------------------

Agregar:

Buscador:
- nombre
- correo
- identificación

Filtros:

- Tipo de usuario
- Rol
- Portal
- Estado
- Terminal/estación
- Aerolínea
- Departamento

Mostrar únicamente los filtros relevantes según los datos disponibles.

Agregar:

"Limpiar filtros"

Preparar la búsqueda para poder migrar posteriormente a búsqueda server-side/debounce.

--------------------------------------------------
6. CREAR / EDITAR USUARIO
--------------------------------------------------

Abrir un drawer lateral o modal grande según el patrón ya utilizado en el proyecto.

Preferiblemente drawer.

El formulario debe ser dinámico.

### PASO 1 — Tipo de usuario / rol

Mostrar claramente:

- Administrador/OCC
- Contratos
- Finanzas
- Gestión Humana
- Agente de Rampa
- Cliente Aerolínea

La selección determina qué campos aparecerán posteriormente.

--------------------------------------------------
7. CAMPOS COMUNES
--------------------------------------------------

Todos los usuarios:

- Nombre
- Apellido
- Correo electrónico
- Teléfono
- Tipo de identificación
- Número de identificación
- Foto de perfil opcional
- Estado de cuenta

El correo representa el usuario/canal de acceso según la arquitectura definida por backend.

--------------------------------------------------
8. CAMPOS PARA BACK-OFFICE
--------------------------------------------------

Para:

- Administrador/OCC
- Contratos
- Finanzas
- Gestión Humana

Mostrar:

- Departamento
- Cargo
- Nivel de acceso, si aplica
- Rol
- Permisos derivados

No inventar una matriz definitiva de permisos.

Si existen roles/permisos en el código o documentación, reutilizarlos.

--------------------------------------------------
9. CAMPOS PARA AGENTE DE RAMPA
--------------------------------------------------

Cuando se seleccione:

"Agente de Rampa"

mostrar:

- Terminal A
- Terminal B
- Ambas
- Número de empleado
- Cargo/categoría
- Fecha de ingreso
- Supervisor, si aplica
- Estado

Agregar un mensaje informativo:

"Esta cuenta habilita el acceso del agente a la aplicación móvil de operaciones."

No implementar aquí las habilitaciones completas.

Mostrar un resumen/enlace hacia el futuro módulo:

"Habilitaciones y certificaciones"

--------------------------------------------------
10. CAMPOS PARA CLIENTE / AEROLÍNEA
--------------------------------------------------

Cuando se seleccione:

"Cliente Aerolínea"

mostrar:

- Aerolínea vinculada
- Persona de contacto
- Cargo dentro de la aerolínea
- Correo
- Teléfono

El selector de aerolínea debe estar preparado para consumir las aerolíneas existentes en el módulo/servicio correspondiente de Contratos.

No crear datos duplicados de aerolíneas si ya existe un catálogo.

--------------------------------------------------
11. CREDENCIALES
--------------------------------------------------

Crear una sección:

"Acceso y credenciales"

NO pedir contraseña directamente.

Por defecto:

"Enviar invitación por correo"

Mostrar:

Portal de acceso:

Back-office
o
Aplicación móvil de Agente
o
Portal de Aerolínea

según el tipo de usuario.

Texto informativo:

"El usuario establecerá su contraseña mediante el proceso seguro de activación."

Si el backend posteriormente contempla contraseña temporal, deja la UI preparada, pero no almacenes ni muestres la contraseña desde frontend.

--------------------------------------------------
12. ROLES Y PERMISOS
--------------------------------------------------

Mostrar el rol seleccionado.

Los permisos pueden aparecer como:

"Permisos heredados del rol"

Ejemplos:

- Consultar
- Crear
- Editar
- Aprobar
- Exportar
- Administrar

Si el backend utiliza RBAC, tratar los permisos como derivados del rol.

NO implementar permisos manuales individualmente si el backend no lo soporta.

--------------------------------------------------
13. DETALLE DEL USUARIO
--------------------------------------------------

Al hacer clic en una fila, abrir `UserDetailPanel` o drawer.

Tabs:

### Información general

Mostrar todos los datos.

### Roles y permisos

Mostrar:
- rol actual
- portal
- permisos
- cambios históricos

### Acceso

Mostrar:
- estado
- último acceso
- fecha de creación
- invitación
- activación

### Actividad

Mostrar:
- accesos
- cambios
- acciones relevantes

### Habilitaciones

Mostrar SOLO para Agente de Rampa.

Resumen de habilitaciones.

Agregar enlace:

"Ver habilitaciones completas"

que dirija al futuro módulo correspondiente.

--------------------------------------------------
14. ACCIONES DE CUENTA
--------------------------------------------------

Desde detalle o menú contextual:

- Editar
- Activar
- Desactivar
- Reenviar invitación
- Restablecer acceso
- Ver historial

No utilizar "Eliminar usuario" como acción principal.

Las cuentas deben conservar trazabilidad histórica.

--------------------------------------------------
15. DESACTIVAR CUENTA
--------------------------------------------------

Al seleccionar:

"Desactivar"

mostrar confirmación:

"¿Desactivar esta cuenta?"

Incluir el nombre del usuario.

Texto:

"El usuario perderá el acceso a los portales asociados hasta que la cuenta vuelva a activarse."

Botones:

Cancelar
Desactivar cuenta

No eliminar información histórica.

--------------------------------------------------
16. ACTIVACIÓN
--------------------------------------------------

Cuando una cuenta esté:

"Pendiente de activación"

mostrar:

- fecha de creación
- estado de invitación
- opción "Reenviar invitación"

Después de activar:

mostrar toast:

"Cuenta activada correctamente."

--------------------------------------------------
17. ACCIONES MASIVAS
--------------------------------------------------

Permitir selección múltiple si los patrones existentes lo permiten.

Acciones:

- Activar seleccionados
- Desactivar seleccionados

Mostrar barra contextual.

Siempre pedir confirmación antes de acciones masivas.

--------------------------------------------------
18. AUDITORÍA
--------------------------------------------------

El detalle debe incluir:

"Ver historial"

Eventos:

- Cuenta creada
- Invitación enviada
- Cuenta activada
- Rol modificado
- Portal modificado
- Cuenta desactivada
- Cuenta reactivada
- Acceso restablecido

Cada evento:

- acción
- usuario responsable
- fecha/hora

Reutilizar el patrón de auditoría existente.

--------------------------------------------------
19. MICROINTERACCIONES
--------------------------------------------------

- Cambio de rol con fade/collapse.
- Hover sutil en filas.
- Fila seleccionada con glass.
- Drawer con transición suave.
- Toast después de operaciones exitosas.
- Confirmación para acciones críticas.
- Loading durante requests.
- Deshabilitar botones durante requests.
- Evitar doble envío.
- Actualización de la tabla después de una operación exitosa.

--------------------------------------------------
20. ESTADOS
--------------------------------------------------

Implementar:

Loading:
- skeleton KPIs
- skeleton tabla

Empty:
"No hay usuarios registrados."

Sin resultados:
"No hay usuarios que coincidan con los filtros."

Pendiente:
Cuenta pendiente de activación.

Activo:
Cuenta activa.

Deshabilitado:
Cuenta deshabilitada.

Error:
" No fue posible cargar los usuarios."
Botón:
"Reintentar"

Formulario:
- Back-office
- Agente de Rampa
- Cliente Aerolínea

Confirmación:
Desactivación.

--------------------------------------------------
21. RESPONSIVE
--------------------------------------------------

Desktop 1440px+:

- KPIs
- tabla completa
- drawer 50-60%

Tablet 1024px:

- columnas reducidas
- drawer como overlay amplio

Mobile:

No prioritario, pero:
- convertir tabla en cards/lista
- drawer a pantalla completa

--------------------------------------------------
22. COMPONENTES
--------------------------------------------------

Reutilizar componentes existentes.

Componentes sugeridos:

- UserManagementPage
- UserStats
- UserFilterBar
- UserTable
- UserTableRow
- UserRoleBadge
- UserStatusBadge
- UserFormDrawer
- RoleSelector
- ConditionalRoleFields
- UserAccessSection
- PermissionList
- UserDetailPanel
- AccountActions
- AccountAuditTimeline
- DeactivateConfirmModal
- BulkActionsBar

No duplicar componentes existentes.

--------------------------------------------------
23. API / DATOS
--------------------------------------------------

Preparar una capa de servicios separada de la UI.

Buscar primero si ya existen contratos/API/clientes.

Operaciones esperadas conceptualmente:

GET usuarios
GET usuario por ID
POST crear usuario
PATCH/PUT actualizar usuario
POST activar cuenta
POST desactivar cuenta
POST reenviar invitación
POST restablecer acceso
GET roles
GET permisos
GET historial del usuario
GET aerolíneas

IMPORTANTE:

No inventes contratos definitivos si ya existen OpenAPI, tipos o servicios.

Si todavía no existe backend:

crear mocks realistas y una capa de servicio fácilmente reemplazable.

Los mocks deben respetar la arquitectura:

identity
account
access
roles
permissions
portal

--------------------------------------------------
24. MODELO DE DATOS FRONTEND
--------------------------------------------------

Si el proyecto no tiene tipos definidos, utilizar una estructura conceptualmente similar a:

UserIdentity:
- id
- firstName
- lastName
- email
- phone
- identification
- avatar

UserAccount:
- id
- userId
- status
- createdAt
- lastLoginAt
- invitationStatus

UserAccess:
- portals
- roles
- permissions

RoleSpecificData:

BackOffice:
- department
- position

RampAgent:
- employeeNumber
- terminals
- category
- hireDate

Airline:
- airlineId
- contactPosition

No fuerces exactamente estos nombres si el proyecto ya tiene convenciones diferentes.

--------------------------------------------------
25. INTEGRACIÓN CON LOGIN
--------------------------------------------------

Este módulo NO debe crear un login nuevo.

Debe preparar la información necesaria para que posteriormente el LOGIN GENERAL o mecanismo de autenticación correspondiente pueda determinar:

- identidad
- estado de cuenta
- roles
- permisos
- portales disponibles

Conceptualmente:

User
→ Identity
→ Account
→ Roles
→ Permissions
→ Accessible Portals

Ejemplo:

Usuario:
Juan Pérez

Account:
Active

Roles:
Operator OCC

Portal:
Back-office

Permissions:
Consultar vuelos
Revisar operaciones
Consultar reportes

Otro ejemplo:

Usuario:
Carlos Rodríguez

Account:
Active

Role:
Ramp Agent

Portal:
Mobile Agent

Otro:

Usuario:
Laura Smith

Account:
Active

Role:
Airline User

Portal:
Airline Portal

--------------------------------------------------
26. RESPONSABILIDAD DEL FRONTEND
--------------------------------------------------

El frontend:

SÍ:
- administra formularios
- muestra usuarios
- muestra estados
- muestra roles
- muestra permisos recibidos
- muestra portales
- dispara acciones API
- maneja estados de carga/error
- valida formularios básicos
- muestra confirmaciones

El frontend NO:
- autentica realmente
- genera JWT
- almacena contraseñas
- decide permisos reales
- accede directamente a SQL
- contiene secretos
- implementa lógica de seguridad backend

--------------------------------------------------
27. ENTREGABLES
--------------------------------------------------

Construir:

1. Vista completa del módulo.
2. KPIs.
3. Tabla.
4. Buscador.
5. Filtros.
6. Crear usuario.
7. Editar usuario.
8. Selección dinámica de roles.
9. Campos condicionales Back-office.
10. Campos condicionales Agente.
11. Campos condicionales Cliente Aerolínea.
12. Configuración de portal.
13. Roles y permisos.
14. Detalle de usuario.
15. Activar/desactivar.
16. Reenviar invitación.
17. Auditoría.
18. Selección múltiple.
19. Loading.
20. Empty.
21. Error.
22. Light mode.
23. Dark mode.
24. Responsive.
25. Integración con la ruta de Gestión Humana.

--------------------------------------------------
RESTRICCIONES
--------------------------------------------------

- Cero emojis.
- Cero iconografía decorativa.
- No modificar innecesariamente Dashboard de Gestión Humana.
- No modificar AppShell/Sidebar salvo la integración mínima de la ruta.
- No crear otro sistema de login.
- No almacenar contraseñas.
- No crear autenticación falsa que pueda confundirse con producción.
- No acceder directamente a SQL Server.
- No introducir librerías innecesarias.
- No romper módulos existentes.
- No duplicar componentes que ya existan.
- Mantener exactamente los tokens visuales ELEVANT.
- No inventar contratos API si ya existen.
- No inventar una matriz definitiva de permisos si todavía no está definida por backend.

--------------------------------------------------
VERIFICACIÓN FINAL
--------------------------------------------------

Antes de terminar:

1. Ejecuta la aplicación.
2. Comprueba la ruta del módulo.
3. Comprueba que aparece desde el Sidebar de Gestión Humana.
4. Comprueba la tabla.
5. Comprueba búsqueda y filtros.
6. Comprueba creación.
7. Comprueba edición.
8. Comprueba cambio dinámico de rol.
9. Comprueba campos de Agente.
10. Comprueba campos de Cliente Aerolínea.
11. Comprueba detalle.
12. Comprueba activar/desactivar.
13. Comprueba reenviar invitación.
14. Comprueba estados loading/empty/error.
15. Comprueba light/dark.
16. Ejecuta TypeScript/lint/tests disponibles.
17. Verifica que no se rompió el entorno existente.

AL FINAL, ENTREGA UN RESUMEN:

- Archivos creados/modificados.
- Componentes reutilizados desde `feat/adminocc`.
- Componentes reutilizados de Gestión Humana.
- Funcionalidades implementadas.
- Modelo de datos utilizado.
- Mocks/API preparados.
- Pruebas ejecutadas.
- Errores encontrados.
- Pendientes que dependen del backend.
- Decisiones importantes tomadas.