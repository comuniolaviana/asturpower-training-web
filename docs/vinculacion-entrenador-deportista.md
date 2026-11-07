# Vinculacion profesional de entrenador y deportista

## Objetivo
Cada entrenador invita desde **Mis deportistas** y cada deportista acepta desde **Mis vínculos**, sin operaciones manuales de base de datos.

## Flujo
1. El entrenador inicia sesion con su cuenta de entrenador. En **Mis deportistas**, pulsa **Generar código de invitación**.
2. Copia el codigo de 32 caracteres y lo envia por un canal privado al deportista. El codigo funciona una sola vez, caduca en 7 dias y no se almacena en claro.
3. El deportista inicia sesion con su propia cuenta y entra a **Mis vínculos**.
4. Escribe el codigo y confirma el consentimiento. Solo entonces pasa a **activo** el vinculo. El entrenador puede consultar el perfil y los resumenes deportivos permitidos.
5. Cualquiera de los participantes puede desvincular desde **Mis vínculos / Mis deportistas**. Reingresar requiere un codigo nuevo y otro consentimiento.

## Seguridad
- El servidor valida la sesion del actor y su rol real almacenado en `user_roles`. Nunca se aceptan IDs de terceros en las acciones de invitacion.
- Se crea un codigo aleatorio de 128 bits y solo persiste su SHA-256 en `asturpower_private.coach_invitations`.
- `create_coach_invitation` y `redeem_coach_invitation` son RPC de acceso exclusivo `service_role`; no hay permisos para `anon` ni `authenticated`.
- El canje es atomico en PostgreSQL: solo el primer canje valido activa el vinculo; los demas fallan.
- Hay un maximo de 5 invitaciones activas por entrenador.
- Los originales FIT completos, los GPS y las curvas que necesitan consentimiento separado no se habilitan por este modulo.
- La nueva tabla privada tiene RLS activado y carece expresamente de politicas de lectura de cliente.
- Los codigos solo se muestran en la sesion del entrenador tras generarlos; si se pierden, se genera otro.
- Sin correo automatico ni envio externo a terceros; copiar el codigo evita nuevas dependencias y permisos.

## Caso Mauro/Enol
Mauro tiene una cuenta de entrenador y otra de deportista distintas. Se ha configurado en la base de datos un enlace activo entre ambas y se mantiene el existente con Enol. **Ese enlace preexistente es una comprobacion de la relacion, no una prueba del flujo interactivo nuevo.** Para validar el flujo desde la interfaz hay que usar una nueva invitacion con un deportista no vinculado.

## Despliegue y pruebas
- La migracion `20261107184500_coach_self_service_invitations.sql` debe estar aplicada ANTES del despliegue del nuevo frontend/backend.
- Las pruebas automaticas cubren autorizacion, consentimiento, rechazo de campos forjados, validacion de codigo, hash criptografico y la interfaz.
- Validar manualmente en Cloudflare con dos usuarios autenticados (coach y athlete), incluyendo codigo caducado o usado, revocacion y acceso aislado.
- No confundir pruebas de compilacion/servidor con una prueba real del recorrido desde dos dispositivos.
