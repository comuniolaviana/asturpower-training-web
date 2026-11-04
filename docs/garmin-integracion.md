# Integración Garmin de AsturPower Training

Revisión: **4 de noviembre de 2026**. Trabajo sobre `desarrollo`, partiendo de `f56f5a2`. La landing y `main` quedan fuera de este cambio.

## Estado comprobado, separado de la simulación

| Elemento | Evidencia y estado |
|---|---|
| Portal Garmin | Sesión de la empresa Asturpower accesible. Existe una aplicación **AsturPower Training**, estado **Approved**, con **Activity API** y **Training API**, y autorización **OAuth 2.0**. |
| Retorno registrado | `https://asturpower-training-dev.netlify.app/.netlify/functions/garmin-callback`. Se ha leído; **no se ha cambiado**. |
| Permisos de deportistas | Al iniciar la revisión, Supabase tenía **0 conexiones Garmin** y **0 estados OAuth**. La aprobación de la aplicación no sustituye el consentimiento individual. |
| Secretos | Netlify ya tiene variables para cliente Garmin, secreto, clave de cifrado y servidor Supabase. Se ha comprobado su presencia y protección; no se han incorporado valores a archivos ni a GitHub. Su validez requiere una autorización real. |
| Notificaciones | API Tools solicita su propia sesión con las credenciales de la aplicación. No se han podido verificar los endpoints habilitados ni realizar cambios allí. |
| Netlify | El equipo AsturPower Training está en **Free**. Existen el sitio original y `asturpower-training-dev`; este último exige acceso del equipo para **todos** los despliegues. |
| Versión desplegada al revisar | El despliegue de desarrollo estaba `ready`, pero correspondía a `b103a233`, anterior al último código de la rama. La existencia de una variable en el panel no demuestra su valor en un despliegue anterior: se fijan al desplegar. |
| Base de datos | Se han inspeccionado tablas, políticas, índices y privilegios del proyecto exclusivo de AsturPower. La nueva migración **no se ha aplicado**: dos solicitudes de prueba SQL transaccional remota caducaron sin confirmación. No se ha intentado saltar esa confirmación. |

El código se guarda con la marca `[skip netlify]` mientras la migración alojada esté pendiente. Esto permite revisar y ejecutar las pruebas en GitHub sin reemplazar la versión actualmente servida ni iniciar otro despliegue en la cuota compartida del equipo. No se han creado ni habilitado nuevas credenciales o cuentas reales.

## Implementado en el código

### OAuth y consentimiento

- Se conserva el retorno exacto registrado y se rechazan otros orígenes/rutas.
- Consentimiento explícito validado también en el servidor, no solo en la casilla del navegador.
- PKCE S256, estado aleatorio guardado como hash, caducidad y consumo de un solo uso antes del canje.
- El cifrado del verificador queda ligado también a la versión del consentimiento. Cancelación, parámetros duplicados y repetición se rechazan sin llamar a Garmin.
- Tokens AES-256-GCM con contexto por deportista. Renovación en servidor, conservación del refresh token rotado, margen de caducidad y bloqueo persistente por deportista al habilitar sincronización.
- Ni los errores ni las respuestas al navegador incluyen tokens, secretos, códigos de autorización o cuerpos de error del proveedor. Las llamadas externas rechazan redirecciones y tienen timeout.
- Los campos de auditoría y el limitador se usan al habilitar las nuevas funciones. Mientras sigan desactivadas, el OAuth conserva compatibilidad con las tablas existentes.

### Envío de entrenamientos

`POST /.netlify/functions/garmin-workout`, con sesión Supabase y cuerpo `{ "workout_id": "UUID" }`.

El servidor carga la sesión desde la base, comprueba el entrenador propietario y su vínculo activo o el deportista propietario, consulta los permisos efectivos Garmin y usa el token **del deportista**. No acepta un destinatario arbitrario enviado por el cliente. El rol administrativo no concede acceso global implícito.

El adaptador convierte los bloques existentes al formato Training V2, crea el entrenamiento y lo programa por fecha en Garmin Connect. El primer alcance admite ciclismo y carrera; conserva segundos, vatios, porcentaje FTP y frecuencia cardíaca. RPE se conserva como instrucción con objetivo libre; no se transforma en una potencia inventada. Natación, fuerza y potencia para carrera requieren un adaptador específico y se rechazan por ahora.

Se guardan huella del contenido, identificador remoto y fase del envío. Repetir el mismo envío devuelve el recibo existente. Un error 429 aplaza el reintento; un resultado incierto de creación no provoca otro POST a ciegas. Una programación incierta se contrasta con el calendario y, si no se resuelve, requiere revisión. Editar una sesión ya exportada no crea silenciosamente otra versión: la actualización/eliminación remota queda pendiente.

