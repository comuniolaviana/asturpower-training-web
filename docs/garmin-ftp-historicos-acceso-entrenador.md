# Garmin FTP histórico y panel de análisis para entrenadores

Fecha: 2026-11-06 · rama: `desarrollo`.

## Hechos comprobados

- ZIP Garmin privado de ~316,93 MiB: 12.876 entradas catalogadas; 12.767 FIT.
- 1.964 resúmenes históricos en calendario; 1.812 FIT deportivos vinculados; 1.094 con NP computable.
- El original contiene snapshots actuales de FTP **305 W**.
- Además, `DI_CONNECT/DI-Connect-Wellness/*_userBioMetrics.json` guarda registros fechados de configuración de FTP. Se identifican cambios históricos representativos: 200 W (2020-03-11), 265 W (2021-04-12), 305 W (2021-04-23), más una variación intradía 265/305 W el 2021-04-24. En el histórico existen 326 eventos con FTP, muchos repetidos.
- No hay registros válidos de FTP guardados todavía en `athlete_physiology`. No hay TSS calculado hasta que el deportista revise y confirme esos umbrales.
- Todos los 1.094 FIT con NP registrados hasta el momento son posteriores al 2020-03-11. Esto **no prueba** que el FTP registrado por Garmin haya sido el FTP fisiológico real en cada sesión, ni que la potencia de sensores diferentes sea totalmente comparable.

## Cambios implementados

1. Análisis de `_userBioMetrics.json` desde el ZIP privado. Distingue *valor actual sin fecha* de *evento histórico fechado*; por día conserva el último registro y avisa de conflictos intradía. Reduce eventos repetidos a cambios de FTP por fecha.
2. Pantalla del deportista en Garmin «Recuperar FTP históricos registrados en Garmin». Vista previa, consentimiento y botón explícito para insertar historial en `athlete_physiology`. No se crean fechas arbitrarias ni se sobreescriben versiones de otros parámetros; si la ficha ya guarda otros datos, se detiene la operación y se solicita revisión del entrenador. Guardado reanudable y comprobación de versiones existentes.
3. Compartición revocable por entrenador: tabla `athlete_coach_fit_sharing`, RLS por propietario, vínculo activo obligatorio. **Sin aprobación expresa, un entrenador no accede a métricas derivadas FIT.**
4. RLS en `garmin_fit_analysis` habilita lectura de métricas por entrenador solamente con permiso, y las columnas `file_name` y `pack_name` no tienen permisos SELECT en el rol authenticated. El ZIP original, las muestras, datos médicos, coordenadas GPS y catálogo siguen exclusivamente del propietario.
5. Panel «Rendimiento» del entrenador con selector de deportista, resumen de actividad vinculada, NP, IF, TSS, potencia y FC medias, cobertura y número de muestras, gráfico de evolución NP, tabla paginada y filtro anual. Identifica explícitamente la fuente del sensor como no verificada.
6. TSS se recalcula en la vista a partir de NP y FTP vigente en cada fecha sin volver a procesar los 12.767 FIT.

## Limitaciones

- «Toda la información» de deporte para entrenador se implementa por fases. Esta fase expone métricas deportivas derivadas y el historial de actividades; **no** muestras completas segundo a segundo, recorridos, nombres de archivos ni el ZIP personal. Compartir curvas detalladas requiere un formato limitado por actividad y permisos adicionales.
- Datos no confirmados por revisión humana pueden producir TSS incorrecto si existieron FTP no registrados.
- Los gráficos PMC/CTL/ATL/TSB sobre historial parcialmente procesado deben conservar el calificativo «parcial», nunca diagnóstico real.
- La compilación y los tests CI verifican código, no el despliegue Cloudflare ni el comportamiento en sesión de deportista/entrenador. Para validar flujo real, entrar en app, comprobar consentimiento, consultar FTP, guardar versiones y entrar en «Rendimiento» con la cuenta del entrenador.

## Próxima comprobación

1. Acceder como deportista, en Garmin → «Compartir análisis deportivos con tu entrenador», autorizar entrenador correspondiente.
2. En Garmin → «Recuperar FTP históricos registrados en Garmin», revisar y confirmar solo si sus fechas parecen correctas.
3. Acceder como entrenador → «Rendimiento», seleccionar deportista y comprobar resumen y actividad paginada.
4. Verificar en Supabase que siguen vigentes RLS y separación de datos. No compartir la cuenta del deportista ni secretos de Garmin con el entrenador.
