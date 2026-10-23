# Fase 0 — Prueba de viabilidad: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Demostrar con los 15 capítulos reales que (1) el LaTeX del manual se puede convertir a un documento editable y volver a `.tex` sin perder contenido ni estructura, y (2) el control de cambios por diferencias (laboratorios + revisor con conflictos) funciona y se entiende. Resultado: decisión documentada de seguir o no con la Fase 1.

**Architecture:** Biblioteca TypeScript en `cliente/` (será la base de la SPA de Fase 1). Esquema de documento definido con extensiones TipTap y validado con `getSchema`. Importador LaTeX → JSON (vía `@unified-latex`), exportador JSON → LaTeX, motor de sugerencias (diff por bloque con ID estable, conflictos y aplicación). Un script verifica la ida y vuelta contra `manual-fuente/tex/`, y una página demo (Vite) permite probar la experiencia "estilo Word".

**Tech Stack:** Node ≥ 22, TypeScript (strict), Vite, Vitest, tsx, TipTap (versión estable vigente; APIs usadas: `Node.create`, `Mark.create`, `getSchema`, `Editor`), `@unified-latex/unified-latex-util-parse`, `diff` (jsdiff), KaTeX. pdflatex (MiKTeX, ya instalado) solo para el script de verificación.

**Spec:** `docs/superpowers/specs/2026-10-23-plataforma-consulta-manual-design.md` (secciones 6.2, 6.3, 6.4, 9 y 10).

**Precondición de git:** la rama `docs/diseno-plataforma` (diseño + este plan) se integra a `main` primero. La implementación va en una rama nueva `feat/fase0-viabilidad` creada desde `origin/main` actualizado.

## Global Constraints

- Reglas del usuario: un paso a la vez, esperando su "continúa"; **ningún commit sin confirmación explícita**; Conventional Commits; identidad git `rcandiaa87 <rodrigo.candia@inia.cl>` (ya en la config local); trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- `manual-fuente/` **nunca** se versiona (contenido del manual). Los tests unitarios usan fixtures sintéticos versionados en `cliente/tests/fixtures/`. Solo el script de verificación lee `manual-fuente/tex/`.
- Solo dependencias con licencia MIT/BSD/ISC/Apache. **Prohibidas las extensiones TipTap Pro** y cualquier dependencia de pago.
- TypeScript `strict: true`. Identificadores de dominio en español, igual que el spec (`importarLatex`, `Sugerencia`, `bloqueId`…).
- Textos visibles en la demo, en español.
- Entrada `.tex`: UTF-8, se acepta CRLF o LF. Salida del exportador: LF.
- Subconjunto LaTeX soportado (spec §3): `\analito`, `\metodo`, `\section`, `enumerate`, `itemize`, `\item`, `\label{itm:...}`, `\ref`, `\footnote`, `$...$`, `\[...\]`, `tabular`, `\degree`, `\textbf`, `\textit`, `\emph`, escapes `\% \& \_ \$ \#`, `--`, `---`, ` `` ''`, `\,`, `~`. Todo lo demás → nodo `especial` / `especialInline` con su LaTeX crudo intacto.

## Review Focus

1. **Entradas con CRLF, tabulaciones y líneas partidas a mitad de frase** (así vienen los capítulos reales): el texto importado debe quedar en un solo párrafo con espacios simples, sin `\r`. → test `importa CRLF y saltos de línea internos como un solo párrafo` (Task 3).
2. **`\label` al final de un ítem, después del texto o en una línea aparte** (`... \label{itm:CEdiasig}`): debe quedar como atributo `etiqueta` del ítem, nunca como texto ni como `especial`. → test `label al final del item se vuelve atributo etiqueta` (Task 3).
3. **Notas al pie con listas adentro, y `\footnote` entre ítems** (fuera de un `\item`, como en `pHjav.tex` tras `\end{enumerate}`): no se puede perder la nota ni moverla de lugar. → test `footnote con itemize interno y footnote suelto entre bloques` (Task 4).
4. **Texto de usuario con caracteres especiales de LaTeX** (`50 % & más_x $`): el exportador debe escaparlos para que compile. → test `escapa caracteres especiales del texto del usuario` (Task 5).
5. **Copia idéntica a la base, o cambios que se deshacen** (escribir y borrar lo mismo): cero sugerencias, nada que revisar. → test `copia sin cambios produce cero sugerencias` (Task 7).