El botón **Enviar a Garmin** está integrado en las sesiones con bloques del calendario. Un recibo significa **programado en Garmin Connect**; nunca afirma que el reloj o ciclocomputador lo haya recibido.

### Recepción automática

`POST /.netlify/functions/garmin-activities` recibe resúmenes de actividades, detalles resumidos, cambios de permisos y desconexiones.

- Origen restringido a los rangos documentados por Garmin, usando la IP que suministra la plataforma. No se confía en `X-Forwarded-For` enviado por el cliente ni se inventa una firma HMAC que Garmin no documenta.
- JSON con límites de tamaño y número de eventos. Se minimiza el contenido: no se guardan GPS, muestras, URLs de descarga ni tokens incluidos por terceros.
- Primero se guarda una entrega cifrada y deduplicada; después se responde HTTP 200. Un fallo de persistencia devuelve error para permitir la redelivery del proveedor.
- Procesamiento posterior por `garmin-process`, con cursor persistente, presupuesto de tiempo, lotes limitados, reintentos acotados y purga de payloads. El progreso normal no consume intentos de error.
- Identidad resuelta por `garmin_user_id`, permiso `ACTIVITY_EXPORT` y vínculo vigente de esa cuenta. Un evento anterior a una asociación más reciente no se aplica a otro usuario.
- Importación idempotente por deportista, origen e identificador de actividad. Resúmenes y detalles del mismo `activityId` convergen en una fila. No se deduplican automáticamente importaciones CSV frente a API.
- Retiradas de consentimiento y desconexiones se procesan antes de las actividades de una misma entrega. Cambios antiguos de permisos no restauran un consentimiento más reciente.
- Las actividades quedan bajo las políticas existentes: deportista propietario y entrenadores con vínculo activo. El cliente no puede insertar actividades fingiendo origen oficial.
- La pantalla Garmin muestra las diez actividades oficiales más recientes del propio deportista mediante una consulta sujeta a RLS. No se marca automáticamente un entrenamiento como completado por parecido de fecha/duración.

Los payloads terminados se borran al finalizar. Los pendientes/fallidos caducan a los siete días y los metadatos de entregas se limpian a los ocho días cuando funciona el procesador. Esta limpieza requiere que el procesador esté habilitado. Se mantienen los registros mínimos necesarios para idempotencia y recibos.

FIT, trazados GPS, análisis de muestras, importación de todo el histórico, borrados de actividades en Garmin y actualizaciones automáticas de entrenamientos exportados quedan fuera de esta entrega. No hay polling histórico ni scraping ni conectores no oficiales.

## Migración preparada y privilegios

`supabase/migrations/20261104105956_garmin_sync.sql` añade registros privados de exportación, cola cifrada, cursor, bloqueos, orden de importación y reservas de cuota, además de metadatos de consentimiento. Las tablas nuevas tienen RLS y carecen de acceso para `anon` y `authenticated`.

Las funciones SQL son **SECURITY INVOKER**, con `search_path` explícito y EXECUTE reservado a `service_role`. No se añaden funciones SECURITY DEFINER para saltarse RLS.

La revisión detectó que `authenticated` tenía TRUNCATE, REFERENCES y TRIGGER sobre el calendario. La migración revoca esos privilegios innecesarios y conserva el CRUD autorizado. Las pruebas SQL comprueban insertar, editar y borrar una sesión con el entrenador correcto después de la revocación. Esta corrección está **preparada y probada localmente; no aplicada todavía en Supabase**.

La migración es incremental para el esquema actual de AsturPower, no un instalador para una base vacía. No debe ejecutarse en Comunio ni en Vehículos Empresa.

## Netlify y alternativa Cloudflare

El inicio de sesión de equipo de Netlify y el inicio de sesión de un deportista en Supabase son controles diferentes. Una función detrás del acceso privado de Netlify no es un receptor accesible para los POST servidor a servidor de Garmin. El retorno OAuth también puede exigir la sesión de Netlify antes de ejecutarse; que funcione en el navegador del propietario no demuestra acceso de otro deportista.

Se han preparado `_headers` y `_redirects` dentro del directorio público de **la app de pruebas**, para que la compilación emita las cabeceras aunque el proyecto no lea `netlify.desarrollo.toml`. Los endpoints sensibles llevan sus propias cabeceras. Estos archivos no cambian la landing de `main`.

`cloudflare/garmin-worker.mjs` y `wrangler.garmin.toml` preparan un **receptor alternativo**, con el mismo motor, la misma base AsturPower y el mismo modelo de seguridad. Tiene una ruta de salud y `/garmin/activities`; no migra el OAuth ni crea un retorno nuevo. El adaptador usa `CF-Connecting-IP` exclusivamente dentro del runtime de Cloudflare.

