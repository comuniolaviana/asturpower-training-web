# Herramientas de rendimiento del entrenador

## Disponible en desarrollo

Acceso: iniciar sesión en el entorno de pruebas, elegir el espacio Entrenador si la cuenta tiene varios roles y abrir **Rendimiento**.

- Selector de deportistas con vinculación activa, sin cuentas ni accesos nuevos.
- Ficha por deporte (ciclismo, carrera, natación): FTP, pulso umbral/máximo/reposo, peso, ritmo umbral y límites de zonas de potencia y pulso.
- Versiones completas por fecha de vigencia. Guardar añade una fila; no borra versiones anteriores. Para una misma fecha prevalece la versión guardada más recientemente. Vacío significa desconocido, no cero.
- Las zonas son límites superiores ascendentes, en porcentaje del FTP o del pulso umbral; la última zona queda abierta. No se asigna automáticamente un modelo de zonas.
- Estimación de carga ciclista para esfuerzo constante: `horas × (porcentaje FTP / 100)² × 100`. Con 60 minutos al 85 %, resultado 72,25. Traduce el porcentaje a vatios solo si existe FTP ciclista del deportista vigente en la fecha indicada.
- Simulación local de 7 a 90 días con CTL/ATL iniciales explícitos, carga diaria y gráfico/tabla. Permite varias sesiones al día; las suma. Los días sin sesiones son descanso en este escenario.
- CTL: `anterior + (carga de hoy - anterior) / 42`.
- ATL: `anterior + (carga de hoy - anterior) / 7`.
- TSB de hoy: `CTL de ayer - ATL de ayer`.

El simulador dura mientras se mantiene la pantalla: no modifica actividades ni sesiones del calendario. No presenta el resultado como historial real ni como diagnóstico. No se inicializan CTL/ATL ni umbrales con valores inventados. La consulta de fichas tiene un límite explícito de 500 versiones recientes; si se alcanza se avisa en pantalla.

## Acceso y conservación

La tabla `athlete_physiology` aplica RLS. Cada deportista puede consultar y añadir sus propias fichas. Un entrenador solo puede hacerlo mientras su vinculación esté activa. Administración no obtiene acceso deportivo adicional por ser administración. Las fechas de creación e identificadores los genera PostgreSQL; la identidad de autor debe coincidir con la sesión. El navegador no puede actualizar ni eliminar versiones. La supresión de una cuenta elimina sus propias fichas; si se elimina un autor entrenador, se anonimiza su referencia y se conserva la ficha del deportista.

La interfaz actual de edición está disponible en el espacio Entrenador. No se introduce un alta, una invitación ni una asignación de roles.

## Pendiente

Procesar e indexar las series del historial completo, calcular NP/IF/carga real con umbrales históricos, distinguir cobertura y exclusión de actividades de prueba, recalcular cronológicamente, comparar ejecutado con planificado y enlazar el simulador al calendario. No se calcula NP a partir de la potencia media ni se mezcla carga prevista con realizada. Los archivos originales permanecen en el almacén privado existente.

Referencias primarias consultadas: [CTL](https://help.trainingpeaks.com/hc/en-us/articles/204071884-Fitness-CTL), [ATL](https://help.trainingpeaks.com/hc/en-us/articles/204071894-Fatigue-ATL), [TSB](https://help.trainingpeaks.com/hc/en-us/articles/204071764-Form-TSB), [RLS de Supabase](https://supabase.com/docs/guides/database/postgres/row-level-security).

Validación: fórmulas con casos conocidos; fechas y umbrales históricos; persistencia y errores de sesión; navegación por roles; cambios de deportista; respuesta privada tardía al salir; PostgreSQL con identidades sintéticas para aislamiento, vinculación pendiente/revocada, suplantación de autor, escritura de marcas de tiempo y modificación/eliminación prohibidas. Sin datos ni credenciales reales en las pruebas.
