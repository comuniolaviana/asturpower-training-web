# AsturPower Training — Arquitectura inicial y plan MVP

**Versión:** 0.3 — 4 de noviembre de 2026
**Estado actualizado:** la app de pruebas y las tablas deportivas ya existen. Garmin ha aprobado la aplicación con Activity API y Training API, y hay un retorno OAuth registrado. El código de sincronización está implementado y probado con datos simulados; la nueva migración y la entrega real siguen pendientes de validación/activación. El informe vigente es `docs/garmin-integracion.md`; las secciones históricas de planificación que siguen no sustituyen esa revisión.

## 1. Objetivo

Construir una plataforma sencilla y segura para varios entrenadores independientes, cada uno con su cartera autorizada. El piloto inicial tendrá un entrenador y dos ciclistas reales: Mauro y Enol. Debe permitir que cada persona inicie sesión, que el entrenador asigne entrenamientos y que el deportista vea sus sesiones. Más adelante se conectarán Activity API y Training API oficiales de Garmin.

**Estado actual comprobado:** el 4 de noviembre se ha visto en el portal la aplicación AsturPower Training en estado Approved, con Activity API, Training API y OAuth 2.0. La cuenta de cada deportista debe autorizarse por separado; se han observado cero conexiones Garmin almacenadas. Véase `docs/garmin-integracion.md` para distinguir código preparado, configuración y pruebas reales pendientes.

## 2. Arquitectura recomendada, provisional

```text
Deportista / Entrenador (móvil o PC)
        |
        v
Web de AsturPower Training (Netlify)
        |                         |
        | usuario autenticado     | llamadas sensibles
        v                         v
Supabase Auth + PostgreSQL     Netlify Functions (servidor)
    (base de datos)                |
        ^                          +--> OAuth 2.0 Garmin, tokens protegidos
        |                          +--> Recibir eventos/activity push
        +--------------------------+--> Publicar entrenamientos Garmin
```

**Propuesta:** mantener Netlify y GitHub, utilizar **Supabase** para autenticación y PostgreSQL, y **Netlify Functions** (Node.js/TypeScript) para endpoints privados y la futura integración con Garmin.

**Ventajas:** reutiliza alojamiento ya configurado; evita gestionar un servidor propio; PostgreSQL facilita relacionar entrenadores, deportistas y sesiones; la seguridad por filas (*Row Level Security*, RLS) permite separar datos; funciones aisladas mantienen secretos fuera del navegador.

**Inconvenientes:** dependemos de proveedores externos, hay cuotas y límites de uso, los servicios gratuitos no equivalen a capacidad o continuidad garantizadas y Netlify Functions requiere diseñar cuidadosamente operaciones largas, reintentos y webhooks. Para trabajos de mayor duración podría añadirse posteriormente un proceso en segundo plano dedicado.

**Alternativas:** (a) backend propio Node.js + PostgreSQL alojado en VPS: más control, mayor mantenimiento y responsabilidad operativa; (b) Firebase: alternativa viable para autenticación y almacenamiento, pero menos directa para relaciones deportivas complejas. La elección se confirmará antes de contratar o crear recursos.

**Costes:** no crear servicios de pago ni compromisos económicos sin revisión. Verificar precios, cuotas, región de datos, contrato de encargo de tratamiento y mecanismos de recuperación vigentes antes de comenzar a guardar datos reales.

## 3. Módulos del MVP (orden)

1. **Autenticación y roles.** Administrador, entrenador y deportista; invitaciones/alta supervisada.
2. **Relación entrenador–deportista.** Solo el entrenador asignado puede consultar los datos que corresponden a su deportista; la persona deportista ve sus datos.
3. **Calendario.** Sesiones programadas por día y deporte; cambiar fecha o estado.
4. **Entrenamientos.** Crear sesión sencilla (deporte, bloques, duración y objetivo); biblioteca básica.
5. **Análisis inicial.** Actividades simuladas o importadas con permiso; distinguir planificado de realizado.
6. **Garmin.** Tras registrar la app y recibir credenciales autorizadas: conexión OAuth, envío de entrenamientos, recepción de actividades y pruebas con dispositivos reales compatibles.

