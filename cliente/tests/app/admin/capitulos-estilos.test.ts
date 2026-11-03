import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Los botones de borrar del admin deben ser legibles aunque esté cargado laboratorio.css, que define
 * `button.peligro` global con fondo rojo. jsdom no resuelve `background` con `var()`, así que:
 * 1) se comprueba que admin.css fija fondo, color y borde en cada estado (normal, :hover, :disabled);
 * 2) se cargan todas las hojas y se comprueba el `color` que gana en la cascada.
 * La verificación visual (captura) va aparte.
 */
const hoja = (ruta: string) => readFileSync(resolve(__dirname, '../../../src', ruta), 'utf8');

describe('admin: estilos de los botones de borrar', () => {
  it('admin.css fija fondo, color y borde en cada estado de ambos botones', () => {
    const css = hoja('app/admin/admin.css');
    for (const clase of ['borrar-capitulo', 'borrar-definitivo']) {
      for (const estado of ['', ':hover:not(:disabled)', ':disabled']) {
        const sel = `.admin button.${clase}${estado} {`;
        const i = css.indexOf(sel);
        expect(i, sel).toBeGreaterThanOrEqual(0);
        const cuerpo = css.slice(i + sel.length, css.indexOf('}', i));
        expect(cuerpo, sel).toMatch(/(^|;)\s*background:/);
        expect(cuerpo, sel).toMatch(/(^|;)\s*color:/);
        expect(cuerpo, sel).toMatch(/border(-color)?:/);
      }
    }
    expect(css).not.toMatch(/button\.peligro/);
  });

  it('con laboratorio.css cargado, el color que gana es el del admin', () => {
    for (const ruta of ['editor/estilos.css', 'app/app.css', 'app/laboratorio/laboratorio.css', 'app/admin/admin.css']) {
      const s = document.createElement('style');
      s.textContent = hoja(ruta);
      document.head.append(s);
    }
    const main = document.createElement('main');
    main.className = 'app admin';
    const crear = (clase: string, deshabilitado = false) => {
      const b = document.createElement('button');
      b.className = clase;
      b.disabled = deshabilitado;
      main.append(b);
      return b;
    };
    const borrar = crear('borrar-capitulo');
    const bloqueado = crear('borrar-capitulo', true);
    const definitivo = crear('borrar-definitivo');
    document.body.append(main);
    try {
      expect(getComputedStyle(borrar).color).toBe('var(--eliminado)'); // sobre fondo var(--papel)
      expect(getComputedStyle(bloqueado).color).toBe('var(--tenue)'); // sobre fondo var(--fondo)
      expect(getComputedStyle(bloqueado).opacity).toBe('1');
      expect(getComputedStyle(definitivo).color).toBe('rgb(255, 255, 255)'); // sobre fondo var(--eliminado)
    } finally {
      main.remove();
      document.head.replaceChildren();
    }
  });
});
