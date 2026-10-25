# Fase 1B — Servidor PHP: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tener la API JSON delgada del spec §6.1, lista para que la consuma la aplicación web del plan 1C. Cubre autenticación, roles, etapas de la consulta, capítulos, copias de laboratorio con sus sugerencias, comentarios, resolución del revisor y versión final, con todos los controles de seguridad del spec §8 probados automáticamente, y un entorno Docker local que replica el hosting.

**Architecture:** PHP 8.2 sin framework. Un front controller (`public/index.php`) arma una `Peticion`, la pasa por un `Enrutador` de tabla fija y devuelve una `Respuesta` JSON. La lógica vive en `src/` (namespace `Manual\`, autoload PSR-4 de Composer):
- controladores delgados por recurso;
- una **capa de acceso** que recibe siempre el usuario de la sesión y filtra por él (el sustituto de RLS);
- validadores de entrada.

MariaDB vía PDO con sentencias preparadas. Las pruebas (PHPUnit) llaman a `Aplicacion::manejar()` en el mismo proceso contra una base de pruebas real en Docker, sin servidor HTTP.

**Tech Stack:** PHP 8.2 (Apache, extensiones pdo_mysql, sodium, intl, mbstring, zip, apcu, opcache), MariaDB 10.6, Composer 2, PHPUnit 11, Docker Compose. No hay más dependencias de Composer en producción: `vendor/` solo contiene el autoloader.

**Spec:** `docs/superpowers/specs/2026-10-23-plataforma-consulta-manual-design.md` (§3 hosting, §4 roles, §5.3, §6.1, §6.5–§6.9, §7, §8, §12).

**Hoja de ruta de la Fase 1:** ver el encabezado de `2026-10-24-fase1a-motor-cambios.md`. Este plan es independiente del 1A y puede ejecutarse en paralelo.

## Global Constraints

- Reglas del usuario (vigentes en la ejecución):
  - sin pausas entre tareas;
  - **commits al final**, uno atómico por tarea, mostrados antes de crearlos;
  - Conventional Commits;
  - identidad git `rcandiaa87 <rodrigo.candia@inia.cl>`;
  - trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` y la línea `Claude-Session` de la sesión;
  - rama `feat/fase1b-servidor` desde `origin/main`.
- **PHP solo dentro de Docker.** El usuario no instala PHP local: todo comando PHP o Composer se corre con `docker compose run --rm …`.
- Código en `servidor/` con la estructura de despliegue del spec §6.9: solo `servidor/public/` va a la raíz web, y `src/`, `config/`, `vendor/` y `.env` quedan fuera de ella.
- **El hosting no tiene SSH:** nada puede depender de ejecutar comandos en el servidor. La migración inicial es un `.sql` que se importa en phpMyAdmin, y lo que necesite CLI tiene también una alternativa en `.sql` o en la API de administración.
- Compatibilidad SQL con MariaDB ≥ 10.3 y MySQL ≥ 8.0. El hosting usa **MariaDB**: lo muestra el `information_schema` (`CLIENT_STATISTICS`, `INNODB_SYS_*`) en phpMyAdmin, 2026-10-24. Versión confirmada en phpMyAdmin (2026-10-24): **10.6.27-MariaDB**, igual a la imagen `mariadb:10.6` de Docker. **El juego de caracteres por defecto del servidor es latin1 (cp1252)**: toda tabla declara `DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci` y la conexión PDO usa `charset=utf8mb4` en el DSN. Hay un test que guarda y lee `≤ µ ñ “”` sin pérdida. El PHP de phpMyAdmin es 8.4, pero eso es del panel; el código se mantiene compatible con 8.2 y con 8.4. Reglas:
  - JSON guardado como `LONGTEXT` y validado en PHP;
  - `utf8mb4` / `utf8mb4_unicode_ci`;
  - sin `RETURNING` ni funciones exclusivas de un motor.
- Identificadores en español; nombres de tablas y columnas como en el spec §6.5, salvo los cambios que este plan declara.
- Respuestas siempre JSON con DTO explícitos. Los errores tienen la forma `{"error": {"codigo": "<snake_case>", "mensaje": "<texto en español>"}}`.
- Límite de cuerpo de petición: **2 MB** (413 `cuerpo_muy_grande`). Un capítulo real pesa menos de 100 KB en JSON.
- Ningún secreto en git: `.env` está en `.gitignore` y `.env.example` va versionado.

## Review Focus

1. **Un laboratorio manipula IDs** (`/api/capitulos/{id}/copia` de un capítulo válido estando autenticado como otro laboratorio, `PATCH /api/comentarios/{id}` de un comentario ajeno, `usuario_id` o `estado` en el cuerpo): nunca debe leer ni escribir datos de otro, y los campos no permitidos se ignoran. → test `aislamiento entre laboratorios en todos los endpoints` (Task 9).
2. **Escrituras fuera de etapa** (sugerencias tras el cierre, resolver durante la consulta, subir capítulos con la consulta abierta): 409 `etapa_no_permite` y la base no cambia. → test `cada escritura respeta la etapa` (Task 8).
3. **Fuerza bruta y enumeración en el login**: la misma respuesta para correo inexistente y para clave errónea; un bloqueo progresivo por cuenta y por IP; el honeypot no revela nada. → test `login no revela si el correo existe` y `bloqueo progresivo` (Task 4).
4. **Documento JSON malicioso o gigante** (un nodo `html`, un atributo `onclick`, una marca desconocida, una profundidad de 10 000, un texto de 5 MB): 422 `documento_invalido` o 413, nunca se guarda. → test `rechaza documentos fuera del esquema` (Task 5).
5. **Doble guardado concurrente de la misma copia** (dos pestañas): el último gana sin corromper el conjunto de sugerencias, porque copia y sugerencias se reemplazan en una sola transacción. → test `guardado de copia es atómico` (Task 7).

---

## Estructura de archivos

```
servidor/
├── composer.json, composer.lock, phpunit.xml, .env.example
├── public/                        # raíz web
│   ├── index.php                  # front controller (solo /api/*; el resto lo sirve Apache)
│   └── .htaccess                  # reescritura a index.php para /api, cabeceras de seguridad
├── src/
│   ├── Aplicacion.php             # arma dependencias, manejar(Peticion): Respuesta
│   ├── Http/{Peticion,Respuesta,Enrutador,ErrorHttp}.php
│   ├── Config.php                 # lee .env (ruta fuera de public/)
│   ├── Bd/{Conexion,Migrador}.php
│   ├── Seguridad/{Cifrado,Claves,Sesion,Csrf,LimiteIntentos,Cabeceras}.php
│   ├── Dominio/{Etapa,Rol}.php
│   ├── Validacion/{ValidadorDocumento,ValidadorSugerencia,Entrada}.php
│   ├── Acceso/                    # capa de acceso filtrada por usuario (RLS)
│   │   └── {Usuarios,Capitulos,Copias,Sugerencias,Comentarios,Consulta,Auditoria}.php
│   └── Controladores/{SesionCtl,ConsultaCtl,CapitulosCtl,CopiaCtl,ComentariosCtl,RevisionCtl,AdminCtl}.php
├── config/esquema-documento.json  # generado desde el cliente (Task 5)
├── migraciones/001_inicial.sql
├── bin/{migrar,crear-admin}.php   # solo desarrollo y CI
└── tests/ (Unit/, Api/, Soporte/)
docker/php/Dockerfile
compose.yaml
docs/api.md                        # contrato de la API (lo consume el plan 1C)
cliente/scripts/exportar-esquema.ts
```

## Contrato de la API (lo produce este plan; `docs/api.md` lo detalla)

Todas las rutas van bajo `/api`. Todo método distinto de GET exige la cabecera `X-CSRF-Token`. Etapas: `preparacion` (antes de la apertura), `consulta` (entre apertura y cierre) y `edicion_final` (después del cierre). Se calculan por fecha en cada petición (spec §6.8).

| Método y ruta | Rol | Etapa | Respuesta / efecto |
|---|---|---|---|
| `POST /sesion` `{correo, clave, sitio_web}` | — | — | `{usuario: {id, nombre, laboratorio, roles[]}, csrf}` · 401 `credenciales_invalidas` · 429 `demasiados_intentos` |
| `GET /sesion` | cualquiera | — | igual que arriba · 401 `sin_sesion` |
| `DELETE /sesion` | cualquiera | — | 204 |
| `GET /consulta` | cualquiera | — | `{apertura, cierre, etapa, motivoObligatorio}` |
| `GET /capitulos` | cualquiera | — | `[{id, orden, slug, titulo, misCambios, misComentarios}]`. El revisor recibe además `totalSugerencias, totalComentarios, pendientes` |
| `GET /capitulos/{id}/base` | cualquiera | — | `{versionId, docJson}` con `ETag` (304 si coincide) |
| `GET /capitulos/{id}/copia` | laboratorio | — | `{docJson, actualizado, sugerencias[]}` (solo las propias) · `{docJson: null}` si no hay copia |
| `PUT /capitulos/{id}/copia` `{versionId, docJson, sugerencias[]}` | laboratorio | consulta | 200 `{actualizado}`. Reemplaza la copia y **todo** el conjunto de sugerencias propias de ese capítulo en una transacción; el `motivo` se conserva por `uid` |
| `PATCH /capitulos/{id}/sugerencias/{uid}` `{motivo}` | laboratorio dueño | consulta | 200 |
| `GET /capitulos/{id}/comentarios` | laboratorio | — | los propios |
| `POST /capitulos/{id}/comentarios` `{bloqueId, rango, texto}` | laboratorio | consulta | 201 `{id}` |
| `PATCH /comentarios/{id}` `{texto}` · `DELETE /comentarios/{id}` | laboratorio dueño | consulta | 200 / 204 |
| `GET /capitulos/{id}/mis-aportes` | laboratorio | edicion_final | propias sugerencias y comentarios con `estado`, `notaResolucion` |
| `GET /capitulos/{id}/aportes` | revisor | consulta, edicion_final | todas las sugerencias y comentarios, con `laboratorio` |
| `PATCH /sugerencias/{id}` `{estado, notaResolucion, derivadaReunion}` | revisor | edicion_final | 200. `estado ∈ pendiente, aceptada, rechazada, modificada` |
| `PATCH /comentarios/{id}/resolucion` `{estado, notaResolucion}` | revisor | edicion_final | 200. `estado ∈ abierto, resuelto` |
| `PUT /capitulos/{id}/final` `{docJson, tex}` | revisor | edicion_final | 200 `{versionId}` (nueva versión `final`; la anterior final se conserva) |
| `GET /capitulos/{id}/final` | revisor | — | `{versionId, docJson, tex}` · 404 si no hay |
| `POST /admin/capitulos` `{slug, titulo, orden, texOriginal, docJson}` | admin | preparacion | 201 `{id, versionId}`. Si el slug existe, crea una nueva versión base |
| `GET /admin/usuarios` | admin | — | `[{id, nombre, laboratorio, correo, roles[], activo}]` |
| `POST /admin/usuarios/importar` `{csv}` | admin | — | 201 `[{correo, clave}]`. Las claves se muestran **una sola vez**. CSV con encabezado `nombre,correo,laboratorio` |
| `POST /admin/usuarios/{id}/clave` | admin | — | 200 `{clave}` (regenerada) |
| `PATCH /admin/usuarios/{id}` `{activo?, roles?}` | admin | — | 200 |
| `PUT /admin/consulta` `{apertura, cierre, motivoObligatorio}` | admin | preparacion (fechas) / cualquiera (motivo) | 200 |

Las fechas viajan en ISO 8601 con zona y se guardan en UTC. Estados HTTP comunes:
- 400 `entrada_invalida` (con `campos` en el error)
- 403 `sin_permiso`
- 404 `no_encontrado`, también cuando el recurso existe pero es ajeno: no se distingue
- 409 `etapa_no_permite` o `version_obsoleta`
- 422 `documento_invalido`

---

### Task 1: Entorno Docker, esqueleto y CI

**Files:**
- Create: `docker/php/Dockerfile`, `compose.yaml`, `servidor/composer.json`, `servidor/phpunit.xml`, `servidor/.env.example`, `servidor/public/index.php` (mínimo), `servidor/tests/Unit/HumoTest.php`
- Modify: `.gitignore` (`servidor/vendor/`, `servidor/.env`), `.github/workflows/ci.yml` (job `servidor`)

**Interfaces:**
- Produces:
  - Servicios de `compose.yaml`:
    - `php`: build `docker/php`, montaje `./servidor:/app`, DocumentRoot `/app/public`, puerto `8080:80`.
    - `bd`: `mariadb:10.6`, base `manual` y base `manual_pruebas`, usuario `manual`.
    - `composer`: imagen `composer:2`, montaje `./servidor:/app`.
  - Comandos que usan los demás pasos:
    - `docker compose run --rm composer install`
    - `docker compose run --rm php vendor/bin/phpunit`

- [ ] **Step 1:** El Dockerfile parte de `php:8.2-apache`, con `mod_rewrite` y `mod_headers` activos y las extensiones `pdo_mysql intl zip opcache` más `apcu` (PECL). `sodium` y `mbstring` vienen en la imagen. `apc.enable_cli=1` va solo en desarrollo.
- [ ] **Step 2:** `composer.json`: `"require": {"php": ">=8.2"}`, `"require-dev": {"phpunit/phpunit": "^11"}` y autoload PSR-4 `Manual\\` → `src/`, `Manual\\Pruebas\\` → `tests/`.
- [ ] **Step 3:** `HumoTest::test_php_tiene_extensiones` afirma `extension_loaded` para `pdo_mysql, sodium, intl, mbstring, apcu`, y que `PASSWORD_ARGON2ID` está definido.
- [ ] **Step 4:** `docker compose run --rm composer install && docker compose run --rm php vendor/bin/phpunit` → 1 test OK.
- [ ] **Step 5:** El job `servidor` de CI:
  - usa `ubuntu-latest` con `services: mariadb:10.6` y `shivammathur/setup-php@v2` (php 8.2, mismas extensiones);
  - corre `composer install`, `composer audit` y `vendor/bin/phpunit`;
  - agrega un job `secretos` con `gitleaks/gitleaks-action@v2`;
  - en el job del cliente, agrega `npm audit --audit-level=high`.

---

### Task 2: Núcleo HTTP y cabeceras de seguridad

**Files:**
- Create: `servidor/src/Http/{Peticion,Respuesta,Enrutador,ErrorHttp}.php`, `servidor/src/Aplicacion.php`, `servidor/src/Config.php`, `servidor/src/Seguridad/Cabeceras.php`, `servidor/public/.htaccess`
- Modify: `servidor/public/index.php`
- Test: `servidor/tests/Unit/EnrutadorTest.php`, `servidor/tests/Api/NucleoTest.php`

**Interfaces:**
- Produces:
  - `final class Peticion { __construct(string $metodo, string $ruta, array $cabeceras, string $cuerpo, string $ip); static desdeGlobales(): self; json(): array /* lanza ErrorHttp 400 entrada_invalida si no es objeto JSON */ }`
  - `final class Respuesta { static json(int $estado, mixed $datos, array $cabeceras = []): self; static vacia(int $estado = 204): self; enviar(): void }`
  - `final class ErrorHttp extends \RuntimeException { __construct(int $estado, string $codigo, string $mensaje, array $campos = []) }`
  - `final class Enrutador { agregar(string $metodo, string $patron, callable $manejador): void; resolver(Peticion $p): Respuesta }`. Patrones con `{id}` (solo dígitos) y `{uid}` (`[A-Za-z0-9:@+_-]{1,190}`). Devuelve 404 `no_encontrado` o 405 `metodo_no_permitido`.
  - `final class Aplicacion { __construct(Config $c); manejar(Peticion $p): Respuesta }`. Atrapa `ErrorHttp` y lo convierte a JSON. Cualquier otro `Throwable` da 500 `error_interno`, sin detalle al cliente, y se registra con `error_log`.
  - `Config::desdeEntorno(string $rutaEnv)` lee estas claves (todas en `.env.example`):
    - `BD_DSN`, `BD_USUARIO`, `BD_CLAVE`
    - `CLAVE_CIFRADO` (32 bytes, base64) y `CLAVE_INDICE` (32 bytes, base64)
    - `COOKIE_SEGURA` (`1` en producción)
    - `ZONA_HORARIA=America/Santiago`
  - Cabeceras en toda respuesta de la API, y las mismas en `.htaccess` para los estáticos:
    - `Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`. El `'unsafe-inline'` de estilos lo exige KaTeX.
    - `Strict-Transport-Security: max-age=31536000`, solo si `COOKIE_SEGURA=1`.
    - `X-Content-Type-Options: nosniff`
    - `Referrer-Policy: same-origin`
    - `Permissions-Policy: camera=(), microphone=(), geolocation=()`
    - `Cache-Control: no-store`, salvo donde un endpoint diga otra cosa.
  - `.htaccess`: reescribe `^api/` a `index.php`, deniega `\.(env|sql|json|lock)$` y desactiva `Options -Indexes`.

- [ ] **Step 1: Tests:**
  - `ruta_desconocida_da_404_json`
  - `metodo_no_permitido_da_405`
  - `id_no_numerico_no_coincide`
  - `cuerpo_mayor_a_2MB_da_413`
  - `json_invalido_da_400`
  - `excepcion_inesperada_da_500_sin_detalle`
  - `toda_respuesta_trae_cabeceras_de_seguridad`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** PHPUnit → PASS. Además, `docker compose up -d` y `curl -i localhost:8080/api/nada` → 404 JSON con las cabeceras.

---

### Task 3: Base de datos y migraciones

**Files:**
- Create: `servidor/migraciones/001_inicial.sql`, `servidor/src/Bd/{Conexion,Migrador}.php`, `servidor/bin/migrar.php`, `servidor/tests/Soporte/BaseDePruebas.php`
- Test: `servidor/tests/Api/MigracionTest.php`

**Interfaces:**
- Produces: las tablas del spec §6.5, con estos cambios **[decisiones de este plan]**:
  - `usuarios`: `roles` es `SET('laboratorio','revisor','admin')` (una persona puede ser revisor y admin, spec §4); `correo_cifrado VARBINARY(255)`; `correo_indice BINARY(32) UNIQUE`; `clave_hash VARCHAR(255)`; `activo TINYINT(1)`.
  - `sugerencias`: `uid VARCHAR(190)` (el id del cliente, `idSugerencia` del plan 1A) con `UNIQUE (usuario_id, capitulo_id, version_base_id, uid)`; `datos LONGTEXT` (el JSON completo de la `Sugerencia` del cliente); `bloque_id`, `tipo` y `grupo` como columnas para filtrar.
  - Resolución: `estado ENUM('pendiente','aceptada','rechazada','modificada') DEFAULT 'pendiente'`, `nota_resolucion`, `derivada_reunion`, `resuelto_por`, `resuelto_en`.
  - `comentarios`: `rango LONGTEXT` (JSON) y `estado ENUM('abierto','resuelto')`.
  - `consulta`: una sola fila (`id = 1`) con `apertura`, `cierre` (DATETIME UTC, NULL si no se definió) y `motivo_obligatorio`.
  - `revisiones_copia` (instantáneas), `auditoria` e `intentos_login` (`clave VARCHAR(190)`, que es `ip:<ip>` o `cuenta:<hex del índice>`, más `fallos`, `bloqueado_hasta` y `actualizado`).
  - Índices del spec §6.5. El FULLTEXT queda para la Fase 2.
  - `Conexion::crear(Config): \PDO` con `ERRMODE_EXCEPTION`, `EMULATE_PREPARES=false`, `utf8mb4` y `time_zone = '+00:00'`.
  - `Migrador::aplicar(\PDO, string $dir): array` aplica en orden los `NNN_*.sql` no registrados en `migraciones_aplicadas` y devuelve los nombres. `001_inicial.sql` se puede importar tal cual en phpMyAdmin (usa `CREATE TABLE IF NOT EXISTS` y se registra a sí mismo).
  - `BaseDePruebas` (trait) recrea `manual_pruebas` antes de cada clase de test y la vacía con `TRUNCATE` antes de cada test.

- [ ] **Step 1: Tests:**
  - `migracion_crea_todas_las_tablas`
  - `migracion_es_idempotente`
  - `uid_de_sugerencia_es_unico_por_usuario_capitulo_version`
  - `correo_indice_es_unico`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS.

---

### Task 4: Autenticación, sesión, CSRF y límite de intentos

**Files:**
- Create: `servidor/src/Seguridad/{Cifrado,Claves,Sesion,Csrf,LimiteIntentos}.php`, `servidor/src/Dominio/Rol.php`, `servidor/src/Acceso/Usuarios.php`, `servidor/src/Acceso/Auditoria.php`, `servidor/src/Controladores/SesionCtl.php`, `servidor/bin/crear-admin.php`, `servidor/tests/Soporte/ClienteApi.php`
- Test: `servidor/tests/Unit/CifradoTest.php`, `servidor/tests/Api/SesionTest.php`

**Interfaces:**
- Produces:
  - `Cifrado`:
    - `cifrar(string $texto): string` usa `sodium_crypto_secretbox` con nonce aleatorio antepuesto;
    - `descifrar(string $bin): string`;
    - `indice(string $correo): string` es HMAC-SHA256 con `CLAVE_INDICE` sobre `mb_strtolower(trim($correo))` y devuelve 32 bytes.
  - `Claves`:
    - `hash(string $c): string` usa `PASSWORD_ARGON2ID`;
    - `verificar(string $c, string $h): bool`;
    - `generar(): string` da 16 caracteres de `random_int` sobre un alfabeto sin ambiguos (`ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789`).
  - `Sesion`:
    - cookie `mm_sesion` con `HttpOnly`, `SameSite=Strict` y `Secure` según `COOKIE_SEGURA`;
    - `session_regenerate_id(true)` al iniciar sesión;
    - expira tras **2 h de inactividad** y **12 h absolutas**;
    - `usuarioActual(): ?array{id:int, nombre:string, laboratorio:string, roles:string[]}`;
    - `exigirRol(string ...$roles): array` da 401 `sin_sesion` o 403 `sin_permiso`.
  - `Csrf`: un token de 32 bytes en hexadecimal por sesión. `verificar(Peticion)` exige la cabecera `X-CSRF-Token` en todo método distinto de GET y HEAD y compara con `hash_equals`. Si falla, da 403 `csrf_invalido`.
  - `LimiteIntentos`:
    - claves `ip:<ip>` y `cuenta:<índice>`;
    - tras **5 fallos**, bloqueos de **1, 5, 15 y 60 min** (progresivos, el último se repite);
    - el éxito reinicia la cuenta;
    - durante el bloqueo, 429 `demasiados_intentos` con `Retry-After`.
  - Login: si el honeypot `sitio_web` no viene vacío, responde 401 `credenciales_invalidas` igual que un fallo y suma intento. Una cuenta inactiva también da `credenciales_invalidas`. Para igualar el tiempo con correos inexistentes, se verifica contra un hash ficticio fijo.
  - `Auditoria::registrar(?int $usuarioId, string $accion, string $entidad, ?int $entidadId, array $detalle = [])`.
  - `ClienteApi` (soporte de tests): `comoUsuario(array $u)`, `get/post/put/patch/delete(string $ruta, array $cuerpo = [])`. Mantiene la cookie y el CSRF entre llamadas en el mismo proceso.
  - `bin/crear-admin.php <nombre> <correo>` imprime la clave generada (solo para desarrollo). Para producción, `docs/api.md` documenta un `INSERT` de ejemplo con un hash Argon2id generado localmente.

- [ ] **Step 1: Tests:**
  - `cifrar_y_descifrar_ida_y_vuelta`
  - `indice_ignora_mayusculas_y_espacios`
  - `login_correcto_devuelve_usuario_y_csrf`
  - `login_no_revela_si_el_correo_existe` (mismo estado y cuerpo para correo inexistente y para clave errónea)
  - `honeypot_lleno_falla_igual`
  - `cuenta_inactiva_no_entra`
  - `bloqueo_progresivo` (5 fallos → 429; con el reloj inyectado avanzado 61 s → se puede intentar; otros 5 → bloqueo de 5 min)
  - `escritura_sin_csrf_da_403`
  - `sesion_expira_por_inactividad`
  - `logout_invalida_la_sesion`
  - `regenera_id_al_entrar`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. El reloj se inyecta (`Reloj` con `ahora(): \DateTimeImmutable`) para poder probar tiempos. **Step 4:** → PASS.

---

### Task 5: Validación del documento y de las sugerencias en el servidor

**Files:**
- Create: `cliente/scripts/exportar-esquema.ts`, `servidor/config/esquema-documento.json` (generado y versionado), `servidor/src/Validacion/{ValidadorDocumento,ValidadorSugerencia,Entrada}.php`
- Modify: `cliente/package.json` (script `"exportar-esquema": "tsx scripts/exportar-esquema.ts"`)
- Test: `servidor/tests/Unit/ValidadorDocumentoTest.php`, `servidor/tests/Unit/ValidadorSugerenciaTest.php`, `servidor/tests/fixtures/` (JSON sintéticos exportados desde el cliente)

**Interfaces:**
- Consumes: `esquemaManual` del cliente (`cliente/src/esquema/esquema.ts`).
- Produces:
  - `esquema-documento.json`, de la forma `{ nodos: { <tipo>: { hijos: string[], marcas: string[], attrs: { <nombre>: "string"|"number"|"boolean"|"null|string"|"json" }, texto: boolean } }, marcas: { <tipo>: { attrs: {...} } } }`. Se genera recorriendo `esquemaManual.nodes`: `hijos` sale del conjunto de tipos que admite `contentMatch`, y el tipo de `attrs` de los defaults y de la definición de cada extensión. La CI comprueba que el archivo está al día: corre `npm run exportar-esquema` y luego `git diff --exit-code servidor/config/esquema-documento.json`.
  - `ValidadorDocumento::validar(mixed $doc): void` lanza `ErrorHttp(422, 'documento_invalido', …)` cuando:
    - la raíz no es `doc`;
    - aparece un tipo o una marca desconocidos;
    - un hijo no está permitido para su padre;
    - hay un atributo no declarado o de tipo incorrecto;
    - hay un texto vacío o que no es string;
    - la profundidad pasa de **64**;
    - hay más de **50 000 nodos**;
    - un string mide más de **20 000** caracteres.
  
    La cardinalidad y el orden exactos los valida el cliente con ProseMirror. El servidor garantiza que no entre nada fuera del esquema (spec §8, "Escapar contenido de usuarios").
  - `ValidadorSugerencia::validar(mixed $s): array` exige, en una lista blanca, `id` (string ≤190), `autor`, `bloqueId`, `base` y `copia` (`{desde, hasta}` enteros ≥0), `original` y `propuesta` (listas de nodos válidos según el esquema), `tipo ∈ contenido, formato, bloque-insertado, bloque-eliminado`, y como opcionales `profundidad`, `siguiente`, `primerHijo`, `grupo`, `orden` y `motivo` (≤2000). Devuelve la sugerencia normalizada **sin** `autor`: el autor lo pone el servidor desde la sesión.
  - `Entrada`: utilidades `texto(array $d, string $campo, int $max)`, `entero`, `fechaIso`, `enumeracion` y `soloCampos(array $d, array $permitidos)`, que descarta el resto.

- [ ] **Step 1:** `exportar-esquema.ts` y el JSON generado. Copiar a `servidor/tests/fixtures/` tres documentos sintéticos válidos del cliente (exportados por el script con `--fixtures`), que incluyan lista anidada, tabla, nota al pie con bloques, ecuación, `especial` y referencia.
- [ ] **Step 2: Tests:**
  - `acepta_los_fixtures_del_cliente`
  - `rechaza_tipo_desconocido`
  - `rechaza_atributo_onclick`
  - `rechaza_marca_desconocida`
  - `rechaza_hijo_no_permitido`
  - `rechaza_profundidad_excesiva`
  - `rechaza_texto_gigante`
  - `sugerencia_valida_sin_autor`
  - `sugerencia_con_campos_extra_los_descarta`
  - `sugerencia_con_tipo_invalido_falla`
- [ ] **Step 3:** → FAIL. **Step 4:** Implementar. **Step 5:** → PASS.

---

### Task 6: Administración — capítulos, usuarios y consulta

**Files:**
- Create: `servidor/src/Dominio/Etapa.php`, `servidor/src/Acceso/{Capitulos,Consulta}.php`, `servidor/src/Controladores/{AdminCtl,ConsultaCtl}.php`
- Modify: `servidor/src/Acceso/Usuarios.php`, `servidor/src/Aplicacion.php` (rutas)
- Test: `servidor/tests/Api/AdminTest.php`, `servidor/tests/Unit/EtapaTest.php`

**Interfaces:**
- Produces:
  - `Etapa::actual(?\DateTimeImmutable $apertura, ?\DateTimeImmutable $cierre, \DateTimeImmutable $ahora): string`. Da `preparacion` si no hay apertura o si `ahora < apertura`, `consulta` si `apertura ≤ ahora < cierre`, y `edicion_final` si `ahora ≥ cierre`.
  - Los endpoints `/admin/*` y `GET /consulta`, según la tabla del contrato.
  - Importar CSV:
    - encabezado exacto `nombre,correo,laboratorio`;
    - UTF-8, con o sin BOM;
    - separador `,` o `;`, detectado por el encabezado;
    - correos validados con `filter_var`;
    - un duplicado (dentro del CSV o ya existente) da 400 con la lista de líneas, y no se crea ninguno, porque va todo en una transacción;
    - rol `laboratorio` por defecto.
  - Subir capítulo:
    - `texOriginal` ≤ 1 MB, UTF-8 válido;
    - `docJson` validado con `ValidadorDocumento`;
    - `slug` cumple `^[a-z0-9-]{1,80}$`.
  
    Solo se permite en `preparacion`. La versión base vigente es la última `tipo=base` del capítulo.
  - Fechas: `cierre > apertura`. Solo se pueden cambiar en `preparacion`; si no, da 409. `motivoObligatorio` se puede cambiar en cualquier etapa.
  - Todas las acciones de administración quedan en `auditoria`.

- [ ] **Step 1: Tests:**
  - `etapa_segun_fechas`
  - `importar_csv_crea_cuentas_y_devuelve_claves_una_vez`
  - `importar_csv_con_duplicado_no_crea_ninguna`
  - `importar_csv_con_punto_y_coma_y_bom`
  - `regenerar_clave_invalida_la_anterior`
  - `desactivar_impide_login`
  - `laboratorio_no_accede_a_admin` (403)
  - `subir_capitulo_crea_version_base`
  - `subir_capitulo_en_consulta_da_409`
  - `fechas_invalidas_dan_400`
  - `cambiar_fechas_en_consulta_da_409`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS.

---

### Task 7: Laboratorio — base, copia con sugerencias y comentarios

**Files:**
- Create: `servidor/src/Acceso/{Copias,Sugerencias,Comentarios}.php`, `servidor/src/Controladores/{CapitulosCtl,CopiaCtl,ComentariosCtl}.php`
- Modify: `servidor/src/Aplicacion.php`
- Test: `servidor/tests/Api/LaboratorioTest.php`

**Interfaces:**
- Produces: los endpoints de laboratorio de la tabla del contrato, con estas reglas:
  - **Capa de acceso:** cada método de `Copias`, `Sugerencias` y `Comentarios` recibe `int $usuarioId` como primer parámetro, y **todas** sus consultas SQL llevan `WHERE usuario_id = :usuario`. Los controladores nunca leen `usuario_id` del cuerpo.
  - `GET /capitulos/{id}/base`:
    - `ETag` = `"v<versionId>"`;
    - se cachea en APCu con la clave `base:<versionId>` (la versión base es inmutable);
    - `Cache-Control: private, max-age=0, must-revalidate`.
  - `PUT /copia`:
    - `versionId` debe ser la versión base vigente; si no, 409 `version_obsoleta`;
    - valida `docJson` y cada sugerencia;
    - **≤ 2000 sugerencias** por guardado;
    - en una transacción: hace upsert de la copia, borra las sugerencias propias del capítulo cuyo `uid` no viene, inserta las nuevas y actualiza `datos` de las que siguen, conservando `motivo` y `estado`;
    - guarda una instantánea en `revisiones_copia` si la última tiene más de **10 min**.
  - Comentarios: `texto` 1–4000 caracteres; `rango` validado como `{desde, hasta}`.

- [ ] **Step 1: Tests:**
  - `base_devuelve_etag_y_304`
  - `copia_inicial_es_null`
  - `guardar_y_leer_copia_con_sugerencias`
  - `re_guardar_conserva_motivo_por_uid`
  - `re_guardar_elimina_sugerencias_que_ya_no_vienen`
  - `version_obsoleta_da_409`
  - `guardado_de_copia_es_atomico` (una sugerencia inválida en medio deja la copia y las sugerencias anteriores intactas)
  - `instantanea_cada_10_minutos` (con reloj inyectado)
  - `crear_editar_borrar_comentario_propio`
  - `motivo_obligatorio_se_exige_si_la_consulta_lo_pide` (**decisión:** solo se exige al marcar la copia como enviada en el plan 1C; aquí se valida que `PATCH …/sugerencias/{uid}` acepte el motivo y que `GET /consulta` exponga la bandera)
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS.

---

### Task 8: Revisor — aportes, resolución y versión final

**Files:**
- Create: `servidor/src/Controladores/RevisionCtl.php`
- Modify: `servidor/src/Acceso/{Sugerencias,Comentarios,Capitulos}.php`, `servidor/src/Aplicacion.php`
- Test: `servidor/tests/Api/RevisionTest.php`, `servidor/tests/Api/EtapasTest.php`

**Interfaces:**
- Produces:
  - Los endpoints de revisor y `GET /capitulos/{id}/mis-aportes`, según la tabla del contrato.
  - El revisor accede a todo mediante métodos separados de la capa de acceso (`Sugerencias::todasDelCapitulo(int $capituloId)`), que solo se llaman tras `exigirRol('revisor')`.
  - `aportes` agrega `laboratorio` y `usuarioId` por fila (spec §12: los revisores ven el laboratorio).
  - Resolver registra `resuelto_por`, `resuelto_en` y una entrada de auditoría con el estado anterior y el nuevo.
  - `PUT /final` valida `docJson`; `tex` debe medir ≤ 1 MB y ser UTF-8 válido. Inserta una versión `tipo=final` nueva.

- [ ] **Step 1: Tests:**
  - `revisor_ve_aportes_de_todos_con_laboratorio`
  - `resolver_sugerencia_registra_quien_y_cuando`
  - `resolver_en_consulta_da_409`
  - `estado_invalido_da_400`
  - `resolver_comentario`
  - `guardar_version_final_crea_nueva_version`
  - `laboratorio_ve_mis_aportes_solo_en_edicion_final`
  - `laboratorio_no_puede_resolver` (403)
  - `cada_escritura_respeta_la_etapa`: una tabla de casos (endpoint, etapa) → 2xx o 409 que cubre todas las escrituras del contrato.
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS.

---

### Task 9: Revisión de seguridad transversal y contrato documentado

**Files:**
- Create: `servidor/tests/Api/AislamientoTest.php`, `docs/api.md`
- Modify: lo que los tests revelen

**Interfaces:**
- Produces: `docs/api.md`, el contrato completo (la tabla de arriba con los cuerpos de ejemplo, los códigos de error, las etapas, el CSRF, el flujo de login y el `INSERT` del primer administrador). Lo consume el plan 1C.

- [ ] **Step 1: Tests:**
  - `aislamiento_entre_laboratorios_en_todos_los_endpoints`: con dos laboratorios con datos, B prueba cada ruta que lleva `{id}` o `{uid}` de A (copia, sugerencias, comentarios, mis-aportes) y siempre obtiene 404 o datos propios vacíos, nunca datos de A.
  - `campos_prohibidos_se_ignoran`: `usuario_id`, `estado`, `resuelto_por`, `roles`, `autor` en los cuerpos de laboratorio no tienen efecto.
  - `respuestas_no_filtran_columnas`: ninguna respuesta contiene `clave_hash`, `correo_cifrado` ni `correo_indice`.
  - `inyeccion_sql_en_slug_y_textos`: textos con `' OR 1=1 --` se guardan literales.
- [ ] **Step 2:** Corregir lo que fallen. **Step 3:** `composer audit` y `npm audit --audit-level=high` sin vulnerabilidades altas. **Step 4:** Escribir `docs/api.md`. **Step 5:** PHPUnit completo → PASS.
