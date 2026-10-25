<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Bd\Conexion;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\RelojFijo;
use Manual\Seguridad\LimiteIntentos;
use PHPUnit\Framework\TestCase;

/**
 * El intento se reserva (cuenta) ANTES de verificar la clave: peticiones en paralelo
 * no pueden probar más de 5 claves antes del bloqueo.
 */
final class LimiteIntentosTest extends TestCase
{
    use BaseDePruebas;

    private const CLAVES = ['ip:10.9.9.9', 'cuenta:abc'];

    public function test_reservas_en_paralelo_no_superan_el_umbral(): void
    {
        $reloj = new RelojFijo();
        // Dos conexiones distintas, como dos procesos PHP atendiendo peticiones simultáneas.
        $a = new LimiteIntentos(self::$bd, $reloj);
        $b = new LimiteIntentos(Conexion::crear(self::configPruebas()), $reloj);

        // Cinco peticiones reservan su intento y siguen verificando la clave (aún sin resultado).
        foreach ([$a, $b, $a, $b, $a] as $i => $limite) {
            $this->assertSame(0, $limite->reservar(self::CLAVES), "reserva $i");
        }
        // La sexta, en paralelo, ya no puede probar otra clave: la saturación bloquea de inmediato.
        $this->assertSame(60, $b->reservar(self::CLAVES));
        $this->assertGreaterThan(0, $a->reservar(['ip:otra', 'cuenta:abc']), 'basta con una clave bloqueada');
        $this->assertSame(0, $a->reservar(['ip:otra2', 'cuenta:otra']));

        // Las cinco en curso fallan: no suman otro nivel ni alargan el bloqueo.
        for ($i = 0; $i < 5; $i++) {
            $this->assertSame([], ($i % 2 ? $b : $a)->confirmarFallo(self::CLAVES));
        }
        $this->assertSame(60, $a->reservar(self::CLAVES));
        $reloj->avanzar(61);
        $this->assertSame(0, $a->reservar(self::CLAVES), 'el bloqueo vence');
        $nivel = self::$bd->query("SELECT bloqueos FROM intentos_login WHERE clave = 'cuenta:abc'")->fetchColumn();
        $this->assertSame(1, (int) $nivel);
    }

    public function test_una_reserva_rechazada_no_cuenta_en_ninguna_clave(): void
    {
        $reloj = new RelojFijo();
        $l = new LimiteIntentos(self::$bd, $reloj);
        for ($i = 0; $i < 5; $i++) {
            $l->reservar(['ip:1', 'cuenta:x']);
            $l->confirmarFallo(['ip:1', 'cuenta:x']);
        }
        $this->assertGreaterThan(0, $l->reservar(['ip:2', 'cuenta:x']));
        $fallos = self::$bd->query("SELECT fallos FROM intentos_login WHERE clave = 'ip:2'")->fetchColumn();
        $this->assertSame(0, (int) $fallos, 'la reserva es todo o nada');
    }

    public function test_el_exito_libera_la_reserva_de_ip_y_borra_la_cuenta(): void
    {
        $l = new LimiteIntentos(self::$bd, new RelojFijo());
        for ($i = 0; $i < 20; $i++) {
            $this->assertSame(0, $l->reservar(['ip:oficina', "cuenta:u$i"]), "entrada $i");
            $l->confirmarExito(['ip:oficina', "cuenta:u$i"]);
        }
        $filas = self::$bd->query("SELECT clave, fallos FROM intentos_login")->fetchAll();
        $this->assertSame([['clave' => 'ip:oficina', 'fallos' => 0]], array_map(fn ($f) => ['clave' => $f['clave'], 'fallos' => (int) $f['fallos']], $filas));
    }
}
