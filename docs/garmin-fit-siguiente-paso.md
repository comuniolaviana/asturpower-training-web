# Garmin FIT: primer módulo de métricas (rama de laboratorio)

**Estado (5 de noviembre de 2026):** módulo de normalización de registros decodificados implementado; 6 pruebas unitarias con datos ficticios superadas. NO hay importación automática de FIT, descargas, cambios en Garmin, Supabase, Cloudflare o Netlify. No se procesaron datos personales reales.

## Motivo

El receptor actual de AsturPower (`garmin-activity-service.mjs`) guarda resúmenes JSON: duración, distancia, elevación y frecuencia cardiaca media si se reciben. No obtiene actualmente series de potencia, pulso o cadencia. Garmin indica que Activity API admite archivos FIT, pero se debe verificar el alcance, modalidad y permisos concretos aprobados de la aplicación antes de activarlos. Starter no implica un historial automático.

Fuentes oficiales:
- https://developer.garmin.com/gc-developer-program/
- https://developer.garmin.com/gc-developer-program/activity-api/
- https://developer.garmin.com/fit/get-the-sdk/
- https://github.com/garmin/fit-javascript-sdk

## Lo preparado en esta rama

- `netlify/lib/garmin-fit-records.mjs` recibe `recordMesgs` **ya decodificados** por el SDK FIT de Garmin y devuelve series de potencia (W), FC (ppm), cadencia sin asignación prematura de deporte y velocidad (m/s).
- Conserva el cero válido de potencia, distingue valores ausentes, descarta valores inválidos, ordena por timestamp, contabiliza duplicados y registra cobertura por **número de registros**, no por duración.
- Elimina coordenadas GPS y campos no contemplados. La procedencia concreta del sensor queda como **no verificada**: no inferir que todos los vatios provienen del mismo potenciómetro.
- No calcula potencia normalizada, FTP, TSS, CTL ni ATL: requieren series completas, pausas, FTP válido y reglas deportivas verificadas.
- `tests/garmin-fit-records.test.mjs`: pruebas con datos inventados, sin credenciales ni peticiones externas.

## Pasos pendientes antes de integrar datos reales

1. Verificar en Garmin API Tools la notificación **Activity Files** u opción FIT habilitada para la aplicación concreta, su cuerpo exacto, método de entrega y permisos vigentes. No asumir que un evento JSON contiene directamente un FIT ni activar nada a ciegas.
2. Integrar el decodificador oficial `@garmin/fitsdk` con versión fijada y `package-lock`, validación de cabecera e integridad CRC, límites de tamaño, aislamiento del fichero y pruebas con **un FIT sintético**. Rechazar FIT corruptos y archivos de tipo distinto de actividad.
3. Diseñar almacenamiento privado de los registros necesarios con RLS por deportista y entrenador autorizado, política de conservación, exportación/borrado y minimización geográfica. Valorar almacenamiento de resúmenes frente a datos brutos.
4. Con consentimiento de un deportista y bajo supervisión del entrenador, verificar **una actividad real completa** desde el dispositivo hasta la app, contrastando potencia, FC, cadencia, pausas, distancia y origen del sensor con Garmin Connect.
5. Solo después, desarrollar y validar métricas de rendimiento. Registrar claramente qué métrica procede de qué sensor y su cobertura temporal.

**Regla de despliegue:** no fusionar esta rama ni activar recepción FIT sin completar revisión, pruebas y autorización explícita. La aplicación existente sigue sin cambios.
