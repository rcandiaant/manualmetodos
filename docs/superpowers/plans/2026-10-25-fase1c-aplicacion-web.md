# Fase 1C — Aplicación web: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que laboratorios, revisores y administradores usen la plataforma de punta a punta contra el servidor real:
- el laboratorio edita su copia con control de cambios, comenta y explica sus cambios;
- el revisor ve todos los aportes, decide, redacta y genera el `.tex` final;
- el administrador carga capítulos, cuentas y fechas.

**Architecture:** Aplicación de una sola página (SPA) en TypeScript sin framework de UI, igual que la demo de la Fase 0, compilada con Vite. Vive en `cliente/src/app/` y usa sin cambios el motor (`src/cambios/`, `src/latex/`, `src/esquema/`).
- Las piezas de editor reutilizables de la demo pasan a `src/editor/`, y la demo se elimina.
- Todo el acceso al servidor pasa por un único cliente HTTP (`src/app/api.ts`), que aplica el contrato de `docs/api.md`.
- La navegación usa rutas con `#` (`#/capitulos`, `#/capitulo/3`, …), así que no hace falta reescritura en el servidor.

**Tech Stack:** el de la Fase 0/1A (TypeScript strict, Vite, Vitest + jsdom, TipTap/ProseMirror, KaTeX) más **MathLive** (MIT), cargado a pedido, para editar fórmulas. El servidor de desarrollo es el Docker del plan 1B (`docker compose up -d`, puerto 8080).

**Spec:** `docs/superpowers/specs/2026-10-23-plataforma-consulta-manual-design.md` (§4 roles, §5.1–§5.3 experiencia de uso, §6.2 editor, §8 seguridad del lado del cliente, §12). Además:
- **contrato de la API:** `docs/api.md`, que es vinculante;
- **vista del revisor:** la recomendación de `docs/fase1-escala.md`;
- **limitaciones conocidas del motor:** `docs/fase0-resultado.md` §4.

**Hoja de ruta:** 1A y 1B están integrados en `main`. Este plan consume sus interfaces. El plan 1D (informe en pantalla e imprimible, empaquetado `.zip` + `.sql`, cron y despliegue) viene después.

## Global Constraints

- **Reglas del usuario:**
  - sin pausas entre tareas;
  - commits al final, uno atómico por tarea, mostrados antes de crearlos;
  - Conventional Commits;
  - identidad git `rcandiaa87 <rodrigo.candia@inia.cl>`, con push por la cuenta `rcandiaant`;
  - trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` y la línea `Claude-Session`;
  - rama `feat/fase1c-app` desde `origin/main`.
- **`docs/api.md` es el contrato.** Si el cliente necesita algo que el contrato no da, la tarea se detiene y lo reporta (NEEDS_CONTEXT). No inventa endpoints ni cambia el servidor.
- **Cabeceras:**
  - toda petición con cuerpo lleva `Content-Type: application/json`;
  - toda escritura lleva `X-CSRF-Token`;
  - `credentials: 'same-origin'`;
  - el `csrf` vive solo en memoria y se recupera con `GET /api/sesion` al recargar.
- **CSP del servidor:** `script-src 'self'`; `style-src 'self' 'unsafe-inline'`; `img-src 'self' data:`; `font-src 'self'`; `connect-src 'self'`. Por eso:
  - nada de CDN, scripts inline, `eval` ni `new Function`;
  - las fuentes de KaTeX y MathLive se empaquetan con Vite;
  - MathLive debe configurarse para no cargar nada de fuera (fuentes y sonidos locales o desactivados).
- **Sin HTML de usuario:**
  - nunca se usa `innerHTML` con texto que venga del servidor o del documento;
  - el DOM se arma con `textContent` y `createElement` (helper `el` de la demo);
  - KaTeX corre con `trust: false`.
- **Autor:** la clave de autor es `u<usuario.id>` (contrato §2.4).
- **Base congelada:** la aplicación nunca modifica la base.
- **Principio rector (anti-objetivo 1):** el trabajo del laboratorio nunca se pierde en silencio. Toda edición queda guardada en el servidor o en un borrador local visible con su estado.
- **Interfaz:**
  - textos visibles en español;
  - escritorio moderno (Chrome, Edge, Firefox y Safari recientes); en móvil basta con leer;
  - accesibilidad básica: botones con texto, foco visible, `role="alert"` en los errores.
- Solo dependencias MIT/BSD/ISC/Apache; sin TipTap Pro.
- **Desarrollo:**
  - `npm run dev` levanta Vite con proxy de `/api` a `http://localhost:8080`;
  - el proxy usa `changeOrigin: false`, así `Host` y `Origin` coinciden y el servidor no responde 403 `origen_invalido`;
  - la sesión de desarrollo usa la cookie `mm_sesion` (sin `Secure`).
