# Inicio y herramientas personales · 7 de noviembre de 2026

El inicio del deportista reúne Calendario, Mis vínculos, Mi perfil y Mi peso en cuatro tarjetas. La cabecera abre zonas de pulso, potencia y avisos; en móvil hay navegación inferior. Las novedades muestran tres eventos reales y permiten abrir el día correspondiente del calendario.

- Ficha: nombre, altura, año de nacimiento y deporte. No se inventan medidas.
- Peso: fecha, kg, contexto y nota; comparación por contexto, media, variación y gráfica. Un registro por fecha y contexto. Privado por defecto; compartir es una decisión por registro y requiere entrenador activo.
- Zonas de ciclismo: reutilizan las instantáneas fisiológicas con fecha. Editar pulso conserva potencia y viceversa; nunca se utiliza un FTP posterior para completar años anteriores. Límites expresados como porcentajes ascendentes de FTP o LTHR.
- Noticias: sincronizaciones Garmin, entrenamientos nuevos o modificados e importaciones agrupadas para evitar miles de avisos por archivos históricos.
- Avisos: permiso voluntario por dispositivo, suscripciones privadas, Web Push cifrado y contenido visible genérico. Servicio `asturpower-push` autenticado mediante secreto interno para el webhook o JWT verificado para la prueba del propio usuario. Claves VAPID generadas y conservadas solo en servidor. Sin cambios de contraseñas ni claves de Garmin.
- La entrega depende del permiso y del servicio push del navegador; la recepción real en el teléfono se comprueba activando los avisos desde la campana y enviando la prueba. En iPhone requiere abrir la aplicación instalada.
- Worker de push separado, sin caché de datos privados y con asociación al usuario; al cerrar sesión se retira esa asociación. El worker principal continúa sin forzar recargas durante importaciones.

Validación: 235 pruebas, compilación Vite, 19 escenarios workerd y 6 escenarios OAuth. RLS probada con titular, entrenador, otro deportista y entrenador desvinculado; el contenido de las noticias y la configuración privada no pueden modificarse desde un cliente autenticado. Comprobados la clave pública, el rechazo 401 sin autenticación y la petición interna de pg_net. El permiso de notificaciones del navegador de revisión está bloqueado: no se ha activado ninguna suscripción ni enviado avisos a otros usuarios. Verificadas con sesión real la portada, ficha, peso vacío, zonas y novedades. No se han añadido medidas ficticias a ninguna cuenta.

Publicación exclusiva en `desarrollo`, Cloudflare de pruebas y Supabase de AsturPower. Netlify original y `main` permanecen fuera de este cambio.
