# Integración Garmin de AsturPower Training

Revisión: **4 de noviembre de 2026**. Trabajo sobre `desarrollo`, partiendo de `f56f5a2`. La landing y `main` quedan fuera de este cambio.

## Migración aplicada con autorización

El **4 de noviembre de 2026**, después de la autorización explícita del usuario, se ha aplicado la migración únicamente en el proyecto AsturPower `drnefgxdrultneeodtsy`, mediante la conexión `asturpower.training`.

- Supabase confirma éxito y registra **`20261104115935`, `garmin_sync`** en su historial. El archivo se ha renombrado a `supabase/migrations/20261104115935_garmin_sync.sql` para coincidir con la versión que asignó el servicio y evitar que el CLI lo considere una migración diferente pendiente. **Su SQL no cambia** respecto al archivo aprobado en `623cba5` (blob `660ed9f7255f01e73816b2613f96cf7d98d05b2a`), que entonces se llamaba `20261104105956_garmin_sync.sql`. No se ha modificado manualmente el historial remoto.
- Verificación alojada por lectura: **cinco tablas con RLS y sin permisos para `anon`/`authenticated`**, seis funciones SECURITY INVOKER con `search_path` explícito y ejecución solo del servidor, secuencia privada y tres columnas nuevas con los tipos esperados.
- El calendario conserva SELECT/INSERT/UPDATE/DELETE para el rol autenticado bajo sus políticas anteriores; TRUNCATE/REFERENCES/TRIGGER ya están retirados.
- Recuentos antes y después: perfiles 3, roles 3, relaciones 2, sesiones planificadas 1, actividades 0, conexiones Garmin 0 y estados OAuth 0. Las cinco tablas nuevas están vacías. No se han creado cuentas definitivas ni alterado registros existentes.
- Se han vuelto a consultar los asesores: los siete avisos informativos [RLS sin políticas](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy) corresponden al almacenamiento exclusivo del servidor. Sigue el aviso previo de [protección contra contraseñas filtradas](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection); no se ha cambiado el plan gratuito ni configurado Auth.
- La prueba funcional alojada de `database/tests/garmin-sync.sql`, con fixtures y ROLLBACK, **no se ejecutó**: su confirmación independiente caducó dos veces. No se ha usado una ruta alternativa para eludirla. Se ha comprobado después que no hay fixtures persistidos. Las 32 comprobaciones funcionales SQL siguen siendo **locales**; la verificación alojada de esta entrega cubre esquema, historial y permisos efectivos por lectura de catálogos.

La primera confirmación de la migración también caducó; una nueva solicitud por el mismo procedimiento sí terminó correctamente. No se ha repetido la aplicación después del éxito. Garmin no se ha habilitado, no hay despliegue nuevo y no se han cambiado las URLs registradas, los planes o la web pública.

## Revisión previa tras `0775990` (antes de aplicar)

Se ha vuelto a leer la rama, el esquema alojado y el portal oficial. AsturPower Training sigue **Approved** con Activity API, Training API, OAuth 2.0 y el mismo retorno registrado. No hay conexiones Garmin autorizadas individualmente en Supabase.

