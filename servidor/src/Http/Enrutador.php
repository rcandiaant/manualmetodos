<?php

declare(strict_types=1);

namespace Manual\Http;

final class Enrutador
{
    private const PARAMETROS = [
        '{id}' => '(?P<id>[0-9]+)',
        '{uid}' => '(?P<uid>[A-Za-z0-9:@+_-]{1,190})',
    ];

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
            if ($ruta['metodo'] === $metodo) {
                $params = array_filter($m, 'is_string', ARRAY_FILTER_USE_KEY);
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
