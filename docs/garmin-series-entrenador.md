# Historial deportivo y curvas del entrenador

Actualización: 6 de noviembre de 2026. Rama exclusiva `desarrollo`.

## Cambio

El titular puede completar una segunda pasada del original ya guardado, sin volver a subir el ZIP. El analizador versión 2 recorre FIT, TCX y GPX por paquetes y guarda un diagnóstico persistente por archivo. Se mantienen las coincidencias conservadoras: fecha, deporte, duración, distancia cuando está disponible y una única candidata. Un archivo alternativo no sobrescribe ni sustituye la fuente ya vinculada a una actividad.

La potencia normalizada registrada expresamente por el dispositivo se conserva como `device`. Cuando no existe, se calcula desde muestras de un segundo solo con cobertura suficiente. Se identifica la procedencia; no se fabrican muestras en huecos. Una lectura FIT con avisos puede conservar sus campos deportivos reconocidos, con advertencia explícita en el detalle. El original permanece completo.

Las series deportivas se guardan por actividad, con sus marcas de tiempo, campos numéricos deportivos admitidos, sesiones, vueltas y eventos. No se reduce el número de registros guardados: únicamente se simplifica el dibujo de las gráficas. Los campos desconocidos, GPS, identidades y contenido general de la cuenta no se comparten; siguen en el original privado del titular. El importador XML admite sesiones únicas TCX/GPX con fechas y deporte identificables. Los casos ambiguos permanecen pendientes y se identifican en el diagnóstico.

## Acceso del entrenador

El permiso existente para métricas derivadas y el nuevo permiso de series son separados y revocables por entrenador. Ambos requieren una vinculación activa. Los objetos de Storage y la tabla de referencias aplican RLS; no hay URLs públicas ni claves administrativas en el navegador. La autorización para métricas no habilita las series por defecto.

En Rendimiento se puede filtrar por año, consultar todas las actividades, representar duración, distancia, pulso, potencia, NP o TSS disponible y abrir una actividad para consultar curvas, vueltas y todos los registros deportivos preparados. La disponibilidad se muestra por actividad. Los casos sin archivo vinculado siguen mostrando el resumen histórico, sin prometer series inexistentes.

## FTP y zonas históricos

Los cálculos usan la versión de parámetros vigente en la fecha de cada actividad (día de Europe/Madrid). Un FTP futuro no se aplica al pasado y una versión posterior con FTP vacío no rescata un FTP antiguo. El entrenador puede registrar cambios de FTP y límites porcentuales con su fecha, conservando los otros parámetros fisiológicos de la versión anterior. Las zonas no se suponen ni se asigna un mismo FTP a todos los años. Un último valor conocido puede necesitar revisión humana si Garmin no registró cambios posteriores: la app no puede reconstruir umbrales anuales que no existen en la exportación.

El detalle calcula tiempo por zonas únicamente para intervalos medidos de un segundo y muestra por separado los huecos no clasificables. No convierte silenciosamente los huecos de registro inteligente en segundos medidos.

## Conservación, presupuesto y reanudación

Las series usan JSON columnar sin recortar registros, comprimido con gzip, con SHA-256 antes de descargarse o publicarse. Cada objeto privado tiene un máximo de 4 MiB y la lectura descomprimida se limita a 64 MiB. Se reservan bytes antes de subir; el límite compartido de 800 MiB cuenta originales, reservas pendientes, series y otros buckets. Una actividad que supere el límite conserva su original y detiene el proceso con un mensaje.

La segunda pasada usa `processing_version=2`. Puede detenerse y reanudarse; guarda cada bloque de 25 archivos solo después de persistir diagnósticos y verificar las series. Los resultados y objetos ya preparados no se duplican. El navegador debe permanecer abierto durante la preparación. Publicar esta versión no significa que todas las series reales ya se hayan preparado: el titular debe iniciar o reanudar la operación desde Garmin → Historial completo → Completar series y revisar historial.

## Pruebas

Pruebas con FIT codificados por el SDK oficial, NP del dispositivo con registro irregular, FTP que cambia entre años, borrado explícito de un umbral, día local en el cambio de año, lectura TCX, series sin pérdida de muestras, exclusión de ubicación, compresión e integridad, preparación/reanudación integral, protección frente a archivos alternativos y PostgreSQL con propietarios y entrenadores sintéticos para verificar permisos, revocación, originales privados y cuota conjunta.
