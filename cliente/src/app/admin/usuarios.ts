/**
 * Administración de usuarios (`#/admin/usuarios`): lista y filtro, importación de CSV,
 * regeneración de claves, activación y roles (docs/api.md §4.6).
 *
 * Las claves generadas viven solo en una variable del cierre de la vista: no se escriben
 * en localStorage/sessionStorage y se descartan al ocultarlas o al salir de la vista.
 */
import { boton, el } from '../../editor/ui';
import { ErrorApi, type Api } from '../api';
import type { Vista } from '../router';
import type { ClaveRegenerada, CuentaImportada, Rol, UsuarioAdmin, UsuarioCambio } from '../tipos-api';
import { cabeceraAdmin, cajaError, mensajeError, mostrar } from './comun';

const ROLES: Rol[] = ['laboratorio', 'revisor', 'admin'];
const MAX_FILAS = 100;

export interface VistaUsuarios extends Vista {
  readonly listo: Promise<void>;
  /** Envía el CSV a `POST /admin/usuarios/importar` y muestra las claves (una sola vez). */
  importar(csv: string): Promise<void>;
  /** Claves visibles ahora en pantalla (vacío si se ocultaron o se salió de la vista). */
  clavesMostradas(): CuentaImportada[];
}

/** Interpreta el mensaje de líneas del servidor: "…inválidos: 3, 7; …líneas: 5." */
export function lineasDeCsv(mensaje: string): string[] {
  const res: string[] = [];
  for (const parte of mensaje.split(';')) {
    const numeros = (parte.match(/\d+/g) ?? []).map(Number);
    if (/inv[aá]lid/i.test(parte)) for (const n of numeros) res.push(`Línea ${n}: datos inválidos`);
    else if (/repetid|registrad/i.test(parte)) for (const n of numeros) res.push(`Línea ${n}: correo repetido o ya registrado`);
  }
  return res;
}

