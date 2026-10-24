# Resultado de la Fase 0 — Viabilidad

Fecha: 2026-10-24
Spec: `docs/superpowers/specs/2026-10-23-plataforma-consulta-manual-design.md`
Plan: `docs/superpowers/plans/2026-10-23-fase0-viabilidad.md`

## Pregunta

¿Se puede editar cada capítulo del manual en un editor visual con control de cambios estilo Word, consolidar los aportes de varios laboratorios y obtener un `.tex` final que compile sin correcciones manuales? ¿Sirve la opción A (documento único con los laboratorios por color) o hay que bajar a la opción B (cola de sugerencias por bloque)?

## Respuesta corta

**Sí. Recomendación: pasar a la Fase 1 con la opción A.** En los 15 capítulos reales, la ida y vuelta LaTeX → editor → LaTeX da un LaTeX igual al original tras una normalización estricta (§2), y compila. El control de cambios, el modo revisor con conflictos y la exportación funcionaron en la prueba manual (computador y celular).

## 1. Verificación contra los 15 capítulos reales

Comando: `npm run verificar` (en `cliente/`), corrido el 2026-10-24. Compilación: `pdflatex -interaction=nonstopmode -halt-on-error`, dos pasadas, sobre `herramientas/marco-prueba.tex`.

Criterios: (a) importa sin excepción · (b) documento válido según el esquema · (c) bloques `especial` (LaTeX no reconocido) en la cantidad esperada · (d) LaTeX exportado igual al original tras normalización estricta · (e) original y exportado compilan · (f) mismo conjunto de referencias sin resolver en original y exportado (la tabla muestra cuántas).

| capítulo | (a) | (b) | (c) | (d) | (e) | (f) orig/exp |
|---|---|---|---|---|---|---|
| aluminio | ok | ok | 0 | ok | ok | 0/0 |
| analitoMICRONUTRIENTES | ok | ok | 0 | ok | ok | 0/0 |
| azufre | ok | ok | 0 | ok | ok | 0/0 |
| boro-aguacaliente | ok | ok | 0 | ok | ok | 0/0 |
| cationes | ok | ok | 0 | ok | ok | 0/0 |
| CE | ok | ok | 0 | ok | ok | 0/0 |
| CO-calcinación | ok | ok | 0 | ok | ok | 0/0 |
| CO | ok | ok | 0 | ok | ok | 0/0 |
| dumas | ok | ok | 0 | ok | ok | 0/0 |
| fosforo-olsen | ok | ok | 0 | ok | ok | 0/0 |
| nitrogeno | ok | ok | 0 | ok | ok | 0/0 |
| NITRÓGENO1.1 | ok | ok | 1 (justificado) | ok | ok | 0/0 |
| NITRÓGENO1.2 | ok | ok | 0 | ok | ok | 0/0 |
| pHjav | ok | ok | 0 | ok | ok | 0/0 |
| textura | ok | ok | 0 | ok | ok | 0/0 |

**Totales:** 15/15 en todos los criterios. El importador reconoce 17 ecuaciones, 9 tablas y 57 notas al pie. Pruebas automatizadas: 186 pasan, más 2 fallos esperados que fijan la limitación de §4. Entre ellas hay una prueba de propiedad: con 300 copias modificadas al azar (semilla fija), aplicar todas las sugerencias de una copia la reproduce exacta. Las copias no incluyen el caso del primer ítem de una lista (§4). Una corrida aparte de 6000 casos también salió limpia.

## 2. Construcciones LaTeX no resueltas

- **Única:** `NITRÓGENO1.1.tex`, línea 25 — `\label{itm:N:naoh1` sin cerrar. Es un **error de la fuente**, no del importador. El grupo abierto se conserva intacto como un bloque `especial` (1494 caracteres, no editable visualmente). **Acción:** avisar al equipo de Fabio para corregirlo en la fuente antes de cargar la base congelada.
- Equivalencias que acepta la normalización del criterio (d). **Sin efecto en el PDF:** `$_x$` ≡ `$_{x}$`; `\emph` ≡ `\textit`; comillas `“ ”` ≡ ``` `` '' ```; guiones `–`/`—` ≡ `--`/`---`; espacio duro ≡ `~`; `\degree` ≡ `\degree{}`; `\\` final antes de `\end{tabular}`; espacios tras `{` o antes de `}`; posición del `\label` dentro del `\item`.
- **Con efecto visual menor:** una `\footnote` escrita justo después de `\end{enumerate}`/`\end{itemize}` se guarda al final del último ítem. En el PDF, la marca de nota queda pegada al último ítem en vez de abrir un párrafo nuevo tras la lista. Ocurre en capítulos reales (por ejemplo `CE.tex` líneas 57–58 y 108–109, `dumas.tex` 34–35). Se aceptó para la Fase 0. En la Fase 1 hay que confirmar con Fabio si esa era la intención o modelar la nota tras la lista.
- Los capítulos son fragmentos sin preámbulo: compilan dentro de un archivo marco. Se usó un marco de prueba; **el marco real del manual sigue pendiente** (spec §11).

## 3. Verificación manual (Task 9)

Probado por Rodrigo en el computador (`localhost`) y en el celular (versión publicada como artifact privado, con el capítulo Fósforo Olsen precargado). Recorrido: laboratorio A y laboratorio B editan el mismo valor de forma distinta y agregan texto → revisor ve ambos por color, resuelve el conflicto, acepta y exporta.

