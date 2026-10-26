/**
 * Arranque de la aplicación. Por ahora (Task 1) solo comprueba el servidor con
 * `GET /api/salud`; la sesión y las vistas reales llegan en las tareas siguientes.
 */
import 'katex/dist/katex.min.css';
import '../editor/estilos.css';
import { el, mensajeDe } from '../editor/ui';
import { crearApi } from './api';
import { definirRutas, type Vista } from './router';
import type { Salud } from './tipos-api';

const api = crearApi({ alSinSesion: () => {} });

function vistaSalud(): Vista {
  let vigente = true;
  return {
    montar(raiz) {
      const estado = el('p', { id: 'estado-servidor' }, 'Comprobando el servidor…');
      raiz.append(el('main', { class: 'app' }, el('h1', {}, 'Manual de métodos'), estado));
      api
        .get<Salud>('/salud')
        .then((r) => {
          if (vigente) estado.textContent = r.estado;
        })
        .catch((e: unknown) => {
          if (!vigente) return;
          estado.setAttribute('role', 'alert');
          estado.textContent = `Sin conexión con el servidor: ${mensajeDe(e)}`;
        });
    },
    desmontar() {
      vigente = false;
    },
  };
}

definirRutas({ '#/capitulos': vistaSalud });