/** Celda CSV: antepone `'` si empieza como fórmula de planilla y entrecomilla si hace falta. */
const celdaCsv = (v: string): string => {
  const seguro = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",;\r\n]/.test(seguro) ? `"${seguro.replace(/"/g, '""')}"` : seguro;
};

/** Filas de datos no vacías del CSV (sin contar el encabezado); aproximado, para el tope de 100. */
function contarFilas(csv: string): number {
  const lineas = csv.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim() !== '');
  return Math.max(0, lineas.length - 1);
}

export function vistaUsuarios(api: Api): VistaUsuarios {
  let vigente = true;
  let listo: Promise<void> = Promise.resolve();
  let usuarios: UsuarioAdmin[] = [];
  let filtro = '';
  let claves: CuentaImportada[] = [];
  let origenClaves = '';
  let confirmando: number | null = null;

  const errores = cajaError();
  const erroresCsv = el('div', { class: 'errores-csv error', role: 'alert', hidden: '' });
  const panelClaves = el('section', { class: 'panel-claves', hidden: '' });
  const cuerpo = el('tbody');
  const texto = el('textarea', {
    rows: '6',
    'aria-label': 'CSV de usuarios',
    placeholder: 'nombre,correo,laboratorio\nAna Pérez,ana@lab.cl,Laboratorio Norte',
  });

  const avisoCopia = el('p', { class: 'copiado', role: 'status' });

  function olvidarClaves(): void {
    avisoCopia.textContent = '';
    claves = [];
    origenClaves = '';
    panelClaves.replaceChildren();
    panelClaves.hidden = true;
  }

  /** Suma claves nuevas a las que siguen visibles: nunca descarta claves aún no copiadas. */
  function agregarClaves(nuevas: CuentaImportada[], titulo: string): void {
    const previas = claves.length;
    claves = [...claves, ...nuevas];
    origenClaves = previas > 0 ? 'Claves pendientes de copiar' : titulo;
  }

  function dibujarClaves(): void {
    if (claves.length === 0) return olvidarClaves();
    panelClaves.replaceChildren(
      el('h2', {}, origenClaves),
      el(
        'p',
        { class: 'advertencia', role: 'alert' },
        'Estas claves se muestran una sola vez y no volverán a mostrarse. Cópielas o descárguelas ahora y entréguelas por un canal seguro. Al salir de esta página se pierden.',
      ),
      el(
        'table',
        { class: 'tabla' },
        el('thead', {}, el('tr', {}, el('th', {}, 'Correo'), el('th', {}, 'Clave'))),
        el('tbody', {}, ...claves.map((c) => el('tr', {}, el('td', {}, c.correo), el('td', {}, el('code', {}, c.clave))))),
      ),
      el(
        'div',
        { class: 'acciones' },
        boton('Copiar todo', () => {
          const t = ['correo\tclave', ...claves.map((c) => `${c.correo}\t${c.clave}`)].join('\n');
          const falla = () => {
            avisoCopia.textContent = 'No se pudo copiar: seleccione la tabla con el ratón y cópiela a mano.';
            const tabla = panelClaves.querySelector('table');
            if (tabla) {
              const rango = document.createRange();
              rango.selectNodeContents(tabla);
              const sel = window.getSelection();
              sel?.removeAllRanges();
              sel?.addRange(rango);
            }
          };
          if (!navigator.clipboard) return falla();
          navigator.clipboard.writeText(t).then(() => {
            avisoCopia.textContent = 'Copiado al portapapeles.';
          }, falla);
        }),
        boton('Descargar CSV', () => {
          const csv = ['correo,clave', ...claves.map((c) => `${celdaCsv(c.correo)},${celdaCsv(c.clave)}`)].join('\r\n') + '\r\n';
          const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
          const a = el('a', { href: url, download: 'claves-usuarios.csv' });
          document.body.append(a);
          a.click();
          a.remove();
          window.setTimeout(() => URL.revokeObjectURL(url), 1000);
        }),
        boton('Ocultar claves', olvidarClaves),
      ),
      avisoCopia,
    );
    panelClaves.hidden = false;
  }

  function filaUsuario(u: UsuarioAdmin): HTMLElement {
    const roles = el(
      'div',
      { class: 'roles' },
      ...ROLES.map((r) => {
        const c = el('input', { type: 'checkbox', value: r, id: `rol-${u.id}-${r}` });
        c.checked = u.roles.includes(r);
        return el('label', { for: `rol-${u.id}-${r}` }, c, ` ${r}`);
      }),
    );
    const acciones = el(
      'div',
      { class: 'acciones' },
      boton('Guardar roles', () => {
        const lista = ROLES.filter((r) => roles.querySelector<HTMLInputElement>(`input[value=${r}]`)?.checked);
        if (lista.length === 0) return mostrar(errores, 'Cada usuario debe tener al menos un rol.');
        void cambiar(u, { roles: lista });
      }),
      boton(u.activo ? 'Desactivar' : 'Activar', () => void cambiar(u, { activo: !u.activo })),
      boton('Regenerar clave', () => {
        confirmando = u.id;
        dibujarLista();
      }),
    );
    const celdas: HTMLElement[] = [
      el('td', {}, u.nombre),
      el('td', {}, u.correo),
      el('td', {}, u.laboratorio),
      el('td', {}, roles),
      el('td', { class: u.activo ? '' : 'inactivo' }, u.activo ? 'Activo' : 'Inactivo'),
      el('td', {}, acciones),
    ];
    if (confirmando === u.id) {
      acciones.append(
        el(
          'div',
          { class: 'confirmar', role: 'alert' },
          `Regenerar la clave de ${u.nombre} cerrará todas sus sesiones abiertas. `,
          boton('Confirmar regeneración', () => void regenerar(u), 'primario'),
          boton('Cancelar', () => {
            confirmando = null;
            dibujarLista();
          }),
        ),
      );
    }
    return el('tr', {}, ...celdas);
  }

  function dibujarLista(): void {
    const q = filtro.trim().toLowerCase();
    const vistos = usuarios.filter(
      (u) => !q || [u.nombre, u.correo, u.laboratorio].some((t) => t.toLowerCase().includes(q)),
    );
    cuerpo.replaceChildren(...vistos.map(filaUsuario));
    if (vistos.length === 0) cuerpo.append(el('tr', {}, el('td', { colspan: '6', class: 'vacio' }, 'Sin usuarios que coincidan.')));
  }

  async function cargarLista(): Promise<void> {
    usuarios = await api.get<UsuarioAdmin[]>('/admin/usuarios');
    if (vigente) dibujarLista();
  }

  async function cambiar(u: UsuarioAdmin, cambio: UsuarioCambio): Promise<void> {
    mostrar(errores, null);
    listo = (async () => {
      try {
        await api.patch(`/admin/usuarios/${u.id}`, cambio);
        if (!vigente) return;
        if (cambio.activo !== undefined) u.activo = cambio.activo;
        if (cambio.roles) {
          u.roles = cambio.roles;
        }
        dibujarLista();
      } catch (e) {
        if (vigente) mostrar(errores, e instanceof ErrorApi && e.codigo === 'operacion_no_permitida'
          ? 'Un administrador no puede desactivarse ni quitarse el rol admin a sí mismo.'
          : mensajeError(e));
      }
    })();
    return listo;
  }

  async function regenerar(u: UsuarioAdmin): Promise<void> {
    mostrar(errores, null);
    confirmando = null;
    listo = (async () => {
      try {
        const r = await api.post<ClaveRegenerada>(`/admin/usuarios/${u.id}/clave`);
        if (!vigente) return;
        agregarClaves([{ correo: u.correo, clave: r.clave }], `Nueva clave de ${u.nombre}`);
        dibujarClaves();
      } catch (e) {
        if (vigente) mostrar(errores, mensajeError(e));
      }
      if (vigente) dibujarLista();
    })();
    return listo;
  }

  function importar(csv: string): Promise<void> {
    mostrar(errores, null);
    mostrar(erroresCsv, null);
    erroresCsv.replaceChildren();
    listo = (async () => {
      if (csv.trim() === '') {
        erroresCsv.textContent = 'Pegue o elija un CSV con el encabezado nombre,correo,laboratorio.';
        erroresCsv.hidden = false;
        return;
      }
      if (contarFilas(csv) > MAX_FILAS) {
        erroresCsv.textContent = `El CSV tiene más de ${MAX_FILAS} filas: divídalo en importaciones de hasta ${MAX_FILAS}.`;
        erroresCsv.hidden = false;
        return;
      }
      try {
        const r = await api.post<CuentaImportada[]>('/admin/usuarios/importar', { csv });
        if (!vigente) return;
        agregarClaves(r, `Cuentas creadas: ${r.length}`);
        texto.value = '';
        dibujarClaves();
        await cargarLista();
      } catch (e) {
        if (!vigente) return;
        if (e instanceof ErrorApi && e.estado === 400) {
          const msg = e.campos?.csv ?? e.message;
          const items = lineasDeCsv(msg);
          erroresCsv.replaceChildren(
            el('p', {}, msg),
            items.length ? el('ul', {}, ...items.map((t) => el('li', {}, t))) : '',
          );
          erroresCsv.hidden = false;
        } else mostrar(errores, mensajeError(e));
      }
    })();
    return listo;
  }

  return {
    get listo() {
      return listo;
    },
    importar,
    clavesMostradas: () => claves.map((c) => ({ ...c })),
    montar(raiz) {
      const buscar = el('input', { type: 'search', 'aria-label': 'Filtrar usuarios', placeholder: 'Filtrar por nombre, correo o laboratorio' });
      buscar.addEventListener('input', () => {
        filtro = buscar.value;
        dibujarLista();
      });
      const archivo = el('input', { type: 'file', accept: '.csv,text/csv,text/plain', 'aria-label': 'Archivo CSV' });
      archivo.addEventListener('change', () => {
        const f = archivo.files?.[0];
        if (f) void f.text().then((t) => vigente && (texto.value = t));
      });
      raiz.append(
        el(
          'main',
          { class: 'app admin' },
          cabeceraAdmin('Usuarios'),
          errores,
          el(
            'section',
            {},
            el('h2', {}, 'Importar usuarios'),
            el('p', { class: 'ayuda' }, `Encabezado nombre,correo,laboratorio (separador , o ;), hasta ${MAX_FILAS} filas. Pegue el CSV o elija un archivo.`),
            texto,
            archivo,
            el('div', { class: 'acciones' }, boton('Importar', () => void importar(texto.value), 'primario')),
            erroresCsv,
          ),
          panelClaves,
          el('h2', {}, 'Usuarios'),
          buscar,
          el(
            'table',
            { class: 'tabla' },
            el(
              'thead',
              {},
              el('tr', {}, ...['Nombre', 'Correo', 'Laboratorio', 'Roles', 'Estado', 'Acciones'].map((t) => el('th', {}, t))),
            ),
            cuerpo,
          ),
        ),
      );
      listo = cargarLista().catch((e: unknown) => {
        if (vigente) mostrar(errores, mensajeError(e));
      });
    },
    desmontar() {
      vigente = false;
      olvidarClaves();
      texto.value = '';
      usuarios = [];
      cuerpo.replaceChildren();
    },
  };
}
