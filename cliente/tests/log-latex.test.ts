import { describe, it, expect } from 'vitest';
import { extraerReferenciasIndefinidas } from '../scripts/log-latex';
import { compararLatex } from '../src/latex/normalizar';

describe('extraerReferenciasIndefinidas', () => {
  it('une avisos partidos a 79 caracteres y compara conjuntos', () => {
    const aviso = "LaTeX Warning: Reference `una-etiqueta-larga' on page 3 undefined on input line 12.";
    const partido = aviso.slice(0, 79) + '\n' + aviso.slice(79);
    expect(partido.split('\n')[0]).toHaveLength(79);
    const log = `x\n${partido}\nLaTeX Warning: Citation \`k' on page 1 undefined on input line 3.\nLaTeX Warning: Reference \`a' on page 1 undefined on input line 4.\n`;
    expect(extraerReferenciasIndefinidas(log)).toEqual(['cita:k', 'ref:a', 'ref:una-etiqueta-larga']);
  });
  it('el resumen sin avisos extraídos no pasa en verde', () => {
    expect(extraerReferenciasIndefinidas('LaTeX Warning: There were undefined references.')).toEqual(['?:resumen']);
    expect(extraerReferenciasIndefinidas('todo bien')).toEqual([]);
  });
});

describe('R23 con CRLF', () => {
  it('comentario seguido de línea en blanco CRLF conserva el párrafo', () => {
    expect(compararLatex('Uno. % c\r\n\r\nDos.', 'Uno. Dos.').igual).toBe(false);
    expect(compararLatex('Uno. % c\r\n\r\nDos.', 'Uno.\n\nDos.').igual).toBe(true);
  });
});
