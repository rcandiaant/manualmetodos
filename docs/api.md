# API del servidor (Fase 1B): contrato

Este documento es el contrato entre el servidor PHP (`servidor/`) y el cliente (plan 1C). Si el código y este documento no coinciden, se trata como un bug.

- Todas las rutas van bajo `/api`.
- Las peticiones y las respuestas son JSON en UTF-8. Las únicas excepciones son el 204 y el 304, que no llevan cuerpo.
- Los nombres de campo van en camelCase. Las columnas internas de la base (`usuario_id`, `clave_hash`, `correo_cifrado`, `correo_indice`, …) nunca aparecen en una respuesta.

---

## 1. Convenciones generales

### 1.1 Formato de error

```json
{"error": {"codigo": "entrada_invalida", "mensaje": "Texto en español.", "campos": {"correo": "Obligatorio, texto de hasta 254 caracteres."}}}
```

`campos` es opcional y solo aparece en errores de validación (400). El cliente debe decidir según `codigo`; `mensaje` sirve solo para mostrarlo.

| HTTP | `codigo` | Cuándo |
|---|---|---|
| 400 | `entrada_invalida` | JSON mal formado, UTF-8 inválido, no es un objeto, campo ausente o mal formado (`campos` dice cuál), un documento demasiado profundo (más de 64 niveles JSON) |
| 401 | `credenciales_invalidas` | login fallido (la misma respuesta para correo inexistente, clave errónea, cuenta inactiva u honeypot lleno) |
| 401 | `sin_sesion` | no hay sesión válida (también en escrituras: el cliente debe volver a entrar) |
| 403 | `sin_permiso` | hay sesión, pero el rol no alcanza |
| 403 | `csrf_invalido` | hay sesión, pero `X-CSRF-Token` falta, está vacío o no coincide |
| 403 | `origen_invalido` | `Origin` no coincide con `Host`, `Origin: null` o `Sec-Fetch-Site: cross-site` (solo en métodos distintos de GET/HEAD) |
| 404 | `no_encontrado` | la ruta no existe, el recurso no existe **o es de otro laboratorio** (no se distingue), o un `{id}`/`{uid}` con formato inválido |
| 405 | `metodo_no_permitido` | la ruta existe con otro método (con cabecera `Allow`). No hay CORS: `OPTIONS` sobre una ruta existente da 405, y sobre una inexistente, 404. Un preflight de otro sitio (`Origin` ajeno o `Sec-Fetch-Site: cross-site`) da antes 403 `origen_invalido`, porque esa comprobación va antes del enrutado (§1.2) |
| 409 | `etapa_no_permite` | escritura fuera de su etapa (ver §3) |
| 409 | `version_obsoleta` | `PUT …/copia` con un `versionId` que ya no es la base vigente |
| 409 | `conflicto_concurrente` | interbloqueo o espera de bloqueo agotada en la base (subida de capítulo, guardado de copia). Se puede reintentar |
| 409 | `operacion_no_permitida` | un admin intenta desactivarse o quitarse el rol `admin` a sí mismo |
| 413 | `cuerpo_muy_grande` | el cuerpo supera el tope de la ruta (§1.4) |
| 415 | `tipo_no_soportado` | hay cuerpo y `Content-Type` no es `application/json` |
| 422 | `documento_invalido` | `docJson` o los nodos de una sugerencia no cumplen el esquema del documento |
| 429 | `demasiados_intentos` | login bloqueado temporalmente (con cabecera `Retry-After` en segundos) |
| 500 | `error_interno` | error no previsto; el detalle va solo al `error_log` del servidor |

### 1.2 Cabeceras obligatorias del cliente

- **`Content-Type: application/json`** en **toda** petición con cuerpo, incluido el login. Si falta, responde 415 `tipo_no_soportado`. Así un formulario de otro sitio no puede mandar un cuerpo sin preflight CORS.
- **`X-CSRF-Token: <csrf>`** en todo método distinto de GET/HEAD, salvo `POST /api/sesion`. El token llega en `POST /sesion` y `GET /sesion`.
- El navegador manda solo `Origin` y `Sec-Fetch-Site`. El servidor compara el host:puerto de `Origin` con `Host`, normalizando el puerto por defecto. Si un proxy reescribe `Host`, el resultado es un 403 `origen_invalido` falso (ver el checklist de despliegue).
- Orden de las comprobaciones previas al enrutado: 413 (tamaño), 403 `origen_invalido`, 415, ruta/método (404/405), 401/403 de sesión y CSRF, y después la lógica del endpoint.

### 1.3 Fechas

