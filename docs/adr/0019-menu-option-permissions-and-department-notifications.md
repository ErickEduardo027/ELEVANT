# ADR-0019: Permisos por opción de menú y notificaciones por departamento

## Estado

Accepted — 2026-10-26.

- Sustituye la sección «Catálogo de permisos» de
  [ADR-0015](0015-department-user-governance.md). El resto de ADR-0015 y de
  [ADR-0017](0017-employees-positions-and-access.md) sigue vigente.
- Mueve a Contratos la gestión del catálogo comercial, que hasta ahora estaba en
  Finanzas (módulo `finance.catalog`, sin ADR propio). Los tarifarios de
  [ADR-0016](0016-finance-tariffs-charges-and-receivables.md) siguen en
  Finanzas; sus códigos `*.manage` se traducen como se explica abajo.

## Contexto

En la revisión del proyecto del 19-oct-2026, el profesor observó lo siguiente:

1. **Permisos.** Los permisos debían concederse por cada opción del menú, con
   «ver, crear, modificar y eliminar» en cada una. La matriz de entonces tenía
   estos problemas:
   - Era módulo × acción, con acciones mezcladas: `manage` agrupaba crear y
     editar, y había verbos de flujo.
   - Algunas opciones del menú compartían código: Servicios pactados con
     Contratos, y Estados de cuenta con Cobros.
   - Algunos módulos no tenían opción de menú.
2. **Notificaciones.** Las notificaciones debían aparecer en pantalla. Solo el
   OCC tenía una campana, que se consultaba cada 15 s. Gestión Humana usaba el
   prototipo, y Contratos y Finanzas no tenían ninguna.
3. **Catálogo comercial.** El equipo decidió que lo gestione Contratos, el área
   que vende los servicios, y que Finanzas conserve los precios.

## Decisión

### Catálogo de permisos

- **Opciones del menú.** Cada opción del menú de cada departamento es un módulo
  del `DepartmentPermissionCatalog`. Cada módulo lleva su `Section` (el grupo
  del menú lateral) y, si es una función dentro de una pantalla, su `Parent`.
  Por ejemplo, Solicitudes de clausura vive dentro de Servicios.
- **Columnas.** Cada acción declara su columna (`Kind`):
  - `read` (Ver);
  - `create` (Crear);
  - `update` (Modificar);
  - `delete` (Eliminar, retirar o descartar);
  - `other` para los pasos de flujo: aprobar, publicar, emitir, exportar,
    validar, firmar, registrar llegadas, etc.
- **Matriz.** La matriz de Private Web es una tabla por sección, con una fila
  por opción y las columnas Ver, Crear, Modificar, Eliminar y Otras acciones.
  Marcar cualquier acción concede también «Ver»; quitar «Ver» quita la opción
  completa.
- **Separación de `manage`.** Cada `manage` se dividió en las acciones que
  realmente ejecuta. Las opciones que compartían código recibieron módulo
  propio: `contracts.agreed_services`, `finance.statements` y
  `finance.billing_units`.
- **Compatibilidad.** Los grants guardados con códigos anteriores no se
  migran: una tabla de alias los traduce al resolver el acceso (`Normalize`).
  Por ejemplo:
  - `finance.preinvoices.manage` → `update` + `issue`;
  - `human_resources.employees.terminate` → `delete`.

  Así, las plantillas y las cuentas existentes conservan su acceso. Los grants
  de gestión de `finance.catalog.*` se descartan y no se trasladan a Contratos,
  para no conceder escritura en otro departamento.
- **Comprobaciones en el servidor.** Cada endpoint comprueba la acción exacta de
  su operación. Crear un borrador exige `create`; editarlo, `update`;
  publicarlo, `publish`. El tráfico en vivo exige Dashboard o Monitoreo de
  vuelos.

### Catálogo comercial en Contratos

- Contratos crea, edita, publica y retira servicios, y sube su imagen
  (`contracts.catalog.*`).
- Finanzas lee el catálogo para poner precios (`finance.tariffs.read`), pero no
  lo modifica.
- Para publicar un servicio se exige una foto o ilustración, una descripción de
  al menos 20 caracteres y un nombre que no sea de prueba.

### Notificaciones por departamento

- **Tabla.** `iam.department_notifications` guarda una alerta por cuenta, tipo
  y fuente. Se escribe en la misma transacción del evento. Repetir la fuente la
  marca otra vez como no leída, sin duplicarla.
- **Destinatarios.** Las cuentas del departamento que tienen la opción
  «Notificaciones» y el permiso que abre la fuente. Si la fuente está asociada
  a una estación, también se exige esa estación.
- **Eventos:**

  | Departamento | Alertas |
  | --- | --- |
  | Gestión Humana | Solicitudes de acceso, requisiciones y solicitudes de disponibilidad. |
  | Contratos | Solicitudes comerciales, comentarios de la aerolínea en un borrador, solicitudes de clausura y contratos firmados por la aerolínea. |
  | Finanzas | Contratos enviados a aprobación de precio, y prefacturas aceptadas o disputadas por la aerolínea. |

  El OCC conserva su feed operativo.
- **Lectura.** `GET department-notifications` y `PUT …/{id}/read` vuelven a
  comprobar el acceso actual. El feed de cambios de cuenta solo anuncia
  `notifications`; el cliente vuelve a leer la lista.
- **Interfaz.** Cada shell de departamento tiene una campana con su contador.
  Las alertas nuevas aparecen como aviso en pantalla, con el botón «Abrir»; el
  aviso no toma el foco, para no interrumpir a quien está escribiendo en un
  formulario. El cajón de notificaciones lista las últimas 50.

## Consecuencias

- **Cambio de contrato API.** Las acciones del catálogo de gobernanza traen
  `kind`, y los módulos `section` y `parent`. El cliente compartido y Private
  Web se actualizaron en el mismo cambio. Si un catálogo antiguo no trae
  `kind`, la matriz lo deduce del nombre de la acción.
- **Revisión de plantillas.** Hay que revisar las plantillas que concedían
  gestión del catálogo en Finanzas: ahora conceden solo lectura.
- **Fuera de alcance.**
  - El correo electrónico de contratos queda pendiente.
  - Las notificaciones no envían correo ni push al navegador; solo se muestran
    mientras la aplicación está abierta.
