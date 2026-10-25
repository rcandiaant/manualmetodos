<?php

declare(strict_types=1);

namespace Manual\Http;

final class Peticion
{
    public const LIMITE_CUERPO = 2 * 1024 * 1024;
    public const LIMITE_CUERPO_CAPITULO = 4 * 1024 * 1024;

    /** Tope de cuerpo por ruta: 4 MB al subir capítulos y al guardar la versión final; 2 MB en el resto. */
    public static function limiteCuerpo(string $metodo, string $ruta): int
    {
        $grande = ($metodo === 'POST' && $ruta === '/api/admin/capitulos')
            || ($metodo === 'PUT' && preg_match('#^/api/capitulos/[0-9]+/final$#D', $ruta) === 1);
        return $grande ? self::LIMITE_CUERPO_CAPITULO : self::LIMITE_CUERPO;
    }

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
        $metodo = strtoupper((string) ($_SERVER['REQUEST_METHOD'] ?? 'GET'));
        $limite = self::limiteCuerpo($metodo, $ruta);
        $excede = ctype_digit($largo) && (int) $largo > $limite;
        $flujo = $excede ? false : fopen('php://input', 'rb');
        if ($flujo !== false) {
            $cuerpo = (string) stream_get_contents($flujo, $limite + 1);
            fclose($flujo);
        }

        return new self(
            $metodo,
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

    /** Valor de la cookie $nombre de la cabecera Cookie (sin decodificar), o null si no viene. */
    public function cookie(string $nombre): ?string
    {
        foreach (explode(';', $this->cabecera('cookie') ?? '') as $par) {
            $partes = explode('=', trim($par), 2);
            if (count($partes) === 2 && $partes[0] === $nombre) {
                return $partes[1];
            }
        }
        return null;
    }

    /** @return array<string,mixed> */
    public function json(): array
    {
        $this->jsonObjeto();
        return json_decode($this->cuerpo, true, 64, JSON_THROW_ON_ERROR);
    }

    /**
     * El cuerpo en forma de objetos (stdClass), que distingue `{…}` de `[…]`. Es la forma que
     * conviene pasar a ValidadorDocumento/ValidadorSugerencia (modo estricto con las listas).
     */
    public function jsonObjeto(): \stdClass
    {
        try {
            $objeto = json_decode($this->cuerpo, false, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new ErrorHttp(400, 'entrada_invalida', 'El cuerpo no es JSON válido.');
        }
        if (!$objeto instanceof \stdClass) {
            throw new ErrorHttp(400, 'entrada_invalida', 'El cuerpo debe ser un objeto JSON.');
        }
        return $objeto;
    }
}
