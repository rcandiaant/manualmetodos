/** Lee los avisos de referencias indefinidas de un .log de pdflatex. */

/** Une las líneas que pdflatex partió al llegar a 79 caracteres. */
function desenvolver(log: string): string {
  const lineas = log.replace(/\r\n?/g, '\n').split('\n');
  let s = '';
  for (const l of lineas) s += l.length === 79 ? l : `${l}\n`;
  return s;
}

/**
 * Devuelve las referencias y citas indefinidas del log, como `ref:x` / `cita:x`,
 * ordenadas y sin repetir. Si el log dice "There were undefined references" pero
 * no se extrajo ninguna, añade `?:resumen` para que nunca pase en verde.
 */
export function extraerReferenciasIndefinidas(log: string): string[] {
  const t = desenvolver(log);
  const set = new Set<string>();
  for (const m of t.matchAll(/(Reference|Citation)\s+`([^']*)'\s+on\s+page\s+\S+\s+undefined/g)) {
    set.add(`${m[1] === 'Reference' ? 'ref' : 'cita'}:${m[2]}`);
  }
  if (set.size === 0 && /There were undefined (references|citations)/.test(t)) set.add('?:resumen');
  return [...set].sort();
}
