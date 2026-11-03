<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Auditoria;
use Manual\Dominio\Rol;
use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Mantenimiento\ReinicioPruebas;
use Manual\Mantenimiento\Respaldo;
use Manual\Seguridad\Sesion;
use Manual\Validacion\Entrada;

/**
 * POST /api/admin/reiniciar con `{"confirmacion": "REINICIAR"}` (docs/api.md §4.6). La ruta solo existe con
 * REINICIO_PRUEBAS=1 en el .env; sin eso responde 404 como cualquier ruta inexistente.
 * Primero respalda la base en var/respaldos; si el respaldo falla, 500 y no se borra nada.
 */
final class ReinicioCtl
{
    public const CONFIRMACION = 'REINICIAR';

    public function __construct(
        private readonly Sesion $sesion,
        private readonly Respaldo $respaldo,
        private readonly ReinicioPruebas $reinicio,
        private readonly Auditoria $auditoria,
        private readonly string $dirRespaldos,
    ) {
    }

    public function reiniciar(Peticion $p): Respuesta
    {
        $admin = $this->sesion->exigirRol(Rol::ADMIN);
        if (($p->json()['confirmacion'] ?? null) !== self::CONFIRMACION) {
            throw Entrada::invalido('confirmacion', 'escriba exactamente ' . self::CONFIRMACION);
        }

        // El respaldo recorre toda la base: se amplía el límite de ejecución si el hosting lo permite.
        if (function_exists('set_time_limit')) {
            @set_time_limit(120);
        }
        // Cualquier aviso de PHP durante el respaldo (mkdir, gzwrite…) cuenta como fallo: sin respaldo fiable no se borra.
        set_error_handler(static function (int $nivel, string $mensaje, string $archivo, int $linea): bool {
            if ((error_reporting() & $nivel) === 0) {
                return false; // silenciado con @
            }
            throw new \ErrorException($mensaje, 0, $nivel, $archivo, $linea);
        });
        try {
            $ruta = $this->respaldo->ejecutar($this->dirRespaldos);
        } catch (\Throwable $e) {
            error_log(sprintf('reiniciar: falló el respaldo (%s: %s)', $e::class, $e->getMessage()));
            throw new ErrorHttp(500, 'respaldo_fallido', 'No se pudo crear el respaldo de la base; no se borró nada.');
        } finally {
            restore_error_handler();
        }
        $archivo = basename($ruta);

        $borrados = $this->reinicio->borrar();
        $this->auditoria->registrar($admin['id'], 'reiniciar_pruebas', 'base', null, ['respaldo' => $archivo, 'borrados' => $borrados]);
        return Respuesta::json(200, ['respaldo' => $archivo, 'borrados' => $borrados]);
    }
}
