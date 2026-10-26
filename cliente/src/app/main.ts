/**
 * Arranque de la aplicación: recupera la sesión (`GET /sesion`) y define las rutas.
 * Las vistas de capítulo, revisión y administración llegan en las tareas siguientes.
 */
import 'katex/dist/katex.min.css';
import '../editor/estilos.css';
import './app.css';
import { crearApi } from './api';
import { vistaInicio } from './inicio';
import { vistaRevisor } from './revisor/vista';
import { definirRutas, navegar, RUTA_INICIO, type Vista } from './router';
import { iniciar, conCompuerta, manejarSinSesion, RUTA_LOGIN, salir, usuarioActual, vistaLogin } from './sesion';
import type { Usuario } from './tipos-api';

const alSinSesion = manejarSinSesion((hash) => navegar(hash));
const compuerta = conCompuerta(alSinSesion);
const api = crearApi({ alSinSesion: compuerta.handler });

/** Vista protegida: sin sesión, guarda la ruta pedida y va al login. */
function protegida(fabrica: (u: Usuario) => Vista): () => Vista {
  return () => {
    const u = usuarioActual();
    if (!u) {
      alSinSesion();
      return { montar() {}, desmontar() {} };
    }
    return fabrica(u);
  };
}

async function arrancar(): Promise<void> {
  const raiz = document.getElementById('app') ?? document.body;
  try {
    await iniciar(api);
  } catch {
    // Sin conexión al arrancar: se muestra el login; el aviso de red sale al intentar entrar.
  }
  // Las rutas se definen después del boot; si no hay sesión, la vista protegida lleva al login
  // recordando la ruta pedida.
  compuerta.abrir();
  definirRutas(
    {
      [RUTA_INICIO]: protegida((u) =>
        vistaInicio(api, u, {
          salir: async () => {
            await salir(api);
            await navegar(RUTA_LOGIN);
          },
        }),
      ),
      [RUTA_LOGIN]: () => vistaLogin(api, { navegar }),
      '#/revisar/:id': (p, q) => protegida(() => vistaRevisor(api, Number(p.id), q))(),
    },
    raiz,
  );
}

void arrancar();
