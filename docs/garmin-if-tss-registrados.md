# IF, TSS y datos de sesión registrados en Garmin

6 de noviembre de 2026. Solo rama `desarrollo` y entorno de pruebas.

El lector anterior conservaba NP, pero no el IF, TSS o FTP de la sesión FIT. Además, un FTP confirmado hoy no autoriza a calcular años anteriores. Si las curvas aún no se han preparado, publicar interfaces no las genera ni completa la importación real.

El lector versión 3 conserva `device_intensity_factor`, `device_tss` y `device_ftp_watts` en columnas separadas y protegidas por los mismos permisos que las métricas anteriores. El SDK oficial realiza las conversiones de escala. Los originales y las zonas históricas no se modifican. Un valor de la sesión no crea automáticamente una versión de FTP para otras actividades.

La presentación da prioridad al recálculo con un FTP histórico confirmado cuando existe para la fecha. Si falta, muestra IF/TSS registrados en el archivo; puede calcular IF desde NP y FTP registrados en esa sesión, y TSS desde su IF y duración. Cada valor indica su origen. Se conservan los valores originales aunque exista un recálculo. No se deriva IF únicamente de TSS ni se convierten ausencias en ceros. Los ceros del dispositivo requieren evidencia de potencia cero registrada. Los deportes distintos del ciclismo no reciben TSS de potencia por analogía.

Los FIT con resumen de sesión válido y métricas registradas, pero sin muestras, pueden vincularse sin prometer curvas inexistentes. Las referencias a archivos siguen verificándose; un archivo alternativo no sustituye una fuente vinculada. La preparación versión 3 revisa una vez los archivos de versiones anteriores y conserva los objetos de series ya preparados.

Calendario y Rendimiento leen las columnas nuevas bajo RLS. El entrenador autorizado tiene lectura, pero no escritura. El ZIP y los nombres de archivo siguen privados. El detalle también presenta datos adicionales realmente incluidos en la sesión y una tabla paginada de vueltas, además de los registros íntegros y las curvas.

Pruebas con FIT del SDK oficial para las escalas de IF/TSS, FTP futuro que no modifica el pasado, recálculo histórico que conserva el original, sesiones sin registros, ausencia de valores y ceros verificados. Pruebas de PostgreSQL comprueban lectura por consentimiento y denegación de edición al entrenador.

La preparación de datos reales debe iniciarse desde la cuenta del deportista: Garmin → Importar historial → aceptar → Preparar historial guardado. El proceso utiliza la exportación existente y necesita mantener abierta la aplicación. No se debe anunciar el historial como completo hasta comprobar sus resultados reales y sus incidencias.
