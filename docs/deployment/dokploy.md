# Despliegue con Dokploy

Esta guía describe la preparación; el scaffold no crea servidores, dominios ni despliegues reales.

## Prerrequisitos

- host endurecido y actualizado;
- DNS bajo control del equipo;
- Dokploy instalado y con acceso administrativo protegido;
- repositorio o registro de imágenes autorizado;
- red/volumen SQL Server separados por ambiente;
- secretos disponibles fuera de Git;
- destino externo para backups;
- plan de migración y rollback.

## API

Construir con `backend/Dockerfile` usando `backend` como contexto. El backend es
autónomo y la imagen no necesita archivos de `frontend`, `packages` o `docs`. El
contenedor escucha en el puerto 8080 y se ejecuta con usuario no root. Dokploy
publica HTTPS mediante el proxy y sondea `GET /health`; no hace falta instalar
`curl` dentro de la imagen solo para un `HEALTHCHECK`.

Configurar, como mínimo, ambiente ASP.NET, cadena de conexión, orígenes CORS explícitos, política de HTTPS/forwarded headers y cualquier opción de proveedor habilitada. La cadena y las claves se crean como secretos de plataforma, no como variables en un archivo versionado.

`/health/ready` sirve para verificar dependencias durante promoción o diagnóstico. No debe usarse como liveness si una caída temporal de SQL provocaría reinicios en bucle.

## SQL Server

SQL Server vive en una red privada y no publica 1433 en Internet. Utiliza volumen persistente exclusivo, contraseña de ambiente y una imagen/edición cuya licencia y recursos estén confirmados. La API accede con una identidad de permisos mínimos; la cuenta administrativa se reserva para operación.

Compose local no es una plantilla de Production. En Testing y Production se crean servicios, volúmenes, secretos y backups separados.

## Migraciones y liberación

1. Confirmar backup recuperable y compatibilidad.
2. Ejecutar migración como tarea controlada con el script y autorización apropiada.
3. Desplegar la imagen fijada por digest o versión inmutable.
4. Verificar health, readiness, ping, logs y un smoke test.
5. Observar errores/latencia y promover clientes solo cuando corresponda.

La API nunca migra al arrancar. Si falla, detener la promoción y seguir el rollback documentado; no ejecutar comandos improvisados desde la consola del contenedor.

## Proxy y seguridad

Aceptar forwarded headers únicamente desde proxies/redes conocidos. Forzar HTTPS en el borde, mantener certificados renovados y limitar el panel Dokploy por red o autenticación fuerte. Swagger permanece deshabilitado en Production y SQL Server no recibe un dominio público.