- **Salida**: siempre en UTC con `Z` y sin fracciones, `YYYY-MM-DDTHH:MM:SSZ` (ej. `2026-11-10T12:00:00Z`). Sin fecha: `null`.
- **Entrada**: ISO 8601 con zona obligatoria (`Z` o `±hh:mm`). Se convierte a UTC y se descartan las fracciones. Se rechazan las fechas que no existen (`2026-02-30`, `25:00`) y las que no traen zona.

### 1.4 Límites

| Límite | Valor |
|---|---|
| Cuerpo de petición (general) | 2 MB |
| Cuerpo de `POST /admin/capitulos` y `PUT /capitulos/{id}/final` | 4 MB |
| Profundidad JSON del cuerpo | 64 niveles (más → 400, nunca 422) |
| Documento: profundidad de nodos / nodos totales / largo de un texto | ≈ 30 por HTTP (ver nota) / 50 000 / 20 000 caracteres |

**Nota sobre la profundidad.** El validador admite 64 niveles de nodos, pero por HTTP manda antes el tope de 64 niveles JSON: cada nivel de nodos consume 2 niveles JSON (el objeto y su `content`). En la práctica un documento admite unos 30 niveles de nodos, es decir, unas **14 listas anidadas** (lista → ítem → lista …). Más que eso da **400 `entrada_invalida`**, nunca 422. Sobra para el manual. El 422 por profundidad solo se alcanza en llamadas directas al validador.
| `texOriginal`, `tex` | 1 a 1 048 576 bytes, UTF-8 válido |
| Sugerencias por guardado | 2 000 |
| `motivo`, `notaResolucion` | 0 a 2 000 caracteres |
| Texto de comentario | 1 a 4 000 caracteres |
| `rango.desde`/`rango.hasta` | enteros 0 a 10 000 000, `desde ≤ hasta` |
| CSV de importación | 100 filas como máximo |

### 1.5 Parámetros de ruta

- `{id}` es un entero positivo. Si no lo es, la ruta no casa y responde 404.
- `{uid}` es el `id` de una sugerencia y cumple `^[A-Za-z0-9:@+_-]{1,190}$`. Puede ir sin codificar (`u12:f1-p1:+0`) o con `encodeURIComponent` (`u12%3Af1-p1%3A%2B0`), porque el servidor aplica `rawurldecode` antes de validar (`+` sigue siendo `+`). Algo que decodificado tenga `/`, espacios, `.` u otros caracteres da 404.

### 1.6 Cabeceras de respuesta

Toda respuesta de la API lleva `Content-Security-Policy`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, `Permissions-Policy`, `Cache-Control: no-store` (salvo `GET …/base`) y `Strict-Transport-Security` si `COOKIE_SEGURA=1`.

---

## 2. Sesión, CSRF y roles

### 2.1 Flujo de login

1. `POST /api/sesion` con `{"correo": "...", "clave": "...", "sitio_web": ""}`.
   - `sitio_web` es un honeypot: el formulario lo deja oculto y vacío. Si viene lleno, responde 401 como una clave errónea.
   - Validación: `correo` es un texto no vacío de 254 caracteres como máximo; `clave` es un texto no vacío de 1 024 bytes como máximo. Si no, 400.
2. Si entra, responde 200:
   ```json
   {"usuario": {"id": 12, "nombre": "Ana Pérez", "laboratorio": "Laboratorio Norte", "roles": ["laboratorio"]}, "csrf": "<token>"}
   ```
   con `Set-Cookie`:
   - con `COOKIE_SEGURA=1`: `__Host-mm_sesion=<id>; Path=/; HttpOnly; SameSite=Strict; Secure`;
   - en desarrollo: `mm_sesion=<id>; Path=/; HttpOnly; SameSite=Strict`.

   La cookie es HttpOnly y el cliente no la toca: basta con `credentials: 'same-origin'`.
3. El cliente guarda `csrf` en memoria y lo manda como `X-CSRF-Token` en cada escritura. Al recargar la página lo recupera con `GET /api/sesion`.
4. `DELETE /api/sesion` (con CSRF) responde 204 y borra la cookie. Sin sesión válida responde 401 `sin_sesion`, como toda escritura, y el cliente puede darla por cerrada.

**Vencimiento.** La sesión vence a las 2 h sin actividad o a las 12 h desde el login. Después de eso, toda petición da 401 `sin_sesion` y la cookie se borra. Los roles y `activo` se releen de la base en cada petición: desactivar a alguien o cambiarle los roles rige de inmediato.

**Regenerar la clave cierra todas las sesiones de esa cuenta.** La sesión guarda una huella de la clave (16 caracteres hex del SHA-256 de `clave_hash`, nunca el hash) y la compara en cada petición. Tras `POST /admin/usuarios/{id}/clave`, cualquier sesión abierta de esa persona responde 401 `sin_sesion`, se destruye y su cookie se borra. Una cuenta desactivada también da 401 y su sesión se destruye en la primera petición que llegue. Si se desactiva y se reactiva sin que medie ninguna petición, la sesión sigue viva. Para expulsar a alguien con certeza (p. ej. cambio de responsable), hay que **regenerar la clave**.

