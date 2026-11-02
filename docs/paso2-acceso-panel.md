# Paso 2 — Acceso y primer panel privado

Estado: código preparado y probado en `desarrollo`. No se ha desplegado ni modificado la landing de `main`. No se han creado usuarios reales, asignado roles, cambiado Auth, contratado servicios o activado Garmin.

## Implementado

- Aplicación independiente en `app/`, manteniendo `index.html` y `privacidad.html` de la web informativa.
- Inicio de sesión mediante el SDK oficial `@supabase/supabase-js` y correo/contraseña de una cuenta previamente habilitada en Auth.
- Sesión por pestaña en `sessionStorage`, renovación mediante SDK, verificación de usuario con `getUser()` y limpieza de vistas al cerrar sesión. Los tokens Supabase no se imprimen ni se incluyen en el código; la integración Garmin futura mantendrá sus tokens en servidor.
- Perfil propio: creación inicial y edición únicamente de `display_name`. Correo de la identidad, roles y relaciones no se actualizan desde el formulario.
- Lectura de roles desde `user_roles`; los metadatos editables no conceden privilegios. Las cuentas sin rol quedan pendientes. Una identidad puede tener varios roles y cambiar de espacio entre ellos; el selector no concede privilegios. No existe registro público.
- Entrenador: lista y búsqueda de deportistas con relación activa y ficha mínima; contadores reales de relaciones activas y pendientes.
- Deportista: perfil propio y estados de sus vínculos. Si el servidor de gestión está habilitado, se muestra el nombre del entrenador de una propuesta propia para poder aceptarla con consentimiento.
- Administrador de plataforma: el código permite añadir roles coach/athlete a perfiles existentes y proponer vínculos pendientes mediante el servidor autorizado. El deportista debe aceptar. Sin configuración de servidor, esos controles no se habilitan.
- Estados vacíos, errores, reintentos, salida de sesión, adaptación móvil y escape de datos en el HTML.

## Estado previo de Supabase

La organización independiente AsturPower Training permanece en Free. Se utiliza el proyecto existente con nombre automático, no un proyecto nuevo. El esquema inicial ya está aplicado: `profiles`, `user_roles`, `coach_athletes`, RLS en las tres tablas y cinco políticas. Las 36 pruebas transaccionales de permisos del paso 1 se superaron y se descartaron sus datos ficticios. El nombre `asturpower-training-dev` sigue siendo una denominación prevista, no el nombre configurado.

Las cuentas del dashboard de Supabase/Garmin no son cuentas de los deportistas en Supabase Auth. Este paso no crea la primera cuenta ni su contraseña.

## Configuración sin claves en GitHub

La aplicación solicita `/.netlify/functions/public-config`. La función solo entrega la URL y una clave **publicable** moderna, nunca service_role, claves secretas, JWT ni credenciales Garmin. Se alimenta de variables del entorno; tampoco se versiona la clave publicable real, siguiendo la instrucción del proyecto. Las claves publicables necesariamente son visibles al navegador cuando la aplicación está activada: la autorización de datos depende de RLS, no de ocultar esa clave.

Variables necesarias en un entorno de desarrollo autorizado:

- `ASTURPOWER_APP_ENABLED=true`
- `SUPABASE_URL`: URL del proyecto independiente de AsturPower
- `SUPABASE_PUBLISHABLE_KEY`: clave publicable moderna existente del mismo proyecto

Sin configuración válida, el acceso queda cerrado y no se intenta autenticar. No se ha cambiado ninguna variable remota en esta entrega. No usar variables `VITE_*` para secretos. `.env*`, dependencias, builds y estado de Netlify están ignorados.

## Verificación reproducible

Requisitos: Node >=22.12, npm y las versiones fijadas por `package-lock.json`.

```sh
npm ci
npm test
npm run build
```

Las pruebas verifican flujo de inicio de sesión con cliente ficticio, escape de nombres, edición limitada del perfil, falta de rol, lista activa, cierre de sesión, respuestas tardías tras la salida y fallos de red. Son pruebas de aplicación con dobles de prueba, no una prueba de acceso real a Supabase Auth. Las pruebas SQL del paso 1 cubren la base real.

Vista ficticia: habilitar `ASTURPOWER_QA=true` solo en el entorno local de desarrollo y abrir `/__qa/`. Casos: `?case=login`, `athlete`, `pending`, `onboarding`, `error`. `/__qa/mobile` muestra el mismo panel a 390 px. Estos endpoints solo existen en el middleware de Vite con QA explícito y no se compilan en `dist-app`.

`netlify.desarrollo.toml` es una propuesta separada para un futuro despliegue de pruebas. No es `netlify.toml`, no cambia el sitio actual ni configura una publicación automática. Incluir cabeceras CSP, no-store y protección contra iframes. Antes de desplegar, revisar el contexto, rutas, cuotas y variables. No activar esta configuración sobre la landing pública.

## Pendiente antes de usar cuentas reales

1. Autorizar y preparar un despliegue de pruebas independiente; confirmar límites gratuitos y configurar las variables publicables en su entorno.
2. Revisar la configuración real de Auth (correo, política de contraseñas, confirmación, límites y dominios de retorno). Esa configuración no se ha alterado ni verificado mediante el panel en esta fase.
3. Actualizar la política de privacidad para el tratamiento real de cuentas y perfiles. La publicada aún cubre el sitio informativo.
4. Habilitar la primera cuenta de prueba y asignar su rol mediante proceso autorizado; ninguna persona obtiene admin por registrarse.
5. Probar inicio/cierre de sesión y renovación reales. No se han solicitado ni generado contraseñas, enviado invitaciones ni usado datos reales.
6. Revisar y habilitar el servidor de roles y consentimiento de vinculaciones ya preparado. No está desplegado ni activado y no se han creado vínculos reales. El envío de invitaciones por correo y las altas de cuentas siguen pendientes; después vendrán calendarios y entrenamientos. Véase `docs/paso3-varios-entrenadores.md`.
7. Registrar Garmin y activar OAuth únicamente tras autorización. No hay una conexión Garmin operativa en el panel.

Referencias revisadas: https://supabase.com/docs/reference/javascript/auth-signinwithpassword ; https://supabase.com/docs/reference/javascript/auth-onauthstatechange ; https://supabase.com/docs/guides/database/postgres/row-level-security