- `manual-fuente/` nunca se versiona.

## Review Focus

1. **La sesión vence (401) o el servidor no responde mientras el laboratorio edita.** No se pierde ninguna edición:
   - el borrador queda en `localStorage` con su estado visible ("Sin guardar: sin conexión, reintentando" o "Sesión vencida: vuelva a entrar");
   - tras volver a entrar, se guarda solo.

   → test `autoguardado conserva el borrador ante 401 y fallo de red` (Task 3).
2. **La consulta se cierra con la página abierta** (409 `etapa_no_permite` al guardar). La vista pasa a solo lectura con un mensaje claro, y el borrador no guardado se ofrece para copiar.

   → test `cierre de la consulta pasa a solo lectura` (Task 3).
3. **El token CSRF falta o es incorrecto** (403 `csrf_invalido`). El cliente recarga el token con `GET /sesion` y reintenta una sola vez. `sin_permiso` nunca se reintenta.

   → test `csrf invalido se reintenta una vez` (Task 1).
4. **El revisor decide sobre un bloque movido** (grupo). Una sola acción decide todos los miembros (varios PATCH). Si uno falla, la interfaz lo muestra y no deja el grupo a medias sin aviso.

   → test `decision de grupo envía todos los miembros y avisa fallos parciales` (Task 7).
5. **Fechas en hora de Chile.** El administrador escribe "12/11/2026 09:00" en `America/Santiago`. Se envía con su desfase correcto (horario de verano incluido) y se muestra igual al volver.

   → test `fechas de la consulta respetan America/Santiago y el horario de verano` (Task 8).

---

## Estructura de archivos

```
cliente/
├── index.html                    # shell de la app (reemplaza el de la demo)
├── vite.config.ts                # + server.proxy /api → :8080 (changeOrigin false)
├── src/
│   ├── editor/                   # movido desde src/demo/ (reutilizable)
│   │   ├── editor.ts             # extensiones, Enter/pegado (R27), correcciones de bid
│   │   ├── decoraciones.ts       # marcas de cambios (laboratorio) y superposición (revisor)
│   │   ├── ui.ts                 # el(), boton(), cajas de error y aviso, resumen de cambios
│   │   ├── barra.ts              # T3 barra de herramientas
│   │   ├── formulas.ts           # T4 MathLive a pedido
│   │   └── estilos.css
│   ├── app/
│   │   ├── main.ts               # arranque: sesión → router
│   │   ├── api.ts                # T1 cliente HTTP del contrato
│   │   ├── tipos-api.ts          # T1 DTO del contrato
│   │   ├── router.ts             # T1 rutas hash
│   │   ├── sesion.ts             # T2 login, sesión, logout
│   │   ├── inicio.ts             # T2 lista de capítulos + etapa
│   │   ├── laboratorio/{vista,autoguardado,panel,comentarios}.ts  # T3, T5
│   │   ├── revisor/{vista,panel,decisiones,final}.ts              # T6, T7
│   │   └── admin/{capitulos,usuarios,consulta}.ts                 # T8
│   └── (cambios/, latex/, esquema/ sin cambios)
├── scripts/humo-api.ts           # T9 prueba de humo contra el servidor Docker
└── tests/app/…                   # tests jsdom con fetch simulado
docs/guia-uso.md                  # T9 guía breve por rol
```

## Interfaces compartidas (las produce la Task 1 y las consumen todas)

- `class ErrorApi extends Error { estado: number; codigo: string; campos?: Record<string,string> }`
- `interface Api`:
  - `get<T>(ruta, opciones?: {etag?: string})`
  - `post<T>`, `put<T>`, `patch<T>`
  - `del(ruta)`

  Todas usan rutas relativas a `/api` y lanzan `ErrorApi` ante cualquier respuesta distinta de 2xx o 304. `get` con `etag` devuelve `{noModificado: true}` si recibe 304.
