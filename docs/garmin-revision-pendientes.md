# Revisión selectiva de originales pendientes

En Garmin → Opciones avanzadas, «Revisar solo archivos pendientes» vuelve a interpretar exclusivamente los archivos cuyo diagnóstico requiere revisión. Reutiliza el catálogo privado, conserva las fuentes ya vinculadas y no modifica los cursores de la pasada completa. Requiere la autorización existente de análisis deportivo y permite detener la operación.

Los TCX que contienen vueltas medidas sin Trackpoints conservan duración, distancia, pulso medio/máximo, calorías, velocidad máxima y cadencia de sus vueltas cuando están presentes. Se almacenan con cero muestras y se identifican expresamente como detalle por vueltas, sin curvas instantáneas ni tiempo en zonas. No se estiman muestras de pulso o potencia a partir de medias.

Las coincidencias siguen siendo conservadoras; las actividades duplicadas no se asignan por orden ni por proximidad arbitraria. Un archivo alternativo no sustituye una fuente ya vinculada. Los originales, ubicaciones y campos de identidad permanecen privados del titular.

Si un TCX histórico tiene otra etiqueta de deporte, solo se permite enlazarlo cuando no existe una candidata del mismo deporte y hay una única actividad con inicio exacto (máximo un segundo), duración y distancia prácticamente idénticas, ambas positivas. Se conserva el deporte declarado por el TCX y se muestra una advertencia en el detalle. Esta excepción no se aplica a FIT ni a sesiones sin distancia.

El visor del titular permite descargar el archivo original abierto, útil para revisar los casos no interpretables con el SDK oficial. No crea enlaces públicos ni otorga permisos adicionales al entrenador.

Pruebas: TCX con vueltas sin muestras, conservación de medidas y ausencia de gráficas ficticias; recuperación selectiva sin alterar el cursor completo; reanudación sin duplicar resultados; todas las pruebas existentes y compilación de la aplicación.
