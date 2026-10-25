# Fase 1A — Motor de cambios listo para la consulta: Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cerrar los huecos del motor de cambios que el informe de la Fase 0 (`docs/fase0-resultado.md` §4–§5) marca como bloqueantes para abrir la consulta: cada edición del laboratorio debe quedar como sugerencia aplicable o como error visible, nunca perderse ni aplicarse en otro lugar. Además, las sugerencias necesitan identidad estable, el `.tex` final debe compilar aunque el usuario escriba caracteres raros, y hay que medir la escala con 35 laboratorios.

**Architecture:** Cambios dentro de la biblioteca `cliente/src/cambios/` y `cliente/src/latex/`, que ya existen. No hay servidor en este plan. La demo (`cliente/src/demo/`) se ajusta solo lo necesario para mostrar lo nuevo; la SPA real es el plan 1C. Este plan es independiente del plan 1B (servidor) y puede ejecutarse en paralelo con él.

**Tech Stack:** el de la Fase 0: TypeScript strict, Vitest, TipTap/ProseMirror, jsdiff, tsx. pdflatex (MiKTeX) solo en `npm run verificar` y en el script de escala.

**Spec:** `docs/superpowers/specs/2026-10-23-plataforma-consulta-manual-design.md` (§2 anti-objetivos, §5.1, §5.2, §6.3, §8 "Escapar contenido de usuarios"). Evidencia de partida: `docs/fase0-resultado.md`.

**Hoja de ruta de la Fase 1** (spec §9). Cada plan produce software probado por sí solo:
- **1A — Motor de cambios** (este plan).
- **1B — Servidor**: PHP 8.2 + MariaDB, Docker local, autenticación, permisos, API. Ver `2026-10-24-fase1b-servidor.md`. Va en paralelo con 1A.
- **1C — Aplicación web**: pantallas de laboratorio, revisor y administrador sobre la API de 1B y el motor de 1A. Se planifica cuando 1A y 1B estén cerrados, porque consume sus interfaces.
- **1D — Informes y despliegue**: informe en pantalla e imprimible, `.zip` + `.sql` para el hosting y tareas cron.

## Global Constraints

- Reglas del usuario (vigentes en la ejecución): sin pausas entre tareas; **commits al final**, uno atómico por tarea, mostrados al usuario antes de crearlos; Conventional Commits; identidad git `rcandiaa87 <rodrigo.candia@inia.cl>`; trailers `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` y la línea `Claude-Session` de la sesión. Rama `feat/fase1a-motor` desde `origin/main`.
- `manual-fuente/` **nunca** se versiona. Los tests usan documentos sintéticos (`tests/ayudantes-doc.ts`); solo `scripts/` lee `manual-fuente/tex/`.
- Solo dependencias MIT/BSD/ISC/Apache; sin TipTap Pro. No se agregan dependencias nuevas en este plan.
- TypeScript `strict`, identificadores de dominio en español.
- **Principio rector (anti-objetivo 1):** una edición que el motor no sabe representar produce un **error visible** o un **aviso**, nunca una pérdida o un cambio de lugar silencioso.
- Al cierre del plan: `npm test` sin `it.fails` en `tests/propiedad-identidad.test.ts`, `npm run typecheck` limpio y `npm run verificar` en 15/15 en los seis criterios.

## Review Focus

1. **Ítem nuevo como primer hijo de cualquier contenedor**: primera fila de una tabla, primer ítem de una sublista, primer párrafo de una nota al pie (sus bloques se tratan como bloques en la tabla, nota incluida). Debe insertarse en ese mismo contenedor y no en el anterior. → test `primer hijo en sublista, en tabla y en nota` (Task 1).
2. **Un bloque movido y además editado** (por ejemplo, un ítem unido con Backspace al anterior y con una palabra cambiada): ni el movimiento ni la edición pueden perderse. → test `movido y editado conserva la edición en la propuesta` (Task 2).
3. **El laboratorio vuelve a guardar con una sugerencia nueva entre dos ya decididas**: las decisiones del revisor sobre las otras deben sobrevivir. → test `insertar una sugerencia antes no cambia los ids de las demás` (Task 3).
4. **Dos sugerencias idénticas del mismo autor en el mismo bloque** (la misma palabra corregida dos veces): ids distintos y estables. → test `sugerencias idénticas en un bloque reciben ids distintos y estables` (Task 3).
5. **Texto del usuario con caracteres fuera del repertorio del marco** (`≤ ≥ → µ ° ± ×`, comillas rectas `"`, `<<`): el `.tex` debe compilar, y lo que no se sabe mapear debe avisarse antes de exportar. → test `mapea símbolos comunes` y `avisa caracteres no soportados` (Task 4).

