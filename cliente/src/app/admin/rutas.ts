/** Rutas de administración: `#/admin`, `#/admin/capitulos`, `#/admin/usuarios`, `#/admin/consulta`. */
import './admin.css';
import { el } from '../../editor/ui';
import type { Api } from '../api';
import type { FabricaVista, Vista } from '../router';
import { tieneRol } from '../sesion';
import type { Usuario } from '../tipos-api';
import { vistaCapitulos } from './capitulos';
import { cabeceraAdmin } from './comun';
import { vistaConsulta } from './consulta';
import { vistaUsuarios } from './usuarios';

function vistaIndice(): Vista {
  return {
    montar(raiz) {
      raiz.append(
        el(
          'main',
          { class: 'app admin' },
          cabeceraAdmin('Administración'),
          el(
            'ul',
            { class: 'capitulos' },
            ...[
              ['#/admin/consulta', 'Consulta', 'Fechas de apertura y cierre.'],
              ['#/admin/capitulos', 'Capítulos', 'Importar y subir capítulos .tex (solo en preparación).'],
              ['#/admin/usuarios', 'Usuarios', 'Importar cuentas, claves, roles y activación.'],
            ].map(([href, t, d]) =>
              el('li', { class: 'capitulo' }, el('div', { class: 'capitulo-titulo' }, el('a', { href }, t)), el('div', { class: 'capitulo-datos' }, d)),
            ),
          ),
        ),
      );
    },
    desmontar() {},
  };
}

const sinPermiso: Vista = {
  montar(raiz) {
    const caja = el('div', { class: 'error', role: 'alert' }, 'Esta sección es solo para administradores.');
    raiz.append(el('main', { class: 'app' }, caja, el('a', { href: '#/capitulos', class: 'enlace-boton' }, 'Volver al inicio')));
  },
  desmontar() {},
};

/**
 * @param protegida envuelve una fábrica que necesita sesión (la de `main.ts`).
 */
export function rutasAdmin(
  api: Api,
  protegida: (fabrica: (u: Usuario) => Vista) => FabricaVista,
): Record<string, FabricaVista> {
  const admin = (f: () => Vista) => protegida((u) => (tieneRol(u, 'admin') ? f() : sinPermiso));
  return {
    '#/admin': admin(vistaIndice),
    '#/admin/capitulos': admin(() => vistaCapitulos(api)),
    '#/admin/usuarios': admin(() => vistaUsuarios(api)),
    '#/admin/consulta': admin(() => vistaConsulta(api)),
  };
}
