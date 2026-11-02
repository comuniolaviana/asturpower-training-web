# Paso 1 — Identidades y permisos

**Estado comprobado a 2 de noviembre de 2026:** completado en la base independiente de AsturPower Training. Plan Free; proyecto existente con su nombre automático. `main` y la web pública permanecen intactos.

## Esquema aplicado

- `profiles`: identificador vinculado a Auth, nombre visible y fecha de creación.
- `user_roles`: roles acumulables por usuario: `admin`, `coach` y `athlete`. Entrenador y deportista pueden coexistir en una identidad. Solo un proceso privilegiado autorizado puede concederlos.
- `coach_athletes`: vinculación pendiente, activa o revocada, con claves foráneas que validan que sus participantes sean entrenador y deportista.

Las tres tablas tienen RLS; cinco políticas restringen accesos. El cliente solo crea su perfil y modifica su nombre, consulta su rol y consulta las relaciones en las que participa. Un entrenador solo lee el perfil de deportistas con vinculación activa. No hay privilegios de lectura o escritura para visitantes sin autenticar.

Los roles no se obtienen de metadatos editables. El cliente no puede escribir roles ni crear, activar o revocar relaciones. Un rol `admin` no concede por sí mismo lectura global desde el cliente; la administración requiere servidor autorizado.

## Archivos

- `database/esquema-inicial-borrador.sql`: borrador histórico original, no volver a aplicar sobre la base.
- `database/esquema-inicial-aplicado.sql`: snapshot del SQL aplicado para base vacía; no es idempotente.
- `database/tests/permisos-iniciales.sql`: pruebas transaccionales con identidades ficticias sin credenciales ni sesiones, descartadas al terminar.
- `database/cambio-multirrol-aplicado.sql`: adaptación incremental ya aplicada para la clave `(user_id, role)`; conserva datos y vínculos existentes.
- `database/tests/aislamiento-multientrenador.sql`: 22 comprobaciones adicionales con dos entrenadores y una identidad con dos roles; fixtures descartadas.

## Verificación realizada

36 comprobaciones originales y 22 adicionales de varios entrenadores superadas: acceso anónimo denegado, edición del perfil propio, aislamiento de carteras, usuarios con dos roles, vínculos pendientes/revocados, escalada de rol rechazada, validación de roles en relaciones y cascadas dentro de las transacciones de prueba. Al terminar se comprueban recuentos de cero usuarios Auth y cero filas en las tres tablas. El asesor de seguridad no devolvió avisos.

## Lo que sigue pendiente

No se han creado cuentas reales ni invitaciones, asignado un primer administrador o desplegado el servidor de gestión de roles y relaciones. El código de gestión está preparado y probado, pero no activado. Tampoco se ha configurado una conexión Garmin.

La siguiente fase de acceso y panel está documentada en `docs/paso2-acceso-panel.md`. La verificación real de inicio de sesión, renovación y configuración Auth deberá completarse cuando se autorice la primera cuenta y el entorno de pruebas. La política de privacidad deberá actualizarse antes de tratar perfiles reales.

No se ha cambiado el plan gratuito ni accedido a bases de otros proyectos. No hay claves, contraseñas, tokens o datos de deportistas en el repositorio.
