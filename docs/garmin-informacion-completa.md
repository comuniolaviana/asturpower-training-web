# Preparación de información completa de Garmin

## Disponible en el entorno de pruebas

Garmin → «Historial completo · Archivos originales» conserva el archivo aportado por el titular sin filtrar campos. Un ZIP de exportación completo mantiene también JSON, metadatos y entradas no interpretadas. Los FIT originales mantienen muestras, coordenadas, vueltas, eventos, potencia instantánea, datos de sensores y campos específicos del dispositivo aunque el lector no los conozca todavía.

El titular selecciona un archivo y acepta explícitamente guardarlo. La lectura local no implica subida. Los originales completos de cuenta son privados del titular; un entrenador vinculado no puede acceder a ellos. No se crean URLs públicas o firmadas. La aceptación de archivo es independiente del OAuth Garmin existente.

La nueva zona de Storage guarda fragmentos inmutables de 4 MiB, con un manifiesto ordenado y SHA-256 por fragmento. El identificador del manifiesto se calcula canónicamente, independiente del orden JSONB. La descarga verifica cada fragmento y reconstruye exactamente los bytes originales. Una transferencia interrumpida se reanuda seleccionando el mismo archivo; los fragmentos existentes se verifican sin sobrescribirlos. No se declara listo hasta comprobar todos sus fragmentos y tamaños.

El plan gratuito ofrece 1 GB total y limita cada objeto a 50 MB. La aplicación reserva un máximo conjunto de 800 MiB para originales, dejando margen operativo. Las reservas incompletas también cuentan. Los fragmentos resuelven el límite por objeto, no amplían el espacio total. Si un archivo no cabe, se detiene antes de empezar sin reducir su contenido ni contratar un plan. Se comprobará el tamaño del historial real cuando llegue.

Las descargas grandes se escriben por fragmentos al disco en navegadores compatibles. El modo de descarga en memoria se limita a 128 MiB; para tamaños superiores pide usar Chrome/Edge en ordenador. El original almacenado no se recorta por esta limitación del navegador.

## Visor

El explorador ZIP lista todas las entradas, no solo actividades. Admite ZIP32/ZIP64 y deflate, incluidos archivos anidados. El lector FIT oficial @garmin/fitsdk 21.221.0 se ejecuta en un Worker del navegador y muestra todos sus grupos de mensajes y campos, incluidos desconocidos, en páginas de 25 registros. No reduce las muestras a medias. JSON/texto se muestra como texto y nunca se ejecuta. Los límites de previsualización se indican sin borrar ni alterar el original: 50 MiB por FIT/entrada, 2 MiB para texto y hasta tres niveles de ZIP.

Conservar un original completo y explorar sus datos no significa que todos esos campos estén ya normalizados en el calendario, las gráficas o los cálculos de carga. La indexación y las vistas deportivas se completarán a partir de los archivos reales; nunca se sustituye la copia original por esa representación derivada. La exportación real sigue pendiente y todavía no se ha importado un historial real.

## Base y permisos

Dos migraciones nuevas y aditivas crean el almacén y separan las funciones privilegiadas en asturpower_private. Los RPC públicos son SECURITY INVOKER. Los auxiliares privados comprueban auth.uid(), rol de deportista y fila propia; el privilegio es necesario para reservar una cuota global sin revelar datos ajenos y confirmar los objetos sin dar escritura directa a las filas.

RLS protege metadatos y objetos. No hay lectura anónima, lectura del entrenador sobre una exportación completa, escritura directa del cliente en el manifiesto ni sobrescritura de fragmentos. Las tablas de sincronización, roles, vínculos, credenciales, callback y cron existentes no se modifican. La primera migración Garmin ya aplicada no se vuelve a ejecutar. La supresión de originales se puede solicitar por el contacto de privacidad; desconectar Garmin no borra copias aportadas voluntariamente.

## Actividades futuras: estado y preparación

El receptor actual sigue recibiendo resúmenes. Activity Files no se ha habilitado en API Tools ni conectado al cron. La especificación oficial Activity API 2.1 §6.4, consultada en el portal y guardada fuera del repositorio, confirma que los archivos originales se obtienen mediante callbackURL, disponible durante 24 horas y de un solo uso. Ese token de descarga no es el token OAuth del usuario. Los endpoints no se inventan ni se siguen redirecciones.

El transporte preparado valida el host y el recurso oficiales, limita tamaño y tiempo, no envía cookies ni Authorization OAuth y realiza un solo intento. Está cubierto con respuestas ficticias y deliberadamente no conectado al receptor activo. Antes de activar archivos reales faltan una reserva de almacenamiento previa a la descarga, un registro duradero del intento único y el tratamiento explícito de un resultado incierto: repetir ciegamente puede perder la copia porque Garmin devuelve 410 después de consumirla. También habrá que registrar y probar el endpoint oficial Activity Files con una actividad nueva. No se afirma recepción automática de FIT completos.

## Validación

Pruebas con datos enteramente sintéticos: reconstrucción binaria por encima de 4 MiB, identidad canónica JSONB, reanudación, corrupción, cambio de sesión, consentimiento, acceso de otro deportista y entrenador vinculado, cuota compartida en PostgreSQL/PGlite, ZIP/deflate y 61 muestras FIT con GPS, potencia, pulso y vueltas. El transporte oficial se prueba sin peticiones a Garmin. No se publican archivos reales, credenciales ni datos de actividad en GitHub.

Fuentes oficiales:
- https://developer.garmin.com/fit/file-types/activity/
- https://github.com/garmin/fit-javascript-sdk
- https://supabase.com/docs/guides/storage/security/access-control
- https://supabase.com/docs/guides/storage/uploads/file-limits
- https://supabase.com/docs/guides/platform/manage-your-usage/storage-size


## Actualización del 8 de noviembre
La preparación descrita arriba se ha conectado al receptor y al análisis automático en servidor. Véase `garmin-archivos-automaticos.md` para el estado de activación externa y validación real; no deben confundirse las pruebas con una entrega real ya completada.
