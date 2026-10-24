import 'katex/dist/katex.min.css';
import './estilos.css';
import { esquemaManual, validarDocumento } from '../esquema/esquema';
import { importarLatex } from '../latex/importar';
import type { DocJSON } from '../tipos';
import { cargarEstado, guardarEstado, LABS, type ContextoModo, type Lab, type Modo } from './almacen';
import { montarLaboratorio } from './laboratorio';
import { montarRevisor } from './revisor';
import { cajaError, el, mensajeDe } from './ui';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const entradaArchivo = $<HTMLInputElement>('archivo');
const nombreArchivo = $<HTMLSpanElement>('nombre-archivo');
const selectorModo = $<HTMLFieldSetElement>('selector-modo');
const selectorLab = $<HTMLLabelElement>('selector-lab');
const lab = $<HTMLSelectElement>('lab');
const avisoAlmacen = $<HTMLDivElement>('aviso-almacen');
const errorCarga = $<HTMLDivElement>('error-carga');
const avisos = $<HTMLDetailsElement>('avisos');
const contenido = $<HTMLElement>('contenido');

const { estado, persistente, aviso: avisoCarga } = cargarEstado();
const ctx: ContextoModo = {
  estado,
  guardar: () => {
    const ok = guardarEstado(estado);
    mostrarAvisoAlmacen(ok);
    return ok;
  },
};

function mostrarAvisoAlmacen(ok: boolean): void {
  avisoAlmacen.hidden = ok;
  avisoAlmacen.textContent = ok
    ? ''
    : 'No hay almacenamiento local disponible: la demo funciona, pero lo guardado se perderá al recargar la página.';
}

let actual: Modo | null = null;

const modoElegido = (): 'laboratorio' | 'revisor' =>
  (selectorModo.querySelector<HTMLInputElement>('input:checked')?.value as 'laboratorio' | 'revisor') ?? 'laboratorio';

function mostrarAvisos(): void {
  const n = estado.avisos.length;
  avisos.hidden = estado.base === null || n === 0;
  (avisos.querySelector('summary') as HTMLElement).textContent =
    `${n} aviso${n === 1 ? '' : 's'} de importación`;
  (avisos.querySelector('ul') as HTMLElement).replaceChildren(...estado.avisos.map((a) => el('li', {}, a)));
}

function montar(opciones?: { descartar?: boolean }): void {
  actual?.destruir(opciones);
  actual = null;
  const modo = modoElegido();
  selectorLab.hidden = modo !== 'laboratorio';
  nombreArchivo.textContent = estado.archivo ?? '';
  mostrarAvisos();
  if (!estado.base) {
    contenido.replaceChildren(
      el(
        'div',
        { class: 'vacio-inicial' },
        el('h2', {}, 'Cargue un capítulo para comenzar'),
        el('p', {}, 'Use «Cargar capítulo (.tex)» y elija un archivo de manual-fuente/tex/.'),
        el(
          'p',
          {},
          'Luego edite como Laboratorio A y B (cada uno guarda su copia) y revise ambas propuestas en modo Revisor.',
        ),
      ),
    );
    return;
  }
  actual = modo === 'laboratorio' ? montarLaboratorio(contenido, ctx, lab.value as Lab) : montarRevisor(contenido, ctx);
}

async function cargarArchivo(archivo: File): Promise<void> {
  let base: DocJSON;
  let avisosImportacion: string[];
  try {
    const { doc, avisos: a } = importarLatex(await archivo.text());
    const v = validarDocumento(doc);
    if (!v.ok) throw new Error(`el capítulo importado no cumple el esquema: ${v.error}`);
    // Normalizado por el esquema: attrs por defecto explícitos, igual que el JSON del editor.
    base = esquemaManual.nodeFromJSON(doc).toJSON() as DocJSON;
    avisosImportacion = a;
  } catch (e) {
    cajaError(errorCarga, `no se pudo importar «${archivo.name}»: ${mensajeDe(e)}`);
    return;
  }
  const hayTrabajo = LABS.some((l) => estado.copias[l]) || Object.keys(estado.decisiones).length > 0;
  if (hayTrabajo && !window.confirm('Cargar otro capítulo descarta las copias de los laboratorios y las decisiones. ¿Continuar?')) {
    return;
  }
  cajaError(errorCarga, null);
  estado.archivo = archivo.name;
  estado.base = base;
  estado.avisos = avisosImportacion;
  estado.copias = {};
  estado.motivos = { labA: {}, labB: {} };
  estado.decisiones = {};
  estado.decisionesDescartadas = {};
  ctx.guardar();
  montar({ descartar: true });
}

entradaArchivo.addEventListener('change', () => {
  const archivo = entradaArchivo.files?.[0];
  entradaArchivo.value = ''; // permite volver a elegir el mismo archivo
  if (archivo) void cargarArchivo(archivo);
});
selectorModo.addEventListener('change', () => montar());
lab.addEventListener('change', () => montar());

mostrarAvisoAlmacen(persistente);
if (avisoCarga) cajaError(errorCarga, avisoCarga);
montar();