- **Compatibilidad comprobada por lectura:** `database/tests/garmin-preflight.sql` devuelve diez comprobaciones correctas en el proyecto exclusivo AsturPower. Comprueba tipos, claves, RLS, acceso privado a tokens/estados, privilegios del servidor y ausencia de objetos que entren en conflicto. No lee registros personales ni ejecuta DDL. Es un control previo a la primera aplicación: después de aplicar la migración debe indicar que los objetos ya existen; no se debe interpretar como una autorización para volver a aplicarla.
- **Cambios preparados:** cinco tablas privadas, dos columnas de versión de consentimiento, una de orden de permisos, seis funciones SQL reservadas al servidor y retirada de TRUNCATE/REFERENCES/TRIGGER del calendario para `authenticated`. No cambia las políticas de acceso entre entrenadores y deportistas ni activa sincronizaciones. Se han añadido límites de espera de bloqueo (5 s) y de sentencia (30 s) dentro de la transacción para abortar ante una base ocupada. La migración sigue **sin aplicar** y requiere autorización explícita.
- **Pruebas repetidas:** 111 casos Node, 30 verificaciones SQL y dos denegaciones, y compilación Vite correctas. El control previo tiene además cinco escenarios locales: esquema compatible, tipo incompatible, RLS desactivada, permiso cliente indebido y función en conflicto. Todos se ejecutan sobre PostgreSQL local con datos ficticios y sin persistencia alojada.
- **Cloudflare avanza:** Wrangler compila el receptor sin subirlo; el bundle se ejecuta en workerd local mediante Miniflare. Siete escenarios verifican salud, desactivación inicial, ausencia de callback OAuth alternativo, rechazo de XFF, persistencia cifrada, duplicados y error de almacenamiento. Las tres llamadas de almacenamiento son interceptadas; no alcanzan Supabase ni Garmin. Se usan exclusivamente credenciales y datos ficticios. Wrangler y Miniflare son herramientas de desarrollo, con versiones fijadas y lockfile; Miniflare corresponde a la versión beta incluida por este Wrangler.
- **Netlify:** equipo Free y sitio privado, con el mismo despliegue publicado de `b103a233`. La conexión disponible no expone el saldo; la página de facturación pide iniciar sesión. No se puede afirmar que el bloqueo por créditos se haya levantado. No se han disparado builds ni cambiado planes o controles de acceso.
- **Accesos pendientes:** API Tools continúa pidiendo la sesión específica de la aplicación; Cloudflare muestra inicio de sesión y no hay una conexión de despliegue disponible. No se han solicitado contraseñas, abierto nuevas cuentas ni copiado secretos entre proveedores. Que el portal Developer esté autenticado no autentica API Tools.
- **Seguridad alojada:** los avisos informativos de RLS sin políticas sobre las dos tablas OAuth son intencionados: solo el servidor debe acceder. Supabase también avisa de protección contra contraseñas filtradas desactivada; su documentación la limita a Pro o superior. No se ha contratado ni activado un plan de pago. Los índices informados como no usados no se eliminan; los dos índices de claves externas recomendados quedan como mejora de rendimiento, sin bloquear esta migración.

No se ha creado una nueva web accesible: `asturpower-training-dev.netlify.app` sigue requiriendo la sesión del equipo y sirviendo la versión anterior. La autorización posterior cubrió exclusivamente la migración en AsturPower; no equivale a autorizar producción, abrir el sitio, cambiar URLs o vincular una cuenta personal de Garmin.

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
| Base de datos | Migración **aplicada** con autorización; versión alojada `20261104115935`. Esquema y privilegios comprobados por lectura. Pruebas funcionales con fixtures solo ejecutadas localmente; las solicitudes de prueba alojada caducaron sin confirmación. |

El código se guarda con la marca `[skip netlify]` mientras el despliegue alojado esté pendiente de revisión. Esto permite revisar y ejecutar las pruebas en GitHub sin reemplazar la versión actualmente servida ni iniciar otro despliegue en la cuota compartida del equipo. No se han creado ni habilitado nuevas credenciales o cuentas reales.

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

`supabase/migrations/20261104115935_garmin_sync.sql` añade registros privados de exportación, cola cifrada, cursor, bloqueos, orden de importación y reservas de cuota, además de metadatos de consentimiento. Las tablas nuevas tienen RLS y carecen de acceso para `anon` y `authenticated`.

Las funciones SQL son **SECURITY INVOKER**, con `search_path` explícito y EXECUTE reservado a `service_role`. No se añaden funciones SECURITY DEFINER para saltarse RLS.

La revisión detectó que `authenticated` tenía TRUNCATE, REFERENCES y TRIGGER sobre el calendario. La migración revoca esos privilegios innecesarios y conserva el CRUD autorizado. Las pruebas SQL locales comprueban insertar, editar y borrar una sesión con el entrenador correcto después de la revocación. Esta corrección ya está **aplicada**, con privilegios efectivos comprobados en Supabase; el CRUD bajo identidades ficticias sigue pendiente de prueba funcional alojada.