- `crearApi(opciones: { fetch?: typeof fetch; alSinSesion: () => void }): Api`:
  - mantiene el `csrf` en memoria (`fijarCsrf`, `csrfActual`);
  - ante un 403 `csrf_invalido` llama `GET /sesion`, actualiza el token y reintenta una vez;
  - ante un 401 `sin_sesion` llama `alSinSesion` y lanza el error.
- `tipos-api.ts`: los DTO del contrato con los nombres exactos de `docs/api.md`. Entre ellos:
  - `Usuario`, `Consulta`, `Etapa`;
  - `CapituloLista`, `Base`, `Copia`;
  - `SugerenciaServidor` (`Sugerencia` + `estado?`, `motivo?`, `sugerenciaId?`, `usuarioId?`, `laboratorio?`, `versionId?`, `notaResolucion?`, `derivadaReunion?`, `resueltoPor?`, `resueltoEn?`);
  - `Comentario`, `Aportes`, `UsuarioAdmin`.
- `router.ts`: `definirRutas(tabla: Record<string, (params) => Vista>)`, `navegar(hash)`. Cada `Vista` tiene `{ montar(raiz): void; desmontar(): void | Promise<void> }`. Antes de cambiar de vista se llama `desmontar` y se espera a que termine, por ejemplo para que el autoguardado haga su último envío.

---

### Task 1: Base de la aplicación — reorganización, cliente HTTP y router

**Files:**
- Move: `cliente/src/demo/{editor,decoraciones,ui}.ts` y `estilos.css` → `cliente/src/editor/`.
- Delete: el resto de `cliente/src/demo/` (`main.ts`, `laboratorio.ts`, `revisor.ts`, `almacen.ts`).
  - Sus tests se trasladan si prueban piezas movidas (decoraciones, editor, bloques nuevos) y se eliminan si prueban el almacén local.
  - La prueba jsdom de tarjetas de grupo (`demo-movidos.test.ts`) se reescribe en la Task 7.
- Create: `cliente/src/app/{main,api,tipos-api,router}.ts`, `cliente/index.html` nuevo, `cliente/tests/app/{api,router}.test.ts`.
- Modify: `cliente/vite.config.ts` (proxy de desarrollo), `cliente/package.json` si hace falta.

**Interfaces:** las de la sección "Interfaces compartidas".

- [ ] **Step 1: Tests (fetch simulado):**
  - `api agrega Content-Type, credentials y X-CSRF-Token en escrituras`
  - `api no manda X-CSRF-Token en GET`
  - `csrf invalido se reintenta una vez` (403 `csrf_invalido` → `GET /sesion` → reintento OK; un segundo 403 lanza `ErrorApi`)
  - `sin_permiso no se reintenta`
  - `401 llama alSinSesion`
  - `304 con etag devuelve noModificado`
  - `error sin cuerpo JSON da ErrorApi con codigo error_interno`
  - `router monta la vista de la ruta y espera desmontar antes de cambiar`
  - `ruta desconocida va a #/capitulos`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar y mover los archivos. `npm test` y `npm run typecheck` en verde, con todos los tests del motor intactos. **Step 4:** `npm run dev` con el Docker del 1B levantado: una página vacía que hace `GET /api/salud` muestra "ok". Es una comprobación manual; anotar el resultado en el informe.

---

### Task 2: Sesión, login e inicio

**Files:**
- Create: `cliente/src/app/{sesion,inicio}.ts`, `cliente/tests/app/{sesion,inicio}.test.ts`

**Interfaces:**
- `sesion.ts`:
  - `iniciar(api): Promise<Usuario | null>` (`GET /sesion`);
  - `entrar(api, correo, clave): Promise<Usuario>`;
  - `salir(api)`;
  - `usuarioActual(): Usuario | null`;
  - `claveAutor(u): string` = `u${u.id}`;
  - `tieneRol(u, rol)`.
- `inicio.ts` es una Vista que muestra:
  - un banner de etapa, con las fechas de `GET /consulta` en hora de Chile;
  - la lista de `GET /capitulos`, con contadores propios y, para el revisor, totales y pendientes;
  - por rol, un enlace al editor (`#/capitulo/{id}`), a la revisión (`#/revisar/{id}`) y al menú de administración.

**Pantalla de login:**
- campos correo y clave;
- campo trampa `sitio_web` oculto con CSS (no `type=hidden`), `tabindex=-1` y `autocomplete=off`;
- con 429, el mensaje dice cuánto esperar según `Retry-After`;
- con 401 `credenciales_invalidas`, un único mensaje genérico;
- no hay "olvidé mi clave": un texto indica contactar al administrador (spec §4).

