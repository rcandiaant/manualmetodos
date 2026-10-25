<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Aplicacion;
use Manual\Config;
use Manual\Http\Peticion;
use Manual\Http\Respuesta;
use PHPUnit\Framework\TestCase;

final class NucleoTest extends TestCase
{
    private const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";

    private function app(bool $segura = false): Aplicacion
    {
        return new Aplicacion(Config::desdeArreglo([
            'COOKIE_SEGURA' => $segura ? '1' : '0',
            'CLAVE_CIFRADO' => base64_encode(random_bytes(32)),
            'CLAVE_INDICE' => base64_encode(random_bytes(32)),
        ]));
    }

    private function peticion(string $metodo, string $ruta, string $cuerpo = ''): Peticion
    {
        return new Peticion($metodo, $ruta, ['content-type' => 'application/json'], $cuerpo, '127.0.0.1');
    }

    /** @template T @param callable():T $f @return T */
    private function sinLog(callable $f): mixed
    {
        $anterior = ini_set('error_log', sys_get_temp_dir() . '/manual-pruebas-error.log');
        try {
            return $f();
        } finally {
            ini_set('error_log', (string) $anterior);
        }
    }

    public function test_ruta_desconocida_da_404_json(): void
    {
        $r = $this->app()->manejar($this->peticion('GET', '/api/nada'));
        $this->assertSame(404, $r->estado);
        $this->assertSame('no_encontrado', $r->datos['error']['codigo']);
        $this->assertIsString($r->datos['error']['mensaje']);
        $this->assertStringStartsWith('application/json', $r->cabeceras['Content-Type']);
    }

    public function test_metodo_no_permitido_da_405(): void
    {
        $r = $this->app()->manejar($this->peticion('POST', '/api/salud'));
        $this->assertSame(405, $r->estado);
        $this->assertSame('metodo_no_permitido', $r->datos['error']['codigo']);
    }

    public function test_cuerpo_mayor_a_2MB_da_413(): void
    {
        $r = $this->app()->manejar($this->peticion('POST', '/api/salud', str_repeat('a', 2 * 1024 * 1024 + 1)));
        $this->assertSame(413, $r->estado);
        $this->assertSame('cuerpo_muy_grande', $r->datos['error']['codigo']);
    }

    public function test_cuerpo_de_exactamente_2MB_no_da_413(): void
    {
        $r = $this->app()->manejar($this->peticion('POST', '/api/salud', str_repeat('a', 2 * 1024 * 1024)));
        $this->assertSame(405, $r->estado);
    }

    public function test_json_invalido_da_400(): void
    {
        $app = $this->app();
        $app->enrutador()->agregar('POST', '/api/eco', fn (Peticion $p) => Respuesta::json(200, $p->json()));
        foreach (['{no es json', '[1,2]', '"texto"', '', '5'] as $cuerpo) {
            $r = $app->manejar($this->peticion('POST', '/api/eco', $cuerpo));
            $this->assertSame(400, $r->estado, "cuerpo: $cuerpo");
            $this->assertSame('entrada_invalida', $r->datos['error']['codigo']);
        }
        $ok = $app->manejar($this->peticion('POST', '/api/eco', '{"a":1}'));
        $this->assertSame(200, $ok->estado);
        $this->assertSame(['a' => 1], $ok->datos);
    }

    public function test_excepcion_inesperada_da_500_sin_detalle(): void
    {
        $app = $this->app();
        $app->enrutador()->agregar('GET', '/api/falla', function (): never {
            throw new \PDOException('SQLSTATE secreto: clave=hunter2');
        });
        $r = $this->sinLog(fn () => $app->manejar($this->peticion('GET', '/api/falla')));
        $this->assertSame(500, $r->estado);
        $this->assertSame('error_interno', $r->datos['error']['codigo']);
        $this->assertStringNotContainsString('hunter2', json_encode($r->datos));
    }

