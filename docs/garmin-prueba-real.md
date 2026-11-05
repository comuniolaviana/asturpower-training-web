# Prueba real Garmin — 5 de noviembre de 2026

La primera autorización OAuth real se ha completado en el entorno Cloudflare de desarrollo. La interfaz devolvió `garmin=connected` y una consulta agregada confirmó una conexión almacenada en Supabase. Esto acredita el canje y la consulta de identidad/permisos oficiales; no acredita todavía un entrenamiento enviado ni una sincronización física.

El error anterior de transporte era el modo `redirect: "error"`, no admitido por Workers. Se sustituyó por `manual`, rechazando cualquier redirección sin seguirla. Posteriormente se recibió 401; tras la última carga del secreto y despliegue, el siguiente canje real terminó correctamente. No se determina retrospectivamente qué carga o versión provocaba los 401.

El primer permiso devuelto fue ACTIVITY_EXPORT y faltaba WORKOUT_IMPORT. Se revisaron exclusivamente los interruptores de AsturPower en Garmin Connect para activar Entreno y desactivar Actividades. La representación accesible de esos interruptores no refleja por sí sola el estado visual; se comprobó también el estado mostrado por la interfaz.

Se corrige un bloqueo de la caché local: antes de enviar, el servidor consulta ahora los permisos actuales de Garmin aunque la copia anterior no contenga WORKOUT_IMPORT. Sigue exigiendo una conexión válida, acceso autorizado al entrenamiento, la autorización oficial actual y el permiso efectivo almacenado antes de crear cualquier exportación. Las pruebas comprueban tanto una nueva concesión como una denegación sin envíos.

## Primer envío real confirmado

La corrección de permisos se publicó en desarrollo en `7fb1f0238efca9d74f0e295a0aa2c2920ed494c9`, con CI correcta y Cloudflare build `caf2427b-f042-4f56-b8f3-85b271f39985`, versión `06cfd83b-2eb5-435c-b370-a28158eed281`. Las 140 pruebas Node y los escenarios workerd existentes pasaron antes de publicar.

Se pulsó una sola vez Enviar a Garmin en la sesión de prueba de ciclismo de 16 minutos, con dos intervalos de potencia. AsturPower respondió Programado en Garmin Connect. Una consulta agregada confirmó una conexión, una conexión con WORKOUT_IMPORT y una exportación programada con ambos identificadores remotos presentes. No se leyeron tokens ni datos de actividades.

Se actualizó la lista oficial https://connect.garmin.com/app/workouts y se encontró la misma sesión, de tipo Bicicleta, duración 16:00, creada el 5 de noviembre de 2026 y con el texto Edita los datos en AsturPower Training. Esto acredita un envío y programación reales mediante Training API y su aparición en Garmin Connect; no es una simulación.

Garmin muestra tres dispositivos compatibles para recibir la sesión. No se eligió uno arbitrariamente ni se afirma que el dispositivo físico la haya recibido: queda pendiente identificar el dispositivo de prueba, poner el envío en cola y comprobar su sincronización. La recepción automática continúa desactivada; no se han descargado actividades ni históricos. No se han modificado main, la web pública, otras aplicaciones Garmin ni otros proyectos.
