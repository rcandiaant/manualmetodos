<?php

declare(strict_types=1);

namespace Manual\Http;

final class Respuesta
{
    /** @param array<string,string> $cabeceras */
    private function __construct(
        public readonly int $estado,
        public readonly mixed $datos,
        public readonly array $cabeceras,
    ) {
    }

    /** @param array<string,string> $cabeceras */
    public static function json(int $estado, mixed $datos, array $cabeceras = []): self
    {
        return new self($estado, $datos, ['Content-Type' => 'application/json; charset=utf-8'] + $cabeceras);
    }

    public static function vacia(int $estado = 204): self
    {
        return new self($estado, null, []);
    }

    /**
     * @param array<string,string> $campos
     * @param array<string,string> $cabeceras
     */
    public static function error(int $estado, string $codigo, string $mensaje, array $campos = [], array $cabeceras = []): self
    {
        $error = ['codigo' => $codigo, 'mensaje' => $mensaje];
        if ($campos !== []) {
            $error['campos'] = $campos;
        }
        return self::json($estado, ['error' => $error], $cabeceras);
    }

    /**
     * Añade cabeceras por defecto sin pisar las que la respuesta ya fijó (nombres sin distinguir mayúsculas).
     * @param array<string,string> $cabeceras
     */
    public function conPorDefecto(array $cabeceras): self
    {
        $presentes = array_change_key_case($this->cabeceras, CASE_LOWER);
        $nuevas = $this->cabeceras;
        foreach ($cabeceras as $nombre => $valor) {
            if (!array_key_exists(strtolower((string) $nombre), $presentes)) {
                $nuevas[$nombre] = $valor;
            }
        }
        return new self($this->estado, $this->datos, $nuevas);
    }

    public function sinCuerpo(): self
    {
        return new self($this->estado, null, $this->cabeceras);
    }

    /** @throws \JsonException si los datos no son codificables (p. ej. UTF-8 inválido) */
    public function cuerpo(): string
    {
        if ($this->datos === null) {
            return '';
        }
        return json_encode($this->datos, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
    }

    public function enviar(): void
    {
        $cuerpo = $this->cuerpo(); // antes de emitir cabeceras: si falla, aún se puede responder 500
        http_response_code($this->estado);
        foreach ($this->cabeceras as $nombre => $valor) {
            header("$nombre: $valor");
        }
        echo $cuerpo;
    }
}