- [ ] **Step 1: Tests:**
  - `login exitoso guarda usuario y csrf y navega a inicio`
  - `login fallido muestra mensaje generico`
  - `429 muestra espera en minutos`
  - `honeypot existe y viaja vacio`
  - `recarga recupera la sesion con GET /sesion`
  - `401 en cualquier vista vuelve al login conservando la ruta pedida`
  - `inicio muestra etapa y fechas en America/Santiago`
  - `inicio muestra enlaces segun roles`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS.

---

### Task 3: Editor del laboratorio con autoguardado

**Files:**
- Create: `cliente/src/app/laboratorio/{vista,autoguardado}.ts`, `cliente/src/editor/barra.ts`, `cliente/tests/app/laboratorio/{autoguardado,vista}.test.ts`

**Interfaces:**
- `autoguardado.ts`:
  - `crearAutoguardado(opciones: { api; capituloId; versionId; base: DocJSON; autor: string; esperaMs?: number /* 2000 */; reloj?; almacen?: Storage })`
  - devuelve `{ cambio(copia: DocJSON): void; guardarYa(): Promise<void>; estado(): EstadoGuardado; alCambiarEstado(fn): void; detener(): Promise<void> }`.
  - `EstadoGuardado = 'guardado' | 'pendiente' | 'guardando' | 'sin-conexion' | 'sesion-vencida' | 'cerrada' | 'error'`. Incluye `ultimoGuardado?: Date` y un mensaje.
  - Al guardar calcula `calcularSugerencias(base, copia, autor)` y hace `PUT /capitulos/{id}/copia` con `{versionId, docJson, sugerencias}`.
  - Antes de cada envío escribe el borrador en `localStorage` (clave `mm:borrador:<usuarioId>:<capituloId>:<versionId>`) y lo borra al confirmar.
  - Si falla la red: reintentos con espera creciente (2, 4, 8 s, hasta 60 s).
  - Si responde 401: estado `sesion-vencida`; reintenta tras volver a entrar.
  - Si responde 409 `etapa_no_permite`: estado `cerrada`, sin más reintentos.
  - Si responde 409 `version_obsoleta`, 413 o 422: estado `error`, con el mensaje del servidor y sin reintentos.
- **Vista `#/capitulo/{id}`** (rol laboratorio):
  - carga `GET …/base` y `GET …/copia`;
  - si hay un borrador local más nuevo que `actualizado`, ofrece "Recuperar borrador no guardado" o "Descartarlo";
  - monta el editor TipTap con las extensiones de `src/editor/editor.ts` y las marcas de cambios de `decoraciones.ts`;
  - muestra el indicador "Guardado hace N s" o el estado correspondiente;
  - es de solo lectura fuera de la etapa `consulta`.
- **Barra (`barra.ts`), según spec §5.1:**
  - negrita, cursiva, subíndice y superíndice (exclusivos entre sí);
  - lista numerada y con viñetas, con sangría y quitar sangría para anidar;
  - tabla: insertar, agregar o quitar fila y columna;
  - nota al pie: insertar, y editarla en un panel lateral con su propio mini-editor sobre `attrs.bloques`;
  - símbolos (° ± ≤ ≥ µ · × →);
  - "Referenciar ítem": lista los ítems con `etiqueta` del capítulo e inserta un nodo `referencia`;
  - "Comentar" (lo implementa la Task 5);
  - "Fórmula" (lo implementa la Task 4).

  Los bloques `especial` se ven grises y no se pueden editar (spec §5.1).

- [ ] **Step 1: Tests:**
  - `autoguardado espera 2 s y envia sugerencias calculadas con autor u<id>`
  - `autoguardado conserva el borrador ante 401 y fallo de red` (borrador en `localStorage`, estados visibles, reenvío al recuperar)
  - `cierre de la consulta pasa a solo lectura` (409 `etapa_no_permite` → `cerrada`, editor no editable, borrador ofrecido para copiar)
  - `version_obsoleta muestra error sin reintentar`
  - `desmontar hace el ultimo guardado`
  - `recuperar borrador mas nuevo que el servidor`
  - `barra: referencia insertada es nodo atomico con la etiqueta elegida`
  - `barra: sub y sup se excluyen`
  - `especial no editable`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS. Comprobación manual contra Docker: un laboratorio edita, recarga y ve sus cambios. Anotar en el informe.