La alternativa se ha probado como manejador Request/Response en Node con proveedor/base simulados. **No está desplegada ni validada en el runtime real de Cloudflare.** No se han creado cuentas, contratado recursos, copiado secretos a otro proveedor ni cambiado dominios. El cron de Cloudflare no está configurado. No se necesita migrar la web para continuar desarrollando.

## Pruebas reproducibles

```sh
npm ci
npm test
npm run test:garmin
npm run test:database:garmin
npm run simulate:garmin
npm run build
```

- Batería Node: OAuth, cifrado, consentimiento, callbacks, permisos, portafolios, PKCE, cuota/reintentos, bloqueos, envío, calendario, importación, deduplicación, lotes y adaptador alternativo. Incluye la interacción del botón en DOM simulado.
- Resultado de esta revisión: **111 pruebas Node superadas**, **30 verificaciones SQL y 2 denegaciones adicionales superadas**, compilación correcta y simulación bidireccional superada. La verificación SQL es local, no alojada.
- PostgreSQL/PGlite: motor PostgreSQL local en WebAssembly, no un mock de SQL. Esquema deportivo/políticas obtenidos por lectura de metadatos del proyecto; andamiaje Auth local solo para las pruebas. Valida RLS, roles, RPC, cuotas, bloqueos, importación y mantenimiento del calendario. No equivale a una prueba de Supabase Auth real o del despliegue alojado.
- La transacción de pruebas SQL se revierte y el ejecutor exige cero usuarios, actividades, conexiones y entregas al finalizar.
- `docs/garmin-pruebas-simuladas.json` recoge una simulación con cero peticiones reales: un entrenamiento y una programación, sin duplicado al repetir; dos entregas iguales producen un único registro de cola y dos actividades de deportistas ficticios separados.
- CI de `desarrollo` incluye la prueba de base de datos local. Las hojas de estilo se cargan en los puntos de entrada del navegador; se ha corregido el fallo previo que impedía ejecutar pruebas Node al importar CSS desde la lógica de interfaz.

## Lo que falta para una primera prueba real

1. Completar la confirmación de ejecución remota y aplicar la migración revisada solo en el proyecto AsturPower. Después comprobar asesores, privilegios y pruebas transaccionales alojadas. No usar otra ruta para eludir esa confirmación.
2. Desplegar la versión revisada en el sitio de desarrollo y comprobar su commit, funciones y cabeceras. Guardar código en GitHub no prueba que Netlify haya desplegado ese commit.
3. Elegir y verificar un receptor HTTPS accesible para Garmin: ruta pública protegida a nivel de aplicación/origen en Netlify o el Worker alternativo. Revisar las consecuencias de acceso y cuotas antes de cambiar la protección del sitio. No abrir la web original para resolverlo.
4. Consultar API Tools con su sesión específica, comprobar los endpoints que ya haya y configurar únicamente los que falten. **No cambiar el retorno OAuth registrado** para resolver el webhook.
5. Habilitar por separado `ASTURPOWER_GARMIN_TRAINING_ENABLED` y `ASTURPOWER_GARMIN_ACTIVITY_ENABLED` únicamente tras los pasos anteriores. Ambas funciones fallan cerradas si falta su activación. Mantener los secretos existentes en el servidor; no generar otros para esta entrega.
6. Un deportista autoriza personalmente Garmin desde su sesión AsturPower. Verificar permisos concedidos, publicar una sesión sencilla, sincronizar un dispositivo compatible y comprobar una actividad recibida. Esta autorización individual y la prueba física no se pueden sustituir por simulaciones.

Antes de uso real generalizado quedan la revisión de privacidad/consentimiento, marca Garmin, revocación desde Garmin Connect y políticas de conservación/exportación. No se certifica una integración en producción ni la llegada al dispositivo con esta entrega.

## Fuentes

- Portal oficial, aplicación de AsturPower y documentación habilitada: https://developerportal.garmin.com/developer-programs/programs-docs
- Especificaciones consultadas en el portal: OAuth2 PKCE 2.0, Training API V2 2.0, Activity API 2.1. Los documentos y ejemplos completos no se copian al repositorio.
- Descripción pública Training API: https://developer.garmin.com/gc-developer-program/enterprise/training-api/
- Descripción pública Activity API: https://developer.garmin.com/gc-developer-program/enterprise/activity-api/
- Funciones y cabeceras Netlify: https://docs.netlify.com/build/functions/overview/ y https://docs.netlify.com/manage/routing/headers/
- Cloudflare Node crypto: https://developers.cloudflare.com/workers/runtime-apis/nodejs/crypto/
