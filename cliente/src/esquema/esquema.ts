import { getSchema } from '@tiptap/core';
import { Node, type Schema } from '@tiptap/pm/model';
import type { DocJSON } from '../tipos';
import { extensionesManual } from './extensiones';

export { extensionesManual };

export const esquemaManual: Schema = getSchema(extensionesManual);

export type ResultadoValidacion = { ok: true } | { ok: false; error: string };

function mensaje(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Recoge recursivamente los `attrs.bloques` de cada notaPie del JSON. */
function notasPie(n: DocJSON, acc: DocJSON[][] = []): DocJSON[][] {
  if (n.type === 'notaPie' && Array.isArray(n.attrs?.bloques)) {
    acc.push(n.attrs.bloques as DocJSON[]);
  }
  for (const h of n.content ?? []) notasPie(h, acc);
  return acc;
}

export function validarDocumento(doc: DocJSON): ResultadoValidacion {
  try {
    Node.fromJSON(esquemaManual, doc).check();
  } catch (e) {
    return { ok: false, error: mensaje(e) };
  }
  for (const bloques of notasPie(doc)) {
    const envoltorio: DocJSON = {
      type: 'doc',
      content: [{ type: 'analito' }, { type: 'metodo' }, ...bloques],
    };
    const r = validarDocumento(envoltorio);
    if (!r.ok) return { ok: false, error: `notaPie: ${r.error}` };
  }
  return { ok: true };
}