---

## Estructura de archivos

```
cliente/
├── package.json, tsconfig.json, vite.config.ts, index.html
├── src/
│   ├── esquema/extensiones.ts     # nodos y marcas TipTap del documento del manual
│   ├── esquema/esquema.ts         # getSchema + validarDocumento
│   ├── latex/importar.ts          # LaTeX → DocJSON (estructura)
│   ├── latex/inline.ts            # LaTeX inline → nodos inline (math, ref, nota, marcas, escapes)
│   ├── latex/exportar.ts          # DocJSON → LaTeX
│   ├── latex/normalizar.ts        # normalización para comparar LaTeX original vs exportado
│   ├── cambios/tokens.ts          # tokenización de un bloque
│   ├── cambios/sugerencias.ts     # calcularSugerencias
│   ├── cambios/conflictos.ts      # detectarConflictos
│   ├── cambios/aplicar.ts         # aplicarSugerencias
│   ├── tipos.ts                   # DocJSON, Sugerencia, etc.
│   └── demo/                      # página demo (laboratorio + revisor)
├── scripts/verificar-capitulos.ts # verificación contra manual-fuente/tex
├── herramientas/marco-prueba.tex  # archivo marco mínimo para compilar
└── tests/ (+ fixtures/)
.github/workflows/ci.yml
docs/fase0-resultado.md
```

---

### Task 1: Proyecto `cliente/` con Vitest y CI

**Files:**
- Create: `cliente/package.json`, `cliente/tsconfig.json`, `cliente/vite.config.ts`, `cliente/src/tipos.ts`, `cliente/tests/humo.test.ts`, `.github/workflows/ci.yml`

**Interfaces:**
- Produces: scripts npm `test` (vitest run), `dev` (vite), `verificar` (tsx scripts/verificar-capitulos.ts), `typecheck` (tsc --noEmit). Tipos en `src/tipos.ts`:
  - `type DocJSON = JSONContent` (re-export de `@tiptap/core`)
  - `type Rango = { desde: number; hasta: number }` (offsets en tokens, `hasta` exclusivo)
  - `type TipoSugerencia = 'contenido' | 'formato' | 'bloque-insertado' | 'bloque-eliminado'`
  - `interface Sugerencia { id: string; autor: string; bloqueId: string; base: Rango; copia: Rango; original: DocJSON[]; propuesta: DocJSON[]; tipo: TipoSugerencia; motivo?: string }`

- [ ] **Step 1:** Test de humo `tests/humo.test.ts`: `expect(1 + 1).toBe(2)` e importa un tipo de `src/tipos.ts`.
- [ ] **Step 2:** `cd cliente && npm install` con las dependencias del Tech Stack; `npm test` → PASS; `npm run typecheck` → sin errores.
- [ ] **Step 3:** `ci.yml`: en push/PR, Node 22, `npm ci`, `npm run typecheck`, `npm test`, con `working-directory: cliente`.
- [ ] **Step 4:** Commit (con confirmación): `chore: inicializar cliente con vitest y CI`.

---

### Task 2: Esquema del documento

**Files:**
- Create: `cliente/src/esquema/extensiones.ts`, `cliente/src/esquema/esquema.ts`
- Test: `cliente/tests/esquema.test.ts`

**Interfaces:**
- Produces: `extensionesManual: Extensions` (array para `getSchema` y para `new Editor`), `esquemaManual: Schema`, `validarDocumento(doc: DocJSON): { ok: true } | { ok: false; error: string }` (usa `Node.fromJSON(esquemaManual, doc).check()`).
- Nodos (nombre → contenido; atributos):
  - `doc` → `analito metodo bloque*`
  - `analito`, `metodo` → `inline*`
  - grupo `bloque`: `seccion` (`inline*`; `bid`), `parrafo` (`inline*`; `bid`), `listaOrdenada` / `listaVinetas` (`item+`), `tabla` (`filaTabla+`; `columnas: string`), `ecuacion` (atom; `latex`, `bid`), `especial` (atom; `latex`, `bid`)
  - `item` → `parrafo bloque*`; `etiqueta: string | null`
  - `filaTabla` → `celda+`; `celda` → `inline*`; `bid`
  - inline: `text`, `matematica` (atom; `latex`), `referencia` (atom; `etiqueta`), `notaPie` (atom; `bloques: DocJSON[]`, con contenido `bloque+` serializado), `especialInline` (atom; `latex`)
  - marcas: `negrita`, `cursiva`, `subindice`, `superindice`