---

## Estructura de archivos

```
cliente/src/
├── tipos.ts                       # Sugerencia: + siguiente, + grupo; TipoSugerencia sin cambios
├── cambios/
│   ├── sugerencias.ts             # T1 siguiente/primerHijo; T2 movidos como par; T3 ids por contenido
│   ├── aplicar.ts                 # T1 insertar antes de `siguiente`; T2 grupos completos
│   ├── estructura.ts              # T2 pasa a decir qué bids se movieron (además de los avisos)
│   ├── identidad.ts               # T3 nuevo: idSugerencia (hash estable)
│   └── conflictos.ts              # T2 un grupo choca si choca cualquiera de sus miembros
├── latex/
│   ├── exportar.ts                # T4 mapa de símbolos
│   └── revision.ts                # T4 nuevo: caracteresNoSoportados, referenciasColgantes
└── demo/                          # T2–T4 ajustes mínimos de presentación
cliente/scripts/escala.ts          # T5 nuevo
docs/fase1-escala.md               # T5 resultado medido
```

---

### Task 1: Inserción como primer hijo de un contenedor

**Files:**
- Modify: `cliente/src/tipos.ts`, `cliente/src/cambios/sugerencias.ts`, `cliente/src/cambios/aplicar.ts`
- Test: `cliente/tests/propiedad-identidad.test.ts` (quitar los dos `it.fails` y volver a activar la mutación de primer ítem), `cliente/tests/conflictos-aplicar.test.ts`

**Interfaces:**
- Consumes: `calcularSugerencias`, `aplicarSugerencias`, `ANCLA_INICIO` (Fase 0).
- Produces: `Sugerencia.siguiente?: string`. Solo en `bloque-insertado`. Es el bid del primer bloque **existente** que sigue a la inserción en orden de documento en la copia, o ausente si no hay ninguno. Se emite siempre en las inserciones, no solo en el primer hijo, porque el revisor lo usa también para ubicar la tarjeta.

**Regla de ubicación** (decide este plan; reemplaza el anclaje solo al anterior):
- En `calcularSugerencias`, al emitir una inserción, se calcula si el nodo nuevo es el **primer hijo** de su padre en la copia. Si lo es, y su padre no es `doc`, se insertará **antes** del bloque `siguiente`. Va al nivel del ancestro de `siguiente` cuya profundidad es `profundidad`, siempre que ese ancestro sea hijo del contenedor equivalente. Si no lo es, va después del ancla, como hoy.
- El dato se guarda como `Sugerencia.primerHijo?: true`, junto a `siguiente`.
- Si `primerHijo` y `siguiente` no se pueden resolver en la base modificada (el bloque siguiente fue eliminado por otra sugerencia aceptada, o el ancestro no admite el tipo), se lanza el mismo `Error('No se puede ubicar la inserción …')`. Es un error visible, no se adivina.
- Las inserciones consecutivas con la misma ancla conservan el orden ascendente de `n` (R8). Si la primera es `primerHijo`, las siguientes se encadenan tras ella como hoy.

- [ ] **Step 1: Tests que fallan.**
  - En `propiedad-identidad.test.ts`, cambiar los dos `it.fails` por `it`: `tras un párrafo: inserta el primer ítem en la lista` y `tras otra lista: inserta el primer ítem en su propia lista`. Las aserciones son las mismas que ya tienen.
  - Volver a incluir la mutación «insertar primer ítem de una lista» en el generador de la prueba de propiedad.
  - `primer hijo en sublista, en tabla y en nota`: tres casos. Cada uno inserta un bloque nuevo como primer hijo de una sublista, de una tabla (primera fila) y de una nota al pie con bloques. En los tres, `aplicar(calcular(base, copia)) ≡ copia`.
  - `primer hijo cuyo siguiente fue eliminado lanza error visible`: lab A inserta un primer ítem antes de `i1` y lab B elimina `i1`. Aplicar las dos lanza `/No se puede ubicar la inserción/`.
