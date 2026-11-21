# ADR-0047: Alcance de la versión 1: sin gastos y Gestión Humana esencial

## Estado

Accepted — 2026-11-21.

## Contexto

La revisión del profesor del 22 de noviembre de 2026 se centra en la reportería. Erick pidió el 20 de noviembre una versión 1 de AVIAM Web más simple:

- quitar «Mis gastos», que aparecía en OCC, Gestión Humana, Contratos y Finanzas, y «Gastos de empleados» de Finanzas;
- dejar en Gestión Humana lo esencial, con el menú agrupado por secciones, como el de Finanzas.

La API, las tablas y las reglas de gastos ([ADR-0040](0040-billing-cycle-invoicing-from-operations-card-collections-credit-notes-and-payables.md)) y de requisiciones ([ADR-0017](0017-employees-positions-and-access.md)) ya están en Development, con datos de prueba. Quitarlos del servidor exigiría migraciones de contracción y cambios en el contrato OpenAPI, y no hace falta para simplificar la interfaz.

## Decisión

**1. Gastos fuera de la interfaz.**
- AVIAM Web deja de mostrar «Mis gastos» en los cuatro departamentos y «Gastos de empleados» en Finanzas. Se borra la ruta `/admin-occ/expenses`. También se borran `ExpensesPage` y `DepartmentExpensesPage`, con sus pruebas y su suscripción a `finance_expenses`.
- «Cuentas por pagar» de Finanzas queda con Facturas de proveedores y Proveedores.
- Se conservan la API (`/finance/expenses…`), las tablas, los permisos del catálogo del servidor y `financePayablesService.js`.

**2. Gestión Humana esencial.**
- El menú se agrupa en secciones: **Personal** (Dashboard, Empleados), **Operación de rampa** (Agentes de rampa, Habilitaciones y certificaciones, Carnets y permisos aeroportuarios, Horarios y disponibilidad, Revisión de asistencia), **Seguimiento** (Reportes, Trazabilidad / Auditoría) y **Accesos** (Validaciones de acceso, Usuarios del departamento). **Configuración** va aparte. Las secciones solo ordenan los módulos que la cuenta ya puede abrir; una sección sin módulos permitidos no aparece.
- **Puestos** deja de ser entrada del menú y pasa a ser una pestaña de **Empleados**, visible con `human_resources.positions.read`.
- **Requisiciones** sale del menú de Gestión Humana y de «Usuarios del departamento» de todos los departamentos (pestaña «Requisiciones» y «Pedir personal»). El formulario de alta de un empleado ya no ofrece cubrir una requisición. Un aviso antiguo de requisición abre Empleados.
- La página **Notificaciones** de Gestión Humana sale. La campana se queda, gobernada por `human_resources.notifications.read`.
- Las rutas `/gestion-humana/positions`, `/requisitions`, `/notifications` y `/expenses` responden 404.
- Se borra el código muerto que leía mocks: la página de notificaciones del prototipo, su servicio y sus fixtures, y `usersMock.js`.

**3. Destino por defecto.** OCC y Gestión Humana pasan a `useNavigationGuard` su `homePath` (el Dashboard) y su `basePath`.
- La entrada del departamento abre el Dashboard si la cuenta puede leerlo.
- Si no puede, la entrada y la ruta del Dashboard llevan al primer módulo permitido.
- Una cuenta sin módulos se queda donde está y ve «Sin módulos asignados».

**4. Editor de plantillas.** La matriz de permisos y las etiquetas de permisos ocultan, solo en el cliente, `finance.expenses` y `human_resources.requisitions` (y las subventanas que vivan dentro de ellos). El catálogo del servidor no cambia, y los permisos que una plantilla ya concede se conservan.

## Consecuencias

- El cambio es solo de AVIAM Web: no toca la API, la base de datos ni el contrato OpenAPI. Se despliega con web-cd.
- Los gastos y requisiciones que ya existen en la base siguen ahí, sin pantalla. Volver a mostrarlos es un cambio de interfaz, sin migración.
- El E2E del ciclo (fase 4) deja de recorrer los gastos y comprueba que el menú de Finanzas no los ofrece.

## Fuera de alcance

- Retirar del servidor los endpoints, permisos o tablas de gastos y requisiciones.
- Cambios en la tablet o en el portal de aerolíneas.