---

### Task 4: Fórmulas con MathLive

**Files:**
- Create: `cliente/src/editor/formulas.ts`, `cliente/tests/app/formulas.test.ts`
- Modify: `cliente/package.json` (dependencia `mathlive`, versión estable vigente con licencia MIT), `cliente/src/editor/barra.ts`

**Interfaces:**
- `abrirEditorFormula(opciones: { latex: string; enBloque: boolean }): Promise<string | null>`:
  - abre un diálogo propio (no `prompt`) con un `<math-field>` de MathLive y vista previa KaTeX;
  - devuelve el LaTeX nuevo, o `null` si se cancela.
- MathLive se carga con `import()` dinámico solo al abrir el diálogo, configurado sin recursos externos (fuentes empaquetadas o del sistema y sonidos desactivados).
- Clic en un nodo `matematica` o `ecuacion` → abre el diálogo → reemplaza `attrs.latex`. El botón "Fórmula" de la barra inserta una nueva.

- [ ] **Step 1: Tests** (con jsdom y MathLive simulado: se prueba el contrato del diálogo, no MathLive):
  - `clic en matematica abre dialogo con su latex`
  - `aceptar reemplaza attrs.latex`
  - `cancelar no cambia nada`
  - `mathlive se importa solo al abrir`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS. `npm run build` termina sin errores. Revisar en el bundle que MathLive no haga peticiones a dominios externos: buscar `https://` en el chunk de MathLive y documentar lo encontrado.

---

### Task 5: Panel del laboratorio — cambios, motivos y comentarios

**Files:**
- Create: `cliente/src/app/laboratorio/{panel,comentarios}.ts`, `cliente/tests/app/laboratorio/{panel,comentarios}.test.ts`

**Interfaces y comportamiento:**
- **Panel lateral de "Mis cambios":**
  - lista las sugerencias agrupadas por unidad (`unidades()` de `src/editor/ui.ts`; un bloque movido cuenta como una sola);
  - clic en un cambio → resalta y desplaza el editor;
  - campo "Motivo" por cambio, que se guarda con `PATCH /capitulos/{id}/sugerencias/{uid}` al salir del campo (con espera);
  - si `motivoObligatorio` es true, los cambios sin motivo se marcan, y la cabecera muestra "N cambios sin motivo". El guardado nunca se bloquea: el principio rector manda.
  - Avisos de estructura no cubiertos (`avisosNoCubiertos`) en una caja `role="alert"`.
- **Comentarios:**
  - al seleccionar texto, "Comentar" crea el comentario con `POST /capitulos/{id}/comentarios` (`bloqueId` del bloque y `rango` en tokens, con las funciones de `decoraciones.ts`);
  - los comentarios propios se listan, se editan (`PATCH /comentarios/{id}`) y se borran (`DELETE`);
  - cada comentario queda anclado visualmente a su bloque;
  - en un bloque `especial` también se puede comentar (spec §5.1).
- **En `edicion_final`:** el panel muestra `GET …/mis-aportes`: el estado de cada aporte (pendiente, aceptado, rechazado, modificado o derivado a reunión) y su nota de resolución.

- [ ] **Step 1: Tests:**
  - `panel agrupa bloque movido como una unidad`
  - `motivo se guarda con PATCH al salir del campo`
  - `motivo obligatorio marca cambios sin motivo sin bloquear el guardado`
  - `comentar seleccion envia bloqueId y rango`
  - `editar y borrar comentario propio`
  - `comentario en bloque especial`
  - `edicion final muestra estados y notas de mis aportes`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS.

---

### Task 6: Revisor I — vista de aportes por bloque

**Files:**
- Create: `cliente/src/app/revisor/{vista,panel}.ts`, `cliente/tests/app/revisor/{panel,vista}.test.ts`

**Interfaces y comportamiento** (según `docs/fase1-escala.md`, "Recomendación"):
- La vista `#/revisar/{id}` (rol revisor) carga `GET …/base` y `GET …/aportes`.
- **Documento base** con las sugerencias de todos los laboratorios superpuestas, un color por laboratorio (`decoracionesRevisor`). Los colores son estables por `usuarioId`, con una paleta de al menos 12 colores distinguibles y letra o abreviatura del laboratorio para quien no distingue colores.
- **Panel por bloque:**
  - cada bloque con aportes muestra un contador de laboratorios distintos;
  - las **propuestas idénticas** de varios laboratorios (mismo tipo, original y propuesta) se colapsan en una fila con la lista de laboratorios.
  - `agruparPorBloque(sugerencias: SugerenciaServidor[]): GrupoBloque[]` es una función pura y se prueba aparte.