La migración es incremental para el esquema actual de AsturPower, no un instalador para una base vacía. No debe ejecutarse en Comunio ni en Vehículos Empresa.

## Netlify y alternativa Cloudflare

El inicio de sesión de equipo de Netlify y el inicio de sesión de un deportista en Supabase son controles diferentes. Una función detrás del acceso privado de Netlify no es un receptor accesible para los POST servidor a servidor de Garmin. El retorno OAuth también puede exigir la sesión de Netlify antes de ejecutarse; que funcione en el navegador del propietario no demuestra acceso de otro deportista.

Se han preparado `_headers` y `_redirects` dentro del directorio público de **la app de pruebas**, para que la compilación emita las cabeceras aunque el proyecto no lea `netlify.desarrollo.toml`. Los endpoints sensibles llevan sus propias cabeceras. Estos archivos no cambian la landing de `main`.

`cloudflare/garmin-worker.mjs` y `wrangler.garmin.toml` preparan un **receptor alternativo**, con el mismo motor, la misma base AsturPower y el mismo modelo de seguridad. Tiene una ruta de salud y `/garmin/activities`; no migra el OAuth ni crea un retorno nuevo. El adaptador usa `CF-Connecting-IP` exclusivamente dentro del runtime de Cloudflare.

La alternativa se ha probado como manejador Request/Response en Node y también compilada con Wrangler y ejecutada en **workerd local**, con almacenamiento interceptado. **No está desplegada ni validada en la red alojada de Cloudflare.** No se han creado cuentas, contratado recursos, copiado secretos a otro proveedor ni cambiado dominios. El cron de Cloudflare no está configurado. No se necesita migrar la web para continuar desarrollando.

## Pruebas reproducibles

```sh
npm ci
npm test
npm run test:garmin
npm run test:database:garmin
npm run simulate:garmin
npm run build
npm run test:garmin:cloudflare
```

- Batería Node: OAuth, cifrado, consentimiento, callbacks, permisos, portafolios, PKCE, cuota/reintentos, bloqueos, envío, calendario, importación, deduplicación, lotes y adaptador alternativo. Incluye la interacción del botón en DOM simulado.
- Resultado de esta revisión: **111 pruebas Node superadas**, **30 verificaciones SQL y 2 denegaciones adicionales superadas**, compilación correcta y simulación bidireccional superada. La verificación SQL es local, no alojada.
- PostgreSQL/PGlite: motor PostgreSQL local en WebAssembly, no un mock de SQL. Esquema deportivo/políticas obtenidos por lectura de metadatos del proyecto; andamiaje Auth local solo para las pruebas. Valida RLS, roles, RPC, cuotas, bloqueos, importación y mantenimiento del calendario. No equivale a una prueba de Supabase Auth real o del despliegue alojado.
- La transacción de pruebas SQL se revierte y el ejecutor exige cero usuarios, actividades, conexiones y entregas al finalizar.
- `docs/garmin-pruebas-simuladas.json` recoge una simulación con cero peticiones reales: un entrenamiento y una programación, sin duplicado al repetir; dos entregas iguales producen un único registro de cola y dos actividades de deportistas ficticios separados.
- CI de `desarrollo` incluye la prueba de base de datos local. Las hojas de estilo se cargan en los puntos de entrada del navegador; se ha corregido el fallo previo que impedía ejecutar pruebas Node al importar CSS desde la lógica de interfaz.
- CI ejecuta además la compilación sin subida y las pruebas de workerd local. El guion no lee `.env`, `.dev.vars` ni credenciales de cuenta; solo pasa bindings ficticios a Miniflare. Toda salida HTTP del Worker se intercepta y cualquier destino inesperado hace fallar la prueba. La prueba no certifica accesibilidad pública ni una sincronización real con Garmin.

## Lo que falta para una primera prueba real

1. La migración ya está aplicada y sus asesores/privilegios revisados. Queda completar la prueba funcional alojada con fixtures y ROLLBACK cuando se confirme su ejecución; no volver a aplicar la migración ni eludir esa confirmación.
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
- Pruebas locales Cloudflare: https://developers.cloudflare.com/workers/testing/miniflare/
- Seguridad Supabase: https://supabase.com/docs/guides/database/postgres/row-level-security y https://supabase.com/docs/guides/auth/password-security


