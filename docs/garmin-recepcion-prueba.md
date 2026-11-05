# Recepción Garmin: preparación de la primera prueba real

El envío de una sesión estructurada desde AsturPower hasta un dispositivo Garmin compatible ha quedado confirmado por la prueba física del 5 de noviembre de 2026. Las imágenes de esa prueba no se publican en este repositorio.

La activación de recepción en el entorno de pruebas se autorizó expresamente el 5 de noviembre de 2026, incluidos los resúmenes deportivos y fisiológicos disponibles y su consulta por el entrenador vinculado. Se activa ASTURPOWER_GARMIN_ACTIVITY_ENABLED=true exclusivamente en este Worker. El permiso individual Actividades todavía debe verificarse en Garmin Connect. No se han recibido actividades reales ni descargado históricos. Las tres URLs mínimas están preparadas en API Tools; su guardado y habilitación no están confirmados.

## Procesador periódico

Se configura el handler scheduled existente cada cinco minutos en el Worker de pruebas. Con ASTURPOWER_GARMIN_ACTIVITY_ENABLED=false no accede a datos ni procesa entregas. Se mantienen las protecciones del proyecto exclusivo, origen oficial, almacenamiento cifrado, deduplicación, reintentos y purga ya existentes. No se modifica Supabase ni el retorno OAuth.

Se añaden pruebas de inactividad con recepción apagada o proyecto incorrecto y procesamiento de una entrega cifrada ficticia, incluyendo borrado de su payload. La ejecución corresponde a CI; no se presenta la preparación como recepción real ni se garantiza rendimiento de cargas grandes en el plan gratuito.

## Configuración mínima pendiente de verificar

Destino previsto: https://asturpower-garmin-dev.asturpower-training.workers.dev/garmin/activities

Se necesitan las notificaciones Activities, Deregistrations y User Permissions Change. Activity Files y MoveIQ no están admitidos por este receptor; no deben habilitarse. Activity Details y Manually Updated Activities pueden revisarse después del primer caso mínimo.

La preparación del procesador se publicó en 472aa339eaece831856ca0d6834e54e681df0516: CI superada y Cloudflare build 46b68ac2-3e64-4bb3-bbf3-270fccebc00b correcto, versión fe265e1c-7a5f-4d51-959d-fa109d7684b8. Tras verificar el nuevo despliegue con la recepción activa, se habilitan las tres notificaciones mínimas, se obtiene el permiso individual Actividades en Garmin Connect, se prueba una entrega oficial con datos ficticios y se comprueba una actividad real consentida. La configuración visible no demuestra que Garmin haya probado o habilitado el destino.

Starter no incluye datos históricos: las actividades sincronizadas antes de autorizar y configurar esta integración no deben darse por importadas automáticamente. No se crean credenciales, cuentas ni recursos de pago.
