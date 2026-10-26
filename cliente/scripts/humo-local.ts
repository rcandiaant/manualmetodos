/**
 * Guarda de la prueba de humo: el SQL de desarrollo y `crear-admin.php` van siempre al stack
 * Docker local, así que la prueba se niega a correr si HUMO_URL apunta a otro servidor.
 */
const LOCALES = new Set(['localhost', '127.0.0.1', '[::1]']);

export function esUrlLocal(url: string): boolean {
  try {
    return LOCALES.has(new URL(url).hostname);
  } catch {
    return false;
  }
}
