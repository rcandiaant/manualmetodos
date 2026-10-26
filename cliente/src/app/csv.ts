/** CSV para planillas (Excel en español): neutralización de fórmulas y armado con BOM. */

/** Celda CSV: antepone `'` si empieza como fórmula de planilla y entrecomilla si hace falta. */
export const celdaCsv = (v: string): string => {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",;\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

/** CSV completo: UTF-8 con BOM, separador `;`, fin de línea LF y cada celda por `celdaCsv`. */
export function armarCsv(cabecera: string[], filas: string[][]): string {
  const linea = (celdas: string[]): string => celdas.map(celdaCsv).join(';');
  return `﻿${[cabecera, ...filas].map(linea).join('\n')}\n`;
}
