<?php

declare(strict_types=1);

namespace Manual\Acceso;

use Manual\Dominio\Etapa;
use Manual\Reloj;

/** Fila única (id = 1) con las fechas de la consulta. Se guardan en UTC y se devuelven en ISO 8601 con «Z». */
final class Consulta
{
    private const UTC = 'UTC';

    public function __construct(private readonly \PDO $bd, private readonly Reloj $reloj)
    {
    }

    /** @return array{apertura:?\DateTimeImmutable,cierre:?\DateTimeImmutable,motivoObligatorio:bool} */
    public function leer(): array
    {
        $f = $this->bd->query('SELECT apertura, cierre, motivo_obligatorio FROM consulta WHERE id = 1')->fetch();
        if ($f === false) {
            return ['apertura' => null, 'cierre' => null, 'motivoObligatorio' => false];
        }
        return [
            'apertura' => self::fecha($f['apertura']),
            'cierre' => self::fecha($f['cierre']),
            'motivoObligatorio' => (int) $f['motivo_obligatorio'] === 1,
        ];
    }

    public function etapa(): string
    {
        $c = $this->leer();
        return Etapa::actual($c['apertura'], $c['cierre'], $this->reloj->ahora());
    }

    /** @return array{apertura:?string,cierre:?string,etapa:string,motivoObligatorio:bool} */
    public function dto(): array
    {
        $c = $this->leer();
        return [
            'apertura' => self::iso($c['apertura']),
            'cierre' => self::iso($c['cierre']),
            'etapa' => Etapa::actual($c['apertura'], $c['cierre'], $this->reloj->ahora()),
            'motivoObligatorio' => $c['motivoObligatorio'],
        ];
    }

    public function guardar(\DateTimeImmutable $apertura, \DateTimeImmutable $cierre, bool $motivoObligatorio): void
    {
        $this->bd->prepare('UPDATE consulta SET apertura = ?, cierre = ?, motivo_obligatorio = ? WHERE id = 1')
            ->execute([self::sql($apertura), self::sql($cierre), $motivoObligatorio ? 1 : 0]);
    }

    public function guardarMotivo(bool $motivoObligatorio): void
    {
        $this->bd->prepare('UPDATE consulta SET motivo_obligatorio = ? WHERE id = 1')->execute([$motivoObligatorio ? 1 : 0]);
    }

    public static function iso(?\DateTimeImmutable $f): ?string
    {
        return $f?->setTimezone(new \DateTimeZone(self::UTC))->format('Y-m-d\TH:i:s\Z');
    }

    private static function sql(\DateTimeImmutable $f): string
    {
        return $f->setTimezone(new \DateTimeZone(self::UTC))->format('Y-m-d H:i:s');
    }

    private static function fecha(mixed $v): ?\DateTimeImmutable
    {
        return is_string($v) ? new \DateTimeImmutable($v, new \DateTimeZone(self::UTC)) : null;
    }
}
