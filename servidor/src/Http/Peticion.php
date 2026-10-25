<?php

declare(strict_types=1);

namespace Manual\Http;

final class Peticion
{
    public const LIMITE_CUERPO = 2 * 1024 * 1024;

    /** @var array<string,string> nombres en minúsculas */
    public readonly array $cabeceras;

    /** @param array<string,string> $cabeceras los nombres se normalizan a minúsculas */
    public function __construct(
        public readonly string $metodo,
        public readonly string $ruta,
        array $cabeceras,
        public readonly string $cuerpo,
        public readonly string $ip,
    ) {
        $this->cabeceras = array_change_key_case($cabeceras, CASE_LOWER);
    }

    /** Único punto que lee superglobales y php://input. */
    public static function desdeGlobales(): self
    {
        $cabeceras = [];
        foreach ($_SERVER as $clave => $valor) {
            if (is_string($valor) && str_starts_with($clave, 'HTTP_')) {
                $cabeceras[strtolower(str_replace('_', '-', substr($clave, 5)))] = $valor;
            }
        }
        foreach (['CONTENT_TYPE' => 'content-type', 'CONTENT_LENGTH' => 'content-length'] as $k => $n) {
            if (isset($_SERVER[$k]) && is_string($_SERVER[$k])) {
                $cabeceras[$n] = $_SERVER[$k];
            }
        }

        $ruta = parse_url((string) ($_SERVER['REQUEST_URI'] ?? '/'), PHP_URL_PATH);
        $ruta = is_string($ruta) && $ruta !== '' ? $ruta : '/';

        // Con Content-Length excesivo no se lee nada: Aplicacion responde 413.
        // Si no, se lee un byte de más para detectar el exceso sin cargar cuerpos enormes.
        $cuerpo = '';
        $largo = $cabeceras['content-length'] ?? '';
        $excede = ctype_digit($largo) && (int) $largo > self::LIMITE_CUERPO;
        $flujo = $excede ? false : fopen('php://input', 'rb');
        if ($flujo !== false) {
            $cuerpo = (string) stream_get_contents($flujo, self::LIMITE_CUERPO + 1);
            fclose($flujo);
        }

        return new self(
            strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET')),
            $ruta,
            $cabeceras,
            $cuerpo,
            (string) ($_SERVER['REMOTE_ADDR'] ?? ''),
        );
    }

    public function cabecera(string $nombre): ?string
    {
        return $this->cabeceras[strtolower($nombre)] ?? null;
    }

    /** @return array<string,mixed> */
    public function json(): array
    {
        try {
            $objeto = json_decode($this->cuerpo, false, 64, JSON_THROW_ON_ERROR);
            if (!$objeto instanceof \stdClass) {
                throw new ErrorHttp(400, 'entrada_invalida', 'El cuerpo debe ser un objeto JSON.');
            }
            return json_decode($this->cuerpo, true, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ErrorHttp(400, 'entrada_invalida', 'El cuerpo no es JSON válido.');
        }
    }
}
