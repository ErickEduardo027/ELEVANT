# Pruebas móviles

`api-client.metro-smoke.ts` verifica que Metro pueda incluir la fábrica móvil y
las operaciones compartidas `createSession`, `getCurrentSession` y
`getRampAssignedOperations`. El export Android completo cubre además la
resolución nativa de SecureStore.

`mobile-session.test.js` ejecuta con Jest/Expo las invariantes de seguridad del
almacenamiento local: el token nunca entra en AsyncStorage, el valor cifrado se
mantiene compacto, los cambios de autorización rotan la revisión, logout/cambio
de cuenta bloquea escrituras tardías y cualquier pareja inconsistente falla en
cerrado.

Siguen pendientes las pruebas de integración en dispositivo para conectividad,
permisos y la futura sincronización de comandos.