**Opinión del usuario (2026-10-24):** "Todo bien! Funciona el control de cambios, la carga de archivos, modo revisor y consolidación."

Además, el `.tex` exportado se compiló aparte. Los errores iniciales ("Missing \begin{document}", `\analito` indefinido) venían de compilar el capítulo sin marco. No eran del exportador.

## 4. Problemas de UX y limitaciones conocidas

Ninguno bloqueante. Quedan para la Fase 1:

- **Inserción al inicio de una lista (prioridad 1 de la Fase 1):** un ítem nuevo puesto como primer ítem de una lista no se aplica bien. Si la lista viene tras un párrafo, falla con "No se puede ubicar la inserción", un error visible. Si viene justo tras otra lista, el ítem **cae al final de la lista anterior sin aviso**. La causa es que la inserción se ancla al bloque previo. Hay que anclarla también al bloque siguiente. Los dos casos quedan registrados en pruebas marcadas como fallo esperado.
- **Unir o mover bloques sin cambiar su texto** (por ejemplo, Backspace al inicio de un ítem lo une con el anterior) no genera sugerencia. La revisión final lo encontró como pérdida silenciosa y se corrigió en parte: ahora se detecta y aparece un **aviso** al laboratorio y al revisor, que dice que ese cambio no se aplicará y hay que rehacerlo o tratarlo a mano. A veces el aviso nombra también a los vecinos del bloque movido. Para la Fase 1: convertir estos cambios en sugerencias aplicables.
- **Borrar el párrafo inicial de un ítem con subítems** se rechaza con error explícito, a propósito: se prefirió fallar antes que perder contenido en silencio.
- **Inserciones en el mismo punto por dos laboratorios:** se listan como conflicto en la tarjeta, pero sin el recuadro naranjo en el texto.
- **Tipografía escrita a mano:** `--`, `---`, ``` `` ``` y `''` vuelven como `–`, `—`, `“`, `”`. Es equivalente al compilar, pero conviene que el editor lo muestre así desde el principio.
- **Negrita en parte de una palabra** se clasifica como cambio de contenido, no de formato.
- **Las decisiones del revisor se borran** si el laboratorio vuelve a guardar su copia. Es lo correcto (las sugerencias pueden haber cambiado), pero en la Fase 1 debe avisarse.
- **Teclado del celular:** sirve para revisar, no para editar a fondo. Los laboratorios editarán en computador.
- **Caracteres especiales:** el exportador solo escapa lo que usan los capítulos actuales. Si un laboratorio escribe `≤`, `≥`, `→`, o `"` y `<<` (atajos de babel en español), la compilación puede fallar. Para la Fase 1: mapear o restringir esos caracteres al exportar y avisar en el editor. Hay que revisarlo con el marco real.
- **Referencias colgantes:** aceptar la eliminación de un ítem con `\label` deja en "??" los `\ref` que lo citan, sin aviso. Para la Fase 1: avisar al exportar.
- **Identidad de las sugerencias:** los motivos y las decisiones se guardan por posición. Por eso, cuando un laboratorio vuelve a guardar, se borran todas las decisiones del revisor sobre su copia. Con 35 laboratorios eso pesa en el segundo anti-objetivo. En la Fase 1 la identidad debe salir del contenido (bloque + original + propuesta).

## 5. Recomendación frente a los anti-objetivos

| Anti-objetivo (spec §2) | Evidencia de la Fase 0 | Riesgo |
|---|---|---|
| No recoger bien el feedback | Los cambios de texto, de formato y los bloques nuevos o eliminados quedan como sugerencia con autor, tipo y ubicación exacta. La edición es directa, como en Word. Faltan los comentarios anclados (Fase 1). Hay dos huecos: unir o mover bloques solo da un aviso, y el primer ítem de una lista se ubica mal (§4). | Medio, mientras no se cierren esos dos huecos; bajo después |
| Consolidar sea más trabajoso que en Word | El revisor ve todo en un solo documento por colores, decide por sugerencia y exporta un `.tex` que compila sin tocarlo. En Word habría que fusionar 35 copias y además traspasar a LaTeX a mano. | Bajo–medio: falta probar con muchos laboratorios a la vez (ver abajo) |
| Costo mayor que una herramienta existente | La parte difícil (LaTeX exacto, sugerencias, conflictos) ya está resuelta y probada en el navegador. Lo que falta es PHP + MySQL convencional: cuentas, permisos, guardado, registro y Excel. | Medio: controlar el alcance de la Fase 1 |

**Decisión recomendada: seguir a la Fase 1 con la opción A.** La opción B (cola por bloque) queda como vista complementaria del revisor si un capítulo acumula demasiadas sugerencias para leerlas por color.

**Riesgos a vigilar en la Fase 1:**
1. **Escala visual:** con 35 laboratorios, la vista por colores puede saturarse en un mismo párrafo. Probar temprano con datos sintéticos de 10–35 copias y, si satura, sumar el filtro por laboratorio o la vista B.
2. **Marco real del manual:** conseguirlo de Fabio para que la exportación se verifique con el preámbulo definitivo.
3. **Base congelada:** corregir `NITRÓGENO1.1` línea 25 antes de abrir la consulta.
4. **Huecos del motor de cambios:** antes de abrir la consulta, anclar las inserciones también al bloque siguiente (primer ítem de una lista) y convertir unir o mover bloques en sugerencias aplicables.
