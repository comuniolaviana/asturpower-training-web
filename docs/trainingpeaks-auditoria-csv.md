# Auditoría TrainingPeaks (solo lectura) — 7 noviembre 2026

## Alcance implementado
- En el panel **Rendimiento** del entrenador vinculado aparece **Comparar con TrainingPeaks**.
- Acceso condicionado a una sesión de entrenador, vínculo activo y permiso explícito de compartir métricas deportivas.
- Se acepta CSV Workout Summary local (máx. 4 MB, máximo 12.000 filas): lectura en el navegador, sin carga a Supabase, sin almacenamiento ni escritura sobre actividades.
- Se exige `WorkoutDay`, `WorkoutType`, `TssActual` y `TotalTime` (duración en horas decimales). Soporta nombres `ActualTss` o `CompletedTss` como alternativas de TSS actual, separadores coma/punto y coma/tabulador, entrecomillado CSV y coma decimal cuando corresponde.
- `TssPlanned` no se usa nunca como carga realizada. Los registros no completados, sin fecha, sin TSS real o sin duración quedan excluidos y contados.
- Coincidencia conservadora: misma fecha local `Europe/Madrid`, mismo deporte y duración aproximada (máximo 600 segundos, margen de 5 % o 180 s). Cuando hay varias posibles actividades o varias filas para la misma actividad, no se decide automáticamente.
- Distingue: dentro del margen (máximo de 5 TSS o 5 %), diferencia relevante, actividad sin TSS en Garmin, ambiguo, sin actividad Garmin y fila incompleta.
- No se guarda el CSV ni el resultado tras cerrar/cambiar deportista. Se limpian las vistas antiguas antes de cualquier carga nueva.

## Limitaciones importantes
- El código está en `desarrollo` **solo tras fusionar el PR**, no equivale a desplegar en el Worker Cloudflare de pruebas.
- La herramienta todavía **no importa TSS a la base de datos ni recalcula CTL/ATL/TSB**. Es una fase de comparación diagnóstica, deliberadamente sin mutaciones.
- No se han validado las columnas con una exportación real del deportista. Los tests usan CSV sintéticos.
- El Workout Summary contiene las cargas y resúmenes, no las series temporales detalladas de potencia/FC/cadencia: no sustituye el FIT.
- No se comprueba que el CSV proceda realmente del atleta seleccionado. El entrenador debe verificar procedencia y autorización antes de cargarlo.
- No certifica integridad del inventario Garmin; un periodo que coincida bien puede seguir teniendo sesiones ausentes en ambos sistemas.
- La fuente del TSS puede ser TSS de potencia, hrTSS, otros métodos o edición manual. El método de cálculo se muestra cuando el CSV lo incluye. Diferencias no implican automáticamente un error de Garmin.

## Pruebas
- `tests/trainingpeaks-audit.test.mjs`: parsing de CSV, campos planned/actual, duraciones, ceros, sesiones ambiguas y diferencias.
- `tests/trainingpeaks-audit-ui.test.mjs`: control de acceso, contenido escapado, borrado de resultados al cambiar de atleta, no escritura.
- CI de Github: `npm test`, `npm run build` y simulaciones Garmin. La corrección de visualización del PMC del PR #8 se mantiene intacta.

## Siguiente hito
1. Probar con un CSV real anonimizado facilitado por su titular con consentimiento.
2. Revisar discrepancias en zona horaria, duraciones e identificación de sensores.
3. Diseñar una tabla separada de correcciones de TSS, con origen y método auditables, RLS y capacidad de deshacer.
4. Solo después reconciliar las cargas, recalcular el PMC y contrastar día a día contra TrainingPeaks. Evitar que la comparación se convierta en una sustitución automática de datos.
5. Publicar en Cloudflare solamente después de validar el despliegue, la versión desplegada y los permisos; no confundir Netlify informativo con la aplicación.