    public function test_toda_respuesta_trae_cabeceras_de_seguridad(): void
    {
        $app = $this->app();
        $app->enrutador()->agregar('GET', '/api/falla', fn () => throw new \RuntimeException('x'));
        $respuestas = $this->sinLog(fn () => [
            $app->manejar($this->peticion('GET', '/api/salud')),
            $app->manejar($this->peticion('GET', '/api/nada')),
            $app->manejar($this->peticion('POST', '/api/salud')),
            $app->manejar($this->peticion('GET', '/api/falla')),
            $app->manejar($this->peticion('POST', '/api/salud', str_repeat('a', 2 * 1024 * 1024 + 1))),
        ]);
        $this->assertCount(5, $respuestas);
        foreach ($respuestas as $r) {
            $this->assertSame(self::CSP, $r->cabeceras['Content-Security-Policy']);
            $this->assertSame('nosniff', $r->cabeceras['X-Content-Type-Options']);
            $this->assertSame('same-origin', $r->cabeceras['Referrer-Policy']);
            $this->assertSame('camera=(), microphone=(), geolocation=()', $r->cabeceras['Permissions-Policy']);
            $this->assertSame('no-store', $r->cabeceras['Cache-Control']);
            $this->assertArrayNotHasKey('Strict-Transport-Security', $r->cabeceras);
        }
    }

    public function test_datos_no_codificables_dan_500_json_con_cabeceras(): void
    {
        $app = $this->app();
        $app->enrutador()->agregar('GET', '/api/malo', fn () => Respuesta::json(200, ['texto' => "\xB1\x31"]));
        $r = $this->sinLog(fn () => $app->manejar($this->peticion('GET', '/api/malo')));
        $this->assertSame(500, $r->estado);
        $this->assertSame('error_interno', $r->datos['error']['codigo']);
        $this->assertSame('nosniff', $r->cabeceras['X-Content-Type-Options']);
        $this->assertSame('{"error":{"codigo":"error_interno","mensaje":"Error interno del servidor."}}', $r->cuerpo());
    }

    public function test_error_fatal_de_arranque_es_500_fijo_con_cabeceras(): void
    {
        $r = $this->sinLog(fn () => Aplicacion::errorFatal(new \InvalidArgumentException('secreto'), true));
        $this->assertSame(500, $r->estado);
        $this->assertStringNotContainsString('secreto', $r->cuerpo());
        $this->assertSame('max-age=31536000', $r->cabeceras['Strict-Transport-Security']);
    }

    public function test_content_length_excesivo_da_413_aunque_el_cuerpo_este_vacio(): void
    {
        $p = new Peticion('POST', '/api/salud', ['Content-Length' => (string) (3 * 1024 * 1024)], '', '127.0.0.1');
        $this->assertSame(413, $this->app()->manejar($p)->estado);
        $p = new Peticion('POST', '/api/salud', ['Content-Length' => '10'], '', '127.0.0.1');
        $this->assertSame(413, $this->app()->manejar($p)->estado);
    }

    public function test_objeto_json_real_y_nombres_de_cabecera_sin_importar_mayusculas(): void
    {
        $this->assertSame([], (new Peticion('POST', '/', [], '{}', ''))->json());
        $this->assertSame(['a'], (new Peticion('POST', '/', [], '{"0":"a"}', ''))->json());
        $this->expectException(\Manual\Http\ErrorHttp::class);
        try {
            (new Peticion('POST', '/', [], '[]', ''))->json();
        } finally {
            $p = new Peticion('GET', '/', ['X-CSRF-Token' => 'abc'], '', '');
            $this->assertSame('abc', $p->cabecera('x-csrf-token'));
            $this->assertSame('abc', $p->cabecera('X-Csrf-Token'));
        }
    }

    public function test_head_se_comporta_como_get_sin_cuerpo(): void
    {
        $r = $this->app()->manejar($this->peticion('HEAD', '/api/salud'));
        $this->assertSame(200, $r->estado);
        $this->assertSame('', $r->cuerpo());
        $this->assertSame('nosniff', $r->cabeceras['X-Content-Type-Options']);
        $this->assertSame(405, $this->app()->manejar($this->peticion('OPTIONS', '/api/salud'))->estado);
    }

    public function test_hsts_solo_con_cookie_segura(): void
    {
        $r = $this->app(true)->manejar($this->peticion('GET', '/api/salud'));
        $this->assertSame('max-age=31536000', $r->cabeceras['Strict-Transport-Security']);
    }

    public function test_un_endpoint_puede_sobrescribir_cache_control(): void
    {
        $app = $this->app();
        $app->enrutador()->agregar('GET', '/api/cacheable', fn () => Respuesta::json(200, [], ['Cache-Control' => 'private, max-age=0, must-revalidate']));
        $r = $app->manejar($this->peticion('GET', '/api/cacheable'));
        $this->assertSame('private, max-age=0, must-revalidate', $r->cabeceras['Cache-Control']);
    }
}
