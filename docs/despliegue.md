# Guía de despliegue en cPanel

Esta guía explica, paso a paso, cómo instalar la plataforma de consulta del Manual de Métodos en un hosting cPanel compartido, sin SSH. Todo se hace desde el panel: *Dominios*, *Administrador de archivos*, *Bases de datos MySQL*, *phpMyAdmin*, *Cron Jobs* y el selector de PHP.

El detalle técnico de cada punto está en el checklist de [`docs/api.md` §6](api.md#6-checklist-de-despliegue). Esta guía lo sigue en orden.

## Antes de empezar

**Qué recibe** del equipo técnico (Rodrigo):

- `manualmetodos-AAAAMMDD-xxxxxxx.zip`: la aplicación completa.
- `manualmetodos-AAAAMMDD-xxxxxxx.sql`: la estructura de la base de datos.

Las dos partes deben tener el mismo nombre. **Si el nombre termina en `-sucio`, no lo instale**: es una prueba interna y no una versión para entregar.

**Qué necesita tener a mano:**

- Acceso a cPanel con su usuario. En esta guía, ese usuario aparece como `USUARIO`: reemplácelo por el suyo en todas las rutas.
- El nombre del subdominio. En esta guía se usa `manual.renalasch.cl` como ejemplo.
- Un lugar seguro **fuera del servidor** para guardar dos claves (un gestor de contraseñas, por ejemplo).

**Cómo queda instalado:**

```
/home/USUARIO/
├── public_html/            (el sitio que ya existe; no se toca)
└── manualmetodos/          (la plataforma)
    ├── public/             (lo único que se ve desde Internet: raíz web del subdominio)
    ├── bin/  config/  migraciones/  src/  vendor/  composer.json
    ├── .env                (lo crea usted en el paso 5; nunca viaja en el paquete)
    └── var/                (lo crea la plataforma sola: sesiones y respaldos)
```

Solo `public/` queda visible desde Internet. Todo lo demás, incluido el `.env` con las claves, queda un nivel más arriba, fuera del alcance de los visitantes.

> **Variante con `index.php` puente** (así está instalada la plataforma en renalasch.cl). En ese hosting cPanel no aceptó una raíz web fuera de `public_html`, así que la raíz web del subdominio es `/home/renalasc/public_html/manual.renalasch.cl`. Ahí solo están el cliente (`index.html`, `assets/`), el `.htaccess` y un `index.php` puente que carga la API desde `/home/renalasc/manualmetodos/public/index.php`. El resto de la plataforma, el `.env` y `var/` siguen en `/home/renalasc/manualmetodos/`, fuera de `public_html`. Las secciones 1, 2, 10.1 y 10.2 tienen un recuadro para esta variante.
>
> ```
> /home/renalasc/
> ├── public_html/
> │   └── manual.renalasch.cl/   (raíz web del subdominio)
> │       ├── index.html  assets/  .htaccess   (del paquete, con la guardia de host)
> │       ├── index.php                         (el puente; nunca se reemplaza)
> │       └── .user.ini                         (límites de PHP, paso 6.1; no existe con CloudLinux)
> └── manualmetodos/
>     ├── public/index.php   (la API de verdad; la carga el puente)
>     ├── bin/  config/  migraciones/  src/  vendor/  composer.json
>     ├── .env
>     └── var/
> ```

---

## 1. Crear el subdominio y activar HTTPS

1. En cPanel, abra **Dominios** y pulse **Crear un nuevo dominio**. En algunos cPanel esto aparece como **Subdominios**.
2. Escriba `manual.renalasch.cl`.
3. **Desmarque** «Compartir la raíz del documento con…», si aparece.
4. En **Raíz del documento** (*Document Root*) escriba `/home/USUARIO/manualmetodos/public`. Es importante que termine en `/public`.
5. Pulse **Enviar**. cPanel crea la carpeta vacía; los archivos llegan en el paso 2.
   - Si cPanel no acepta una raíz fuera de `public_html`, **no ponga la plataforma dentro de `public_html`**: el `.env` quedaría visible desde el sitio principal. Deténgase y consulte al equipo técnico. Para ese caso hay una variante en [`docs/api.md` §6](api.md#6-checklist-de-despliegue), punto «Qué se sube y dónde».
   - **Variante con `index.php` puente** (la de renalasch.cl): si cPanel solo acepta raíces dentro de `public_html`, use `/home/renalasc/public_html/manual.renalasch.cl` como raíz del documento. La plataforma igual se instala en `/home/renalasc/manualmetodos/` (paso 2) y el `.env` queda fuera de `public_html`; en la raíz web solo van el cliente, el `.htaccess` y el puente.
6. HTTPS:
   - En **SSL/TLS Status** confirme que `manual.renalasch.cl` tenga un certificado válido. Si no lo tiene, pulse **Run AutoSSL** y espere unos minutos.
   - De vuelta en **Dominios**, active **Force HTTPS Redirect** para `manual.renalasch.cl`.

> La plataforma solo funciona por HTTPS. Por HTTP el navegador descarta la cookie de sesión: el login parece funcionar, pero no se queda dentro.

## 2. Subir y extraer el paquete

1. Abra el **Administrador de archivos** y entre a su carpeta personal (`/home/USUARIO`). Es la carpeta que contiene `public_html`, no `public_html` misma.
2. Active la vista de archivos ocultos: botón **Configuración** (arriba a la derecha) → marque **Mostrar archivos ocultos (dotfiles)** → **Guardar**. Sin esto no verá el `.env` ni el `.htaccess`.
3. Pulse **Cargar** y suba el `.zip`. Espere a que la barra llegue al 100 % y vuelva a la carpeta.
4. Seleccione el `.zip`, pulse **Extraer** y confirme la carpeta `/home/USUARIO`. Se crea la carpeta `manualmetodos` con todo adentro, y con eso el subdominio ya tiene contenido en `manualmetodos/public`.
   - Si cPanel creó antes una carpeta `manualmetodos/public` vacía, no importa: la extracción la rellena.
5. Revise que existan `manualmetodos/public/index.html`, `manualmetodos/public/.htaccess` y `manualmetodos/vendor/autoload.php`.
6. Borre el `.zip` de `/home/USUARIO`. Ya no hace falta.

> **Variante con `index.php` puente** (raíz web `/home/renalasc/public_html/manual.renalasch.cl`). Haga los puntos 1 a 5 igual: la plataforma completa queda en `/home/renalasc/manualmetodos/`. Después:
>
> 1. **Copie el cliente a la raíz web conservando las carpetas.** El Administrador de archivos no copia bien carpetas con subcarpetas una por una, así que se hace con un zip: entre a `/home/renalasc/manualmetodos/public`, seleccione `index.html`, `assets` y `.htaccess` → **Comprimir** (Zip) → nombre `cliente.zip`. Mueva `cliente.zip` a `/home/renalasc/public_html/manual.renalasch.cl` y ahí use **Extraer**. Borre `cliente.zip`. No copie `index.php`.
> 2. **Cree el puente.** En `/home/renalasc/public_html/manual.renalasch.cl`, **+ Archivo** → `index.php` → **Editar**, con exactamente este contenido:
>
>    ```php
>    <?php
>    // Puente: la plataforma vive fuera de public_html. No reemplazar en las actualizaciones.
>    require '/home/renalasc/manualmetodos/public/index.php';
>    ```
>
>    El `index.php` de verdad sigue en `/home/renalasc/manualmetodos/public/` y busca `vendor/` y `.env` relativos a su propia carpeta, así que funciona igual cargado desde el puente.
> 3. **Agregue la guardia de host.** La raíz web está dentro de `public_html`, así que el sitio principal también podría llegar a ella (por ejemplo `renalasch.cl/manual.renalasch.cl/`). Edite el `.htaccess` de `/home/renalasc/public_html/manual.renalasch.cl` y, **justo después de la línea `RewriteEngine On`**, agregue estas 3 líneas:
>
>    ```apache
>    # Guardia de host: esta carpeta solo responde a manual.renalasch.cl
>    RewriteCond %{HTTP_HOST} !^manual\.renalasch\.cl$ [NC]
>    RewriteRule ^ - [F]
>    ```
>
>    Cualquier visita que no sea a `manual.renalasch.cl` recibe 403.
> 4. Con **MultiPHP INI Editor**, los límites de PHP del paso 6.1 (`.user.ini`) se crean en `/home/renalasc/public_html/manual.renalasch.cl`, que es la raíz web. Con **Select PHP Version** (CloudLinux, el caso de renalasch.cl) no se crea ningún archivo ahí: es normal.
> 5. En la prueba rápida (paso 9), `https://manual.renalasch.cl/.env` y `/composer.json` responden **404** en vez de 403: esos archivos no están en la raíz web. Es correcto.

## 3. Crear la base de datos y su usuario

En **Bases de datos MySQL** (no use el asistente: marca todos los privilegios por defecto):

1. **Crear nueva base de datos:** escriba un nombre, por ejemplo `manual`. cPanel le agrega su prefijo, y el nombre completo queda como `USUARIO_manual`. Anótelo.
2. **Agregar nuevo usuario:** por ejemplo `app`, que queda como `USUARIO_app`. Use **Generador de contraseñas**, copie la contraseña y guárdela; se usa en el paso 5.
3. **Agregar usuario a la base de datos:** elija `USUARIO_app` y `USUARIO_manual` y pulse **Agregar**.
4. En la pantalla de privilegios, **no marque «TODOS LOS PRIVILEGIOS»**. Marque solo estos cuatro:
   - `SELECT`
   - `INSERT`
   - `UPDATE`
   - `DELETE`

   Pulse **Realizar cambios**.

La plataforma nunca necesita crear ni borrar tablas. La importación del paso 4 la hace phpMyAdmin con su usuario de cPanel, que sí tiene esos permisos.

## 4. Importar la estructura de la base (`.sql`)

1. Abra **phpMyAdmin** desde cPanel.
2. En la columna izquierda, pulse la base `USUARIO_manual`.
3. Abra la pestaña **Importar**.
4. En **Archivo a importar**, elija el `.sql` que recibió.
5. Deje **Conjunto de caracteres del archivo** en `utf-8`. **No cambie nada más**, ni el cotejamiento de la base ni el formato (SQL).
6. Pulse **Importar** (o **Continuar**). Debe aparecer un mensaje verde de importación exitosa.
7. En la columna izquierda deben aparecer **11 tablas**: `auditoria`, `capitulos`, `comentarios`, `consulta`, `copias_laboratorio`, `intentos_login`, `migraciones_aplicadas`, `revisiones_copia`, `sugerencias`, `usuarios` y `versiones_capitulo`.

Aunque la base diga `latin1`, es normal y no hay que convertirla: cada tabla declara su propio `utf8mb4`. Si por error importa el archivo dos veces, no pasa nada.

## 5. Crear el `.env` con las claves

El `.env` guarda la conexión a la base y dos claves de cifrado. **Nunca viaja en el paquete:** se crea a mano en el servidor.

### 5.1 Generar las dos claves

Cada clave son 32 bytes aleatorios escritos en base64 (un texto de 44 caracteres que termina en `=`). Hay que generar **dos claves distintas**:

- **En Windows**, abra *PowerShell* y pegue esta línea. Ejecútela dos veces, una para cada clave:
  ```
  $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
  ```
- **En Mac o Linux**, abra una terminal y ejecute dos veces:
  ```
  openssl rand -base64 32
  ```

**Guarde las dos claves fuera del servidor de inmediato**, en el gestor de contraseñas, junto con el nombre del sitio. Si se pierden, los correos de los usuarios quedan ilegibles, nadie puede entrar y los respaldos dejan de servir. No las envíe por correo ni por chat.

### 5.2 Crear el archivo

1. En el Administrador de archivos, entre a `/home/USUARIO/manualmetodos`.
2. Seleccione `.env.produccion.example` → **Copiar** → escriba `/home/USUARIO/manualmetodos/.env` como destino. Si cPanel le pide la carpeta en vez del nombre, cópielo y después renombre la copia a `.env`.
3. Seleccione `.env` → **Editar**. Reemplace cada valor que está entre `<…>`. Las líneas que empiezan con `#` son explicaciones y no hay que tocarlas.

   | Variable | Qué poner |
   |---|---|
   | `BD_HOST` | `localhost` |
   | `BD_NOMBRE` | `USUARIO_manual` (paso 3) |
   | `BD_NOMBRE_PRUEBAS` | déjela como está; en producción no se usa |
   | `BD_USUARIO` | `USUARIO_app` (paso 3) |
   | `BD_CLAVE` | la contraseña de `USUARIO_app` (paso 3) |
   | `BD_DSN` | `mysql:host=localhost;dbname=USUARIO_manual;charset=utf8mb4`, con el nombre de su base |
   | `CLAVE_CIFRADO` | la primera clave de 5.1 |
   | `CLAVE_INDICE` | la segunda clave de 5.1 (tiene que ser **distinta** de la primera) |
   | `COOKIE_SEGURA` | `1`. **No lo cambie:** es obligatorio en producción |
   | `ZONA_HORARIA` | `America/Santiago` |

   Escriba cada valor sin comillas y sin espacios alrededor del `=`.
4. Pulse **Guardar cambios**.
5. Seleccione `.env` → **Permisos** → deje `600` (solo lectura y escritura para el dueño). Si después el sitio responde «Error 500», pruebe con `640`.

El servidor se niega a arrancar si una clave falta, no mide 32 bytes o si las dos son iguales. Eso es intencional.

### 5.3 Reiniciar datos de prueba (solo durante las pruebas)

Mientras se prueba la plataforma con los laboratorios, el administrador puede necesitar dejarla limpia entre una ronda y otra. Para eso existe **«Reiniciar datos de prueba»** (en *Administración → Consulta*, al pie: «Zona de pruebas»). Borra copias, propuestas, comentarios, decisiones y versiones finales, y devuelve la consulta a preparación. Conserva capítulos, usuarios, auditoría e intentos de login. Antes de borrar escribe un respaldo en `var/respaldos/`, igual al del Cron Job (sección 8), y si el respaldo falla no borra nada. El detalle está en [`docs/api.md` §4.6](api.md#46-administración).

**Está apagado por defecto.** Para habilitarlo durante las pruebas:

1. Edite el `.env` (paso 5.2) y agregue al final la línea:

   ```
   REINICIO_PRUEBAS=1
   ```

   El valor tiene que ser `1`; se ignoran los espacios alrededor y las comillas (`REINICIO_PRUEBAS="1"` también vale). Cualquier otro valor (`0`, `si`, `01`…), o la línea ausente, lo deja apagado.
2. Guarde. No hace falta reiniciar nada: el cambio vale desde la petición siguiente.
3. En *Administración → Consulta* debe aparecer, al final, la **Zona de pruebas**.

**Antes de la consulta real, apáguelo (obligatorio):** borre la línea `REINICIO_PRUEBAS=1` del `.env`, o cámbiela a `REINICIO_PRUEBAS=0`. Compruebe que la Zona de pruebas ya no aparece en *Administración → Consulta* (recargue la página). Con el reinicio apagado, la ruta `POST /api/admin/reiniciar` ni siquiera existe (responde 404).

Cada reinicio deja su respaldo en `var/respaldos/` y cuenta para la rotación de los 14 más recientes. Si hizo muchos reinicios seguidos, descargue antes de la consulta real algún respaldo diario que quiera conservar.

## 6. Ajustar PHP

### 6.1 Versión y límites

> **¿MultiPHP o Select PHP Version?** Algunos cPanel traen **MultiPHP Manager** y **MultiPHP INI Editor**. Otros, con CloudLinux, traen en su lugar **Select PHP Version** (en la sección *Software*; también aparece como «Seleccionar versión de PHP»). **renalasch.cl usa Select PHP Version**: ahí no existen MultiPHP Manager ni MultiPHP INI Editor. Con Select PHP Version la versión, las extensiones y los límites se ajustan en esa misma pantalla, valen para toda la cuenta y **no se crea ningún `.user.ini`**. Las instrucciones de abajo indican las dos rutas.

1. En **MultiPHP Manager**, marque `manual.renalasch.cl` y elija **PHP 8.2**, 8.3 u 8.4. Pulse **Aplicar**.
   - Con **Select PHP Version** (CloudLinux): elija la versión arriba de la pantalla, y en la pestaña **Extensions** confirme que estén marcadas `pdo_mysql` (o `nd_pdo_mysql`), `mbstring` y `sodium`. Si `pdo_mysql` aparece como «skipped as conflicting» porque `nd_pdo_mysql` está marcada, está bien. Si `sodium` no se deja marcar, suele venir incluida en PHP; el sitio avisa si falta.
2. En **MultiPHP INI Editor** con `manual.renalasch.cl` elegido, o en **Select PHP Version → pestaña Options**, deje:

   | Opción | Valor mínimo |
   |---|---|
   | `upload_max_filesize` | `8M` (los capítulos pesan hasta 4 MB) |
   | `post_max_size` | `8M` |
   | `max_execution_time` | `120` (para importar 100 usuarios de una vez) |
   | `memory_limit` | `128M` |

   Con MultiPHP INI Editor, pulse **Aplicar**: cPanel guarda estos valores en un archivo `.user.ini` (o `php.ini`) dentro de `manualmetodos/public/`. **No lo borre nunca**, tampoco al actualizar (paso 10). En **Options** de Select PHP Version cada valor se guarda solo al cambiarlo y no se crea ningún archivo.

Si al PHP le falta alguna extensión, el sitio muestra un mensaje que la nombra.

### 6.2 Confirmar la ruta del PHP para los Cron Jobs (una vez)

El paso 7 y el paso 8 ejecutan comandos con Cron Jobs, y esos comandos tienen que correr con el **PHP de línea de comandos (CLI)**. Con otro tipo de PHP no funcionan: por ejemplo, el respaldo termina con error y deja el aviso `cron.php debe ejecutarse con PHP CLI` en el correo del cron y en el `error_log`.

1. Abra **Cron Jobs**. Arriba, en **Correo electrónico de cron**, escriba su correo y pulse **Actualizar correo electrónico**. cPanel le envía ahí lo que imprime cada tarea.
2. Agregue un Cron Job de prueba con **Una vez por minuto** y este comando:
   ```
   date; /usr/local/bin/php -v; /opt/cpanel/ea-php82/root/usr/bin/php -v
   ```
3. Espere el correo (uno o dos minutos) y **borre ese Cron Job** (botón **Eliminar** en la lista de abajo).
4. Lea el correo:
   - La primera línea es **la fecha y hora del servidor**. Compárela con la hora de Chile en que llegó el correo y anote la diferencia (por ejemplo, «el servidor va 3 horas adelantado»). La necesita en el paso 7.
   - Después, cada ruta responde con una línea parecida a `PHP 8.2.x (cli) (built: …)`:
     - Si `/usr/local/bin/php` dice **`(cli)`** y una versión **8.2 o mayor**, use las líneas de esta guía tal cual.
     - Si no (dice `(cgi-fcgi)`, una versión menor, «not found» o «No such file»), reemplace `/usr/local/bin/php` por `/opt/cpanel/ea-php82/root/usr/bin/php` en **todas** las líneas de esta guía. Esa es la versión CLI de PHP 8.2 que trae cPanel.
     - Si ninguna de las dos sirve, pida al soporte del hosting «la ruta del binario PHP 8.2 CLI para Cron Jobs».

## 7. Crear el primer administrador

La clave de cada usuario va cifrada con las claves del `.env`. Por eso **no sirve escribir el usuario a mano en phpMyAdmin**: el administrador se genera con el comando `bin/crear-admin.php --sql`, que usa esas mismas claves y entrega una línea `INSERT` para pegar en phpMyAdmin. El comando no toca la base; solo escribe ese texto.

Como el hosting no tiene SSH, el comando se ejecuta **una sola vez** con un Cron Job, que deja el resultado en un archivo. Antes tiene que haber hecho el paso 6.2 (ruta de PHP y hora del servidor).

1. **Elija la hora de ejecución.** Tome la hora actual **del servidor** (la de Chile más la diferencia que anotó en 6.2) y súmele 5 minutos. Por ejemplo, si en el servidor son las 14:52, use las 14:57: **Minuto** `57`, **Hora** `14`.
2. En **Cron Jobs → Agregar nuevo Cron Job**, elija **Configuración común → Personalizado**. Escriba ese **Minuto** y esa **Hora**, deje `*` en *Día*, *Mes* y *Día de la semana*, y en **Comando** pegue esta línea, todo en una sola línea:
   ```
   umask 077; /usr/local/bin/php /home/USUARIO/manualmetodos/bin/crear-admin.php --sql "Nombre Apellido" admin@inia.cl > /home/USUARIO/manualmetodos/admin-inicial.txt 2>&1
   ```
   - Reemplace `USUARIO`, `Nombre Apellido` y `admin@inia.cl`.
   - **Escriba el nombre sin tildes ni ñ** (por ejemplo, «Fabio Munoz»): el campo Comando de cPanel puede estropear esos caracteres. El laboratorio no se escribe: queda «Administración», con tilde, automáticamente.
   - `umask 077` hace que solo su usuario pueda leer el archivo, y `> … 2>&1` hace que la clave quede en el archivo y no viaje por correo.
3. Pulse **Agregar nuevo Cron Job**. Espere hasta **dos minutos después** de la hora elegida (unos 7 minutos en total).
4. **Borre ese Cron Job** (botón **Eliminar** en la lista de abajo). Si queda programado, vuelve a correr todos los días a esa hora y reescribe el archivo con una clave nueva.
5. En el Administrador de archivos, abra `/home/USUARIO/manualmetodos/admin-inicial.txt` (**Ver** o **Editar**). Debe contener exactamente tres líneas:
   ```
   INSERT INTO usuarios (nombre, laboratorio, correo_cifrado, …) VALUES (CONVERT(0x… USING utf8mb4), …, 1);
   Correo: admin@inia.cl
   Clave:  …
   ```
   - Si el archivo no existe, espere un par de minutos más. Si sigue sin aparecer, revise la hora del servidor (6.2) y repita desde el punto 1.
   - Si dice `not found`, `No such file or directory` o nombra una versión de PHP menor que 8.2, revise la ruta de PHP (6.2) y repita desde el punto 1.
   - Si empieza con líneas como `X-Powered-By:` o `Content-type:`, esa ruta de PHP no es la CLI: vuelva a 6.2, use la otra ruta y repita desde el punto 1.
6. Copie la **clave** a su gestor de contraseñas.
7. Copie la línea completa que empieza con `INSERT INTO usuarios`. En phpMyAdmin, elija la base `USUARIO_manual` → pestaña **SQL** → péguela → **Continuar**. Debe decir «1 fila insertada».
8. **Borre `admin-inicial.txt` de forma definitiva.** En el Administrador de archivos, selecciónelo → **Eliminar** → marque **Omitir la papelera y eliminar permanentemente los archivos** (*Skip the trash*) → **Confirmar**. Si lo borró sin marcar esa opción, abra **Ver papelera** (*View Trash*) y pulse **Vaciar papelera** (*Empty Trash*).
9. **Cambie la clave en el primer ingreso.** La clave estuvo unos minutos escrita en el servidor, así que hay que reemplazarla:
   1. Entre a `https://manual.renalasch.cl/` con el correo y la clave del archivo.
   2. Abra **Administración → Usuarios**, busque su propia fila y pulse **Regenerar clave** → **Confirmar regeneración**.
   3. Copie la **clave nueva** que aparece en la pantalla y reemplace la anterior en su gestor de contraseñas. Se muestra solo esta vez.
   4. La plataforma cierra todas las sesiones de esa cuenta, incluida la suya: en la siguiente acción le pedirá entrar de nuevo. Entre con la clave nueva.

   Desde ese momento, la clave que quedó en el archivo ya no sirve.

> Alternativa sin Cron Job: alguien con Docker y una copia del repositorio puede generarlo en su computador con un `.env` que tenga **las mismas** `CLAVE_CIFRADO` y `CLAVE_INDICE` (ver [`docs/api.md` §5](api.md#5-primer-administrador)). Igual conviene regenerar la clave en el primer ingreso.

Los demás usuarios (laboratorios y revisor) los crea después el administrador desde la plataforma, en **Administración → Usuarios**.

## 8. Configurar los Cron Jobs de mantenimiento

La plataforma necesita dos tareas automáticas: un **respaldo diario** de la base y una **limpieza semanal** de intentos de login viejos. Los respaldos quedan en `/home/USUARIO/manualmetodos/var/respaldos/` y se conservan los 14 más recientes. Use la ruta de PHP que confirmó en el paso 6.2.

### 8.1 Agregar las dos tareas

En **Agregar nuevo Cron Job** pegue cada línea en **Configuración común → Personalizado**: los cinco números van en los campos *Minuto, Hora, Día, Mes, Día de la semana*, y el resto va en **Comando**.

```
# Respaldo diario a las 03:30
30 3 * * * /usr/local/bin/php /home/USUARIO/manualmetodos/bin/cron.php respaldo
# Limpieza semanal, domingo a las 04:00
0 4 * * 0 /usr/local/bin/php /home/USUARIO/manualmetodos/bin/cron.php limpieza
```

| Tarea | Minuto | Hora | Día | Mes | Día de la semana | Comando |
|---|---|---|---|---|---|---|
| Respaldo | `30` | `3` | `*` | `*` | `*` | `/usr/local/bin/php /home/USUARIO/manualmetodos/bin/cron.php respaldo` |
| Limpieza | `0` | `4` | `*` | `*` | `0` | `/usr/local/bin/php /home/USUARIO/manualmetodos/bin/cron.php limpieza` |

- La hora es la **del servidor del hosting**, que puede no ser la de Chile. Basta con que caiga de madrugada. Los nombres de los respaldos van en hora UTC.
- Cada tarea envía un correo con una línea («respaldo: … (N bytes)»). Si prefiere recibir solo los errores, agregue ` >/dev/null` al final del comando: los errores siguen llegando.

### 8.2 Probar el respaldo ahora (obligatorio)

No espere hasta las 03:30 para saber si funciona:

1. Agregue un Cron Job temporal con **Una vez por minuto** y el comando:
   ```
   /usr/local/bin/php /home/USUARIO/manualmetodos/bin/cron.php todo
   ```
2. Espere el correo (uno o dos minutos) y **borre ese Cron Job temporal**. Las dos tareas del paso 8.1 se quedan. El correo debe decir:
   ```
   limpieza: 0 intentos de login borrados
   respaldo: /home/USUARIO/manualmetodos/var/respaldos/respaldo-AAAAMMDD-HHMMSS.sql.gz (… bytes)
   ```
3. Compruebe las dos cosas:
   - En el Administrador de archivos existe `manualmetodos/var/respaldos/respaldo-AAAAMMDD-HHMMSS.sql.gz`, con un tamaño mayor que 0.
   - En phpMyAdmin, base `USUARIO_manual` → pestaña **SQL**, esta consulta devuelve una fila con la fecha de recién (en UTC):
     ```
     SELECT creado, detalle FROM auditoria WHERE accion = 'cron_respaldo' ORDER BY id DESC LIMIT 1;
     ```
4. Si falta cualquiera de las dos, lea el correo del cron y el archivo `error_log` (en `manualmetodos/public/` o en `manualmetodos/`) y busque `cron.php debe ejecutarse con PHP CLI` o `ERROR`. Lo más común es una ruta de PHP equivocada (vuelva al paso 6.2) o un dato mal escrito en el `.env` (paso 5).

Que haya corrido dos veces no hace daño: solo deja dos respaldos.

## 9. Prueba rápida

Es la lista de [`docs/api.md` §6](api.md#6-checklist-de-despliegue), «Prueba rápida después de desplegar». Hágala en el navegador, en una ventana de incógnito:

| Abra | Debe ver |
|---|---|
| `http://manual.renalasch.cl/api/salud` (con **http**) | la dirección cambia sola a `https://…` y la página muestra `{"estado":"ok"}` |
| `https://manual.renalasch.cl/api/sesion` | `{"error":{"codigo":"sin_sesion",…}}`: es correcto, todavía no ha entrado |
| `https://manual.renalasch.cl/.env` | **403 Forbidden** (nunca el contenido del archivo) |
| `https://manual.renalasch.cl/composer.json` | **403 Forbidden** |
| `https://manual.renalasch.cl/` | la pantalla de ingreso de la plataforma |

Después:

1. Entre con el correo y la clave del paso 7. Debe llegar a la lista de capítulos, con el botón **Administración**. Si entra, también quedan comprobadas la cookie segura y la protección contra peticiones de otro sitio (`origen_invalido`).
2. Recargue la página (F5). Debe seguir dentro. Si vuelve a pedir la clave, el sitio no se está sirviendo por HTTPS (revise el paso 1).
3. Pulse **Administración → Consulta**. Debe ver la etapa actual («Preparación») y el formulario de apertura y cierre, sin mensajes de error. Si ya conoce las fechas reales de la consulta, guárdelas ahí: debe aparecer «Cambios guardados.». Las fechas se pueden cambiar en cualquier momento. Si es la instalación para la consulta real, compruebe también que **no** aparece la «Zona de pruebas» al pie (5.3).

**Con una terminal** (opcional, para el equipo técnico):

```
curl -I http://manual.renalasch.cl/api/salud     → 301, Location: https://manual.renalasch.cl/api/salud
curl -i https://manual.renalasch.cl/api/salud    → 200 {"estado":"ok"}
curl -i https://manual.renalasch.cl/api/sesion   → 401 sin_sesion
```

Si el sitio está detrás de Cloudflare u otro proxy, revise antes de abrir el punto «Proxy o Cloudflare» de [`docs/api.md` §6](api.md#6-checklist-de-despliegue).

---

## 10. Actualizar a una versión nueva

Recibirá un `.zip` nuevo, y a veces un `.sql`. La regla es esta:

| Se reemplaza | **No se toca nunca** |
|---|---|
| En `manualmetodos/`: `bin/`, `config/`, `migraciones/`, `src/`, `vendor/`, `composer.json` y `.env.produccion.example` | `.env` (sus claves y la conexión) y `var/` (sesiones y respaldos) |
| En `manualmetodos/public/`: **solo** `assets/`, `index.html`, `index.php` y `.htaccess` | Todo lo demás que haya en `public/`: `.user.ini` o `php.ini` si existen (los límites del paso 6.1, solo con MultiPHP INI Editor), `.well-known/` (el certificado) y `error_log` |

**Nunca borre `public/` entera:** ahí cPanel guarda sus propios archivos, y si se pierden, los límites de PHP vuelven en silencio a los del hosting (los capítulos grandes dejarían de subir días después).

Las carpetas viejas no se borran: se renombran como `…-anterior`, para poder volver atrás si la versión nueva falla.

### 10.1 Pasos

Hágalo en un horario tranquilo: entre los puntos 4 y 6 el sitio queda fuera de servicio unos minutos.

1. **Respaldo previo:** agregue un Cron Job temporal con **Una vez por minuto** y el comando `/usr/local/bin/php /home/USUARIO/manualmetodos/bin/cron.php respaldo`. Espere el correo y **borre el Cron Job**. Descargue ese respaldo a su computador (Administrador de archivos → seleccionar → **Descargar**).
2. Suba el `.zip` nuevo a `/home/USUARIO` y **extráigalo en una carpeta aparte**: cree la carpeta `/home/USUARIO/nueva` y, al **Extraer**, escriba `/home/USUARIO/nueva`. Quedará `/home/USUARIO/nueva/manualmetodos/…`.
3. Si quedaron carpetas `…-anterior` de una actualización pasada, bórrelas ahora: `bin-anterior`, `config-anterior`, `migraciones-anterior`, `src-anterior`, `vendor-anterior`, `composer.json-anterior` y `public-anterior`, todas dentro de `/home/USUARIO/manualmetodos/`.
4. **Aparte la versión actual.** En `/home/USUARIO/manualmetodos`:
   1. Con **Cambiar nombre**, renombre `bin` → `bin-anterior`, `config` → `config-anterior`, `migraciones` → `migraciones-anterior`, `src` → `src-anterior`, `vendor` → `vendor-anterior` y `composer.json` → `composer.json-anterior`.
   2. Borre `.env.produccion.example` (es solo una plantilla).
   3. Cree la carpeta `public-anterior` (botón **+ Carpeta**), al lado de `public` y no dentro de ella.
   4. Entre a `public`, seleccione **solo** `assets`, `index.html`, `index.php` y `.htaccess` → **Mover** → `/home/USUARIO/manualmetodos/public-anterior`. Lo demás que haya en `public` se queda donde está.

   **No toque `.env` ni `var`.**
5. **Ponga la versión nueva.**
   1. Entre a `/home/USUARIO/nueva/manualmetodos`, seleccione `bin`, `config`, `migraciones`, `src`, `vendor`, `composer.json` y `.env.produccion.example` → **Mover** → `/home/USUARIO/manualmetodos`.
   2. Entre a `/home/USUARIO/nueva/manualmetodos/public`, seleccione `assets`, `index.html`, `index.php` y `.htaccess` → **Mover** → `/home/USUARIO/manualmetodos/public`.
   3. Confirme que en `manualmetodos/public` están `.htaccess` (con los archivos ocultos visibles) y, si existían antes, `.user.ini` o `php.ini`.
6. Revise PHP:
   - En **MultiPHP Manager**, vuelva a aplicar la versión de PHP del subdominio (paso 6.1). cPanel a veces guarda la versión dentro de `public/.htaccess`, y ese archivo acaba de reemplazarse. Con **Select PHP Version** basta confirmar que siga elegida la versión 8.2 o superior.
   - En **MultiPHP INI Editor** (o **Select PHP Version → Options**), confirme que los cuatro límites del paso 6.1 siguen con sus valores. Si alguno volvió al valor del hosting, corríjalo.
7. Si la versión trae un `.sql`, impórtelo como en el paso 4 **solo si las notas de la versión lo piden**.
8. Repita la prueba rápida (paso 9).
9. Si todo funciona, borre la carpeta `/home/USUARIO/nueva` y el `.zip`. Deje las carpetas `…-anterior` hasta la próxima actualización: no estorban y permiten volver atrás.

> **Si su raíz web está dentro de public_html (variante con index.php puente).** Es el caso de renalasch.cl: raíz web `/home/renalasc/public_html/manual.renalasch.cl`, con `index.html`, `assets/`, `.htaccess` y el `index.php` puente (ver «Cómo queda instalado» y el paso 2). Los puntos 1 a 3 y 7 a 9 son iguales. Cambian los puntos 4 a 6:
>
> - **4. Aparte la versión actual.**
>   1. En `/home/renalasc/manualmetodos`, igual que arriba (4.1 y 4.2): renombre `bin`, `config`, `migraciones`, `src`, `vendor` y `composer.json` como `…-anterior`, y borre `.env.produccion.example`.
>   2. En `/home/renalasc/manualmetodos/public` mueva **solo** `index.php` a una carpeta nueva `/home/renalasc/manualmetodos/public-anterior`.
>   3. Antes de tocar la raíz web, abra su `.htaccess` actual (`/home/renalasc/public_html/manual.renalasch.cl/.htaccess`) y copie a un lugar seguro las 3 líneas de la guardia de host que siguen a `RewriteEngine On`. **Si su `.htaccess` actual no las tiene**, no hay nada que copiar: en el punto 5.4 agréguelas tal como aparecen en el paso 2 de la variante (punto 3).
>   4. Cree `/home/renalasc/cliente-anterior` (**fuera** de `public_html`) y mueva ahí, desde `/home/renalasc/public_html/manual.renalasch.cl`, **solo** `index.html`, `assets` y `.htaccess`.
>   5. **No toque el `index.php` de la raíz web (el puente) ni `.user.ini`, `php.ini`, `.well-known/` o `error_log`.** Tampoco `/home/renalasc/manualmetodos/.env` ni `var/`.
> - **5. Ponga la versión nueva.**
>   1. Mueva `bin`, `config`, `migraciones`, `src`, `vendor`, `composer.json` y `.env.produccion.example` desde `/home/renalasc/nueva/manualmetodos` a `/home/renalasc/manualmetodos`, como arriba.
>   2. El `index.php` del paquete (`/home/renalasc/nueva/manualmetodos/public/index.php`) va **solo** a `/home/renalasc/manualmetodos/public/`. **Nunca lo copie a la raíz web: pisaría el puente y toda la API respondería «Error 500».**
>   3. Para el cliente, use un zip para conservar las carpetas: en `/home/renalasc/nueva/manualmetodos/public` seleccione `index.html`, `assets` y `.htaccess` → **Comprimir** → `cliente.zip`, muévalo a `/home/renalasc/public_html/manual.renalasch.cl`, **Extraer** ahí y borre `cliente.zip`.
>   4. Edite el `.htaccess` recién copiado a la raíz web y vuelva a agregar, **justo después de `RewriteEngine On`**, las 3 líneas de la guardia de host: las que copió en 4.3 o, si no las tenía, las del paso 2 de la variante (punto 3). Agréguelas siempre, aunque antes no estuvieran. Sin ellas, la carpeta respondería también desde el sitio principal.
>   5. Confirme que en la raíz web siguen el `index.php` puente y, si existían, `.user.ini` o `php.ini`.
> - **6. Revise PHP.** En renalasch.cl (Select PHP Version): confirme que siga elegida PHP 8.2 o superior y que los cuatro límites de la pestaña **Options** sigan como en el paso 6.1. Con MultiPHP: vuelva a aplicar la versión en **MultiPHP Manager**, porque el `.htaccess` de la raíz web se reemplazó y cPanel puede guardar ahí la versión, y confirme los límites (`.user.ini` en la raíz web) en **MultiPHP INI Editor**.
> - En la prueba rápida (paso 9), `/.env` y `/composer.json` responden **404** en esta variante, no 403. Es correcto.
> - Pida a los laboratorios que recarguen la página (o la cierren y la vuelvan a abrir): una pestaña abierta con el cliente anterior puede fallar al comentar hasta recargar.
> - Al terminar, borre `/home/renalasc/nueva` y el `.zip`. Deje `cliente-anterior` y `public-anterior` hasta la próxima actualización.

### 10.2 Volver a la versión anterior

Si la prueba rápida falla con la versión nueva y no hay una solución inmediata:

1. En `/home/USUARIO/manualmetodos`, renombre las carpetas nuevas como `…-fallida`: `bin` → `bin-fallida`, `config` → `config-fallida`, `migraciones` → `migraciones-fallida`, `src` → `src-fallida`, `vendor` → `vendor-fallida` y `composer.json` → `composer.json-fallida`.
2. Renombre las anteriores a su nombre original: `bin-anterior` → `bin`, `config-anterior` → `config`, `migraciones-anterior` → `migraciones`, `src-anterior` → `src`, `vendor-anterior` → `vendor` y `composer.json-anterior` → `composer.json`.
3. En `public`, borre `assets`, `index.html`, `index.php` y `.htaccess` (los nuevos). Después entre a `public-anterior`, seleccione todo su contenido → **Mover** → `/home/USUARIO/manualmetodos/public`.
4. Vuelva a aplicar la versión de PHP en **MultiPHP Manager**, o confírmela en **Select PHP Version** (paso 6.1).
5. Si en el punto 7 de 10.1 importó un `.sql`, restaure el respaldo previo del punto 1 (paso 11).
6. Repita la prueba rápida (paso 9) y avise al equipo técnico, con el correo del cron o el `error_log` si los hay.

> **Si su raíz web está dentro de public_html (variante con index.php puente).** Los puntos 1, 2, 5 y 6 son iguales. Cambian el 3 y el 4:
>
> - **3.** En `/home/renalasc/manualmetodos/public` borre el `index.php` nuevo y mueva ahí el de `/home/renalasc/manualmetodos/public-anterior`. En `/home/renalasc/public_html/manual.renalasch.cl` borre **solo** `index.html`, `assets` y `.htaccess` (los nuevos) y mueva ahí el contenido de `/home/renalasc/cliente-anterior`. Si ese `.htaccess` anterior no tenía la guardia de host, agréguela como en el paso 2 de la variante. **El `index.php` puente no se toca.**
> - **4.** Confirme la versión y los límites en **Select PHP Version → Options** (renalasch.cl). Con MultiPHP: vuelva a aplicar la versión en **MultiPHP Manager** y confirme los límites de `.user.ini` en la raíz web.

Cuando el problema esté resuelto, borre las carpetas `…-fallida`.

## 11. Restaurar un respaldo

Restaurar **reemplaza toda la base** por el contenido del respaldo: se pierde todo lo que se hizo después de esa fecha (cambios de los laboratorios, decisiones, usuarios). Hágalo solo si es necesario, y avise antes a los usuarios.

1. Elija el respaldo en `manualmetodos/var/respaldos/`. El nombre dice la fecha y la hora en UTC: `respaldo-20261026-063000.sql.gz` es del 26-10-2026 a las 06:30 UTC (03:30 en Chile en horario de verano).
2. **Antes de restaurar, saque un respaldo del estado actual** (Cron Job temporal con `cron.php respaldo`, como en 8.2). Así puede deshacer la restauración.
3. Descargue el respaldo elegido a su computador (Administrador de archivos → **Descargar**).
4. En phpMyAdmin, elija la base `USUARIO_manual` → **Importar** → suba el `.sql.gz` tal cual, **sin descomprimirlo**. Conjunto de caracteres `utf-8` y nada más cambiado → **Importar**.
5. Debe terminar con un mensaje verde. El respaldo borra y recrea cada tabla, así que no hace falta vaciar la base antes.
6. Repita la prueba rápida (paso 9) y entre con un usuario conocido.

Tenga en cuenta:

- Un respaldo **solo sirve con las mismas `CLAVE_CIFRADO` y `CLAVE_INDICE`** del `.env` con que se hizo. Con otras claves, nadie puede entrar. Por eso hay que guardarlas fuera del servidor (paso 5.1).
- Si phpMyAdmin rechaza el archivo por tamaño, el límite de subida está en la misma pantalla de **Importar**. Pida al soporte del hosting que lo suba, o pida al equipo técnico que lo importe.
- Los respaldos viven en el mismo servidor. Descargue uno de vez en cuando (por ejemplo, cada semana durante la consulta) y guárdelo fuera: si se pierde la cuenta del hosting, se pierden también los respaldos.
