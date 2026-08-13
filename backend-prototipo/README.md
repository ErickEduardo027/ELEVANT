# Backend del prototipo ELEVANT — Etapa 0

Base local del prototipo integrado. En esta etapa no contiene autenticación ni
flujos departamentales; únicamente establece el servidor, la persistencia y las
pruebas que utilizarán las siguientes etapas.

## Requisitos

- Node.js 20 o superior.
- Puerto `4310` disponible.

No utiliza paquetes externos y no requiere `node_modules`.

## Ejecutar

Desde `backend-prototipo`:

```powershell
npm start
```

También se puede abrir `INICIAR-BACKEND.cmd`.

Comprueba el servicio en:

```text
http://localhost:4310/health
```

## Probar

```powershell
npm test
```

## Persistencia

- `data/seed.json`: estructura inicial versionada y limpia.
- `data/runtime.json`: datos locales creados al ejecutar; Git lo ignora.

La escritura se realiza primero en un archivo temporal y luego se reemplaza el
archivo de ejecución para reducir el riesgo de corrupción.

Cuando una etapa incrementa `schemaVersion`, el backend detecta automáticamente
el archivo local anterior y vuelve a generar `runtime.json` desde `seed.json`.

## Variables opcionales

```text
PROTOTYPE_HOST=0.0.0.0
PROTOTYPE_PORT=4310
PROTOTYPE_DATA_DIR=C:\ruta\datos
```

## Etapa 2: agentes móviles

Gestión Humana puede registrar un usuario con el rol **Agente de Rampa**. El backend crea automáticamente su cuenta móvil con:

- Usuario: el correo registrado por Gestión Humana.
- Contraseña temporal: `Elevant2026!`.
- Estado inicial: activo.

Cuando Gestión Humana desactiva al usuario, su acceso móvil queda bloqueado. Al reactivarlo puede iniciar sesión nuevamente. En esta etapa todavía no se asignan vuelos ni listas de comprobación.