**Bloqueo de login.**
- Se cuentan los intentos por cuenta (índice del correo) y por IP (`REMOTE_ADDR`).
- **5 fallos por cuenta** o **20 fallos por IP** producen un bloqueo de 60 s. El umbral de IP es más alto porque varios laboratorios pueden salir a Internet por la misma IP (NAT institucional). Los siguientes niveles son 300, 900 y 3 600 s, y el último se repite.
- El intento que bloquea responde 401; los siguientes responden 429 `demasiados_intentos` con `Retry-After`.
- Una clave sin actividad durante 24 h vuelve a cero.
- Un login correcto reinicia la cuenta y le resta un fallo a la IP.

### 2.2 401 frente a 403

- **401 `sin_sesion`**: no hay sesión, o venció. El cliente debe mostrar el login. Vale también para escrituras sin sesión, que no dan 403.
- **403 `csrf_invalido`**: hay sesión, pero falta el token o es incorrecto. El cliente debe recargar el token con `GET /sesion` y reintentar una vez.
- **403 `sin_permiso`**: el rol no alcanza. No hay que reintentar.

### 2.3 Roles

`laboratorio`, `revisor` y `admin`. Un usuario puede tener varios. "Cualquiera" en las tablas quiere decir cualquier usuario con sesión.

### 2.4 Clave de autor de las sugerencias

- La clave de autor es **`u<usuarioId>`**, p. ej. `u12`, y se calcula con `usuario.id` de la sesión.
- El cliente la pasa a `calcularSugerencias(base, copia, autor)`.
- El `id` de cada sugerencia debe empezar por `u<id>:` y seguir con al menos un carácter más; si no, responde 400 con `campos["sugerencias[i].id"]`.
- El `autor` que manda el cliente se exige, pero se descarta: en las lecturas, `autor` lo pone el servidor.

---

## 3. Etapas

Se calculan por fecha en cada petición, con la fila única de `consulta`:

| Etapa | Condición |
|---|---|
| `preparacion` | sin `apertura`, o `ahora < apertura` |
| `consulta` | `apertura ≤ ahora < cierre` |
| `edicion_final` | `ahora ≥ cierre` |

| Escritura | Etapa permitida |
|---|---|
| `POST /admin/capitulos`, `PUT /admin/consulta` (si cambian las fechas) | preparacion (durante la consulta solo se puede **extender** el cierre, §4.6) |
| `PUT …/copia`, `PATCH …/sugerencias/{uid}`, `POST …/comentarios`, `PATCH`/`DELETE /comentarios/{id}` | consulta |
| `PATCH /sugerencias/{id}`, `PATCH /comentarios/{id}/resolucion`, `PUT …/final` | edicion_final |

- Fuera de su etapa, una escritura responde 409 `etapa_no_permite` y no cambia nada.
- Las etapas de laboratorio y revisor no se solapan. Por eso un re-guardado de la copia conserva el `estado` de cada sugerencia sin riesgo de pisar una resolución.
- Las lecturas valen en cualquier etapa, salvo `GET …/aportes` (consulta y edicion_final) y `GET …/mis-aportes` (solo edicion_final).

Orden de comprobación en los endpoints: rol (401/403), etapa (409), capítulo o recurso (404) y entrada (400/422). En `PATCH /comentarios/{id}` y en las resoluciones la entrada se valida antes de buscar el id (rol, etapa, 400, 404). La validación no depende del id, así que eso no revela nada.

---

## 4. Endpoints

### 4.0 Resumen