- `bid` (ID de bloque) es string, default `null`; solo los bloques de texto (`seccion`, `parrafo`, `celda`, `ecuacion`, `especial`) lo llevan.

- [ ] **Step 1:** Tests: `documento mínimo válido` (`analito` + `metodo` + un `parrafo`) → `ok: true`; `rechaza doc sin metodo` → `ok: false`; `item requiere parrafo inicial` → `ok: false`; `notaPie guarda bloques en atributo` (roundtrip `Node.fromJSON(...).toJSON()` conserva `attrs.bloques`).
- [ ] **Step 2:** Ejecutar `npx vitest run tests/esquema.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `extensiones.ts` (un `Node.create`/`Mark.create` por elemento, `renderHTML`/`parseHTML` mínimos con `data-tipo` para la demo) y `esquema.ts`.
- [ ] **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit: `feat(esquema): esquema del documento del manual`.

---

### Task 3: Importador — estructura de bloques

**Files:**
- Create: `cliente/src/latex/importar.ts`, `cliente/tests/fixtures/estructura.tex`
- Test: `cliente/tests/importar-estructura.test.ts`

**Interfaces:**
- Consumes: `esquemaManual`, `validarDocumento` (Task 2); `convertirInline(nodos: Ast.Node[], ctx: CtxImport): DocJSON[]` (Task 4; en esta tarea, un stub que convierte solo texto plano).
- Produces: `importarLatex(tex: string): { doc: DocJSON; avisos: string[] }`. Los `bid` se asignan en orden de documento: `b1`, `b2`, … (deterministas: la misma entrada da los mismos IDs). `avisos` lista cada construcción convertida a `especial`/`especialInline` (`"línea N: \\comando"`).

- [ ] **Step 1:** Fixture sintético `estructura.tex` (escrito para el test, no copiado del manual): `\analito{pH}`, `\metodo{...}`, dos `\section`, un `enumerate` con un `enumerate` anidado, un `itemize`, un ítem con `\label{itm:X:a}` al final tras un salto de línea, CRLF y tabulaciones.
- [ ] **Step 2:** Tests en `importar-estructura.test.ts`:
  - `importa analito y metodo` → `doc.content[0].type === 'analito'`, texto `'pH'`.
  - `secciones y listas anidadas` → tipos esperados en orden; la lista anidada vive dentro del `item`.
  - `label al final del item se vuelve atributo etiqueta` → `item.attrs.etiqueta === 'itm:X:a'`, y ningún nodo de texto contiene `label`.
  - `importa CRLF y saltos de línea internos como un solo párrafo` → un `parrafo` cuyo texto no contiene `\r`, `\n` ni espacios dobles.
  - `bid deterministas` → dos importaciones del mismo texto producen JSON idéntico.
  - `entorno desconocido va a especial con aviso` → `\begin{figure}...\end{figure}` produce `especial` con `latex` igual al original y un aviso.
  - `resultado valida contra el esquema` → `validarDocumento(doc).ok`.
- [ ] **Step 3:** Ejecutar → FAIL.
- [ ] **Step 4:** Implementar con `parse` de `@unified-latex/unified-latex-util-parse`, recorriendo el AST. Separar párrafos por línea en blanco (`parbreak`). Los `\label` dentro de un `\item` se extraen al atributo.
- [ ] **Step 5:** Tests → PASS.
- [ ] **Step 6:** Commit: `feat(latex): importador de estructura de capítulos`.

---

### Task 4: Importador — contenido inline, ecuaciones y tablas

**Files:**
- Create: `cliente/src/latex/inline.ts`, `cliente/tests/fixtures/inline.tex`
- Modify: `cliente/src/latex/importar.ts` (usar `convertirInline` real; `\[...\]` → `ecuacion`; `tabular` → `tabla`; `\footnote` fuera de párrafo → se adjunta al final del bloque anterior)
- Test: `cliente/tests/importar-inline.test.ts`

**Interfaces:**
- Produces: `convertirInline(nodos: Ast.Node[], ctx: CtxImport): DocJSON[]`; `interface CtxImport { avisos: string[]; siguienteBid(): string }`.
- Reglas de conversión:
  - `$_2$` / `$_{2}$` / `$^{+}$` (matemática formada **solo** por sub/superíndices de contenido simple, sin otros comandos) → `text` con marca `subindice`/`superindice`. El resto de `$...$` → `matematica` con `latex` sin los `$`.
  - `\degree` fuera de math → texto `°`; `\textbf`/`\textit`/`\emph` → marcas; escapes `\% \& \_ \$ \#` → el carácter; `--` → `–`, `---` → `—`, ` ``…'' ` → `“…”`, `\,` → espacio fino U+202F, `~` → U+00A0.
  - `\ref{x}` → `referencia` con `etiqueta: 'x'`; `\footnote{...}` → `notaPie` con `bloques` = bloques importados del contenido (admite `itemize` dentro).
  - Comando inline desconocido → `especialInline` con su LaTeX crudo y aviso.

