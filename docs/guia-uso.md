# Guía de uso de la plataforma de consulta del Manual de Métodos

Esta guía explica, en pocas palabras, cómo se usa la plataforma según su rol. Para entrar necesita el correo y la clave que le entregó el administrador. Si olvida la clave, pídale al administrador una nueva.

## Las tres etapas

La plataforma pasa sola de una etapa a otra según las fechas que fija el administrador. Todas las horas son de Chile.

| Etapa | Qué se puede hacer |
|---|---|
| **Preparación** (antes de la apertura) | El administrador sube los capítulos y crea las cuentas. Los laboratorios todavía no pueden editar. |
| **Consulta** (entre la apertura y el cierre) | Los laboratorios proponen cambios y dejan comentarios. El revisor puede mirar lo que llega, pero aún no decide. |
| **Edición final** (después del cierre) | Los laboratorios ya no pueden editar; ven qué se decidió sobre lo suyo. El revisor decide y arma la versión final. |

---

## Laboratorio

### Proponer cambios

1. Entre con su correo y su clave. Verá la lista de capítulos con cuántos cambios y comentarios suyos tiene cada uno.
2. Abra un capítulo y edite el texto directamente, como en un procesador de texto. La plataforma marca cada cambio respecto del texto original: lo agregado, lo borrado y el formato cambiado.
3. El panel lateral lista sus cambios. Puede deshacer uno con Ctrl+Z en el editor.

Si mueve, une o separa bloques (por ejemplo, borra el inicio de un ítem y lo pega al anterior), la plataforma lo muestra como **bloque movido**. Si aparece un aviso de "cambios de estructura que no se aplicarán", deshágalo y, si hace falta, borre el bloque y escríbalo de nuevo donde corresponde, o explíquelo en un comentario.

### Guardado automático y borradores

- **No hay botón de guardar.** La plataforma guarda sola unos segundos después de cada cambio. Arriba se indica el estado: "Guardando…", "Guardado", "Cambios sin guardar…".
- Si se corta la conexión, verá "Sin guardar: sin conexión, reintentando". Sus cambios quedan en un **borrador en este navegador** y se envían solos cuando vuelve la conexión.
- Si la sesión venció (2 horas sin actividad), verá "Sesión vencida: vuelva a entrar". Entre de nuevo: el borrador se guarda solo.
- Si al abrir un capítulo hay un borrador que no alcanzó a guardarse, la plataforma le ofrece **recuperarlo** o **descartarlo**.
- Si la consulta cierra con la página abierta, el capítulo pasa a solo lectura y se le ofrece copiar el texto que no alcanzó a guardarse.
- **No abra el mismo capítulo en dos pestañas o ventanas.** Si lo hace, solo una puede editar: la otra muestra "Este capítulo está abierto en otra pestaña…" y queda en solo lectura. Cuando cierre la primera, la segunda pasa a editar sola. También puede pulsar **Tomar el control**: la otra pestaña queda en solo lectura y le ofrece copiar lo que no alcanzó a guardar.
- Si la copia cambió en el servidor desde otra pestaña, ventana o computador, la página no reemplaza ese trabajo: pasa a solo lectura y le ofrece copiar sus últimos cambios. Recárguela para seguir.

El borrador vive solo en el navegador donde trabajó. Termine de guardar antes de cambiarse de computador. Si al pulsar **Salir** quedan cambios sin guardar en el navegador, la plataforma se lo avisa antes de cerrar la sesión.

### Motivos

Cada cambio puede llevar un **motivo**: una frase breve que explica por qué lo propone, por ejemplo "la norma vigente usa 10 g". Ayuda mucho al revisor. Si el administrador marcó el motivo como obligatorio, el panel indica cuántos cambios no tienen motivo. Aun así, su trabajo se guarda igual.

### Comentarios

Seleccione un trozo de texto y pulse **Comentar** para dejar una observación sin cambiar el texto, por ejemplo una duda o algo para conversar en la reunión. Mientras dure la consulta puede editar o borrar sus comentarios.

### Qué ve cada laboratorio

