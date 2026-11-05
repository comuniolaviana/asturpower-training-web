# Recepción Garmin: preparación de la primera prueba real

El envío de una sesión estructurada desde AsturPower hasta un dispositivo Garmin compatible ha quedado confirmado por la prueba física del 5 de noviembre de 2026. Las imágenes de esa prueba no se publican en este repositorio.

La recepción sigue desactivada y requiere consentimiento de Actividades del deportista. No se han recibido actividades reales ni descargado históricos. Una imagen aportada por el usuario muestra que API Tools es accesible y que las URLs de notificaciones están vacías.

## Procesador periódico

Se configura el handler scheduled existente cada cinco minutos en el Worker de pruebas. Con ASTURPOWER_GARMIN_ACTIVITY_ENABLED=false no accede a datos ni procesa entregas. Se mantienen las protecciones del proyecto exclusivo, origen oficial, almacenamiento cifrado, deduplicación, reintentos y purga ya existentes. No se modifica Supabase ni el retorno OAuth.

Se añaden pruebas de inactividad con recepción apagada o proyecto incorrecto y procesamiento de una entrega cifrada ficticia, incluyendo borrado de su payload. La ejecución corresponde a CI; no se presenta la preparación como recepción real ni se garantiza rendimiento de cargas grandes en el plan gratuito.

## Configuración mínima pendiente de verificar

Destino previsto: https://asturpower-garmin-dev.asturpower-training.workers.dev/garmin/activities

Se necesitan las notificaciones Activities, Deregistrations y User Permissions Change. Activity Files y MoveIQ no están admitidos por este receptor; no deben habilitarse. Activity Details y Manually Updated Activities pueden revisarse después del primer caso mínimo.

Antes de activar se verifican el despliegue y el procesador, se confirma la activación con el usuario y se obtiene el consentimiento individual de Actividades. Después se registra la URL en API Tools, se prueba una entrega oficial con datos ficticios y se comprueba una actividad real consentida. La configuración visible no demuestra que Garmin haya probado o habilitado el destino.

Starter no incluye datos históricos: las actividades sincronizadas antes de autorizar y configurar esta integración no deben darse por importadas automáticamente. No se crean credenciales, cuentas ni recursos de pago.
