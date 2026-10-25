<?php

declare(strict_types=1);

namespace Manual\Seguridad;

use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;

/**
 * Token CSRF por sesión (32 bytes en hexadecimal), enviado por el cliente en la cabecera X-CSRF-Token.
 * Se exige en todo método distinto de GET y HEAD. Solo POST /api/sesion (login) está exento:
 * aún no hay sesión, y al entrar se rota la sesión y se emite un token nuevo.
 */
final class Csrf
{
    public function __construct(private readonly Sesion $sesion)
    {
    }

    public static function generar(): string
    {
        return bin2hex(random_bytes(32));
    }

    /**
     * @throws ErrorHttp 401 sin_sesion si no hay sesión válida (toda escritura la requiere);
     *                   403 csrf_invalido si el token falta o no coincide
     */
    public function verificar(Peticion $p): void
    {
        if ($p->metodo === 'GET' || $p->metodo === 'HEAD') {
            return;
        }
        if (!$this->sesion->activa()) {
            throw new ErrorHttp(401, 'sin_sesion', 'Debe iniciar sesión.');
        }
        $esperado = $this->sesion->tokenCsrf();
        $recibido = $p->cabecera('x-csrf-token');
        if ($esperado === null || $recibido === null || !hash_equals($esperado, $recibido)) {
            throw new ErrorHttp(403, 'csrf_invalido', 'Token CSRF ausente o inválido.');
        }
    }
}