- **Cola de conflictos:** `detectarConflictos` sobre las sugerencias pendientes, ordenados por posición en el documento, con la propuesta de cada laboratorio lado a lado.
- **Filtros:** por laboratorio, "solo conflictos" (opcional, no por defecto), "solo pendientes", y cambios o comentarios. El filtro se recuerda en la URL (`#/revisar/3?lab=12&solo=conflictos`).
- Los comentarios de todos los laboratorios aparecen anclados a su bloque.
- **Solo lectura en `consulta`:** el revisor puede mirar el avance, pero las decisiones se habilitan en `edicion_final` (contrato §3).

- [ ] **Step 1: Tests:**
  - `agruparPorBloque colapsa propuestas identicas y cuenta laboratorios distintos`
  - `colores estables por usuarioId y letra visible`
  - `cola de conflictos en orden de documento`
  - `filtro por laboratorio y solo pendientes`
  - `filtro en la url se restaura al recargar`
  - `en consulta las decisiones estan deshabilitadas`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS.

---

### Task 7: Revisor II — decisiones, versión final y exportación

**Files:**
- Create: `cliente/src/app/revisor/{decisiones,final}.ts`, `cliente/tests/app/revisor/{decisiones,final}.test.ts`

**Interfaces y comportamiento:**
- **Decisiones:**
  - Por aporte (o fila colapsada): aceptar, rechazar, derivar a reunión, nota de resolución.
  - Cada acción hace `PATCH /sugerencias/{sugerenciaId}` reenviando siempre `estado`, `notaResolucion` y `derivadaReunion` (contrato §4.5).
  - Una fila colapsada decide a la vez todas sus sugerencias idénticas.
  - Un grupo de bloque movido decide todos sus miembros (`completarGrupo`). Si algún PATCH falla, la tarjeta lo marca, ofrece reintentar y no lo muestra como decidido.
  - En un conflicto no se pueden aceptar propuestas de dos laboratorios: aceptar una deja las otras como "por rechazar", con confirmación en la página (sin `confirm()`).
- **Comentarios:** marcar como resuelto o reabrir, con nota (`PATCH /comentarios/{id}/resolucion`).
- **Versión final (`final.ts`):**
  - "Componer versión final" calcula `aplicarSugerencias(base, aceptadas)` y abre un editor sobre el resultado;
  - el revisor puede **redactar otra** versión o hacer ediciones directas (spec §5.2);
  - las sugerencias que el revisor reemplaza con su redacción se marcan `modificada`;
  - "Guardar versión final" hace `PUT /capitulos/{id}/final` con `{docJson, tex: exportarLatex(doc)}`;
  - si existe `GET …/final`, se ofrece retomarla.
  - Errores visibles de `aplicarSugerencias` (grupo incompleto, inserción no ubicable, R14): mensaje claro con la sugerencia implicada, sin tragarse el error.
- **Exportar `.tex`:**
  - descarga del capítulo final como archivo, con nombre `slug.tex`, LF y UTF-8;
  - antes, si `caracteresNoSoportados` o `referenciasColgantes` no están vacíos, muestra el aviso en la página con "Exportar de todos modos". El aviso se oculta si cambian las decisiones (comportamiento de 1A).

- [ ] **Step 1: Tests:**
  - `decision reenvia estado nota y derivadaReunion`
  - `fila colapsada decide todas las identicas`
  - `decision de grupo envía todos los miembros y avisa fallos parciales`
  - `conflicto no permite aceptar dos laboratorios`
  - `componer final aplica aceptadas y muestra error visible de aplicar`
  - `guardar final envia docJson y tex exportado`
  - `exportar avisa caracteres no soportados y referencias colgantes`
  - `tarjeta de grupo movido muestra una sola accion` (reemplaza `demo-movidos.test.ts`)
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS.

---

### Task 8: Administración

**Files:**
- Create: `cliente/src/app/admin/{capitulos,usuarios,consulta}.ts`, `cliente/src/app/fechas.ts`, `cliente/tests/app/admin/{capitulos,usuarios,consulta}.test.ts`, `cliente/tests/app/fechas.test.ts`

