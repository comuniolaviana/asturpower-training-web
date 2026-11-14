# AsturPower · Ampliación segura del almacenamiento deportivo

**Comprobado el 14-11-2026.** No ejecutar migraciones, activar pagos ni limpiar datos hasta confirmar el plan y las copias.

## Diagnóstico contrastado

Proyecto Supabase: `drnefgxdrultneeodtsy`, organización **AsturPower Training**, **plan Free** en la fecha de la comprobación.

La función PostgreSQL `asturpower_private.reserve_activity_series` de la migración
`supabase/migrations/20261106164038_garmin_sports_series_and_diagnostics.sql`
incluye un **presupuesto interno de 838.860.800 bytes (800 MiB)** que se reparte entre originales de Garmin, series y objetos de otros buckets contabilizados.

Consulta de solo lectura a 14-11-2026:
- Originales contabilizados: **452.164.113 bytes**
- Series contabilizadas: **386.613.370 bytes**
- Otros objetos contabilizados: **0 bytes**
- Total: **838.777.483 bytes**, el **99,99 %**
- Restan **83.317 bytes**
- Series `ready`: **2.263**
- Series `uploading`: **0**
- FIT vinculados: **2.266**

Estos valores **son globales** de este proyecto, no únicamente de un deportista.

Al alcanzar el límite, la función devuelve `series_storage_budget_exceeded` (SQLSTATE `54000`).
El cliente antiguo convertía todos los errores de reserva en `No se pudo reservar espacio para las series deportivas`, sin identificar la causa. En esta rama se mejora el diagnóstico, pero **no se aumenta el presupuesto**.

## Antes de contratar un aumento o introducir una tarjeta

1. Confirmar en el panel de Supabase la oferta/plan, cuota de Storage, límites de base de datos y coste aplicable; no asumir que una tarjeta de pago concede por sí sola exactamente 10 GB.
2. Revisar almacenamiento total del proyecto y de la organización, incluyendo copias de originales y objetos privados; la consulta interna NO equivale necesariamente al uso que factura Supabase.
3. Preparar copias seguras y comprobables de base de datos y archivos FIT originales; verificar cómo se restauraría todo.
4. Validar que el volumen acordado admite las 4.317 actividades aproximadas pendientes de Mauro y el uso de futuros deportistas, con margen de crecimiento.
5. Una vez activa y confirmada la capacidad, realizar **migración SQL revisada** que eleve ambos topes de presupuesto relevantes (`reserve_activity_series`, `reserve_garmin_original`) de modo coherente, con una sola fuente de configuración si es posible y tests de cuotas y concurrencia. Evitar editar SQL histórico aplicado.
6. Confirmar políticas RLS, límites por archivo, idempotencia, subida ZIP por fragmentos y capacidad de revertir la migración sin borrar registros.
7. Procesar primero **una** actividad FIT pendiente de un deportista autorizado, verificar integridad y curvas, luego lotes pequeños; registrar progreso, duplicados y fallos sin repetir todo el historial.
8. Comparar número y fechas de las actividades realmente importadas contra el catálogo exportado por Garmin. No inferir orden cronológico de los archivos que se cargaron primero.

## Qué NO hacer

- NO borrar FIT originales ni series para desbloquear espacio sin autorización y copias.
- NO subir silenciosamente de Free a un plan de pago desde código.
- NO cambiar 800 MiB por 10 GB mientras el proyecto permanezca en Free.
- NO suponer que `series_storage_budget_exceeded` significa fallo de Garmin Connect; es una limitación local del almacenamiento.
- NO afirmar que las 4.317 actividades reportadas por Mauro sean todas FIT completos o que ya estén asociadas al deportista.

## Referencia de cuota

Documentación oficial Supabase: [Manage Storage size usage](https://supabase.com/docs/guides/platform/manage-your-usage/storage-size) (a 14-11-2026, cuota Free publicada de 1 GB, plan Pro con cuota mayor; verificar siempre al contratar).

**Estado:** diagnóstico de solo lectura efectuado y mejoras del motor en rama de revisión; ampliación pendiente del titular. No realizado ningún cambio de capacidad ni facturación.
