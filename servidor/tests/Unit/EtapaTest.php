<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use Manual\Dominio\Etapa;
use PHPUnit\Framework\TestCase;

final class EtapaTest extends TestCase
{
    private function f(string $s): \DateTimeImmutable
    {
        return new \DateTimeImmutable($s, new \DateTimeZone('UTC'));
    }

    public function test_etapa_segun_fechas(): void
    {
        $ap = $this->f('2026-11-01 00:00:00');
        $ci = $this->f('2026-11-30 00:00:00');
        self::assertSame('preparacion', Etapa::actual(null, null, $this->f('2026-11-15 00:00:00')));
        self::assertSame('preparacion', Etapa::actual(null, $ci, $this->f('2026-12-15 00:00:00')));
        self::assertSame('preparacion', Etapa::actual($ap, $ci, $this->f('2026-10-31 23:59:59')));
        self::assertSame('consulta', Etapa::actual($ap, $ci, $ap));
        self::assertSame('consulta', Etapa::actual($ap, $ci, $this->f('2026-11-29 23:59:59')));
        self::assertSame('edicion_final', Etapa::actual($ap, $ci, $ci));
        self::assertSame('edicion_final', Etapa::actual($ap, $ci, $this->f('2027-01-01 00:00:00')));
        self::assertSame('consulta', Etapa::actual($ap, null, $this->f('2030-01-01 00:00:00')));
    }
}