## Continuación del despliegue Cloudflare — 4 de noviembre de 2026

- Netlify rechazó el intento del commit `a96f6f4` por créditos agotados; no se solicita otro despliegue allí.
- La aprobación móvil de Wrangler terminó correctamente en Cloudflare, pero Work no pudo recibir la sesión porque la política de red bloqueó el acceso a `dash.cloudflare.com`. La CLI siguió sin autenticación. No se repite la autorización ni se extraen tokens.
- Se ha vinculado Cloudflare con el repositorio de AsturPower mediante su integración oficial con GitHub. El usuario confirmó haber guardado `desarrollo` como rama de despliegue del Worker independiente `asturpower-garmin-dev`.
- El primer intento `4bf348ac` seleccionó `main` y se detuvo en la comprobación de rama, antes de ejecutar el comando de despliegue. La comprobación se conserva: `test "$WORKERS_CI_BRANCH" = "desarrollo"`.
- El comando acordado es `npx wrangler deploy --config wrangler.garmin.toml`. Este registro inicia un único intento desde `desarrollo`; no certifica que Cloudflare lo haya publicado. Se debe verificar el resultado y la URL real antes de marcarlo como desplegado.
- El receptor sigue cerrado con `ASTURPOWER_GARMIN_ACTIVITY_ENABLED=false`, sin secretos ni cron configurados. No se modifica el retorno OAuth registrado en Garmin, la web principal ni `main`.
- Este Worker solo implementa salud y recepción de eventos. Aún no aloja el acceso de deportistas ni OAuth, por lo que publicarlo no basta para pulsar «Conectar Garmin».
- Se dejó preparada en Supabase una sesión de ciclismo de 16 minutos con dos intervalos de potencia, pendiente de autorización individual y envío; no se han copiado identificadores de personas a este documento.
- Estado real: ninguna cuenta Garmin conectada ni entrenamiento enviado ni actividad oficial importada en la última comprobación. Las pruebas de código existentes siguen siendo locales/simuladas; la CI del commit `a96f6f4` terminó correctamente.

## Receptor público verificado y adaptador de aplicación opcional

Cloudflare confirmó el despliegue del commit `2b3150f` desde `desarrollo`, versión `7469b7d8-9e20-4956-9de1-e4a906800f3f`. Se comprobó por HTTP real:

- `https://asturpower-garmin-dev.asturpower-training.workers.dev/health`: **200**, `{"service":"asturpower-garmin-receiver","enabled":false}`.
- POST con cuerpo vacío a `/garmin/activities`: **503**, `garmin_activity_not_enabled`. No se usaron actividades ni datos de salud.

Eso certifica HTTPS y publicación del receptor desactivado, no OAuth, envío ni recepción de datos Garmin reales.

`cloudflare/garmin-app-worker.mjs` y `wrangler.garmin-app.toml` preparan la aplicación existente y sus endpoints en el mismo Worker. Esta configuración es **opcional y todavía NO está seleccionada ni desplegada**: la integración Git sigue utilizando `wrangler.garmin.toml`, receptor solamente.

El adaptador reutiliza los manejadores de equipo, OAuth y Training, pasando bindings explícitos por petición, sin copiar secretos a `process.env`. Solo admite el Supabase exclusivo de AsturPower y el hostname de pruebas verificado. Conserva autenticación, roles, vínculos autorizados y rechazo de peticiones de otro origen. El procesador no tiene ruta pública. El frontend se compila a archivos estáticos sin configuración privada; se excluyen las reglas Netlify y el Worker añade cabeceras de seguridad, CSP limitada a ese Supabase, no-store y noindex.

Los manejadores OAuth mantienen Netlify como origen predeterminado. Únicamente el adaptador Cloudflare selecciona su origen fijo; no deriva retornos desde Host, query, Origin o cabeceras reenviadas. El callback elimina los parámetros y vuelve al origen del adaptador. Los estados de OAuth conservan su callback exacto y no se reutilizan entre proveedores.

