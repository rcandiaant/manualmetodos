<?php

declare(strict_types=1);

namespace Manual;

use Manual\Acceso\Auditoria;
use Manual\Acceso\Capitulos;
use Manual\Acceso\Comentarios;
use Manual\Acceso\Consulta;
use Manual\Acceso\Copias;
use Manual\Acceso\Sugerencias;
use Manual\Acceso\Usuarios;
use Manual\Bd\Conexion;
use Manual\Controladores\AdminCtl;
use Manual\Controladores\CapitulosCtl;
use Manual\Controladores\ComentariosCtl;
use Manual\Controladores\ConsultaCtl;
use Manual\Controladores\CopiaCtl;
use Manual\Controladores\RevisionCtl;
use Manual\Controladores\SesionCtl;
use Manual\Http\Enrutador;
use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Seguridad\AlmacenSesion;
use Manual\Seguridad\AlmacenSesionNativa;
use Manual\Seguridad\Cabeceras;
use Manual\Seguridad\Cifrado;
use Manual\Seguridad\Csrf;
use Manual\Seguridad\LimiteIntentos;
use Manual\Seguridad\PoliticaPeticion;
use Manual\Seguridad\Sesion;

/**
 * Arma las dependencias y atiende una petición a la vez.
 * La base y el almacén de sesiones se crean al primer uso: las rutas que no los necesitan no conectan.
 */
final class Aplicacion
{
    private readonly Enrutador $enrutador;
    private readonly Reloj $reloj;
    private ?Peticion $peticion = null;
    private ?Sesion $sesion = null;

    public function __construct(
        private readonly Config $config,
        ?Reloj $reloj = null,
        private ?AlmacenSesion $almacenSesion = null,
        private ?\PDO $bd = null,
    ) {
        $this->reloj = $reloj ?? new RelojSistema();
        $this->enrutador = new Enrutador();
        $this->registrarRutas();
    }

    public function enrutador(): Enrutador
    {
        return $this->enrutador;
    }

    /** Sesión de la petición en curso (solo válido dentro de manejar()). */
    public function sesion(): Sesion
    {
        if ($this->peticion === null) {
            throw new \LogicException('No hay una petición en curso.');
        }
        return $this->sesion ??= new Sesion(
            $this->almacenSesion ??= new AlmacenSesionNativa($this->config->cookieSegura),
            $this->reloj,
            fn (): Usuarios => $this->usuarios(),
            $this->config->cookieSegura,
            $this->peticion->cookie(Sesion::nombreCookie($this->config->cookieSegura)),
        );
    }

    /** Único lugar donde se registran las rutas de la API. */
    private function registrarRutas(): void
    {
        $this->enrutador->agregar('GET', '/api/salud', fn () => Respuesta::json(200, ['estado' => 'ok']));

        $this->ruta('POST', '/api/sesion', fn (Peticion $p) => $this->sesionCtl()->entrar($p), exentoCsrf: true);
        $this->ruta('GET', '/api/sesion', fn (Peticion $p) => $this->sesionCtl()->actual($p));
        $this->ruta('DELETE', '/api/sesion', fn (Peticion $p) => $this->sesionCtl()->salir($p));

        $this->ruta('GET', '/api/consulta', fn (Peticion $p) => $this->consultaCtl()->ver($p));

        $this->ruta('GET', '/api/capitulos', fn (Peticion $p) => $this->capitulosCtl()->listar($p));
        $this->ruta('GET', '/api/capitulos/{id}/base', fn (Peticion $p, array $a) => $this->capitulosCtl()->base($p, $a));
        $this->ruta('GET', '/api/capitulos/{id}/copia', fn (Peticion $p, array $a) => $this->copiaCtl()->ver($p, $a));
        $this->ruta('PUT', '/api/capitulos/{id}/copia', fn (Peticion $p, array $a) => $this->copiaCtl()->guardar($p, $a));
        $this->ruta('PATCH', '/api/capitulos/{id}/sugerencias/{uid}', fn (Peticion $p, array $a) => $this->copiaCtl()->motivo($p, $a));
        $this->ruta('GET', '/api/capitulos/{id}/comentarios', fn (Peticion $p, array $a) => $this->comentariosCtl()->listar($p, $a));
        $this->ruta('POST', '/api/capitulos/{id}/comentarios', fn (Peticion $p, array $a) => $this->comentariosCtl()->crear($p, $a));
        $this->ruta('PATCH', '/api/comentarios/{id}', fn (Peticion $p, array $a) => $this->comentariosCtl()->editar($p, $a));
        $this->ruta('DELETE', '/api/comentarios/{id}', fn (Peticion $p, array $a) => $this->comentariosCtl()->borrar($p, $a));

        $this->ruta('GET', '/api/capitulos/{id}/mis-aportes', fn (Peticion $p, array $a) => $this->revisionCtl()->misAportes($p, $a));
        $this->ruta('GET', '/api/capitulos/{id}/aportes', fn (Peticion $p, array $a) => $this->revisionCtl()->aportes($p, $a));
        $this->ruta('PATCH', '/api/sugerencias/{id}', fn (Peticion $p, array $a) => $this->revisionCtl()->resolverSugerencia($p, $a));
        $this->ruta('PATCH', '/api/comentarios/{id}/resolucion', fn (Peticion $p, array $a) => $this->revisionCtl()->resolverComentario($p, $a));
        $this->ruta('PUT', '/api/capitulos/{id}/final', fn (Peticion $p, array $a) => $this->revisionCtl()->guardarFinal($p, $a));
        $this->ruta('GET', '/api/capitulos/{id}/final', fn (Peticion $p, array $a) => $this->revisionCtl()->verFinal($p, $a));

        $this->ruta('POST', '/api/admin/capitulos',fn (Peticion $p) => $this->adminCtl()->subirCapitulo($p));
        $this->ruta('GET', '/api/admin/usuarios', fn (Peticion $p) => $this->adminCtl()->listarUsuarios($p));
        $this->ruta('POST', '/api/admin/usuarios/importar', fn (Peticion $p) => $this->adminCtl()->importarUsuarios($p));
        $this->ruta('POST', '/api/admin/usuarios/{id}/clave', fn (Peticion $p, array $a) => $this->adminCtl()->regenerarClave($p, $a));
        $this->ruta('PATCH', '/api/admin/usuarios/{id}', fn (Peticion $p, array $a) => $this->adminCtl()->actualizarUsuario($p, $a));
        $this->ruta('PUT', '/api/admin/consulta', fn (Peticion $p) => $this->adminCtl()->guardarConsulta($p));
    }

