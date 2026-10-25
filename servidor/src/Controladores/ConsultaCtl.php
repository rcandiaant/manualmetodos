<?php

declare(strict_types=1);

namespace Manual\Controladores;

use Manual\Acceso\Consulta;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use Manual\Seguridad\Sesion;

/** GET /api/consulta: fechas y etapa vigente, para cualquier usuario con sesión. */
final class ConsultaCtl
{
    public function __construct(private readonly Sesion $sesion, private readonly Consulta $consulta)
    {
    }

    public function ver(Peticion $p): Respuesta
    {
        $this->sesion->exigirRol();
        return Respuesta::json(200, $this->consulta->dto());
    }
}
