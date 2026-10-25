<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use Manual\Http\Enrutador;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use PHPUnit\Framework\TestCase;

final class EnrutadorTest extends TestCase
{
    private function peticion(string $metodo, string $ruta): Peticion
    {
        return new Peticion($metodo, $ruta, [], '', '127.0.0.1');
    }

    public function test_id_no_numerico_no_coincide(): void
    {
        $e = new Enrutador();
        $e->agregar('GET', '/api/capitulos/{id}', fn (Peticion $p, array $params) => Respuesta::json(200, $params));
        $this->assertSame(200, $e->resolver($this->peticion('GET', '/api/capitulos/12'))->estado);
        $this->assertSame(404, $e->resolver($this->peticion('GET', '/api/capitulos/abc'))->estado);
        $this->assertSame(404, $e->resolver($this->peticion('GET', '/api/capitulos/12x'))->estado);
    }

    public function test_parametros_se_pasan_al_manejador(): void
    {
        $e = new Enrutador();
        $e->agregar('PATCH', '/api/capitulos/{id}/sugerencias/{uid}', fn (Peticion $p, array $params) => Respuesta::json(200, $params));
        $r = $e->resolver($this->peticion('PATCH', '/api/capitulos/7/sugerencias/a:b@c+d_e-f'));
        $this->assertSame(200, $r->estado);
        $this->assertSame(['id' => '7', 'uid' => 'a:b@c+d_e-f'], $r->datos);
        $this->assertSame(404, $e->resolver($this->peticion('PATCH', '/api/capitulos/7/sugerencias/a b'))->estado);
    }

    public function test_metodo_no_permitido_da_405_con_allow(): void
    {
        $e = new Enrutador();
        $e->agregar('GET', '/api/x', fn () => Respuesta::vacia());
        $e->agregar('PUT', '/api/x', fn () => Respuesta::vacia());
        $r = $e->resolver($this->peticion('POST', '/api/x'));
        $this->assertSame(405, $r->estado);
        $this->assertSame('GET, PUT', $r->cabeceras['Allow']);
        $this->assertSame('metodo_no_permitido', $r->datos['error']['codigo']);
    }

    public function test_ruta_desconocida_da_404(): void
    {
        $r = (new Enrutador())->resolver($this->peticion('GET', '/api/nada'));
        $this->assertSame(404, $r->estado);
        $this->assertSame('no_encontrado', $r->datos['error']['codigo']);
    }
}