| Método y ruta | Rol | Etapa | Respuesta |
|---|---|---|---|
| `GET /salud` | — | — | `{estado: "ok"}` |
| `POST /sesion` | — | — | 200 `{usuario, csrf}` · 401 · 429 |
| `GET /sesion` | cualquiera | — | 200 `{usuario, csrf}` · 401 `sin_sesion` |
| `DELETE /sesion` | cualquiera | — | 204 · 401 `sin_sesion` |
| `GET /consulta` | cualquiera | — | `{apertura, cierre, etapa, motivoObligatorio}` |
| `GET /capitulos` | cualquiera | — | lista de capítulos |
| `GET /capitulos/{id}/base` | cualquiera | — | `{versionId, docJson}` + `ETag` / 304 |
| `GET /capitulos/{id}/copia` | laboratorio | — | `{docJson, actualizado, versionId, sugerencias[]}` o `{docJson: null}` |
| `PUT /capitulos/{id}/copia` | laboratorio | consulta | 200 `{actualizado}` |
| `PATCH /capitulos/{id}/sugerencias/{uid}` | laboratorio dueño | consulta | 200 `{id, motivo}` |
| `GET /capitulos/{id}/comentarios` | laboratorio | — | los propios |
| `POST /capitulos/{id}/comentarios` | laboratorio | consulta | 201 `{id}` |
| `PATCH /comentarios/{id}` | laboratorio dueño | consulta | 200 `{id}` |
| `DELETE /comentarios/{id}` | laboratorio dueño | consulta | 204 |
| `GET /capitulos/{id}/mis-aportes` | laboratorio | edicion_final | `{sugerencias[], comentarios[]}` propios |
| `GET /capitulos/{id}/aportes` | revisor | consulta, edicion_final | `{sugerencias[], comentarios[]}` de todos |
| `PATCH /sugerencias/{id}` | revisor | edicion_final | 200 `{id}` |
| `PATCH /comentarios/{id}/resolucion` | revisor | edicion_final | 200 `{id}` |
| `PUT /capitulos/{id}/final` | revisor | edicion_final | 200 `{versionId}` |
| `GET /capitulos/{id}/final` | revisor | — | `{versionId, docJson, tex}` · 404 |
| `POST /admin/capitulos` | admin | preparacion | 201 `{id, versionId}` |
| `GET /admin/usuarios` | admin | — | lista de usuarios |
| `POST /admin/usuarios/importar` | admin | — | 201 `[{correo, clave}]` |
| `POST /admin/usuarios/{id}/clave` | admin | — | 200 `{clave}` |
| `PATCH /admin/usuarios/{id}` | admin | — | 200 `{id}` |
| `PUT /admin/consulta` | admin | preparacion (fechas) / consulta (solo extender el cierre) / cualquiera (motivo) | 200, igual que `GET /consulta` |

### 4.1 Consulta

**`GET /consulta`** devuelve:

```json
{"apertura": "2026-11-02T12:00:00Z", "cierre": "2026-11-12T12:00:00Z", "etapa": "consulta", "motivoObligatorio": false}
```

`motivoObligatorio` lo hace cumplir el cliente (1C): el servidor solo lo guarda y lo expone.

### 4.2 Capítulos

**`GET /capitulos`** devuelve los capítulos ordenados por `orden` e `id`:

```json
[{"id": 3, "orden": 1, "slug": "cap-1", "titulo": "Capítulo 1", "misCambios": 2, "misComentarios": 1}]
```

- `misCambios` cuenta las sugerencias propias y `misComentarios` los comentarios propios.
- Quien tiene rol `revisor` recibe además `totalSugerencias`, `totalComentarios` y `pendientes` (sugerencias pendientes más comentarios abiertos, de todos los laboratorios, sin filtrar por versión base).

**`GET /capitulos/{id}/base`** devuelve `{"versionId": 7, "docJson": {…}}`, la versión base vigente.
- Cabeceras: `ETag: "v7"` y `Cache-Control: private, max-age=0, must-revalidate`.
- `If-None-Match` acepta una lista separada por comas, el prefijo `W/` y `*`. Si coincide, responde 304 sin cuerpo.
- Si el capítulo no existe, 404.

### 4.3 Copia del laboratorio

**`GET /capitulos/{id}/copia`** (solo rol laboratorio; otro rol da 403):

```json
{"docJson": {…}, "actualizado": "2026-11-03T15:20:00Z", "versionId": 7,
 "sugerencias": [{"id": "u12:f1-p1:a", "bloqueId": "f1-p1", "base": {"desde": 0, "hasta": 4}, "copia": {"desde": 0, "hasta": 5},
                  "original": […], "propuesta": […], "tipo": "contenido", "autor": "u12", "motivo": "…", "estado": "pendiente"}]}
```

- Sin copia, responde `{"docJson": null}`.
- `versionId` es la versión base sobre la que está la copia. Si no coincide con el `versionId` de `GET …/base`, la copia es de una base anterior, y un `PUT` con ese `versionId` da 409 `version_obsoleta`.
- `sugerencias` trae solo las propias de esa versión, en orden de creación. `motivo` aparece solo si existe.

**`PUT /capitulos/{id}/copia`** con el cuerpo:

```json
{"versionId": 7, "docJson": {"type": "doc", "content": […]},
 "sugerencias": [{"id": "u12:f1-p1:a", "bloqueId": "f1-p1", "autor": "u12", "base": {"desde": 0, "hasta": 4}, "copia": {"desde": 0, "hasta": 5},
                  "original": [{"type": "text", "text": "hola"}], "propuesta": [{"type": "text", "text": "hola mundo"}], "tipo": "contenido"}]}
```

