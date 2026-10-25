<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use Manual\Config;
use PHPUnit\Framework\TestCase;

final class ConfigTest extends TestCase
{
    private string $env;

    protected function setUp(): void
    {
        $this->env = tempnam(sys_get_temp_dir(), 'env');
    }

    protected function tearDown(): void
    {
        @unlink($this->env);
    }

    public function test_lee_archivo_env(): void
    {
        $cifrado = base64_encode(str_repeat('a', 32));
        $indice = base64_encode(str_repeat('b', 32));
        file_put_contents($this->env, "# comentario\nBD_DSN=mysql:host=x;dbname=y\nBD_USUARIO=\"u\"\nCLAVE_CIFRADO=$cifrado\nCLAVE_INDICE=$indice\nCOOKIE_SEGURA=1\n");
        $c = Config::desdeEntorno($this->env);
        $this->assertSame('mysql:host=x;dbname=y', $c->bdDsn);
        $this->assertSame('u', $c->bdUsuario);
        $this->assertSame(str_repeat('a', 32), $c->claveCifrado);
        $this->assertTrue($c->cookieSegura);
        $this->assertSame('America/Santiago', $c->zonaHoraria);
    }

    public function test_claves_ausentes_o_malas_cierran_por_defecto(): void
    {
        $buena = base64_encode(str_repeat('a', 32));
        foreach ([
            [],
            ['CLAVE_CIFRADO' => $buena],
            ['CLAVE_CIFRADO' => $buena, 'CLAVE_INDICE' => 'no-es-base64!!'],
            ['CLAVE_CIFRADO' => $buena, 'CLAVE_INDICE' => base64_encode('corta')],
            ['CLAVE_CIFRADO' => $buena, 'CLAVE_INDICE' => $buena], // deben ser distintas
        ] as $valores) {
            try {
                Config::desdeArreglo($valores);
                $this->fail('Debió lanzar excepción');
            } catch (\InvalidArgumentException) {
                $this->addToAssertionCount(1);
            }
        }
    }

    public function test_env_malformado_lanza_excepcion(): void
    {
        file_put_contents($this->env, "basura sin igual\nCLAVE_CIFRADO=%%%\n");
        $this->expectException(\InvalidArgumentException::class);
        Config::desdeEntorno($this->env);
    }
}
