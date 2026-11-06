# AsturPower: vinculación automática de FIT y cálculos deportivos (MVP)

Implementado en la rama `desarrollo` el 6 de noviembre de 2026.

## Datos reales y privacidad

- Los 12.876 ficheros indexados (12.767 FIT, 107 TCX y 2 GPX) permanecen en el ZIP original privado de 316,93 MB. **No** todos son actividades deportivas.
- El calendario contiene 1.964 actividades históricas de resúmenes oficiales. Ninguno de los identificadores numéricos de nombres FIT coincide directamente con esos `external_id`. **Prohibido vincular por nombre**.
- `garmin_fit_analysis` guarda **solo métricas derivadas** y la referencia a su FIT. `garmin_fit_scan_progress` recuerda la posición en cada paquete para reanudar.
- Ambas tablas usan RLS: únicamente el titular lee y escribe lo permitido. El entrenador no obtiene acceso al archivo completo ni a este resultado propietario por el mero vínculo. Un futuro consentimiento para compartir métricas derivadas requerirá un mecanismo separado.

## Algoritmo de vinculación

Desde Garmin → «Historial completo» → ZIP grande → «Vincular automáticamente FIT con actividades»:
1. Confirmación voluntaria del titular para procesar.
2. Lectura progresiva de los siete ZIP internos desde las partes privadas, con SHA-256 y CRC32.
3. Decodificación FIT con `@garmin/fitsdk`. Solo se consideran archivos con una sesión individual y muestras de registro; se omiten los FIT de monitorización, multideporte ambiguo o ilegibles sin borrar ni alterar originales.
4. Coincidencia conservadora con exactamente una actividad por deporte, inicio (diferencia máxima 180 segundos), duración (máximo 120 segundos o 25 %) y distancia (máximo 500 m o 15 %, cuando existe). Si hay varias candidatas o ninguna, no se vincula.
5. Los resultados se insertan sin sobrescribir los de actividades ya vinculadas. Índice único impide atribuir el mismo FIT a varias sesiones. Cursor durable cada 25 archivos, recuperación tras interrupción.
6. El titular puede detener el análisis y reanudarlo; deberá mantener abierta la pestaña mientras se procesa.

## Cálculo

- NP: promedio móvil de 30 segundos de las muestras de potencia registradas cada segundo, elevado a la cuarta potencia, promediado y obtenido mediante raíz cuarta; no se rellena artificialmente ningún hueco de medición.
- La NP queda sin calcular si hay menos del 90 % de cobertura de potencia respecto al tiempo de ejercicio o no hay suficientes ventanas consecutivas. Los 0 W registrados son válidos; ausencias de datos no equivalen a 0 W.
- FTP: siempre histórico según fecha de vigencia en `athlete_physiology`. Nunca se presupone el FTP actual para ejercicios antiguos.
- IF = NP / FTP; TSS = (segundos de ejercicio/3600) × IF² × 100.
- Sin FTP o sin NP válida, IF y TSS quedan nulos. **No se inventan valores de carga**.
- Si el entrenador guarda FTP históricos después, el cálculo de TSS se actualiza **al consultar** a partir de la NP y la duración ya calculadas, sin reabrir miles de FIT.
- CTL 42 días, ATL 7 días, TSB previo a cada día como CTL - ATL: en este MVP solo aparece una proyección explícitamente **PARCIAL** de TSS conocido, inicializada en cero. No debe llamarse fatiga o forma fisiológica real porque faltan sesiones y otras disciplinas.

## Estado de pruebas

- Datos ficticios: FIT real codificado por el SDK con 120 registros a 200 W, NP = 200 W, controles de cobertura, sesión única, duplicados, coincidencia estricta, FTP de vigencia y TSS con fórmula 64 para una hora al 80 % FTP.
- Prueba integral sintética: empaquetar FIT → descargar original ZIP privado → descifrar/decodificar → relacionar actividad → calcular NP → guardar resultado y cursor → reanudar sin duplicado → añadir FTP después y comprobar TSS.
- Pruebas de GitHub y compilación: consultar Actions antes de declarar versión lista.
- El análisis de los datos **reales** sigue sin haberse ejecutado hasta que el titular pulse el botón. La existencia del código y de tablas RLS no significa que estén vinculadas las 1.964 actividades; algunos archivos pueden carecer de muestras y los emparejamientos no demostrables se quedarán pendientes de revisión.

## Paso posterior

Mejorar las vinculaciones dudosas mediante inspección de actividad y datos de sensores. Crear consentimiento específico para compartir derivados con entrenador, sin divulgar archivos originales, nombres con correo electrónico ni rutas GPS. Validar compatibilidad con fuentes distintas de potencia y evitar mezclarlas automáticamente.