- Responde 200 `{"actualizado": "…Z"}`.
- Reemplaza la copia y **todo** el conjunto de sugerencias propias del capítulo en una sola transacción: las que no vienen se borran.
- Para las sugerencias que ya existían (mismo `uid`, con distinción de mayúsculas), se conservan su `motivo` y su `estado`.
- Las sugerencias nuevas toman el `motivo` del cuerpo, si viene.
- Campos de la sugerencia:
  - obligatorios: `id`, `bloqueId`, `base`, `copia`, `original`, `propuesta` y `tipo` ∈ `contenido`, `formato`, `bloque-insertado`, `bloque-eliminado`, además de `autor`;
  - opcionales: `profundidad`, `siguiente`, `primerHijo`, `grupo`, `orden` y `motivo`.
  - Cualquier otro campo se ignora (`estado`, `usuario_id`, …).
- Errores:
  - 400 con `campos["sugerencias[i].<campo>"]`;
  - 422 `documento_invalido` (el mensaje dice «Sugerencia i:») si los nodos no cumplen el esquema;
  - un `uid` repetido da 400;
  - un prefijo de autor ajeno da 400.
- Si pasaron más de 10 minutos desde la última instantánea, se guarda una nueva en `revisiones_copia`. Se conservan solo las **últimas 20** por laboratorio y capítulo: las más antiguas se borran en la misma transacción.

**`PATCH /capitulos/{id}/sugerencias/{uid}`** con `{"motivo": "…"}`:
- `motivo` tiene de 0 a 2 000 caracteres; vacío equivale a quitar el motivo.
- Solo actúa sobre sugerencias propias de la versión vigente.
- Responde 200 `{"id": "<uid>", "motivo": "…" | null}`. Si la sugerencia es ajena o no existe, 404.

### 4.4 Comentarios del laboratorio

- **`GET /capitulos/{id}/comentarios`** devuelve `[{"id": 5, "bloqueId": "f1-p1", "rango": {"desde": 0, "hasta": 2}, "texto": "…", "estado": "abierto", "creado": "…Z"}]`, solo los propios, en orden de `id`.
- **`POST /capitulos/{id}/comentarios`** con `{"bloqueId": "f1-p1", "rango": {"desde": 0, "hasta": 2}, "texto": "…"}` responde 201 `{"id": 5}`.
- **`PATCH /comentarios/{id}`** con `{"texto": "…"}` responde 200 `{"id": 5}`. Solo el texto es editable.
- **`DELETE /comentarios/{id}`** responde 204.
- Un comentario ajeno o inexistente da 404. Los campos extra (`usuario_id`, `estado`, `resuelto_por`, …) se ignoran.

### 4.5 Revisión

**`GET /capitulos/{id}/mis-aportes`** (laboratorio, solo en edicion_final) devuelve `{"sugerencias": […], "comentarios": […]}`, solo los propios, con `estado` y `notaResolucion`. Las sugerencias traen además `derivadaReunion` (bool: si se derivó a la reunión de revisión). No expone quién resolvió ni datos de otros laboratorios.

**`GET /capitulos/{id}/aportes`** (revisor, en consulta o edicion_final) devuelve `{"sugerencias": […], "comentarios": […]}` de todos los laboratorios y de todas las versiones base.

Cada sugerencia es el objeto del cliente más estos campos:

| Campo | Contenido |
|---|---|
| `id` | el uid del cliente |
| `sugerenciaId` | **id de fila**: es el que usa `PATCH /sugerencias/{id}` |
| `autor` | la clave de autor `u<id>` |
| `motivo` | solo si existe |
| `usuarioId`, `laboratorio` | el autor |
| `versionId` | la versión base de la sugerencia |
| `estado`, `notaResolucion`, `derivadaReunion`, `resueltoPor`, `resueltoEn` | la resolución |

Cada comentario: `{id, usuarioId, laboratorio, bloqueId, rango, texto, estado, notaResolucion, resueltoPor, resueltoEn, creado}`.

**`PATCH /sugerencias/{id}`** (`{id}` = `sugerenciaId`) con `{"estado": "aceptada", "notaResolucion": "…", "derivadaReunion": true}`:
- `estado` es obligatorio y uno de `pendiente`, `aceptada`, `rechazada` o `modificada`.
- **Cada PATCH reemplaza toda la resolución.** Si se omite `notaResolucion` (o viene `null` o vacía), la nota queda en NULL. Si se omite `derivadaReunion`, **vuelve a `false`**. El cliente debe reenviar siempre los tres campos.
- Con `pendiente` (reabrir), `resueltoPor` y `resueltoEn` quedan en NULL. Con los demás estados se guardan el revisor y la hora.
- Responde 200 `{"id": <sugerenciaId>}`. Si no existe, 404.

