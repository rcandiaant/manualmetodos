<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Consulta;
use Manual\Dominio\Rol;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Seguridad\Sesion;

/**
 * GET /api/consulta: fechas y etapa vigente, para cualquier usuario con sesión.
 * Al admin le agrega `decisionesTomadas`, `aportes` y `reinicioPermitido` (docs/api.md §4.1).
 */
final class ConsultaCtl
{
    public function __construct(
        private readonly Sesion $sesion,
        private readonly Consulta $consulta,
        private readonly bool $reinicioPermitido = false,
    ) {
    }

    public function ver(Peticion $p): Respuesta
    {
        $u = $this->sesion->exigirRol();
        return Respuesta::json(200, in_array(Rol::ADMIN, $u['roles'], true)
            ? $this->consulta->dtoAdmin($this->reinicioPermitido)
            : $this->consulta->dto());
    }
}
