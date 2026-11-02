# Paso 1 — Identidades y permisos (preparación)

**Estado a 2 de noviembre de 2026:** el esquema SQL es un borrador guardado en la rama `desarrollo`. **No se ha creado ningún proyecto Supabase ni ejecutado SQL.** La web pública en `main` permanece intacta.

## Por qué empezamos por aquí

La primera versión necesita tres tipos de usuarios: administrador, entrenador y deportista. Ningún usuario debe acceder a otro deportista salvo que exista una vinculación válida con el entrenador.

## Tablas preparadas

1. `profiles` — perfil mínimo (nombre visible e identificador de inicio de sesión). No duplicamos el correo guardado por Auth.
2. `user_roles` — rol asignado exclusivamente desde el servidor; no desde datos editables por el usuario.
3. `coach_athletes` — relación entrenador–deportista, pendiente, activa o revocada.

Hay reglas RLS para que cada persona solo vea los registros autorizados. Las relaciones y los roles no pueden crearse ni modificarse desde un cliente corriente.

**Nota:** el diseño todavía no implementa las invitaciones, la autorización de administradores ni el alta segura de entrenadores. Eso se implementará y probará antes de introducir personas reales.

## Archivo preparado

`database/esquema-inicial-borrador.sql` es el diseño de las tablas. Es **un borrador no aplicado** y no hay garantía de seguridad o funcionamiento hasta ejecutarlo en un entorno aislado y superar pruebas de acceso.

## Pruebas obligatorias cuando tengamos una base de pruebas

- Crear usuarios ficticios con Auth: entrenador A, entrenador B, deportista X y deportista Y.
- Confirmar que un usuario no puede escribir `user_roles`, cambiar su propio rol ni insertar `coach_athletes`.
- Comprobar que el deportista X ve su perfil, pero no puede consultar perfiles de Y.
- Crear una relación A→X autorizada desde el servidor y activar la relación: A puede consultar el perfil de X; B no puede.
- Revocar A→X: A deja de ver el perfil de X.
- Comprobar que usuarios anónimos no pueden leer ni editar perfiles, roles ni relaciones.
- Ejecutar las recomendaciones de seguridad de Supabase y revisar permisos de las tablas.
- Hacer pruebas de restauración y de exportación/borrado antes de utilizar datos personales reales.

## Separación de entornos

**Producción:** `main` está conectada a Netlify. No se cambia durante esta fase.

**Desarrollo:** rama `desarrollo` para código y esquemas preliminares. Evitamos que el código aún sin revisar se publique en el mismo directorio que la web pública.

**Base de datos:** crear un proyecto Supabase exclusivo de AsturPower, sin usar bases de Comunio ni Gestión de Vehículos. La creación está pendiente de elegir cuenta/organización y de comprobar el precio antes de aceptarlo.

## Próximo paso

Elegir la organización de Supabase; consultar el coste exacto de un nuevo proyecto en ella; crear el entorno independiente solo si es gratuito (o después de autorización expresa del usuario sobre cualquier coste). A continuación aplicar un esquema revisado como migración versionada y ejecutar pruebas RLS.

No se han añadido claves, credenciales, datos de Garmin o información de deportistas. Nunca guardar secretos en GitHub.