**`PATCH /comentarios/{id}/resolucion`** con `{"estado": "resuelto", "notaResolucion": "…"}`:
- `estado` es `abierto` o `resuelto`.
- La nota también se reemplaza: si se omite, queda en NULL.
- `abierto` limpia quién y cuándo resolvió. Nunca cambia el texto del comentario.
- Responde 200 `{"id": 5}`.

**`PUT /capitulos/{id}/final`** con `{"docJson": {…}, "tex": "…"}`:
- Crea una nueva versión `final`; las anteriores se conservan y la base vigente no cambia.
- Responde 200 `{"versionId": 9}`.
- Errores: 400 si `docJson` no es un objeto o si `tex` está vacío, no es texto o supera 1 MB; 422 si el documento no cumple el esquema.

**`GET /capitulos/{id}/final`** (revisor, cualquier etapa) devuelve `{"versionId": 9, "docJson": {…}, "tex": "…"}` de la última final. Si no hay final o el capítulo no existe, 404.

### 4.6 Administración

**`POST /admin/capitulos`** con `{"slug": "cap-1", "titulo": "…", "orden": 1, "texOriginal": "…", "docJson": {…}}`:
- Validación:
  - `slug` cumple `^[a-z0-9-]{1,80}$`;
  - `titulo` tiene de 1 a 255 caracteres;
  - `orden` es un entero de 0 a 100 000;
  - `texOriginal` va de 1 B a 1 MB;
  - `docJson` pasa por el validador del documento.
- La etapa se comprueba antes que el cuerpo: fuera de preparación da 409.
- Responde 201 `{"id": 3, "versionId": 7}`.
- Si el slug ya existe, actualiza `titulo` y `orden` y crea una nueva versión base.
- Dos subidas simultáneas del mismo slug pueden dar 409 `conflicto_concurrente`.

**`GET /admin/usuarios`** devuelve `[{"id", "nombre", "laboratorio", "correo", "roles", "activo"}]`, ordenado por laboratorio, nombre e id. El correo va descifrado.

**`POST /admin/usuarios/importar`** con `{"csv": "nombre,correo,laboratorio\nAna,ana@lab.cl,Lab Norte"}`:
- El encabezado debe ser exactamente `nombre,correo,laboratorio`, sin distinguir mayúsculas. El separador puede ser `,` o `;` y se detecta en la primera línea.
- Se aceptan un BOM UTF-8 opcional y comillas CSV. El texto debe ser UTF-8, y las líneas en blanco se ignoran.
- **Máximo 100 filas por importación.**
- Si hay cualquier línea inválida o un correo repetido (en el CSV o ya existente), responde 400 con los números de línea física y no crea ninguna cuenta.
- Responde 201 `[{"correo": "ana@lab.cl", "clave": "Xy7…"}]`. Las claves (16 caracteres) **se muestran una sola vez**.

**`POST /admin/usuarios/{id}/clave`** responde 200 `{"clave": "…"}` con una clave regenerada. Si el usuario no existe, 404. **Cierra todas las sesiones abiertas de esa cuenta** (§2.1).

**`PATCH /admin/usuarios/{id}`** con `{"activo"?: bool, "roles"?: ["laboratorio", …]}`:
- Hace falta al menos uno de los dos campos; `roles` debe ser una lista no vacía de roles válidos.
- Responde 200 `{"id"}`.
- Un admin no puede desactivarse ni quitarse `admin` a sí mismo: 409 `operacion_no_permitida`.

**`PUT /admin/consulta`** con `{"apertura": "…", "cierre": "…", "motivoObligatorio": false}`:
- Los tres campos son obligatorios.
- Reglas de las fechas:
  - `cierre > apertura`;
  - `apertura ≥ ahora − 5 min` (si no, 400 en `apertura`); una apertura igual a "ahora" abre la consulta al instante;
  - `cierre > ahora` (si no, 400 en `cierre`).
- Fuera de preparación:
  - si las fechas son **iguales** a las guardadas, solo cambia `motivoObligatorio` (200);
  - **durante la consulta se puede extender el cierre** («ampliamos una semana»): misma `apertura` que la guardada (el mismo instante, en cualquier zona), `cierre` posterior al cierre actual y a la hora actual. Responde 200 y también guarda `motivoObligatorio`. No altera ninguna etapa ya vivida;
  - cualquier otro cambio (acortar el cierre, mover la apertura, o extender una vez cerrada la consulta, ya en edicion_final) responde 409 `etapa_no_permite` y no cambia nada.

  Por eso el cliente puede reenviar siempre los tres campos.
- Responde 200 con el mismo cuerpo que `GET /consulta`.

---

## 5. Primer administrador

