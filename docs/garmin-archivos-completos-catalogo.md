# AsturPower · Historial Garmin completo: acceso y catálogo privado

**6 de noviembre de 2026 — estado de implementación.**

## Objetivo de datos

La exportación oficial del deportista se guarda íntegra, incluidos archivos y campos
que no entiende aún la app. **No se sustituye por resúmenes**. Las actividades
resumidas se mantienen como índice del calendario, pero no son fuente suficiente
para TSS/NP/CTL/ATL/TSB ni para curvas de potencia.

La exportación real usada para revisar el formato tiene un ZIP exterior de
316,93 MiB, siete ZIP anidados y 12.876 entradas FIT/TCX/GPX, que incluyen
distintos tipos de registros, no todos necesariamente actividades. El único ZIP
real está en el almacén privado del titular; no se ha publicado en GitHub.

## Implementado

1. Lectura comprobada por SHA-256 de los fragmentos privados existentes, sin
   crear una segunda copia de los 316 MiB.
2. Lectura por rangos y streaming de las entradas ZIP comprimidas o almacenadas;
   CRC32 verificado para cada archivo abierto.
3. Explorador para el ZIP completo, incluidos los siete paquetes internos de
   hasta 64 MiB y sus archivos individuales.
4. FIT: lectura mediante el SDK oficial Garmin en un Worker del navegador,
   navegación de todos los grupos de mensajes sin recorte de muestras y curvas
   simplificadas de potencia, frecuencia cardíaca, cadencia, altitud, velocidad
   y distancia cuando esos campos existen. La reducción de puntos SOLO afecta
   al dibujo; los registros decodificados permanecen accesibles por páginas.
5. Índice persistente **privado del titular**, de paquetes y archivos contenidos:
   rutas/nombres, extensión y tamaño. Reanuda por paquete sin repetir los
   ya catalogados. No publica datos ni concede acceso a un entrenador.
6. Nuevas pruebas sintéticas de lectura grande, verificación, sesión del
   propietario y deduplicación del índice; CI y compilación de la app.

## Cómo usar

Garmin → «Historial completo · Archivos originales» → ZIP grande →
«Crear o continuar índice completo». Mantener abierta la página mientras
se leen los siete paquetes. Si se interrumpe, repetir para continuar.

Una vez guardado el índice, buscar cualquier FIT/TCX/GPX y usar
«Abrir datos originales». El visor permite navegar mensajes y curvas.

El índice todavía no está generado para el historial real hasta que el
titular active esa operación desde la aplicación. Los archivos no
requieren subirse otra vez.

## Limitaciones expresas / siguiente fase

- El índice localiza archivos, pero aún **NO convierte todas las muestras FIT**
  en una serie normalizada asociada con cada actividad de calendario.
- Los 12.876 archivos no son 12.876 entrenamientos: pueden incluir métricas
  fisiológicas, monitorización, ajustes de dispositivo y otros datos.
- No se han calculado métricas NP/TSS/CTL/ATL/TSB desde las series originales.
  Antes se deben identificar actividades, vincularlas de forma verificable
  con los resúmenes, registrar sensor/fuente, fecha y umbrales vigentes y
  detectar duplicados y huecos.
- Si se ofrecen datos derivados a entrenadores, solicitar consentimiento y
  revisar permisos: el archivo completo permanece privado por defecto.
- La actualización del código ha superado CI, pero la publicación efectiva
  del último commit en Cloudflare y la prueba en navegador autenticado deben
  verificarse antes de declarar el flujo real operativo.
- Evitar copiar todos los registros y binarios de nuevo a Supabase:
  superaría rápidamente el presupuesto gratuito; usar los originales
  inmutables y un índice pequeño para análisis calculados por demanda
  o por lotes controlados.

## Reversibilidad

Las migraciones del catálogo son aditivas. No eliminan ZIP originales,
resúmenes de Garmin, credenciales ni vínculos. La interfaz puede revertirse
a un commit anterior; los registros del catálogo no afectan a los originales.
No borrar manualmente filas ni objetos de Storage para revertir la interfaz.
