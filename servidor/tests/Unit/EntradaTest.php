<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use Manual\Http\ErrorHttp;
use Manual\Validacion\Entrada;
use PHPUnit\Framework\TestCase;

final class EntradaTest extends TestCase
{
    private function assertInvalido(callable $f, string $campo): void
    {
        try {
            $f();
        } catch (ErrorHttp $e) {
            $this->assertSame(400, $e->estado);
            $this->assertSame('entrada_invalida', $e->codigo);
            $this->assertArrayHasKey($campo, $e->campos);
            return;
        }
        $this->fail("Se esperaba entrada_invalida en $campo");
    }

    public function test_texto(): void
    {
        $this->assertSame('ñandú', Entrada::texto(['n' => 'ñandú'], 'n', 5));
        $this->assertSame('', Entrada::texto(['n' => ''], 'n', 5, 0));
        $this->assertInvalido(fn () => Entrada::texto(['n' => 'ñandús'], 'n', 5), 'n');
        $this->assertInvalido(fn () => Entrada::texto(['n' => ''], 'n', 5), 'n');
        $this->assertInvalido(fn () => Entrada::texto(['n' => 3], 'n', 5), 'n');
        $this->assertInvalido(fn () => Entrada::texto([], 'n', 5), 'n');
        $this->assertInvalido(fn () => Entrada::texto(['n' => "\xff"], 'n', 5), 'n');
    }

    public function test_entero(): void
    {
        $this->assertSame(3, Entrada::entero(['n' => 3], 'n', 0));
        $this->assertInvalido(fn () => Entrada::entero(['n' => -1], 'n', 0), 'n');
        $this->assertInvalido(fn () => Entrada::entero(['n' => 11], 'n', 0, 10), 'n');
        $this->assertInvalido(fn () => Entrada::entero(['n' => '3'], 'n'), 'n');
        $this->assertInvalido(fn () => Entrada::entero(['n' => 3.0], 'n'), 'n');
        $this->assertInvalido(fn () => Entrada::entero(['n' => true], 'n'), 'n');
    }

    public function test_fecha_iso_con_zona_en_utc(): void
    {
        $f = Entrada::fechaIso(['f' => '2026-11-02T09:30:00-03:00'], 'f');
        $this->assertSame('2026-11-02T12:30:00+00:00', $f->format(DATE_ATOM));
        $this->assertSame('UTC', $f->getTimezone()->getName());
        $this->assertSame('2026-11-02T12:30:00+00:00', Entrada::fechaIso(['f' => '2026-11-02T12:30:00.123Z'], 'f')->format(DATE_ATOM));
        $this->assertInvalido(fn () => Entrada::fechaIso(['f' => '2026-11-02T09:30:00'], 'f'), 'f');
        $this->assertInvalido(fn () => Entrada::fechaIso(['f' => '2026-02-30T09:30:00Z'], 'f'), 'f');
        $this->assertInvalido(fn () => Entrada::fechaIso(['f' => 'mañana'], 'f'), 'f');
        $this->assertInvalido(fn () => Entrada::fechaIso(['f' => 1700000000], 'f'), 'f');
    }

    public function test_enumeracion(): void
    {
        $this->assertSame('b', Entrada::enumeracion(['e' => 'b'], 'e', ['a', 'b']));
        $this->assertInvalido(fn () => Entrada::enumeracion(['e' => 'c'], 'e', ['a', 'b']), 'e');
        $this->assertInvalido(fn () => Entrada::enumeracion(['e' => 0], 'e', ['a', 'b']), 'e');
    }

    public function test_solo_campos_descarta_el_resto(): void
    {
        $this->assertSame(['a' => 1, 'c' => 3], Entrada::soloCampos(['a' => 1, 'b' => 2, 'c' => 3], ['a', 'c', 'z']));
    }
}