Verificación local actual: **118 pruebas Node superadas**, compilación Vite y del Worker correctas, receptor anterior superando sus 7 escenarios en workerd, y adaptador opcional superando **10 escenarios con workerd y los activos Vite reales**, con cero peticiones externas. El flujo OAuth completo se ha simulado en ambos orígenes; no equivale al consentimiento Garmin de un deportista. CI incorpora la prueba del nuevo adaptador.

Para comprobarlo sin publicar:

```sh
WRANGLER_SEND_METRICS=false npm run test:garmin:cloudflare:app
```

Para seleccionar posteriormente la aplicación completa, habrá que cambiar el build del Worker a `test "$WORKERS_CI_BRANCH" = "desarrollo" && npm run build:garmin:cloudflare:app` y el deploy a `npx wrangler deploy --config wrangler.garmin-app.toml`. Todas sus activaciones están en false: publicar esa configuración por sí sola no habilita cuentas ni Garmin. No se han ejecutado esos cambios de configuración.

Bloqueos de la prueba real: configurar en Cloudflare los valores privados existentes por un canal seguro; activar los módulos después de verificar permisos y privacidad; y **obtener autorización explícita antes de sustituir o añadir en Garmin** `https://asturpower-garmin-dev.asturpower-training.workers.dev/.netlify/functions/garmin-callback`. Ese cambio trasladaría el destino de futuras autorizaciones desde el entorno Netlify bloqueado; los estados pendientes del retorno antiguo no sirven para el nuevo. La dirección registrada sigue siendo la de Netlify. No se han creado credenciales ni cambiado permisos o URLs en Garmin. No hay una cuenta Garmin conectada por esta entrega.

## Autorización recibida y publicación del callback de pruebas

El usuario autorizó explícitamente sustituir el retorno OAuth de pruebas de Netlify por el callback del Worker Cloudflare anterior. La aprobación se conserva; no debe pedirse otra vez por el mismo cambio. Antes de guardarlo en Garmin se verificará que la ruta está publicada y no devuelve 404.

Se selecciona la aplicación en `wrangler.garmin.toml`, conservando el receptor aislado y reversible en `wrangler.garmin-receiver.toml`. El antiguo fichero opcional `wrangler.garmin-app.toml` pasa a la configuración activa. `build:garmin:cloudflare` continúa probando el receptor mediante su fichero independiente. Todas las activaciones siguen en **false**; no se añaden secretos. El origen y el Supabase de AsturPower se fijan como valores no secretos del servidor.

Para evitar otra configuración manual del panel, el comando de despliegue existente permanece intacto y Wrangler ejecuta su `build.command` (`npm run build:garmin:cloudflare:app`). Se verificó desde cero, eliminando antes los archivos generados, que el CLI instalado ejecuta el build y pasa los 10 escenarios de workerd con cero peticiones externas. La compilación y el resultado de GitHub/Cloudflare deben verificarse antes de afirmar que el nuevo callback está publicado. Este cambio no habilita «Conectar Garmin».

Revisión de la política pública actualmente registrada: menciona Garmin, Supabase, Netlify y Google/Gmail, pero **no Cloudflare**. La aplicación debe permanecer desactivada para datos personales y de Garmin hasta actualizar la información sobre el proveedor y revisar las garantías de tratamiento; no se modifica la web principal ni su política en esta entrega. La actualización de esa información y cualquier cambio de URL de privacidad registrado son distintos de la autorización recibida para el retorno OAuth.

Resultado comprobado de este cambio: Cloudflare publicó correctamente el commit `17ce3bf`, versión `a7224077-d1e0-4da7-92fc-fc273c9b0831`, y su CI terminó correctamente. La raíz sirve el frontend compilado con **200**; el callback devuelve **303** a `/?garmin=not_ready`, con no-store, no-referrer y CSP del Supabase exclusivo. Es el comportamiento previsto con OAuth desactivado y no una conexión real.