Fuera de alcance inicial: pagos, entrenamientos generados automáticamente por IA, planes avanzados, Strava, históricos completos de Garmin, rankings y métricas complejas CTL/ATL/TSB sin datos fiables.

## 4. Modelo preliminar de datos

> Modelo evolutivo: `profiles`, `user_roles` y `coach_athletes` ya están aplicadas y probadas. Las tablas deportivas y Garmin siguientes siguen siendo propuestas.

| Entidad | Datos mínimos | Regla esencial |
|---|---|---|
| `profiles` | `user_id`, nombre visible, fecha de creación | Identidad propia, independiente del entrenador |\n| `user_roles` | `(user_id, role)` con roles acumulables | Una persona puede ser entrenador y deportista; asignación controlada desde servidor |
| `coach_athletes` | `coach_id`, `athlete_id`, `status`, fecha de vinculación | Una relación autorizada permite acceso limitado al entrenador |
| `workouts` | `id`, `coach_id`, deporte, nombre, pasos estructurados, versión | El entrenador gestiona sus propios entrenamientos |
| `workout_assignments` | `id`, `workout_id`, `athlete_id`, fecha programada, estado | Solo entrenador vinculado asigna o cambia sesiones |
| `activities` | `id`, `athlete_id`, origen, `external_id`, fecha, deporte, resúmenes | Cada deportista ve sus actividades; importación idempotente |
| `garmin_connections` | `athlete_id`, identificador Garmin, permisos, estado de conexión, marcas temporales | **Privado / servidor**; guardar tokens cifrados, nunca visibles al cliente |
| `garmin_event_log` | identificador de entrega, estado, intentos, fecha y referencia a actividad | **Privado / servidor**; minimizar datos de las notificaciones |

Registrar las unidades de medida y su fuente: potencia, ritmo, frecuencia cardíaca, distancia y desnivel; no mezclar sensores distintos sin distinguir procedencia. Para evitar duplicados, aplicar unicidad por combinación de **origen + deportista + identificador externo**, no solo identificador externo. Mantener versiones de sesiones para distinguir lo planificado originalmente de modificaciones posteriores.

Los roles/permisos se almacenarán en datos controlados por el servidor, **no** en metadatos editables por el propio usuario.

## 5. Seguridad y protección de datos

- Habilitar RLS en todas las tablas expuestas y escribir **pruebas tanto de acceso permitido como denegado**: un deportista no puede leer el de otro; un entrenador no puede ver deportistas que no gestiona.
- Credenciales Garmin, refresh tokens y claves privadas **solo en entornos de servidor y almacenamiento protegido**; nunca en `index.html`, JavaScript público, repositorio o almacenamiento del navegador.
- Validar en backend toda asignación y toda llamada que cambie datos, aunque el frontend oculte controles.
- Para OAuth: PKCE, `state` de un solo uso unido a la sesión, validación de redirect y permisos efectivos, renovación y revocación segura de tokens.
- HTTPS, límites de peticiones, auditoría mínima, deduplicación y reintentos controlados para eventos. Comprobar la autenticidad de notificaciones según los mecanismos de la documentación oficial de Garmin para la aplicación concedida.
- Preparar copias de seguridad, restauración probada y eliminación/exportación de datos antes de usar deportistas reales.
- **RGPD:** actualizar la política de privacidad antes de recopilar información fisiológica o potencialmente de salud; definir responsabilidades, base jurídica, consentimiento explícito cuando corresponda, acceso de entrenadores, proveedores, conservación y ejercicios de derechos.
- Elegir región y garantías apropiadas de tratamiento y transferencias antes del uso real.

## 6. URLs previstas para integrar Garmin (NO activas)

Se presentan como **rutas de diseño**, no como endpoints ya publicados. No deben registrarse definitivamente en Garmin sin implementar y probarlas.

