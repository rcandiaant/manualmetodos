import type { Sugerencia } from '../tipos';
import { jsonEstable } from './tokens';

/** FNV-1a de 32 bits, en hexadecimal de 8 caracteres. */
export function fnv1a(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/**
 * Id por contenido: `${autor}:${bloqueId}:${hash}`. No depende de rangos ni de la
 * posición: insertar otra sugerencia antes no cambia los ids de las demás.
 * `ocurrencia` (desde 0) desambigua sugerencias idénticas del mismo autor y bloque.
 * Solo usa caracteres `[A-Za-z0-9:@+_-]` si autor y bloqueId los usan.
 */
export function idSugerencia(s: Omit<Sugerencia, 'id'>, ocurrencia: number): string {
  const hash = fnv1a(
    jsonEstable({
      tipo: s.tipo,
      original: s.original,
      propuesta: s.propuesta,
      grupo: s.grupo ?? null,
      ocurrencia,
    }),
  );
  return `${s.autor}:${s.bloqueId}:${hash}`;
}

/** Asigna `id` a cada sugerencia (en orden de documento), contando las repetidas. */
export function asignarIds(sugs: Sugerencia[]): void {
  const vistas = new Map<string, number>();
  for (const s of sugs) {
    const clave = jsonEstable({
      autor: s.autor,
      bloqueId: s.bloqueId,
      tipo: s.tipo,
      original: s.original,
      propuesta: s.propuesta,
    });
    const k = vistas.get(clave) ?? 0;
    vistas.set(clave, k + 1);
    s.id = idSugerencia(s, k);
  }
}
