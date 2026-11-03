/** CSV para planillas (Excel en español): neutralización de fórmulas y armado con BOM. */

/** Celda CSV: antepone `'` si empieza como fórmula de planilla y entrecomilla si hace falta. */
export const celdaCsv = (v: string): string => {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",;\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

/**
 * Limpia una celda pegada como lo hace el servidor (AdminCtl::limpiarCampo): NBSP pasa a espacio,
 * se quitan los caracteres de formato invisibles (BOM, U+200B/C/D…) y los espacios Unicode de los extremos.
 */
const limpiarCelda = (v: string): string => v.replace(/ /g, ' ').replace(/\p{Cf}/gu, '').trim();

/** Campos de una línea CSV con comillas `"…"` (`""` escapa una comilla), como `str_getcsv` del servidor. */
function camposCsv(linea: string, sep: string): string[] {
  const campos: string[] = [];
  let actual = '';
  let comillas = false;
  for (let i = 0; i < linea.length; i++) {
    const c = linea[i];
    if (comillas) {
      if (c !== '"') actual += c;
      else if (linea[i + 1] === '"') actual += linea[++i];
      else comillas = false;
    } else if (c === '"' && actual === '') comillas = true;
    else if (c === sep) {
      campos.push(actual);
      actual = '';
    } else actual += c;
  }
  campos.push(actual);
  return campos;
}

/**
 * Separador de un CSV pegado, según su primera línea (igual que AdminCtl::separadorCsv): el primer
 * candidato (tabulador de Excel, `;`, `,`) que da exactamente 3 campos; si ninguno, el primero que aparezca.
 */
export function separadorCsv(linea: string): string {
  const candidato = ['\t', ';', ','].find((s) => camposCsv(linea, s).length === 3);
  return candidato ?? (linea.includes('\t') ? '\t' : linea.includes(';') ? ';' : ',');
}

/** ¿Es la línea el encabezado opcional `nombre,correo,laboratorio` (con cualquier separador, espacios o mayúsculas)? */
export function esEncabezadoUsuarios(linea: string): boolean {
  const celdas = camposCsv(linea, separadorCsv(linea)).map((c) =>
    limpiarCelda(c).replace(/^[“”„‟‘’‚‛«»‹›](.*)[“”„‟‘’‚‛«»‹›]$/, '$1').trim().toLowerCase(),
  );
  return celdas.join('|') === 'nombre|correo|laboratorio';
}

/** ¿Está vacía la línea (solo separadores, espacios o caracteres invisibles, como una fila vacía de Excel)? */
export const lineaVacia = (linea: string): boolean => limpiarCelda(linea.replace(/[\t;,]/g, '')) === '';

/** CSV completo: UTF-8 con BOM, separador `;`, fin de línea LF y cada celda por `celdaCsv`. */
export function armarCsv(cabecera: string[], filas: string[][]): string {
  const linea = (celdas: string[]): string => celdas.map(celdaCsv).join(';');
  return `﻿${[cabecera, ...filas].map(linea).join('\n')}\n`;
}