- Página pública: `https://asturpower-training.netlify.app/`
- Política actual: `https://asturpower-training.netlify.app/privacidad.html`
- Retorno OAuth propuesto: `https://asturpower-training.netlify.app/.netlify/functions/garmin-oauth-callback`
- Recepción de actividades propuesta: `https://asturpower-training.netlify.app/.netlify/functions/garmin-activities`
- Desconexiones / cambios de permisos: definir las rutas exactas **después** de revisar la documentación privada de Garmin y la configuración de la aplicación.

No asumir que la dirección pública y las rutas definidas bastan: Garmin puede requerir configuraciones concretas de callback, permisos, dominios o verificación. **No inscribir endpoints inexistentes como si estuvieran activos.**

## 7. Flujo Garmin deseado y pruebas

1. El deportista conectado pulsa «Conectar Garmin».
2. El servidor inicia autorización OAuth 2.0 con PKCE y `state`.
3. Garmin solicita consentimiento y devuelve un código al retorno autorizado.
4. El servidor valida el resultado, intercambia código por tokens y guarda credenciales de forma protegida.
5. Se registran permisos concedidos y estado de conexión. Si faltan permisos, mostrarlo y no realizar operaciones no autorizadas.
6. Training API publica un entrenamiento estructurado y, cuando sea compatible, lo programa en Garmin Connect.
7. El usuario sincroniza el reloj/ciclocomputador; no confundir publicación en Garmin Connect con confirmación de llegada al dispositivo.
8. Activity API remite la actividad tras su subida a Garmin Connect; el receptor la registra y procesa sin duplicados.
9. Probar denegación/revocación de consentimiento, permisos parciales, duplicados, errores 429 y reintentos, cambios de usuario, borrado y desconexión.

Las APIs Garmin **no han sido probadas** con una aplicación de AsturPower todavía.

## 8. Hitos de entrega

| Hito | Resultado verificable | Estado |
|---|---|---|
| H0 | Web informativa y política inicial publicadas | Realizado |
| H1 | Arquitectura inicial y datos documentados | Diseño |
| H2 | Entorno de pruebas, autenticación, tablas con RLS y pruebas de aislamiento | Base multirrol aplicada; 58 pruebas SQL y 44 pruebas de aplicación/servidor superadas; pendiente de despliegue y cuenta real |
| H3 | Entrenador invita a deportista y asigna entrenamiento sencillo; calendario visible | Pendiente |
| H4 | Endpoints HTTPS y OAuth implementados y probados sin secretos expuestos | Pendiente |
| H5 | Alta Garmin Starter registrada con Activity y Training, credenciales seguras | Pendiente |
| H6 | Prueba real: enviar un entrenamiento compatible, sincronizar dispositivo, recibir actividad y comparar | Pendiente |

## 9. Próxima acción concreta

Completar la confirmación para aplicar la migración Garmin ya probada localmente, verificar el despliegue de `desarrollo` y resolver el acceso servidor a servidor del receptor sin cambiar el retorno registrado ni la landing. Después configurar las notificaciones en API Tools y realizar una autorización personal y una prueba de dispositivo. La ejecución remota de la nueva migración no se ha completado.

Los diseños anteriores de entidades, URLs e hitos se conservan como contexto histórico; las rutas y estados operativos vigentes están en `docs/garmin-integracion.md`.

## Referencias generales

- Garmin Developer — programa: https://developer.garmin.com/gc-developer-program/
- Garmin Training API: https://developer.garmin.com/gc-developer-program/training-api/
- Garmin Activity API: https://developer.garmin.com/gc-developer-program/activity-api/
- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase RLS: https://supabase.com/docs/guides/database/postgres/row-level-security
- Netlify Functions, secretos y variables: https://docs.netlify.com/build/functions/environment-variables/

**Nota:** las especificaciones más detalladas de OAuth, webhook, límites y formato de datos deben comprobarse en la documentación habilitada para la aplicación Garmin antes de escribir la integración.  


