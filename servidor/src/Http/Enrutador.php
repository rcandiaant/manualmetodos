<?php

declare(strict_types=1);

namespace Manual\Http;

final class Enrutador
{
    /** Lo que casa en la ruta cruda (sin decodificar). {uid} admite la forma con %XX de encodeURIComponent. */
    private const PARAMETROS = [
        '{id}' => '(?P<id>[0-9]+)',
        '{uid}' => '(?P<uid>[^/]{1,570})',
    ];

    /** Lo que debe cumplir cada parámetro ya decodificado (rawurldecode: «+» sigue siendo «+»). */
    private const DECODIFICADOS = [
        'id' => '/^[0-9]+$/D',
        'uid' => '/^[A-Za-z0-9:@+_-]{1,190}$/D', // = ValidadorSugerencia::PATRON_ID
    ];

    /**
     * Decodifica los parámetros y los valida; null si alguno no cumple (la ruta no casa).
     * @param array<string,string> $crudos
     * @return array<string,string>|null
     */
    private static function decodificar(array $crudos): ?array
    {
        $res = [];
        foreach ($crudos as $nombre => $valor) {
            $valor = rawurldecode($valor);
            if (preg_match(self::DECODIFICADOS[$nombre], $valor) !== 1) {
                return null;
            }
            $res[$nombre] = $valor;
        }
        return $res;
    }

    /** @var list<array{metodo:string,regex:string,manejador:callable}> */
    private array $rutas = [];

    /** @param callable(Peticion, array<string,string>): Respuesta $manejador */
    public function agregar(string $metodo, string $patron, callable $manejador): void
    {
        $regex = preg_quote($patron, '#');
        foreach (self::PARAMETROS as $marca => $sustituto) {
            $regex = str_replace(preg_quote($marca, '#'), $sustituto, $regex);
        }
        $this->rutas[] = ['metodo' => strtoupper($metodo), 'regex' => '#^' . $regex . '$#D', 'manejador' => $manejador];
    }

    public function resolver(Peticion $p): Respuesta
    {
        $permitidos = [];
        $metodo = $p->metodo === 'HEAD' ? 'GET' : $p->metodo;
        foreach ($this->rutas as $ruta) {
            if (preg_match($ruta['regex'], $p->ruta, $m) !== 1) {
                continue;
            }
            $params = self::decodificar(array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY));
            if ($params === null) {
                continue;
            }
            if ($ruta['metodo'] === $metodo) {
                return ($ruta['manejador'])($p, $params);
            }
            $permitidos[] = $ruta['metodo'];
        }
        if ($permitidos !== []) {
            $permitidos = array_values(array_unique($permitidos));
            sort($permitidos);
            return Respuesta::error(405, 'metodo_no_permitido', 'Método no permitido.', [], ['Allow' => implode(', ', $permitidos)]);
        }
        return Respuesta::error(404, 'no_encontrado', 'Recurso no encontrado.');
    }
}
