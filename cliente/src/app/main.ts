/**
 * Arranque de la aplicación: recupera la sesión (`GET /sesion`) y define las rutas.
 * Las vistas del revisor y de administración se cargan por ruta (`import()`), para que el
 * laboratorio no descargue el importador LaTeX ni el panel de decisiones.
 */
import 'katex/dist/katex.min.css';
import '../editor/estilos.css';
import './app.css';
import { crearApi } from './api';
import { vistaInicio } from './inicio';
import { vistaCapitulo } from './laboratorio/vista';
import { definirRutas, navegar, RUTA_INICIO, vistaDiferida, type FabricaVista, type Vista } from './router';
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

/** Rutas de administración (las define `admin/rutas.ts`, que se carga al entrar en una de ellas). */
const RUTAS_ADMIN = ['#/admin', '#/admin/capitulos', '#/admin/usuarios', '#/admin/consulta'] as const;

function rutasAdminDiferidas(): Record<string, FabricaVista> {
  const tabla: Record<string, FabricaVista> = {};
  for (const ruta of RUTAS_ADMIN) {
    tabla[ruta] = (p, q) =>
      vistaDiferida(async () => {
        const fabrica = (await import('./admin/rutas')).rutasAdmin(api, protegida)[ruta];
        if (!fabrica) throw new Error(`ruta de administración desconocida: ${ruta}`);
        return fabrica(p, q);
      });
  }
  return tabla;
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
      ...rutasAdminDiferidas(),
      [RUTA_LOGIN]: () => vistaLogin(api, { navegar }),
      '#/revisar/:id': (p, q) =>
        protegida((u) =>
          vistaDiferida(async () => (await import('./revisor/vista')).vistaRevisor(api, Number(p.id), q, u.id)),
        )(),
      '#/capitulo/:id': (p) => protegida((u) => vistaCapitulo(api, u, p.id))(),
    },
    raiz,
  );
}

void arrancar();