- [ ] **Step 1:** Fixture `inline.tex` sintético con: `H$_2$SO$_4$`, `$(105 \pm 5)\degree C$`, `\ref{itm:X:a}`, una nota con `itemize` interno, una nota suelta tras `\end{enumerate}`, `\[ SA\,(\%) = \frac{a-b}{b-c} \times 100 \]`, una `tabular{cl}` de tres filas "donde:", `\textbf{ojo}`, un comando inventado `\foo{bar}`.
- [ ] **Step 2:** Tests:
  - `subindices simples se vuelven marcas` → `H`, `2`(subindice), `SO`, `4`(subindice).
  - `math compleja queda como nodo matematica` → `latex === '(105 \\pm 5)\\degree C'`.
  - `ref se vuelve nodo referencia`.
  - `footnote con itemize interno y footnote suelto entre bloques` → ambas `notaPie` existen; la suelta queda al final del último párrafo del bloque anterior; `bloques` contiene una `listaVinetas`.
  - `ecuacion destacada` → nodo `ecuacion` con `latex` sin `\[ \]`.
  - `tabular a tabla` → `tabla.attrs.columnas === 'cl'`, 3 filas × 2 celdas, celda con `matematica` `a`.
  - `comando desconocido a especialInline con aviso`.
- [ ] **Step 3:** Ejecutar → FAIL. **Step 4:** Implementar. **Step 5:** Tests → PASS.
- [ ] **Step 6:** Commit: `feat(latex): contenido inline, ecuaciones y tablas`.

---

### Task 5: Exportador e ida y vuelta

**Files:**
- Create: `cliente/src/latex/exportar.ts`, `cliente/src/latex/normalizar.ts`
- Test: `cliente/tests/exportar.test.ts`

**Interfaces:**
- Consumes: `importarLatex` (Task 3), fixtures de Tasks 3 y 4.
- Produces: `exportarLatex(doc: DocJSON): string`; `normalizarLatex(tex: string): string`; `compararLatex(a: string, b: string): { igual: boolean; primeraDiferencia?: { posicion: number; a: string; b: string } }` (contexto de ±40 caracteres).
- Formato de salida: mismo estilo del manual: `\analito{}`, línea en blanco, `\metodo{}`, `\section{}`, `\begin{enumerate}` con `\item` indentado con tabulación por nivel, `\label{}` al final del texto del ítem, `\footnote{}` pegado al texto, `\[`/`\]` en líneas propias, `\begin{tabular}{cl}` con ` & ` y ` \\`. Inversos exactos de las reglas de Task 4 (`°` → `\degree`, marca subíndice de un carácter → `$_2$`, de más caracteres → `$_{...}$`, `“…”` → ` ``…'' `, etc.).
- `normalizarLatex`: elimina comentarios `%` no escapados, convierte CRLF a LF, colapsa todo espacio en blanco a uno, quita espacios alrededor de `{ } & \\ \[ \]` y antes de `\label`/`\footnote`, y unifica `$_{x}$` → `$_x$` cuando `x` es de un carácter.

