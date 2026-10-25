import type { Sugerencia } from '../tipos';

/**
 * Clave de un grupo (bloque movido): autor + `grupo`. El mismo `grupo` de dos autores
 * son grupos distintos. null si la sugerencia no tiene grupo.
 */
export const claveGrupo = (s: Sugerencia): string | null =>
  s.grupo === undefined ? null : `${s.autor}\u0000${s.grupo}`;

export interface Conflicto {
  bloqueId: string;
  ids: string[];
}

/**
 * true si dos sugerencias del mismo bloque y de autores distintos chocan:
 * - una es `bloque-eliminado` (cualquier otra cosa en ese bloque lo toca);
 * - ambas son `bloque-insertado` (misma posición: tras el mismo ancla);
 * - ambas editan el texto y sus rangos base se solapan, o ambas son inserciones
 *   en el mismo punto (rangos vacíos con igual `desde`).
 * Un `bloque-insertado` (va después del bloque) no choca con ediciones de su texto.
 */
function chocan(a: Sugerencia, b: Sugerencia): boolean {
  if (a.autor === b.autor || a.bloqueId !== b.bloqueId) return false;
  if (a.tipo === 'bloque-eliminado' || b.tipo === 'bloque-eliminado') return true;
  const insA = a.tipo === 'bloque-insertado';
  const insB = b.tipo === 'bloque-insertado';
  if (insA || insB) return insA && insB;
  if (a.base.desde < b.base.hasta && b.base.desde < a.base.hasta) return true;
  const vacioA = a.base.desde === a.base.hasta;
  const vacioB = b.base.desde === b.base.hasta;
  return vacioA && vacioB && a.base.desde === b.base.desde;
}

/**
 * true si dos sugerencias de autores distintos chocan a través del `siguiente` de una
 * inserción `primerHijo` (que se ubica antes de ese bloque, R4):
 * - una es `primerHijo` antes de X y la otra elimina X;
 * - ambas son `primerHijo` antes del mismo X.
 */
function chocanPorSiguiente(a: Sugerencia, b: Sugerencia): boolean {
  if (a.autor === b.autor) return false;
  const antesDe = (s: Sugerencia) => (s.primerHijo ? s.siguiente : undefined);
  const elimina = (s: Sugerencia) => (s.tipo === 'bloque-eliminado' ? s.bloqueId : undefined);
  const xa = antesDe(a);
  const xb = antesDe(b);
  if (xa !== undefined && (xa === xb || xa === elimina(b))) return true;
  return xb !== undefined && xb === elimina(a);
}

/**
 * Grupos (cierre transitivo) de sugerencias en conflicto, en orden de aparición. Los
 * miembros de un mismo `grupo` (y autor) entran juntos si choca cualquiera de ellos.
 */
export function detectarConflictos(sugerencias: Sugerencia[]): Conflicto[] {
  const padre = sugerencias.map((_, i) => i);
  const raiz = (i: number): number => {
    while (padre[i] !== i) {
      padre[i] = padre[padre[i]];
      i = padre[i];
    }
    return i;
  };
  const enConflicto = new Set<number>();

  const porBloque = new Map<string, number[]>();
  sugerencias.forEach((s, i) => {
    const l = porBloque.get(s.bloqueId) ?? [];
    l.push(i);
    porBloque.set(s.bloqueId, l);
  });
  for (const indices of porBloque.values()) {
    for (let x = 0; x < indices.length; x++) {
      for (let y = x + 1; y < indices.length; y++) {
        const i = indices[x];
        const j = indices[y];
        if (!chocan(sugerencias[i], sugerencias[j])) continue;
        enConflicto.add(i).add(j);
        padre[raiz(i)] = raiz(j);
      }
    }
  }

  // Choques entre bloques distintos vía `siguiente` de una inserción `primerHijo`.
  const conSiguiente = sugerencias.flatMap((s, i) => (s.primerHijo && s.siguiente !== undefined ? [i] : []));
  for (const i of conSiguiente) {
    sugerencias.forEach((_, j) => {
      if (i === j || !chocanPorSiguiente(sugerencias[i], sugerencias[j])) return;
      enConflicto.add(i).add(j);
      padre[raiz(i)] = raiz(j);
    });
  }

  // Un grupo (mismo autor y `grupo`: bloque movido) choca si choca cualquiera de sus
  // miembros: todos entran al mismo conflicto, porque se deciden juntos.
  const porGrupo = new Map<string, number[]>();
  sugerencias.forEach((s, i) => {
    const k = claveGrupo(s);
    if (k === null) return;
    porGrupo.set(k, [...(porGrupo.get(k) ?? []), i]);
  });
  for (const miembros of porGrupo.values()) {
    if (!miembros.some((i) => enConflicto.has(i))) continue;
    for (const i of miembros) {
      enConflicto.add(i);
      padre[raiz(i)] = raiz(miembros[0]);
    }
  }

  const grupos = new Map<number, Conflicto>();
  sugerencias.forEach((s, i) => {
    if (!enConflicto.has(i)) return;
    const r = raiz(i);
    const g = grupos.get(r) ?? { bloqueId: s.bloqueId, ids: [] };
    g.ids.push(s.id);
    grupos.set(r, g);
  });
  return [...grupos.values()];
}