El correo se guarda **cifrado** (`correo_cifrado`) y se busca por un índice ciego (`correo_indice`), y la clave va con Argon2id. Por eso **un `INSERT` escrito a mano no sirve**: hay que generarlo con las mismas claves que producción.

1. En una máquina con Docker, crear `servidor/.env` con **las mismas** `CLAVE_CIFRADO` y `CLAVE_INDICE` que el `.env` de producción.
2. Ejecutar:
   ```
   docker compose run --rm php php bin/crear-admin.php --sql "Nombre Apellido" admin@inia.cl "Administración"
   ```
   El comando no se conecta a ninguna base. Imprime un `INSERT INTO usuarios (...) VALUES (CONVERT(0x… USING utf8mb4), …, 0x…, 0x…, …, 1);`, con todos los valores en hexadecimal (no depende del charset de la sesión de phpMyAdmin), y después el correo y la **clave generada**, que se muestra una sola vez.
3. Pegar el `INSERT` en phpMyAdmin (pestaña SQL) sobre la base de producción.
4. Entrar con ese correo y esa clave. Los demás usuarios se crean desde `POST /admin/usuarios/importar`.

En desarrollo, sin `--sql`, el comando inserta directamente en la base del entorno.

---

## 6. Checklist de despliegue

Revisar cada punto antes de abrir el sitio:

- [ ] **HTTPS** activo en el dominio, con certificado válido.
- [ ] **Redirección HTTP → HTTPS (301).** El `.htaccess` de `public/` ya redirige toda visita `http://` a `https://`, salvo `localhost`/`127.0.0.1` (desarrollo). Además, activar **«Force HTTPS Redirect»** del dominio en cPanel (*Dominios*); tener ambos no causa problemas. Comprobar después: `curl -I http://<dominio>/api/salud` → `301` con `Location: https://<dominio>/api/salud`. Detrás de un proxy que termina TLS (Cloudflare en modo «Flexible»), el origen ve siempre HTTP y la redirección entraría en bucle: usar el modo «Full (strict)».
- [ ] **`COOKIE_SEGURA=1`** en el `.env` de producción. **Es obligatorio, porque falla abierto:** sin él, la cookie sale sin `Secure` ni el prefijo `__Host-` y no se emite HSTS. El valor por defecto es 0 para que funcione el desarrollo local sin HTTPS. **Con `COOKIE_SEGURA=1` el sitio debe servirse solo por HTTPS:** por HTTP el navegador descarta la cookie `__Host-`/`Secure`, así que el login responde 200 pero la sesión no persiste (de ahí el punto anterior).
- [ ] **Paquete de producción con `vendor/` sin dependencias de desarrollo.** En la máquina con Docker, desde la raíz del repo:
  ```
  docker compose --profile herramientas run --rm composer install --no-dev --optimize-autoloader --classmap-authoritative
  ```
  Eso deja en `servidor/vendor/` solo el autoload (sin phpunit) y regenera `vendor/composer/platform_check.php`, que corta el arranque con un mensaje claro si al PHP del hosting le falta `mbstring`, `pdo_mysql` o `sodium`. Se arma el paquete con `bin/`, `config/`, `migraciones/`, `public/`, `src/`, `vendor/` y `composer.json`, sin `tests/`, `phpunit.xml`, `var/` ni `.env`. Después, para volver al entorno de desarrollo: `docker compose --profile herramientas run --rm composer install`.
- [ ] **Qué se sube y dónde** (Administrador de archivos o FTP de cPanel; no hay SSH). `public/index.php` busca `../vendor/autoload.php` y `../.env`, así que el resto del servidor va **en la carpeta padre de la raíz web**:
  - **Recomendado:** un subdominio o dominio adicional con su *Document Root* apuntando a `/home/<usuario>/manualmetodos/public`. Se sube el paquete completo a `/home/<usuario>/manualmetodos/` y `public/` queda como raíz web.
  - **Si la raíz web es fija** (`public_html`): el contenido de `public/` (`index.php`, `.htaccess` y, en 1C, la SPA) va a `public_html/`, y `bin/`, `config/`, `migraciones/`, `src/`, `vendor/`, `composer.json` y `.env` van a `/home/<usuario>/`, al lado de `public_html` y fuera de ella.
  - El `.env` de producción se crea a mano en el servidor (no viaja en el paquete) y `var/sesiones` se crea sola (ver más abajo).