- [ ] **Step 1:** Tests:
  - `ida y vuelta conserva el documento` → para cada fixture: `importarLatex(exportarLatex(importarLatex(tex).doc)).doc` deep-equal a `importarLatex(tex).doc`.
  - `ida y vuelta conserva el LaTeX normalizado` → para cada fixture: `compararLatex(tex, exportarLatex(importarLatex(tex).doc)).igual === true`.
  - `escapa caracteres especiales del texto del usuario` → párrafo con texto `50 % & más_x $ #` exporta `50 \% \& más\_x \$ \#`.
  - `especial se exporta byte a byte` → el `latex` de un nodo `especial` aparece literal en la salida.
- [ ] **Step 2:** Ejecutar → FAIL. **Step 3:** Implementar. **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit: `feat(latex): exportador e ida y vuelta`.

---

### Task 6: Verificación contra los 15 capítulos reales

**Files:**
- Create: `cliente/scripts/verificar-capitulos.ts`, `cliente/herramientas/marco-prueba.tex`

**Interfaces:**
- Consumes: `importarLatex`, `exportarLatex`, `compararLatex`, `validarDocumento`.
- Produces: `npm run verificar [-- --sin-compilar]`. Lee `../manual-fuente/tex/*.tex` y escribe `../manual-fuente/_reportes/verificacion.md` (fuera de git) más los `.tex` exportados en `../manual-fuente/_reportes/exportados/`. Código de salida 0 solo si todos los capítulos cumplen.
- `marco-prueba.tex`: `book`, `inputenc utf8`, `babel spanish`, `amsmath`, `gensymb`, `hyperref`; `\newcommand{\analito}[1]{\chapter{#1}}`, `\newcommand{\metodo}[1]{\section*{#1}}`; incluye el capítulo con `\input`. Es un sustituto hasta tener el marco real de Fabio (pendiente del spec §11).

Criterios por capítulo (columnas del reporte): (a) importa sin excepción; (b) `validarDocumento` ok; (c) cantidad y lista de `especial`/`especialInline`; (d) `compararLatex(original, exportado).igual`, y si no, la primera diferencia; (e) original y exportado compilan con `pdflatex -interaction=nonstopmode -halt-on-error` sobre `marco-prueba.tex` (salvo `--sin-compilar`); (f) cantidad de `\ref` sin resolver, que debe coincidir entre original y exportado.

- [ ] **Step 1:** Implementar el script y el marco.
- [ ] **Step 2:** Ejecutar `cd cliente && npm run verificar`. Resultado esperado: 15/15 en (a), (b), (d) y (e). Cada `especial` debe estar justificado en el reporte.
- [ ] **Step 3:** Por cada capítulo que falle: agregar al fixture correspondiente (Task 3 o 4) un caso sintético mínimo que reproduzca la construcción, verlo fallar, corregir el importador/exportador y volver al Step 2. Iterar hasta 15/15 o hasta identificar una construcción que no tenga solución razonable (anotarla para el informe).
- [ ] **Step 4:** Commit: `feat(verificacion): script de verificación contra capítulos reales` (más los commits `fix(latex): …` de cada corrección del Step 3).

---

### Task 7: Motor de sugerencias — diferencias por bloque

**Files:**
- Create: `cliente/src/cambios/tokens.ts`, `cliente/src/cambios/sugerencias.ts`
- Test: `cliente/tests/sugerencias.test.ts`

**Interfaces:**
- Consumes: `DocJSON`, `Sugerencia`, `Rango` (Task 1); `importarLatex` para armar casos.
- Produces:
  - `interface Token { clave: string; texto: string; marcas: string[]; nodo?: DocJSON }`. `clave` = texto para palabras, espacios y puntuación; para nodos atómicos inline: `tipo:` + JSON estable de sus attrs.
  - `tokenizarBloque(bloque: DocJSON): Token[]`: palabra / espacio / puntuación / nodo atómico como un token cada uno.
  - `listarBloques(doc: DocJSON): Array<{ bid: string | null; nodo: DocJSON; anteriorBid: string | null }>` (orden de documento).
  - `calcularSugerencias(base: DocJSON, copia: DocJSON, autor: string): Sugerencia[]`.
