/** Nombres de archivo compartidos (módulo pequeño: no arrastra el editor a quien lo importe). */

/** `cap-1` o, si no sirve, un slug ASCII simple del título (misma forma que exige el servidor: `[a-z0-9-]`). */
export function nombreTex(slug: string | undefined, titulo: string | undefined, capituloId: number): string {
  if (slug && /^[a-z0-9-]{1,80}$/.test(slug)) return `${slug}.tex`;
  const ascii = (titulo ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
  return `${ascii || `capitulo-${capituloId}`}.tex`;
}
