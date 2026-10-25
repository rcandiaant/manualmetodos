<?php

declare(strict_types=1);

namespace Manual\Http;

/** Error controlado que se convierte en una respuesta JSON de error. */
final class ErrorHttp extends \RuntimeException
{
    /** @param array<string,string> $campos detalle por campo (solo para 400/422) */
    public function __construct(
        public readonly int $estado,
        public readonly string $codigo,
        string $mensaje,
        public readonly array $campos = [],
    ) {
        parent::__construct($mensaje);
    }
}