- [ ] **Step 2:** `npx vitest run tests/propiedad-identidad.test.ts tests/conflictos-aplicar.test.ts` → FAIL.
- [ ] **Step 3:** Implementar `siguiente`, `primerHijo` y la ubicación antes de `siguiente` en `insertarEnAncla`.
- [ ] **Step 4:** `npm test` → PASS, sin `it.fails` en el archivo de propiedad. `npm run verificar` → 15/15.

---

### Task 2: Bloques movidos o unidos como sugerencias aplicables

**Files:**
- Modify: `cliente/src/tipos.ts`, `cliente/src/cambios/estructura.ts`, `cliente/src/cambios/sugerencias.ts`, `cliente/src/cambios/aplicar.ts`, `cliente/src/cambios/conflictos.ts`, `cliente/src/demo/revisor.ts`, `cliente/src/demo/laboratorio.ts`
- Test: `cliente/tests/estructura.test.ts`, `cliente/tests/sugerencias.test.ts`, `cliente/tests/propiedad-identidad.test.ts`

**Interfaces:**
- Consumes: `detectarCambiosEstructura` (Fase 0), `Sugerencia.siguiente` (Task 1).
- Produces:
  - `bidsMovidos(base: DocJSON, copia: DocJSON): Set<string>` en `estructura.ts`. Son los bids conservados cuyo tipo, contenedor u orden cambió, con el mismo criterio que hoy usa `detectarCambiosEstructura`. `detectarCambiosEstructura` se mantiene para los avisos, implementada sobre `bidsMovidos`.
  - `Sugerencia.grupo?: string`. Las sugerencias con el mismo `grupo` se aceptan o rechazan juntas. El valor es `mov:${bid}`.
  - `completarGrupo(aceptadas: Sugerencia[], todas: Sugerencia[]): Sugerencia[]` en `aplicar.ts`. Devuelve las aceptadas más los miembros faltantes de sus grupos. Lanza error si una sugerencia del grupo está explícitamente rechazada mientras otra está aceptada. La UI lo evita, y este error lo atrapa si falla.

**Modelo** (decide este plan): un bloque movido o unido se representa como un **par** de sugerencias con el mismo `grupo`:
- un `bloque-eliminado` del bloque en su lugar original, con el contenido de la base;
- un `bloque-insertado` en el lugar nuevo, con el contenido de la copia (que puede traer ediciones de texto) y su `bid` original en `attrs.bid`, para que la versión final lo conserve.

Para obtenerlo, `calcularSugerencias` trata los bids de `bidsMovidos` como "no existentes" al recorrer la copia, y como "eliminados" al recorrer la base. No se agrega ningún `TipoSugerencia` nuevo. El revisor ve el par como una sola tarjeta, "Movido" o "Unido al ítem anterior". Es "Unido" cuando el bloque pasó a ser hijo del ítem anterior, en el mismo nivel de lista.

Detalle obligatorio: si al insertarlo se conserva `attrs.bid`, `listarBloques` de la versión final puede ver ese bid dos veces mientras convive con su eliminación. `aplicarSugerencias` debe aplicar la eliminación del grupo **antes** que la inserción.

