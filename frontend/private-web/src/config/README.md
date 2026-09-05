# Configuración web

`elevantApiClient.js` lee y valida `VITE_ELEVANT_API_URL` en un único punto y construye el cliente compartido sin acoplarlo a la sesión mock. La aplicación falla de forma visible si falta la URL requerida.
