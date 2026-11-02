# Varios entrenadores y roles acumulables

Estado a 2 de noviembre de 2026: adaptación de base aplicada en el proyecto independiente de AsturPower; código guardado en `desarrollo`; sin desplegar, sin cuentas reales y sin importar historiales. Primer piloto previsto: un entrenador y dos ciclistas, Mauro y Enol. Los entrenadores A y B utilizados en las pruebas son ficticios y no reciben acceso.

## Qué permitió la revisión y qué faltaba

`profiles` ya proporciona una identidad por cuenta Auth. `coach_athletes` ya es una relación muchos-a-muchos: cada entrenador puede vincular varios deportistas, y un deportista puede autorizar a varios entrenadores. No existe un `coach_id` único dentro del perfil que obligue al deportista a pertenecer a una sola persona.

Las cinco políticas RLS ya separaban los datos: un usuario lee su perfil y sus roles; ve solo vínculos donde participa; un entrenador lee el perfil de un deportista solamente con un vínculo activo. Estar registrado como entrenador no da acceso a todos los perfiles ni al directorio global.

El límite estaba en `user_roles`, cuya clave primaria era solo `user_id`. Se ha sustituido por `(user_id, role)`, conservando las filas y reconstruyendo las dos FK de los vínculos dentro de la migración. Se mantienen RLS, GRANT, integridad de roles, estados e índices. Se pueden añadir coach y athlete a la misma identidad; nadie puede concedérselos desde el cliente. La asignación no elimina otros roles. No se ha concedido ningún rol a personas reales.

## Panel y servidor

- El panel lee todos los roles propios desde la base. La selección de espacio no concede permisos, solo elige entre los que ya están concedidos.
- La vista Entrenador filtra por `coach_id` y la vista Deportista por `athlete_id`. Cambiar de espacio descarta los datos de la vista anterior antes de cargar la siguiente.
- El servidor comprueba el token con `getUser()` y lee las pertenencias desde `user_roles`. No confía en roles del formulario ni en `user_metadata`.
- Las peticiones GET validan que el espacio solicitado pertenece al usuario. El directorio de plataforma solo aparece en una vista Admin expresamente autorizada, no por ser entrenador ni por tener también un rol administrativo.
- El código del servidor permite a un administrador de plataforma añadir coach/athlete a perfiles existentes y proponer vínculos pendientes. No puede conceder admin mediante ese endpoint.
- Solo el deportista destinatario puede aceptar una propuesta pendiente y activar el vínculo. Se exige confirmación explícita en el panel. Un administrador o entrenador no puede aceptar en nombre del deportista.
- Participantes y administrador pueden revocar. Una propuesta revocada requiere propuesta nueva y aceptación nueva; no se reactiva mediante una aceptación antigua.
- Un entrenador no recibe los nombres de deportistas pendientes o revocados mediante el servidor. Para consentir, el deportista sí puede ver el nombre del entrenador de su propia propuesta.

No hay correos de invitación, creación masiva de cuentas, pagos, marcas comerciales separadas, equipos empresariales ni administración avanzada de entrenadores. Se muestran hasta 50 perfiles y 50 vínculos por página en la administración básica.

## Propiedad de datos al ampliar la aplicación

Las siguientes entidades siguen pendientes de implementación; esta tabla fija el contrato de diseño antes de incorporar datos reales:

| Entidad | Propietario / clave | Acceso del entrenador |
|---|---|---|
| Perfil e identidad Auth | Usuario, independiente de cualquier entrenador | Solo perfil del deportista con vínculo activo |
| Roles | `(user_id, role)`, gestionados desde servidor autorizado | Solo roles propios desde el cliente |
| Vínculo | `(coach_id, athlete_id)` con estado | Solo vínculos propios; sin acceso transitivo a la cartera ajena |
| Biblioteca de entrenamientos futura | `coach_id` creador | Solo biblioteca propia; compartir requerirá otra autorización explícita |
| Asignación de entrenamiento futura | Sesión y `athlete_id`, con entrenador asignador | Comprobar autoría y vínculo activo, no solo pertenencia al rol coach |
| Actividad / historial futuro | `athlete_id`, origen e identificador externo | Consulta mediante vínculo activo y permisos correspondientes |
| Conexión Garmin futura | `athlete_id`, independiente del coach | Nunca tokens; el servidor administra OAuth del propio deportista |
| Estadísticas futuras | Derivadas de actividades del deportista | Mismas reglas que los datos de origen; sin vistas que eludan RLS |

La revocación o el cambio de entrenador no borrará la cuenta, su Garmin ni su historial. No habrá tokens compartidos entre Mauro y Enol. Los secretos Garmin se almacenarán en un esquema privado o almacén de secretos, sin permisos para `anon` ni `authenticated`; un cambio de vista jamás otorga acceso a ellos. No se han creado ni activado esas tablas o conexiones todavía.

No se necesita una tabla de empresas o un sistema comercial de multitenencia para las carteras individuales actuales: identidad + roles + vínculos autorizados proporcionan la separación. Si se incorporan organizaciones posteriormente, necesitarán su propio modelo y pruebas.

## Pruebas y límites de lo verificado

- 36 pruebas SQL originales repetidas después del cambio.
- 22 pruebas SQL nuevas en la base real, con dos entrenadores y deportistas ficticios, una cuenta dual y un deportista compartido únicamente tras un vínculo autorizado. Se comprueba revocación por entrenador y conservación de la identidad deportista al retirar coach.
- 44 pruebas de aplicación/servidor, incluyendo cambio de espacio, filtro de cartera, rol falsificado rechazado, token verificado, consentimiento y protección de operaciones privilegiadas.
- Compilación de producción correcta. Las fixtures visuales y sus datos no se incorporan al build de producción.

Los datos SQL de prueba se descartan con ROLLBACK; no tienen contraseñas, identidades de login ni sesiones. Las pruebas JS usan dobles de prueba: no sustituyen una prueba real de Auth y de las Functions desplegadas. Entrenamientos, estadísticas y Garmin siguen pendientes, por lo que no se afirma que sus permisos ya hayan sido probados.

## Activación pendiente

El servidor está deshabilitado por defecto. Antes de activarlo hay que autorizar un entorno separado de pruebas, revisar privacidad y Auth, preparar la primera cuenta y asignar su rol desde un proceso supervisado. Se necesitan variables de servidor `ASTURPOWER_TEAM_ENABLED=true` y `SUPABASE_SECRET_KEY`, además de las publicables del paso 2. Nunca se entrega esa clave secreta al navegador ni se guarda en GitHub. No se ha leído ni creado una clave secreta para este desarrollo.

Los datos reales de Mauro y Enol se incorporarán solo después de esa puesta en marcha. Garmin Starter no incluye recuperación histórica: la carga histórica se diseñará mediante exportaciones autorizadas de cada deportista o mediante las capacidades contractuales que se acuerden con Garmin; la sincronización futura será individual.