- [ ] **Step 1: Tests que fallan.**
  - `backspace al inicio de un ítem produce un par movido aplicable`: es el caso de la Fase 0 (i2 unido a i1). Se esperan 2 sugerencias con el mismo `grupo`, `aplicar ≡ copia`, y `detectarCambiosEstructura` sigue dando el aviso.
  - `movido y editado conserva la edición en la propuesta`: i2 unido a i1 y con `42,0` → `42,00`. La propuesta contiene `42,00` y `aplicar ≡ copia`.
  - `reordenar dos ítems produce un par por bloque movido`: `aplicar ≡ copia`.
  - `completarGrupo agrega el miembro faltante` y `completarGrupo con un miembro rechazado lanza error`.
  - `un grupo choca si choca cualquiera de sus miembros`: lab A une i2 a i1 y lab B edita i2. `detectarConflictos` devuelve un conflicto que contiene las tres sugerencias.
  - Prueba de propiedad: agregar al generador las mutaciones «unir ítem al anterior» y «mover bloque a otra lista». `aplicar(calcular) ≡ copia` en los 300 casos.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar. En la demo:
  - El revisor muestra el par como una tarjeta con un solo Aceptar o Rechazar, que actúa sobre el grupo.
  - El laboratorio lista "Movido" o "Unido" en su panel.
  - La caja de avisos de la Fase 0 desaparece cuando todos sus bids quedan cubiertos por un par.
- [ ] **Step 4:** `npm test` → PASS. `npm run verificar` → 15/15.

---

### Task 3: Identidad de las sugerencias por contenido

**Files:**
- Create: `cliente/src/cambios/identidad.ts`
- Modify: `cliente/src/cambios/sugerencias.ts`, `cliente/src/demo/almacen.ts`, `cliente/src/demo/laboratorio.ts`
- Test: `cliente/tests/identidad.test.ts`, `cliente/tests/almacen.test.ts`

**Interfaces:**
- Consumes: `jsonEstable` (`tokens.ts`).
- Produces:
  - `idSugerencia(s: Omit<Sugerencia, 'id'>, ocurrencia: number): string`. Formato: `${autor}:${bloqueId}:${hash}`, con `hash` = FNV-1a de 32 bits en hexadecimal (8 caracteres) sobre `jsonEstable({ tipo, original, propuesta, grupo, ocurrencia })`. `ocurrencia` cuenta desde 0 cuántas sugerencias anteriores del mismo autor, bloque, tipo, original y propuesta hay en orden de documento. No incluye rangos ni `n` posicional.
  - `calcularSugerencias` asigna `id` con `idSugerencia`. Los formatos `:+n` y `:desde` de R8 desaparecen.
  - El orden de aplicación de inserciones en una misma ancla ya no puede salir del id. Pasa a un campo explícito `Sugerencia.orden?: number`, con el `n` de hoy. `numeroInsercion` lee `orden` y lanza error si falta, como R15.
  - Demo: `guardarCopia` deja de borrar todas las decisiones del laboratorio (R28). Conserva las que tengan un `id` que siga existiendo y descarta solo las de ids desaparecidos.

- [ ] **Step 1: Tests que fallan.**
  - `insertar una sugerencia antes no cambia los ids de las demás`: copia con 2 ediciones, más una tercera insertada antes en el mismo bloque. Los ids de las 2 primeras no cambian.
  - `sugerencias idénticas en un bloque reciben ids distintos y estables`.
  - `rehacer el mismo cambio da el mismo id`: deshacer y volver a escribir el mismo texto.
  - `cambiar la propuesta cambia el id`.
  - En `almacen.test.ts`: `re-guardar conserva decisiones de sugerencias que siguen existiendo` y `re-guardar descarta decisiones huérfanas`. Este último reemplaza el test de R28 que esperaba borrar todo.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → PASS, con la prueba de propiedad intacta.

---

### Task 4: Exportación segura — símbolos y referencias colgantes

**Files:**
- Create: `cliente/src/latex/revision.ts`
- Modify: `cliente/src/latex/exportar.ts`, `cliente/src/demo/revisor.ts`
- Test: `cliente/tests/exportar.test.ts`, `cliente/tests/revision.test.ts`

