# Servicios del dispositivo

La capa canónica de Mobile Agent expone:

- `mobile-auth.ts`: crear, leer, revalidar y cerrar una sesión de agente sin
  exponer el token a la UI;
- `assigned-operations.ts`: lectura `getRampAssignedOperations` sin parámetros
  de agente/estación, con caché por cuenta y fallback solo por falta de red;
- `mobile-service-error.ts`: códigos y mensajes saneados para estados de UI.

Los futuros adaptadores de cámara, archivos y conectividad deben seguir siendo
sustituibles en pruebas.
