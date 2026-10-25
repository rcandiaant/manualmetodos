<?php

declare(strict_types=1);

namespace Manual\Seguridad;

use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;

/**
 * Defensas contra peticiones de otros sitios, aplicadas a toda la API antes de enrutar.
 *
 * - Todo cuerpo debe ser `application/json`. Un formulario HTML de otro sitio no puede enviar ese
 *   tipo sin un preflight CORS (que la API no concede), así que no puede armar un JSON con
 *   `enctype="text/plain"` (p. ej. un login CSRF que meta a la víctima en la cuenta del atacante).
 *   → 415 `tipo_no_soportado`.
 * - En métodos distintos de GET/HEAD: si viene `Origin`, debe coincidir con `Host`; y se rechaza
 *   `Sec-Fetch-Site: cross-site`. → 403 `origen_invalido`. Sin Origin (clientes no navegador,
 *   navegadores antiguos) se confía en SameSite=Strict, el CSRF y el Content-Type.
 */
final class PoliticaPeticion
{
    public static function verificar(Peticion $p): void
    {
        if ($p->metodo !== 'GET' && $p->metodo !== 'HEAD') {
            self::verificarOrigen($p);
        }
        if ($p->cuerpo !== '') {
            $tipo = strtolower(trim(explode(';', $p->cabecera('content-type') ?? '', 2)[0]));
            if ($tipo !== 'application/json') {
                throw new ErrorHttp(415, 'tipo_no_soportado', 'El cuerpo debe enviarse como application/json.');
            }
        }
    }

    private static function verificarOrigen(Peticion $p): void
    {
        if (strtolower(trim($p->cabecera('sec-fetch-site') ?? '')) === 'cross-site') {
            throw self::ajeno();
        }
        $origen = $p->cabecera('origin');
        if ($origen === null) {
            return;
        }
        $partes = parse_url(trim($origen));
        $host = strtolower(trim($p->cabecera('host') ?? ''));
        if (!is_array($partes) || !isset($partes['scheme'], $partes['host']) || $host === '') {
            throw self::ajeno(); // incluye Origin: null
        }
        $porDefecto = ['http' => 80, 'https' => 443][strtolower($partes['scheme'])] ?? null;
        $esperado = strtolower($partes['host']) . (isset($partes['port']) && $partes['port'] !== $porDefecto ? ':' . $partes['port'] : '');
        if ($porDefecto !== null && str_ends_with($host, ':' . $porDefecto)) {
            $host = substr($host, 0, -strlen(':' . $porDefecto));
        }
        if ($esperado !== $host) {
            throw self::ajeno();
        }
    }

    private static function ajeno(): ErrorHttp
    {
        return new ErrorHttp(403, 'origen_invalido', 'Petición de un origen no permitido.');
    }
}
