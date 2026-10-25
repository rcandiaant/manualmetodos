<?php

declare(strict_types=1);

namespace Manual;

/** Fuente de la hora actual. Se inyecta para poder probar vencimientos y bloqueos. */
interface Reloj
{
    public function ahora(): \DateTimeImmutable;
}