Después de comprobar esa ruta, se guardó en el portal oficial de Garmin **solo el retorno OAuth autorizado**. La vista posterior mostró `https://asturpower-garmin-dev.asturpower-training.workers.dev/.netlify/functions/garmin-callback`, Key Status Approved, Starter Enabled y las mismas Activity API y Training API. No se pulsó Show key ni se modificaron claves, permisos, imagen, web o URL de privacidad.

Siguiente bloqueo: faltan los valores privados existentes en los bindings de Cloudflare y la revisión de privacidad para ese proveedor. Los nombres necesarios son `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, `GARMIN_CLIENT_ID`, `GARMIN_CLIENT_SECRET` y `GARMIN_TOKEN_ENCRYPTION_KEY`; sus valores no se incluyen en GitHub ni se solicitan por chat. La conexión Git permite desplegar código, pero no proporciona una sesión del panel Cloudflare a Work ni acceso a los secretos de Netlify. No se habilitan módulos ni se inicia el consentimiento individual hasta resolverlo por un canal seguro. Ningún deportista conectado ni entrenamiento enviado a Garmin por esta entrega.


## Continuación del 5 de noviembre: secretos cargados y comprobación previa

Esta sección actualiza los bloqueos descritos anteriormente. El usuario confirmó la carga y despliegue de los cinco secretos existentes en Cloudflare. Su captura muestra los cinco nombres como Secret / Value encrypted; no se han leído, copiado a GitHub ni regenerado sus valores. La captura acredita su almacenamiento como secretos, no su validez frente a Garmin o Supabase.

Se declara `secrets.required` con esos cinco nombres en Wrangler y se reutiliza el validador OAuth para que GET `/health` añada `configuration_format_ready` y `configuration_invalid_fields`. La segunda lista solo contiene nombres de campos de una lista fija, nunca sus valores. El booleano comprueba presencia y formato, el proyecto exclusivo y el callback exacto; ignora la activación solo para el diagnóstico y no devuelve valores, no autentica usuarios, no consulta bases de datos y no llama a Garmin. El acceso y las operaciones conservan todas las comprobaciones de activación. El receptor independiente conserva su contrato anterior.

Se ha preparado localmente un borrador de privacidad que incluye el alojamiento Cloudflare. Su publicación fue bloqueada por la revisión automática por contener un correo de contacto y declaraciones sobre el tratamiento de datos que requieren aprobación. No se incluye el borrador en este commit, no se modifica el enlace de la interfaz ni se cambia la versión del consentimiento. La página de privacidad registrada en Garmin sigue siendo la anterior.

Comprobaciones locales: 119 pruebas Node superadas y 11 escenarios del adaptador completo en workerd, con activos Vite reales y cero solicitudes externas. Incluyen formato de configuración, rechazo cuando falta cada valor, módulos desactivados y callback cerrado. Estas pruebas no verifican las credenciales contra sus proveedores ni equivalen a una conexión Garmin real.

Esta publicación mantiene los cinco módulos en false, Activity API sin recepción activa ni cron y la web original y main intactas. No se ejecuta ninguna migración ni escritura de datos. Queda comprobar la versión publicada y el booleano de formato en HTTPS; aprobar y publicar la información de privacidad que incluya Cloudflare y autorizar expresamente la activación de acceso, equipo, OAuth y envío en este entorno. La recepción de actividades requiere una revisión independiente de API Tools y del procesador. Después, el deportista debe iniciar sesión y conceder personalmente su consentimiento Garmin. No hay prueba de cuenta Garmin conectada, entrenamiento enviado ni llegada a dispositivo.


Cloudflare y CI confirmaron el commit `3b65c7a`, versión `ab91ce87-e267-405c-bd4a-acd8744cd729`. La comprobación real desde el navegador de Work mostró `configuration_format_ready=false` y recepción desactivada. No se atribuye el fallo a un campo concreto hasta recibir el diagnóstico limitado a nombres; no se pide repetir toda la carga ni se muestran valores. La consulta HTTPS con Python devolvió 403, mientras el navegador sí pudo leer la salud del Worker; ese código aislado no demuestra bloqueo de Cloudflare a todo Work ni invalida el despliegue.
