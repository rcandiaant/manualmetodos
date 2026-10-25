# Fase 1A: medición de escala con 35 laboratorios

Comando: `npm run escala -- --labs 35 --ediciones 8 --semilla 1` (desde `cliente/`).

## Método

- Para cada uno de los 15 capítulos de `manual-fuente/tex/` se importa el LaTeX (`importarLatex`) y se generan 35 copias, cada una con 8 mutaciones al azar (PRNG de semilla fija). Las mutaciones son las de `tests/ayudantes-mutacion.ts`: edición de texto, inserción y eliminación de bloque, ítem nuevo como primer ítem, unión de un ítem con el anterior y movimiento de un ítem a otra lista.
- Se miden en milisegundos `calcularSugerencias` (las 35 copias), `detectarConflictos`, la decisión de qué aceptar (`decidir`, que cierra los grupos con `completarGrupo`) y `aplicarSugerencias`. Se acepta una sugerencia por conflicto (gana un laboratorio, rotando; se aceptan todos sus miembros del conflicto, incluidos los grupos de bloque movido) y todas las demás.
- El resultado se exporta con `exportarLatex` y se compila con `pdflatex` (marco de prueba, dos pasadas).
- El "ms total" suma esas cuatro etapas; no incluye importar, mutar, exportar ni compilar.
- Los tiempos son de un equipo de desarrollo (Windows 11, Node, una sola corrida). Sirven como orden de magnitud.

## Resultados

| capítulo | sugerencias | conflictos | labs/bloque p50 | p90 | máx | % bloques >5 labs | props. distintas máx | % bloques >5 props. | sug. ancladas máx | ms calcular | ms conflictos | ms decidir | ms aplicar | ms total | compila |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| aluminio | 511 | 2 | 16 | 21 | 25 | 100 | 12 | 57 | 35 | 76 | 10 | 1 | 3 | 90 | ok |
| analitoMICRONUTRIENTES | 638 | 1 | 14 | 19 | 24 | 98 | 14 | 43 | 30 | 135 | 15 | 3 | 2 | 155 | ok |
| azufre | 574 | 4 | 13 | 20 | 24 | 88 | 14 | 28 | 24 | 104 | 11 | 3 | 4 | 122 | ok |
| boro-aguacaliente | 538 | 2 | 12 | 17 | 19 | 96 | 16 | 33 | 20 | 96 | 4 | 1 | 2 | 103 | ok |
| cationes | 731 | 3 | 12 | 17 | 20 | 95 | 10 | 22 | 24 | 127 | 17 | 1 | 2 | 147 | ok |
| CE | 930 | 3 | 17 | 20 | 23 | 93 | 10 | 27 | 25 | 156 | 9 | 2 | 3 | 170 | ok |
| CO-calcinación | 499 | 3 | 15 | 19 | 22 | 100 | 14 | 55 | 22 | 79 | 11 | 1 | 1 | 92 | ok |
| CO | 929 | 2 | 15 | 21 | 23 | 97 | 15 | 27 | 38 | 109 | 22 | 6 | 5 | 142 | ok |
| dumas | 666 | 2 | 17 | 22 | 25 | 95 | 14 | 37 | 25 | 89 | 23 | 4 | 1 | 117 | ok |
| fosforo-olsen | 736 | 4 | 12 | 16 | 19 | 95 | 15 | 18 | 19 | 134 | 4 | 1 | 1 | 140 | ok |
| nitrogeno | 490 | 2 | 15 | 24 | 26 | 93 | 15 | 69 | 28 | 78 | 20 | 1 | 1 | 100 | ok |
| NITRÓGENO1.1 | 465 | 5 | 13 | 24 | 27 | 87 | 19 | 35 | 31 | 90 | 8 | 1 | 1 | 100 | ok |
| NITRÓGENO1.2 | 896 | 3 | 11 | 13 | 16 | 92 | 11 | 15 | 17 | 155 | 9 | 2 | 3 | 169 | ok |
| pHjav | 449 | 1 | 19 | 22 | 26 | 100 | 23 | 71 | 28 | 99 | 7 | 1 | 1 | 108 | ok |
| textura | 992 | 5 | 13 | 16 | 21 | 94 | 9 | 9 | 21 | 125 | 11 | 1 | 2 | 139 | ok |

Columnas de saturación: por bloque (sin el ancla de inicio de documento) se cuentan los laboratorios distintos con alguna propuesta, y las propuestas distintas tras colapsar las idénticas (mismo tipo, original y propuesta). Los percentiles y los porcentajes se calculan sobre los bloques con al menos una propuesta. "Sug. ancladas máx" es el número bruto de sugerencias ancladas a un bloque (una inserción se ancla al bloque anterior); se conserva solo como referencia.

## Criterios

- Tiempo total por capítulo < 2000 ms: **cumple**. El máximo es 170 ms (CE).
- El resultado compila: **15/15**.
- `aplicarSugerencias` no lanza error: **15/15** sin excepciones.

## Límites del modelo de prueba

Las cifras de conflictos y de concentración dependen del generador, no de laboratorios reales:

- Las mutaciones se reparten de forma uniforme y al azar sobre todo el capítulo. Los laboratorios reales se concentran en los mismos pasos (una cifra, una unidad), lo que daría más conflictos de los 1 a 5 medidos por capítulo. Esos 1 a 5 conflictos no son una estimación del caso real.
- Cada capítulo tiene pocos bloques frente a 280 ediciones (35 x 8), por lo que la mediana de laboratorios por bloque (11 a 19) y la fracción de bloques con más de 5 laboratorios (87 a 100 %) son altas. Es el efecto de ese cociente y de las inserciones y movimientos (que generan varias sugerencias ancladas), no una predicción.
- Con ese modelo, entre 9 % y 71 % de los bloques tienen más de 5 propuestas distintas, de modo que una vista que liste todo sin agrupar se satura.
- Una sola corrida, sin calentamiento: los tiempos son orden de magnitud.

## Recomendación para la vista del revisor (plan 1C)

Como el máximo de laboratorios distintos por bloque (27) y el p90 (13 a 24) superan 5:

1. Vista **por bloque** con un contador de laboratorios, y las propuestas idénticas de distintos laboratorios **colapsadas** en una sola fila con su contador.
2. Los **conflictos como cola priorizada** y ordenable, para decidirlos primero.
3. **Filtro por laboratorio** para revisar las propuestas de uno solo.
4. "Solo conflictos" como **filtro opcional**, no por defecto: con 1 a 5 conflictos frente a 450 a 990 sugerencias por capítulo, ocultaría casi todo lo que el revisor debe decidir.
5. Mantener la decisión por grupo para los bloques movidos (aceptar o rechazar el movimiento entero).