- Cada laboratorio ve **solo sus propios cambios y comentarios**. No ve los de otros laboratorios.
- Después del cierre aparece **Mis aportes**: lo que se decidió sobre cada cambio suyo (aceptado, rechazado o modificado), la nota del revisor y si se derivó a la reunión de revisión. No se muestra quién resolvió.

---

## Revisor

### Durante la consulta

Puede abrir cada capítulo y ver los aportes de todos los laboratorios a medida que llegan. Todavía no puede decidir.

### Decidir (edición final)

1. En la lista de capítulos verá, para cada uno, el total de sugerencias y comentarios y cuántos siguen **pendientes**.
2. Al abrir un capítulo, los aportes aparecen **agrupados por bloque**, con el laboratorio de cada uno y un color por laboratorio. Si varios laboratorios propusieron exactamente lo mismo, aparece una sola vez, con todos los laboratorios que la propusieron.
3. Los **conflictos** (dos laboratorios cambiaron el mismo texto de forma distinta) aparecen en una cola, en el orden del documento. Solo uno de ellos puede quedar aceptado.
4. Para cada aporte puede:
   - **Aceptar** o **Rechazar**;
   - **Marcar como modificada (redacción propia)**, si prefiere escribir su propia versión en la versión final;
   - **Derivar a reunión**, para conversarlo en la reunión ampliada;
   - escribir una **nota de resolución**, que el laboratorio verá;
   - **Reabrir** una decisión ya tomada.
5. Un **bloque movido** se decide de una vez: la decisión se aplica a todas sus partes. Si alguna parte falla, la plataforma lo avisa para que reintente.
6. Los comentarios se marcan como resueltos, con una nota si hace falta.

Los filtros (un laboratorio, solo conflictos, solo pendientes, solo cambios o solo comentarios) quedan en la dirección de la página, así que puede guardarla o compartirla.

### Versión final

1. **Componer versión final** aplica sobre el texto original solo las sugerencias aceptadas y abre un editor con el resultado.
2. Ahí puede corregir o redactar directamente, por ejemplo en los aportes marcados como modificados.
3. **Guardar versión final** la guarda en el servidor. Puede guardar varias veces; se conservan todas las versiones. Mientras edita, la plataforma guarda un borrador en el navegador y se lo ofrece si sale sin guardar. Si hay un borrador sin recuperar, **Componer versión final** le pregunta antes de descartarlo.
4. **Exportar .tex** descarga el capítulo en LaTeX. Si el texto tiene caracteres que LaTeX no sabe escribir o referencias sin destino, la plataforma lo avisa antes de exportar.

---

## Administrador

### Capítulos (solo en preparación)

1. En **Capítulos**, elija el archivo `.tex` del capítulo. Verá una vista previa y avisos de lo que no se pudo convertir. Esos trozos quedan protegidos y los laboratorios no pueden editarlos.
2. Revise el identificador (slug), el título y el orden, y pulse **Subir**. Si sube de nuevo el mismo identificador, se crea una nueva versión del capítulo.

Una vez abierta la consulta ya no se pueden subir capítulos.

### Usuarios

- **Importar** cuentas con un CSV de hasta 100 filas, con el encabezado exacto `nombre,correo,laboratorio`. Si una fila tiene un error, no se crea ninguna cuenta y se indica la línea.
- Las claves nuevas **se muestran una sola vez**. Cópielas o use **Descargar CSV** y entrégueselas a cada persona por un canal seguro.
- Las cuentas importadas son de laboratorio. Para el revisor, cambie los roles y pulse **Guardar roles**. Una persona puede tener varios roles.
- **Desactivar** impide entrar. **Regenerar clave** entrega una clave nueva y cierra al instante todas las sesiones abiertas de esa cuenta; úselo, por ejemplo, si cambia el responsable de un laboratorio.

El primer administrador lo crea el equipo técnico al instalar la plataforma.

### Consulta

- Fije la **apertura** y el **cierre** en hora de Chile. La consulta se abre y se cierra sola en esas fechas.
- Con la consulta abierta solo se puede **extender el cierre** (por ejemplo, "ampliamos una semana"). No se puede acortarlo, mover la apertura ni reabrir una consulta ya cerrada.
- **Motivo obligatorio** pide a los laboratorios un motivo para cada cambio. Se puede cambiar en cualquier momento y nunca impide guardar.