- Algoritmo:
  - Emparejar bloques por `bid`.
  - Bloque de la copia sin `bid` o con `bid` ausente en la base → `bloque-insertado` anclado a `anteriorBid` (`base: {desde: 0, hasta: 0}`).
  - `bid` de la base ausente en la copia → `bloque-eliminado`.
  - Bloques emparejados: `diffArrays` de jsdiff sobre `clave + '|' + marcas.join(',')`. Agrupar cambios contiguos en una sugerencia con sus rangos en base y copia.
  - Si en el grupo las claves coinciden y solo difieren las marcas → `tipo: 'formato'`; si no, `'contenido'`.
  - `id` determinista: `${autor}:${bloqueId}:${base.desde}`.
  - Los editores deben conservar el `bid` al editar un bloque, y un bloque nuevo creado al partir otro con Enter recibe `bid: null` (la demo lo asegura en Task 9).

- [ ] **Step 1:** Tests:
  - `copia sin cambios produce cero sugerencias`.
  - `cambio de una palabra` → base `Disolver 42,0 g de` y copia `Disolver 42,00 g de` → 1 sugerencia `contenido`, `original` texto `42,0` y `propuesta` `42,00`.
  - `insercion al final del bloque` → `base.desde === base.hasta`, propuesta `' por un máximo de 30 días'`.
  - `solo negrita es formato`.
  - `parrafo nuevo es bloque-insertado anclado al anterior`.
  - `parrafo borrado es bloque-eliminado`.
  - `cambiar una referencia cuenta como un token` → `referencia` itm:a → itm:b da una sugerencia con un token en cada lado.
  - `escribir y deshacer no deja rastro` → copia que vuelve al texto original → cero sugerencias.
- [ ] **Step 2:** Ejecutar → FAIL. **Step 3:** Implementar. **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit: `feat(cambios): cálculo de sugerencias por bloque`.

---

### Task 8: Conflictos y aplicación de sugerencias aceptadas

**Files:**
- Create: `cliente/src/cambios/conflictos.ts`, `cliente/src/cambios/aplicar.ts`
- Test: `cliente/tests/conflictos-aplicar.test.ts`

**Interfaces:**
- Consumes: `Sugerencia`, `calcularSugerencias`, `tokenizarBloque`, `listarBloques`, `exportarLatex`.
- Produces:
  - `detectarConflictos(sugerencias: Sugerencia[]): Array<{ bloqueId: string; ids: string[] }>`. Hay conflicto entre sugerencias de **autores distintos** del mismo bloque si sus rangos base se solapan (`a.desde < b.hasta && b.desde < a.hasta`), o si ambas son inserciones en la misma posición, o si una es `bloque-eliminado` y la otra toca ese bloque. Se agrupan transitivamente.
  - `aplicarSugerencias(base: DocJSON, aceptadas: Sugerencia[]): DocJSON`. Lanza `Error('Sugerencias en conflicto: …')` si recibe un par en conflicto. Aplica por bloque, de derecha a izquierda por `base.desde`, reemplazando los tokens del rango por `propuesta`. Inserta y elimina bloques según su tipo. Fusiona nodos de texto adyacentes con las mismas marcas.

- [ ] **Step 1:** Tests (con dos autores sobre un fixture):
  - `mismo fragmento de dos laboratorios es conflicto` → LabA `42,0→42,00`, LabB `42,0→42,01` → un conflicto con ambos ids.
  - `cambios en zonas distintas no son conflicto`.
  - `mismo autor nunca entra en conflicto consigo mismo`.
  - `aplicar una sugerencia produce el texto propuesto` → `exportarLatex` del resultado contiene `42,00 g` y no `42,0 g`.
  - `aplicar varias del mismo bloque respeta posiciones` → dos cambios no solapados del mismo párrafo se aplican ambos correctamente.
  - `aplicar sugerencias en conflicto lanza error`.
  - `aplicar ninguna devuelve la base` → deep-equal.
- [ ] **Step 2:** Ejecutar → FAIL. **Step 3:** Implementar. **Step 4:** Tests → PASS.
- [ ] **Step 5:** Commit: `feat(cambios): conflictos y aplicación de sugerencias`.

