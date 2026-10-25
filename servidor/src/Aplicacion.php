<?php

declare(strict_types=1);

namespace Manual;

use Manual\Http\Enrutador;
use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Seguridad\Cabeceras;

final class Aplicacion
{
    private readonly Enrutador $enrutador;

    public function __construct(private readonly Config $config)
    {
        $this->enrutador = new Enrutador();
        $this->registrarRutas();
    }

    public function enrutador(): Enrutador
    {
        return $this->enrutador;
    }

    /** Único lugar donde se registran las rutas de la API. */
    private function registrarRutas(): void
    {
        $this->enrutador->agregar('GET', '/api/salud', fn () => Respuesta::json(200, ['estado' => 'ok']));
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
        try {
            $largo = $p->cabecera('content-length') ?? '';
            $largo = ctype_digit($largo) ? (int) $largo : 0;
            // Cuerpo vacío con Content-Length > 0: PHP lo descartó (excede post_max_size).
            if (strlen($p->cuerpo) > Peticion::LIMITE_CUERPO || $largo > Peticion::LIMITE_CUERPO || ($largo > 0 && $p->cuerpo === '')) {
                throw new ErrorHttp(413, 'cuerpo_muy_grande', 'El cuerpo de la petición supera el límite de 2 MB.');
            }
            $r = $this->enrutador->resolver($p);
            $r->cuerpo(); // fuerza la codificación aquí: un fallo se vuelve 500 controlado
            if ($p->metodo === 'HEAD') {
                $r = $r->sinCuerpo();
            }
        } catch (ErrorHttp $e) {
            $r = Respuesta::error($e->estado, $e->codigo, $e->getMessage(), $e->campos);
        } catch (\Throwable $e) {
            $r = self::errorFatal($e, $this->config->cookieSegura);
        }
        return $r->conPorDefecto(Cabeceras::todas($this->config->cookieSegura));
    }
}
