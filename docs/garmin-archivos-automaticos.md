# Archivos Garmin automáticos — 8 de noviembre de 2026

Se conecta `activityFiles` al receptor oficial del entorno de pruebas. Los resúmenes se mantienen y los archivos se procesan en el servidor: no hace falta abrir la aplicación ni subir archivos manualmente para las nuevas entregas.

El receptor devuelve 200 tras guardar una notificación cifrada, procesa inmediatamente con `waitUntil` y conserva el cron de cinco minutos como respaldo. Cada callback oficial se valida y se consume una sola vez, tras registrar un intento duradero y reservar espacio dentro del límite compartido de 800 MiB. Nunca se envía OAuth al callback ni se siguen redirecciones. Los callbacks no se guardan en texto claro ni se registran en logs. Un GET incierto no se repite; una nueva entrega con un callback distinto puede recuperarlo.

El archivo completo se conserva en fragmentos privados de 4 MiB con SHA-256. Los reintentos de almacenamiento reutilizan los bytes en memoria, sin volver a descargar de Garmin. Una vez completo, un webhook interno firmado con la clave existente del servidor activa `garmin-file-analysis`. La función verifica HMAC y caducidad, adquiere una reserva exclusiva, vuelve a comprobar conexión y permiso, reconstruye y verifica el original y usa el SDK oficial FIT. Une el archivo por el ID oficial de la actividad y el deportista, con comprobación adicional de fecha. No sustituye un detalle histórico diferente.

La función conserva las muestras deportivas y vueltas con el mismo formato que el calendario y mantiene los IF, TSS y FTP originales del dispositivo. Los umbrales históricos siguen aplicándose por fecha. El original completo, incluidos sus campos no proyectados y GPS, permanece privado; las series deportivas respetan los permisos de entrenador ya configurados. La llegada de series vuelve a activar automáticamente el cálculo de récords existente.

Los ficheros FIT tienen análisis automático; TCX y GPX se conservan completos pero quedan señalados para revisión de formato. No se generan curvas ni métricas ausentes. Los fallos tienen estados explícitos y códigos fijos; la preparación se reanuda desde el original almacenado sin consumir otra vez el callback.

## Activación externa y validación real

Debe habilitarse **Activity Files** en el portal oficial de Garmin, hacia `https://asturpower-garmin-dev.asturpower-training.workers.dev/garmin/activities`. La sesión de API Tools estaba caducada al revisar este cambio. El despliegue del receptor no equivale a haber activado la entrega de Garmin. Las actividades ya recibidas solo como resumen necesitan una nueva entrega del proveedor o el original; no se presupone acceso de backfill en Starter.

Las pruebas usan FIT sintéticos creados con el SDK oficial, verifican los registros completos, vueltas, cargas, aislamiento, cifrado, callbacks, deduplicación, almacenamiento incompleto y ejecución sin navegador. Debe comprobarse una entrega real después de la activación externa antes de dar por resueltas las actividades del 6 y 7 de noviembre.
