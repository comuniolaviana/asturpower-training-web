# Prueba real Garmin — 5 de noviembre de 2026

La primera autorización OAuth real se ha completado en el entorno Cloudflare de desarrollo. La interfaz devolvió `garmin=connected` y una consulta agregada confirmó una conexión almacenada en Supabase. Esto acredita el canje y la consulta de identidad/permisos oficiales; no acredita todavía un entrenamiento enviado ni una sincronización física.

El error anterior de transporte era el modo `redirect: "error"`, no admitido por Workers. Se sustituyó por `manual`, rechazando cualquier redirección sin seguirla. Posteriormente se recibió 401; tras la última carga del secreto y despliegue, el siguiente canje real terminó correctamente. No se determina retrospectivamente qué carga o versión provocaba los 401.

El primer permiso devuelto fue ACTIVITY_EXPORT y faltaba WORKOUT_IMPORT. Se revisaron exclusivamente los interruptores de AsturPower en Garmin Connect para activar Entreno y desactivar Actividades. La representación accesible de esos interruptores no refleja por sí sola el estado visual; se comprobó también el estado mostrado por la interfaz.

Se corrige un bloqueo de la caché local: antes de enviar, el servidor consulta ahora los permisos actuales de Garmin aunque la copia anterior no contenga WORKOUT_IMPORT. Sigue exigiendo una conexión válida, acceso autorizado al entrenamiento, la autorización oficial actual y el permiso efectivo almacenado antes de crear cualquier exportación. Las pruebas comprueban tanto una nueva concesión como una denegación sin envíos.

Pendiente: verificar el primer envío de la sesión de prueba, su aparición en Garmin Connect y la sincronización con un dispositivo compatible. La recepción automática continúa desactivada; no se han descargado actividades ni históricos. No se han modificado main, la web pública, otras aplicaciones Garmin ni otros proyectos.