- [ ] **`.env` fuera de la raíz web.** Solo `servidor/public/` se publica (es la raíz web o se apunta el dominio a ella). `src/`, `config/`, `vendor/`, `migraciones/`, `bin/`, `var/` y `.env` quedan un nivel arriba. Comprobar que `https://<dominio>/.env` y `https://<dominio>/../.env` no devuelven nada. El `.htaccess` además niega `.env`, `.sql`, `.lock` y `composer.json`.
- [ ] **Claves**: `CLAVE_CIFRADO` y `CLAVE_INDICE` tienen 32 bytes aleatorios en base64 cada una y son **distintas entre sí**: el servidor no arranca si coinciden o no miden 32 bytes. Se generan así:
  ```
  docker compose run --rm php php -r "echo base64_encode(random_bytes(32)), PHP_EOL;"
  ```
  (o `openssl rand -base64 32`), una vez por clave. **Hay que respaldarlas fuera del servidor:** si se pierden, los correos guardados no se pueden descifrar ni buscar y nadie puede entrar.
- [ ] **PHP 8.2 a 8.4** en el selector del hosting, con `pdo_mysql`, `mbstring`, `sodium` y `json` (los tres primeros están en `require` de `composer.json` y los verifica `platform_check.php`). Se usa Argon2id (19 MiB, t=2, 1 hilo: unos 19 MB por login simultáneo, dentro de los 512 MB de la cuenta) si `PASSWORD_ARGON2ID` está disponible; si no, bcrypt con costo 12 de forma automática (los hashes existentes siguen funcionando: cada hash dice su algoritmo). APCu es opcional (caché de documentos base).
- [ ] **`post_max_size` y `upload_max_filesize` ≥ 4M** (los capítulos y las finales admiten hasta 4 MB). Si PHP descarta el cuerpo, la API responde 413. Recomendado: `max_execution_time` ≥ 120 para importar 100 usuarios (cada clave es un hash Argon2id).
- [ ] **`servidor/var/sesiones` escribible** por PHP. La carpeta se crea sola con permisos 0700. Si el hosting no lo permite, toda petición a `/api` da 500 y el `error_log` lo indica: crearla por FTP con permisos 0700 (o 0750) para el usuario de PHP.
- [ ] **Base de datos: MariaDB 10.6** (el charset por defecto del servidor es latin1). Importar `servidor/migraciones/001_inicial.sql` **tal cual** en phpMyAdmin, sin convertir ni cambiar el charset: cada tabla declara `utf8mb4`, y las columnas de identificadores, `utf8mb4_bin`. La conexión usa `charset=utf8mb4` en `BD_DSN` (`mysql:host=localhost;dbname=…;charset=utf8mb4`). Re-importar el archivo no hace daño (`CREATE TABLE IF NOT EXISTS`, `INSERT IGNORE`).
- [ ] **Usuario de la base con privilegios mínimos.** En *Bases de datos MySQL* de cPanel, el asistente marca ALL PRIVILEGES por defecto: hay que desmarcarlo y dar al usuario de la app (el de `BD_USUARIO`/`BD_DSN`) **solo `SELECT`, `INSERT`, `UPDATE` y `DELETE`** sobre la base de la app, sin `CREATE`, `ALTER`, `DROP`, `INDEX`, `TRIGGER` ni otros. La app nunca necesita DDL. La importación de `001_inicial.sql` (que sí hace `CREATE TABLE`) se hace en phpMyAdmin con el usuario de cPanel, que tiene todos los permisos. Si alguna vez se importa con el usuario de la app, darle `CREATE` y `ALTER` solo durante la importación y quitárselos después.
- [ ] **Primer administrador** con `bin/crear-admin.php --sql` (§5). Un INSERT a mano no sirve.
- [ ] **Proxy o Cloudflare** delante del hosting:
  - El bloqueo de login por IP usa `REMOTE_ADDR` y no confía en `X-Forwarded-For`. Detrás de un proxy, todos los usuarios comparten la IP del proxy, y 20 fallos de cualquiera bloquean el login de todos durante 1 a 60 min. Si hay proxy, hay que restaurar la IP real a nivel de servidor (p. ej. `mod_remoteip` con la lista de IP de Cloudflare) **antes** de abrir.
  - Si el proxy reescribe la cabecera `Host` y no coincide con el `Origin` del navegador, toda escritura da un **403 `origen_invalido`** falso. El proxy debe conservar el `Host` original.
  - Una oficina con NAT (una IP para muchos) comparte el contador de IP. Por eso su umbral es 20 (el de cuenta sigue en 5). Es aceptable a esta escala.
- [ ] **Zona horaria**: `ZONA_HORARIA=America/Santiago` solo afecta a PHP. La base y la API trabajan en UTC.
- [ ] **Prueba rápida después de desplegar**:
  - `http://<dominio>/api/salud` → 301 a `https://<dominio>/api/salud`;
  - `GET /api/salud` → 200;
  - `GET /api/sesion` → 401 `sin_sesion`;
  - login con el admin → 200 con `Set-Cookie: __Host-mm_sesion=…; Secure`;
  - `PUT /api/admin/consulta` desde el navegador → sin 403 `origen_invalido`.
