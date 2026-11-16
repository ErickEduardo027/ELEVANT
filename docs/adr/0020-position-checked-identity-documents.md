# ADR-0020: Documentos de identidad validados por posición

## Estado

Accepted — 2026-11-02. Amplía la validación por tipo introducida en la revisión docente
de octubre de 2026.

## Contexto

AVIAM pidió más rigor en los documentos con que se identifica el representante de una
aerolínea al solicitar acceso:

- que cada carácter esté en su posición;
- que el pasaporte dominicano empiece siempre por «RD»;
- que se elimine la opción «Otro», que aceptaba cualquier texto de 3 a 40 caracteres.

Lo que encontramos al investigar:

- **Pasaporte dominicano.** Ninguna fuente pública describe su numeración: ni la
  [Dirección General de Pasaportes](https://www.pasaportes.gob.do/index.php/sobre-nosotros/historia)
  ni la [ficha del pasaporte](https://en.wikipedia.org/wiki/Dominican_Republic_passport).
  Además, desde febrero de 2026 se emite un pasaporte biométrico nuevo. La regla «RD y 7
  dígitos» es, por tanto, una **regla de negocio de AVIAM**, no una especificación oficial.
- **Cédula.** Tiene 11 dígitos: 3 de oficina, 7 de secuencia y un dígito verificador
  Luhn. La implementación de referencia,
  [python-stdnum](https://sources.debian.org/data/main/p/python-stdnum/1.5-1/stdnum/do/cedula.py),
  mantiene además una lista de unas 460 cédulas emitidas que **no** cumplen el dígito
  verificador.

## Decisión

### Reglas y mensajes

- `IdentityDocuments.Check` (backend) y `checkIdentityDocument` (cliente compartido)
  devuelven el número canónico o el **primer carácter que falla**, con su posición y lo
  esperado. Por ejemplo: «El pasaporte dominicano: la posición 1 debe ser «R»; encontramos
  «A». Formato: RD1234567.». Los dos lados usan los mismos patrones y mensajes, y las
  pruebas de ambos verifican los mismos textos.
- **Pasaporte dominicano** (`DO`): `RD` en las posiciones 1–2 y dígitos en las 3–9. El
  prefijo es una sola constante (`DominicanPassportPrefix`), para cambiarlo si la DGP
  publica otro formato.
- **Pasaportes extranjeros:** patrones por país donde el formato está documentado. Por
  ahora:
  - `US`: 9 dígitos, o una letra y 8 dígitos.
  - `CA`: `AA999999`, o `A999999AA` desde 2023.

  El resto de países sigue ICAO 9303: de 6 a 9 letras o dígitos, con al menos un dígito.
- **Cédula y residencia:** cada posición debe ser un dígito y el dígito 11 debe ser el
  verificador Luhn. No se usa la lista de excepciones de python-stdnum (licencia LGPL).
  Si aparece una cédula real que la regla rechace, se tratará como un caso a revisar.

### Solicitud pública

- El documento del representante es obligatorio: **Cédula dominicana** o **Pasaporte**.
  «Otro» desaparece de la interfaz, del cliente compartido y de la API.
- El pasaporte exige su nacionalidad. La cédula solo se admite si la nacionalidad es la
  dominicana o se deja vacía.
- El campo da forma al número mientras se escribe: la cédula como `###-#######-#` y el
  pasaporte en mayúsculas.

### Empleados

El expediente no guarda la nacionalidad. Por eso, un pasaporte que empieza por «RD» se
valida con la regla dominicana y cualquier otro con ICAO 9303.

## Consecuencias

- Las solicitudes antiguas guardadas con «Otro» se siguen leyendo, pero ya no se crean
  nuevas con ese tipo.
- Un representante sin documento válido ya no puede enviar la solicitud.
- Si aparece un pasaporte dominicano válido con otro prefijo, basta con cambiar la
  constante en los dos lados y sus pruebas.
