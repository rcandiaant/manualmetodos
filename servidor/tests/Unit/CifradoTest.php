<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use Manual\Seguridad\Cifrado;
use Manual\Seguridad\Claves;
use PHPUnit\Framework\TestCase;

final class CifradoTest extends TestCase
{
    private function cifrado(): Cifrado
    {
        return new Cifrado(str_repeat('k', 32), str_repeat('i', 32));
    }

    public function test_cifrar_y_descifrar_ida_y_vuelta(): void
    {
        $c = $this->cifrado();
        $bin = $c->cifrar('María.Pérez@lab.cl');
        $this->assertNotSame('María.Pérez@lab.cl', $bin);
        $this->assertStringNotContainsString('lab.cl', $bin);
        $this->assertSame('María.Pérez@lab.cl', $c->descifrar($bin));
        $this->assertLessThanOrEqual(255, strlen($c->cifrar(str_repeat('a', 200))), 'cabe en VARBINARY(255)');
    }

    public function test_cifrar_usa_nonce_aleatorio(): void
    {
        $c = $this->cifrado();
        $this->assertNotSame($c->cifrar('a@b.cl'), $c->cifrar('a@b.cl'));
    }

    public function test_descifrar_rechaza_datos_alterados_o_cortos(): void
    {
        $c = $this->cifrado();
        $bin = $c->cifrar('a@b.cl');
        $bin[strlen($bin) - 1] = chr(ord($bin[strlen($bin) - 1]) ^ 1);
        try {
            $c->descifrar($bin);
            $this->fail('Debió rechazar el texto alterado');
        } catch (\RuntimeException) {
            $this->addToAssertionCount(1);
        }
        $this->expectException(\RuntimeException::class);
        $c->descifrar('corto');
    }

    public function test_descifrar_con_otra_clave_falla(): void
    {
        $bin = $this->cifrado()->cifrar('a@b.cl');
        $this->expectException(\RuntimeException::class);
        (new Cifrado(str_repeat('z', 32), str_repeat('i', 32)))->descifrar($bin);
    }

    public function test_indice_ignora_mayusculas_y_espacios(): void
    {
        $c = $this->cifrado();
        $i = $c->indice('Ana.Soto@Lab.CL');
        $this->assertSame(32, strlen($i));
        $this->assertSame($i, $c->indice('  ana.soto@lab.cl '));
        $this->assertSame($c->indice('ÑANDÚ@lab.cl'), $c->indice('ñandú@lab.cl'));
        $this->assertNotSame($i, $c->indice('otra@lab.cl'));
        $this->assertSame(hash_hmac('sha256', 'ana.soto@lab.cl', str_repeat('i', 32), true), $i);
    }

    public function test_indice_depende_de_la_clave(): void
    {
        $otro = new Cifrado(str_repeat('k', 32), str_repeat('j', 32));
        $this->assertNotSame($this->cifrado()->indice('a@b.cl'), $otro->indice('a@b.cl'));
    }

    public function test_claves_rechaza_largo_invalido(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Cifrado('corta', str_repeat('i', 32));
    }

    public function test_hash_es_argon2id_y_verifica(): void
    {
        $h = Claves::hash('secreta');
        $this->assertStringStartsWith('$argon2id$', $h);
        $this->assertTrue(Claves::verificar('secreta', $h));
        $this->assertFalse(Claves::verificar('otra', $h));
        $this->assertFalse(Claves::verificar('secreta', 'no-es-un-hash'));
    }

    public function test_hash_ficticio_usa_los_mismos_parametros_que_hash(): void
    {
        $this->assertStringStartsWith('$argon2id$', Claves::HASH_FICTICIO);
        $this->assertSame(Claves::HASH_FICTICIO, Claves::hashFicticio(true));
        $this->assertSame(password_get_info(Claves::hash('x'))['options'], password_get_info(Claves::HASH_FICTICIO)['options']);
    }

    public function test_sin_argon2id_usa_bcrypt(): void
    {
        $this->assertSame('argon2id', Claves::algoritmo(true));
        $this->assertSame(PASSWORD_BCRYPT, Claves::algoritmo(false));
        $this->assertSame(defined('PASSWORD_ARGON2ID') ? 'argon2id' : PASSWORD_BCRYPT, Claves::algoritmo());

        $h = Claves::hash('secreta', false);
        $this->assertStringStartsWith('$2y$12$', $h);
        $this->assertTrue(Claves::verificar('secreta', $h), 'password_verify entiende ambos formatos');
        $this->assertFalse(Claves::verificar('otra', $h));

        $ficticio = Claves::hashFicticio(false);
        $this->assertStringStartsWith('$2y$12$', $ficticio, 'el ficticio usa el mismo algoritmo y costo');
        $this->assertSame(password_get_info($h)['options'], password_get_info($ficticio)['options']);
        $this->assertFalse(Claves::verificar('cualquiera', $ficticio));
    }

    public function test_cifrado_exige_claves_distintas(): void
    {
        $this->expectException(\InvalidArgumentException::class);
        new Cifrado(str_repeat('k', 32), str_repeat('k', 32));
    }

    public function test_generar_da_16_caracteres_sin_ambiguos(): void
    {
        $vistas = [];
        for ($i = 0; $i < 50; $i++) {
            $c = Claves::generar();
            $this->assertMatchesRegularExpression('/^[ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789]{16}$/', $c);
            $vistas[$c] = true;
        }
        $this->assertCount(50, $vistas);
    }
}