**Interfaces:**
- Produces:
  - En `exportar.ts`, el mapa de símbolos del texto de usuario, fuera de `$…$`. Valores exactos:
    - `≤` → `$\leq$` y `≥` → `$\geq$`
    - `→` → `$\rightarrow$`
    - `×` → `$\times$`
    - `±` → `$\pm$`
    - `µ` (U+00B5) y `μ` (U+03BC) → `$\mu$`
    - `°` → `\degree{}`
    - `"` → `\textquotedbl{}`
    - `<` → `\textless{}` y `>` → `\textgreater{}`. Así se evitan los atajos `<<` y `>>` de babel-spanish.
  - El importador debe leer cada uno de vuelta como el carácter original, para que la ida y vuelta del JSON siga siendo identidad.
  - **Excepción obligatoria:** si un capítulo real ya trae una de esas formas en la fuente (por ejemplo `$\pm$` escrito a mano), la normalización estricta debe seguir dando igual. Verificarlo con `npm run verificar`.
  - `caracteresNoSoportados(doc: DocJSON): Array<{ caracter: string; bloqueId: string | null }>`. Son los caracteres del texto que no son ASCII imprimible, ni letras latinas con diacríticos (Latin-1 y Latin Extended-A), ni están en el mapa.
  - `referenciasColgantes(doc: DocJSON): string[]`. Son las etiquetas citadas por nodos `referencia` que ningún ítem del documento declara.
  - Demo, revisor: antes de "Exportar .tex final", si cualquiera de las dos listas no está vacía, se muestra un aviso con los detalles en la página (no `confirm`) y un botón "Exportar de todos modos".

- [ ] **Step 1: Tests que fallan.**
  - `mapea símbolos comunes`: un párrafo con `≤ ≥ → × ± µ μ ° " < >` exporta exactamente las formas de arriba, y la ida y vuelta JSON → LaTeX → JSON da el mismo texto.
  - `avisa caracteres no soportados`: con `☺` y `∑` → dos entradas con su `bloqueId`. Con `á ñ Ü ő` → ninguna.
  - `detecta referencias colgantes`: una referencia a `itm:x:a` sin ítem que la declare → `['itm:x:a']`.
- [ ] **Step 2:** → FAIL.
- [ ] **Step 3:** Implementar.
- [ ] **Step 4:** `npm test` → PASS. Compilar a mano un capítulo sintético con todos los símbolos del mapa: exportarlo a `manual-fuente/_reportes/simbolos.tex` y correr `pdflatex` con `herramientas/marco-prueba.tex`. Compila sin errores. `npm run verificar` → 15/15.

---

### Task 5: Medición de escala con 35 laboratorios

**Files:**
- Create: `cliente/scripts/escala.ts`, `docs/fase1-escala.md`
- Modify: `cliente/package.json` (script `"escala": "tsx scripts/escala.ts"`)

**Interfaces:**
- Consumes: `importarLatex`, `calcularSugerencias`, `detectarConflictos`, `aplicarSugerencias`, `exportarLatex` y el generador de mutaciones de `tests/propiedad-identidad.test.ts`. Hay que extraerlo a `tests/ayudantes-mutacion.ts` para reutilizarlo sin duplicarlo.
- Produce: `npm run escala -- [capitulo] [--labs 35] [--ediciones 8] [--semilla 1]`.
  - Por capítulo real de `manual-fuente/tex/` (todos si no se indica uno), genera N copias con K mutaciones cada una, con PRNG de semilla fija.
  - Mide en milisegundos `calcularSugerencias` (total), `detectarConflictos` y `aplicarSugerencias`, aceptando una sugerencia por conflicto y todas las demás.
  - Exporta y compila el resultado con `pdflatex`.
  - Imprime una tabla y la agrega a `manual-fuente/_reportes/escala.md`.

- [ ] **Step 1:** Extraer el generador a `tests/ayudantes-mutacion.ts`. La prueba de propiedad lo importa y `npm test` sigue en verde.
- [ ] **Step 2:** Implementar `scripts/escala.ts`.
- [ ] **Step 3:** Ejecutar `npm run escala -- --labs 35 --ediciones 8` sobre los 15 capítulos.
  - Criterios: tiempo total por capítulo **< 2000 ms**, el resultado compila en los 15 y aplicar no lanza error.
  - Si un criterio falla, registrar el capítulo y la causa. No se corrige en esta tarea salvo que sea trivial.
- [ ] **Step 4:** Escribir `docs/fase1-escala.md` con:
  - la tabla medida (capítulo, sugerencias, conflictos, ms por etapa y compila);
  - el máximo de sugerencias por bloque, que es el indicador de saturación visual;
  - una recomendación para la vista del revisor del plan 1C: filtro por laboratorio o "solo conflictos" por defecto si el máximo por bloque supera 5.