    /**
     * Registra una ruta que exige CSRF en todo método distinto de GET/HEAD.
     * Solo el login (POST /api/sesion) va exento.
     * @param callable(Peticion, array<string,string>): Respuesta $manejador
     */
    private function ruta(string $metodo, string $patron, callable $manejador, bool $exentoCsrf = false): void
    {
        $this->enrutador->agregar($metodo, $patron, function (Peticion $p, array $params) use ($manejador, $exentoCsrf): Respuesta {
            if (!$exentoCsrf) {
                (new Csrf($this->sesion()))->verificar($p);
            }
            return $manejador($p, $params);
        });
    }

    private function bd(): \PDO
    {
        return $this->bd ??= Conexion::crear($this->config);
    }

    private function usuarios(): Usuarios
    {
        return new Usuarios($this->bd(), new Cifrado($this->config->claveCifrado, $this->config->claveIndice));
    }

    private function capitulos(): Capitulos
    {
        return new Capitulos($this->bd(), null, Capitulos::prefijoInstalacion($this->config));
    }

    private function auditoria(): Auditoria
    {
        return new Auditoria($this->bd(), $this->reloj);
    }

    private function consultaCtl(): ConsultaCtl
    {
        return new ConsultaCtl($this->sesion(), new Consulta($this->bd(), $this->reloj));
    }

    private function capitulosCtl(): CapitulosCtl
    {
        return new CapitulosCtl($this->sesion(), $this->capitulos(), new Sugerencias($this->bd()), new Comentarios($this->bd()));
    }

    private function copiaCtl(): CopiaCtl
    {
        $sugerencias = new Sugerencias($this->bd());
        return new CopiaCtl(
            $this->sesion(),
            $this->capitulos(),
            new Copias($this->bd(), $sugerencias),
            $sugerencias,
            new Consulta($this->bd(), $this->reloj),
            $this->reloj,
        );
    }

    private function comentariosCtl(): ComentariosCtl
    {
        return new ComentariosCtl($this->sesion(), $this->capitulos(), new Comentarios($this->bd()), new Consulta($this->bd(), $this->reloj), $this->reloj);
    }

    private function revisionCtl(): RevisionCtl
    {
        return new RevisionCtl(
            $this->sesion(),
            $this->capitulos(),
            new Sugerencias($this->bd()),
            new Comentarios($this->bd()),
            new Consulta($this->bd(), $this->reloj),
            $this->auditoria(),
            $this->reloj,
        );
    }

    private function adminCtl(): AdminCtl
    {
        return new AdminCtl(
            $this->sesion(),
            $this->usuarios(),
            $this->capitulos(),
            new Consulta($this->bd(), $this->reloj),
            $this->auditoria(),
            $this->reloj,
        );
    }

    private function sesionCtl(): SesionCtl
    {
        return new SesionCtl($this->sesion(), $this->usuarios(), new LimiteIntentos($this->bd(), $this->reloj), $this->auditoria());
    }

    /** Respuesta fija para fallos fuera de manejar() (arranque, lectura de la petición, envío). */
    public static function errorFatal(\Throwable $e, bool $https): Respuesta
    {
        error_log(sprintf('%s: %s en %s:%d', $e::class, $e->getMessage(), $e->getFile(), $e->getLine()));
        return Respuesta::error(500, 'error_interno', 'Error interno del servidor.')
            ->conPorDefecto(Cabeceras::todas($https));
    }

    public function manejar(Peticion $p): Respuesta
    {
        $this->peticion = $p;
        $this->sesion = null;
        try {
            $largo = $p->cabecera('content-length') ?? '';
            $largo = ctype_digit($largo) ? (int) $largo : 0;
            // Cuerpo vacío con Content-Length > 0: PHP lo descartó (excede post_max_size).
            $limite = Peticion::limiteCuerpo($p->metodo, $p->ruta);
            if (strlen($p->cuerpo) > $limite || $largo > $limite || ($largo > 0 && $p->cuerpo === '')) {
                throw new ErrorHttp(413, 'cuerpo_muy_grande', 'El cuerpo de la petición supera el límite de ' . ($limite >> 20) . ' MB.');
            }
            PoliticaPeticion::verificar($p);
            $r = $this->enrutador->resolver($p);
            $r->cuerpo(); // fuerza la codificación aquí: un fallo se vuelve 500 controlado
            if ($p->metodo === 'HEAD') {
                $r = $r->sinCuerpo();
            }
        } catch (ErrorHttp $e) {
            $r = Respuesta::error($e->estado, $e->codigo, $e->getMessage(), $e->campos);
        } catch (\Throwable $e) {
            $r = self::errorFatal($e, $this->config->cookieSegura);
        } finally {
            $cookies = $this->sesion?->cabeceras() ?? [];
            $this->peticion = null;
            $this->sesion = null;
        }
        return $r->conCabeceras($cookies)->conPorDefecto(Cabeceras::todas($this->config->cookieSegura));
    }
}
