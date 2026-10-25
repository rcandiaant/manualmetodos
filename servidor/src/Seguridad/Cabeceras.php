<?php

declare(strict_types=1);

namespace Manual\Seguridad;

final class Cabeceras
{
    public const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

    /** @return array<string,string> */
    public static function todas(bool $https): array
    {
        $cabeceras = [
            'Content-Security-Policy' => self::CSP,
            'X-Content-Type-Options' => 'nosniff',
            'Referrer-Policy' => 'same-origin',
            'Permissions-Policy' => 'camera=(), microphone=(), geolocation=()',
            'Cache-Control' => 'no-store',
        ];
        if ($https) {
            $cabeceras['Strict-Transport-Security'] = 'max-age=31536000';
        }
        return $cabeceras;
    }
}