**Interfaces y comportamiento:**
- **`fechas.ts`:**
  - `aIsoConZona(local: string /* "2026-11-12T09:00" */, zona = 'America/Santiago'): string` devuelve ISO con el desfase correcto en esa fecha;
  - `aLocal(isoZ: string, zona = 'America/Santiago'): string` hace la conversión inversa.
  - Se implementa con `Intl.DateTimeFormat` (sin dependencias). Ante horas ambiguas o inexistentes por el cambio de hora, elige la primera válida y lo dice en la interfaz.
- **Capítulos (`#/admin/capitulos`):**
  - se elige un `.tex`, se importa en el navegador (`importarLatex`) y se ve una vista previa;
  - la vista previa incluye un reporte de avisos y de bloques `especial` (spec §5.3);
  - se propone el slug desde el nombre del archivo (minúsculas, sin tildes, guiones);
  - título y orden se pueden editar;
  - "Subir" hace `POST /admin/capitulos` con `texOriginal` y `docJson`, solo en `preparacion`; si no, explica por qué no se puede.
- **Usuarios (`#/admin/usuarios`):**
  - lista y filtro;
  - importar CSV (pegado o archivo) → tabla de claves generadas que **se muestra una sola vez**, con "Copiar todo" y "Descargar CSV" generados en el navegador, y una advertencia clara;
  - regenerar clave (avisa que cierra sus sesiones);
  - activar o desactivar;
  - roles;
  - los errores del CSV se muestran por línea física.
- **Consulta (`#/admin/consulta`):**
  - apertura y cierre con `datetime-local` en hora de Chile y motivo obligatorio;
  - en `consulta` solo se habilita extender el cierre;
  - se muestran los errores 400 por campo.

- [ ] **Step 1: Tests:**
  - `fechas de la consulta respetan America/Santiago y el horario de verano` (casos en septiembre y en abril, y una fecha normal)
  - `slug propuesto desde el nombre del archivo`
  - `vista previa reporta especiales y avisos`
  - `subir fuera de preparacion explica el bloqueo`
  - `claves importadas se muestran una vez y no quedan en el estado al salir`
  - `errores de csv por linea`
  - `en consulta solo se puede extender el cierre`
- [ ] **Step 2:** → FAIL. **Step 3:** Implementar. **Step 4:** → PASS.

---

### Task 9: Prueba de humo de punta a punta y guía de uso

**Files:**
- Create: `cliente/scripts/humo-api.ts`, `docs/guia-uso.md`
- Modify: `cliente/package.json` (script `"humo": "tsx scripts/humo-api.ts"`)

**Interfaces:**
- `npm run humo` corre contra `http://localhost:8080` (Docker del 1B con la base `manual` recreada).
  - Usa Node `fetch` con un frasco de cookies propio y las mismas funciones de `src/app/api.ts`.
  - Recorre:
    1. el administrador, creado con `bin/crear-admin.php`, entra;
    2. sube un capítulo sintético (fixture del repo, nunca del manual real);
    3. importa 3 laboratorios y un revisor;
    4. fija las fechas para abrir la consulta;
    5. cada laboratorio entra, edita y guarda, con sugerencias reales del motor, incluido un conflicto y un bloque movido;
    6. comenta;
    7. se adelanta el cierre en la base de pruebas, con un SQL de desarrollo documentado, porque la API no permite fechas pasadas;
    8. el revisor ve los aportes, decide, compone y guarda la versión final;
    9. se exporta el `.tex` final y se compila con `pdflatex` y `herramientas/marco-prueba.tex`.

  Imprime cada paso con ok o fallo y termina con código distinto de 0 si algo falla.
- `docs/guia-uso.md`: una guía breve por rol (laboratorio, revisor, administrador), con los flujos principales en lenguaje simple, para enviar a Fabio y a los laboratorios.

- [ ] **Step 1:** Implementar `humo-api.ts`. Documentar en el informe cómo preparar la base (comandos Docker exactos).
- [ ] **Step 2:** `npm run humo` → todos los pasos ok y el `.tex` compila.
- [ ] **Step 3:** Escribir `docs/guia-uso.md`.
- [ ] **Step 4:** `npm test`, `npm run typecheck` y `npm run build` en verde. `npm run verificar` sigue en 15/15.
