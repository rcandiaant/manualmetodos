<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use Manual\Http\Respuesta;
use PHPUnit\Framework\TestCase;

final class RespuestaTest extends TestCase
{
    public function test_con_por_defecto_no_pisa_cabeceras_con_otra_capitalizacion(): void
    {
        $r = Respuesta::json(200, [], ['cache-control' => 'private'])
            ->conPorDefecto(['Cache-Control' => 'no-store', 'X-Content-Type-Options' => 'nosniff']);
        $this->assertSame('private', $r->cabeceras['cache-control']);
        $this->assertArrayNotHasKey('Cache-Control', $r->cabeceras);
        $this->assertSame('nosniff', $r->cabeceras['X-Content-Type-Options']);
    }
}