---

### Task 9: Demo — laboratorio con control de cambios y revisor con dos laboratorios

**Files:**
- Create: `cliente/index.html`, `cliente/src/demo/main.ts`, `cliente/src/demo/laboratorio.ts`, `cliente/src/demo/revisor.ts`, `cliente/src/demo/decoraciones.ts`, `cliente/src/demo/estilos.css`
- Test: `cliente/tests/decoraciones.test.ts`

**Interfaces:**
- Consumes: todo lo anterior; `Editor` de TipTap con `extensionesManual`; KaTeX para renderizar `matematica` y `ecuacion` (NodeViews).
- Produces: `posicionEnDoc(doc: ProseMirrorNode, bid: string, offsetToken: number): number` (posición ProseMirror del inicio del token N del bloque) en `decoraciones.ts`; `decoracionesDeCambios(doc: ProseMirrorNode, sugerencias: Sugerencia[]): DecorationSet` (inserciones = decoración inline verde subrayada sobre `copia`; eliminaciones = widget con el texto `original` en rojo tachado en la posición `copia.desde`).
- Comportamiento de la demo (sin backend; estado en `localStorage`, envuelto en try/catch):
  - **Cargar capítulo:** selector de archivo `.tex` (se elige uno de `manual-fuente/tex/`) → `importarLatex` → base. Se muestran los avisos.
  - **Modo laboratorio:** selector "Laboratorio A / B". El editor carga la copia del laboratorio (o la base si no hay). En cada cambio (debounce 300 ms) recalcula `calcularSugerencias` y redibuja las decoraciones. Panel lateral con la lista de sugerencias y un campo "motivo" por sugerencia. Botón "Guardar copia". Barra mínima: negrita, cursiva, subíndice, superíndice. Enter conserva `bid` en el bloque original y deja `bid: null` en el nuevo.
  - **Modo revisor:** muestra la base (solo lectura) con las sugerencias de A (verde) y B (ámbar) superpuestas, y los conflictos con recuadro naranjo. Tarjetas al margen con Aceptar/Rechazar, y en conflicto "elegir A / elegir B / ninguna". Botón "Exportar .tex final" → `aplicarSugerencias` + `exportarLatex` → descarga.
- [ ] **Step 1:** Tests de `decoraciones.test.ts`: `posicionEnDoc ubica el token N del bloque` y `decoracionesDeCambios crea una inline por insercion y un widget por eliminacion` (con un `Editor` headless sobre un doc pequeño).
- [ ] **Step 2:** Ejecutar → FAIL. **Step 3:** Implementar `decoraciones.ts`. **Step 4:** Tests → PASS.
- [ ] **Step 5:** Implementar la demo (`npm run dev`).
- [ ] **Step 6: Verificación manual con el usuario** (con un capítulo real, p. ej. fosforo-olsen):
  1. Como Lab A, cambiar `42,0 g` → `42,00 g` y agregar texto al final de un ítem: se ven verde y tachado en rojo, estilo Word.
  2. Como Lab B, cambiar `42,0 g` → `42,01 g`.
  3. En el revisor aparece un conflicto con las dos propuestas. Elegir A, aceptar otra sugerencia de B, exportar el `.tex`.
  4. El `.tex` exportado compila con `herramientas/marco-prueba.tex` y contiene `42,00 g`.
  5. Las referencias (`3.1`) y las notas al pie no se rompen al escribir alrededor.
- [ ] **Step 7:** Commit: `feat(demo): prototipo de control de cambios para laboratorio y revisor`.

---

### Task 10: Informe de viabilidad

**Files:**
- Create: `docs/fase0-resultado.md`

- [ ] **Step 1:** Redactar con: tabla del reporte de verificación (15 capítulos × criterios de Task 6), construcciones LaTeX no resueltas, resultado de la verificación manual de Task 9 con la opinión del usuario, problemas de UX observados en el control de cambios, y **recomendación: seguir a Fase 1 / seguir con la opción B / cambiar a herramienta existente**, con el porqué medido contra los anti-objetivos del spec §2.
- [ ] **Step 2:** Revisión del usuario; commit: `docs: resultado de la fase 0`.
