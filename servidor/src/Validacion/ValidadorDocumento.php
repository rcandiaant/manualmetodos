<?php

declare(strict_types=1);

namespace Manual\Validacion;

use Manual\Http\ErrorHttp;

/**
 * Valida un documento ProseMirror (JSON decodificado) contra `config/esquema-documento.json`,
 * generado desde el esquema del cliente (`npm run exportar-esquema`).
 *
 * Garantiza que no entre nada fuera del esquema: tipos, marcas (y su exclusión mutua), atributos,
 * hijos permitidos y límites de tamaño. La cardinalidad y el orden exactos los valida el cliente
 * con ProseMirror.
 *
 * Acepta dos representaciones:
 * - **objetos** (`json_decode(..., false)`, la recomendada): estricta, porque distingue `{…}` de `[…]`;
 *   un `{"0": …}` donde va una lista (`content`, `marks`, `bloques`) se rechaza;
 * - **arrays asociativos** (`json_decode(..., true)`): ahí `{"0": …}` y `{}` son indistinguibles de
 *   una lista, así que quien guarde el documento debe persistir siempre el JSON re-codificado,
 *   nunca el cuerpo crudo de la petición.
 */
final class ValidadorDocumento
{
    public const PROFUNDIDAD_MAXIMA = 64;
    public const NODOS_MAXIMOS = 50_000;
    public const LARGO_MAXIMO = 20_000;
    /** Largo máximo de un dato del usuario repetido en un mensaje de error. */
    private const LARGO_ECO = 80;

    private const CLAVES_NODO = ['type' => true, 'attrs' => true, 'content' => true, 'marks' => true, 'text' => true];
    private const CLAVES_MARCA = ['type' => true, 'attrs' => true];

    /**
     * Atributos `json` que guardan bloques (átomos con contenido en attrs). Sus elementos se validan
     * como hijos de `doc` salvo los de FUERA_DE_NOTAS, igual que `validarDocumento` del cliente.
     * Un atributo `json` que no esté aquí se rechaza: no hay forma segura de validarlo.
     */
    private const ATRIBUTOS_CON_BLOQUES = ['notaPie' => ['bloques' => true]];
    private const FUERA_DE_NOTAS = ['analito', 'metodo'];

    private const RUTA_ESQUEMA = __DIR__ . '/../../config/esquema-documento.json';

    /** @var array{nodos: array<string,array{hijos: list<string>, marcas: list<string>, attrs: array<string,string>, texto: bool}>, marcas: array<string,array{attrs: array<string,string>, excluye: list<string>}>}|null */
    private static ?array $esquema = null;

    private int $nodos = 0;

    /** @param bool $estricto true si el árbol viene como objetos (stdClass) */
    private function __construct(
        private readonly array $e,
        private readonly string $prefijo,
        private readonly bool $estricto,
    ) {
    }

    /** @throws ErrorHttp 422 `documento_invalido` */
    public static function validar(mixed $doc): void
    {
        $v = new self(self::esquema(), '', $doc instanceof \stdClass);
        $raiz = $v->objeto($doc, false);
        if ($raiz === null || ($raiz['type'] ?? null) !== 'doc') {
            throw $v->error('la raíz debe ser un nodo «doc»');
        }
        $v->nodo($doc, null, [], 1, 'doc');
    }

    /**
     * Valida una lista de nodos sueltos (fragmentos de una sugerencia): cualquier tipo salvo `doc`
     * en el primer nivel, con marcas solo si el nodo es inline; dentro, las reglas normales.
     *
     * @throws ErrorHttp 422 `documento_invalido`
     */
    public static function validarNodos(mixed $nodos, string $campo): void
    {
        $e = self::esquema();
        $estricto = $nodos instanceof \stdClass || (is_array($nodos) && ($nodos[0] ?? null) instanceof \stdClass);
        $v = new self($e, "{$campo}: ", $estricto);
        $lista = $v->lista($nodos);
        if ($lista === null) {
            throw $v->error('debe ser una lista de nodos');
        }
        $tipos = array_values(array_diff(array_keys($e['nodos']), ['doc']));
        foreach ($lista as $i => $n) {
            $v->nodo($n, $tipos, null, 1, "[{$i}]");
        }
    }

    private static function esquema(): array
    {
        if (self::$esquema === null) {
            $json = file_get_contents(self::RUTA_ESQUEMA);
            if ($json === false) {
                throw new \LogicException('No se pudo leer ' . self::RUTA_ESQUEMA);
            }
            self::$esquema = json_decode($json, true, 64, JSON_THROW_ON_ERROR);
        }
        return self::$esquema;
    }

    private function error(string $detalle): ErrorHttp
    {
        return new ErrorHttp(422, 'documento_invalido', "Documento inválido: {$this->prefijo}{$detalle}");
    }

    /** Dato del usuario acortado para repetirlo en un mensaje. */
    private static function eco(mixed $v): string
    {
        $s = is_string($v) || is_int($v) ? (string) $v : get_debug_type($v);
        return mb_strlen($s, 'UTF-8') > self::LARGO_ECO ? mb_substr($s, 0, self::LARGO_ECO, 'UTF-8') . '…' : $s;
    }

    /** Ruta acortada por la izquierda (lo útil es el final). Solo contiene claves ya validadas. */
    private static function ruta(string $ruta): string
    {
        return strlen($ruta) > self::LARGO_ECO ? '…' . substr($ruta, -self::LARGO_ECO) : $ruta;
    }

    /**
     * Un objeto JSON como array asociativo, o null si no lo es.
     * @param bool $vacio si un `[]` cuenta como objeto vacío (solo en modo arrays, para `attrs`)
     */
    private function objeto(mixed $v, bool $vacio): ?array
    {
        if ($v instanceof \stdClass) {
            return get_object_vars($v);
        }
        if ($this->estricto || !is_array($v)) {
            return null;
        }
        return ($v === [] ? $vacio : !array_is_list($v)) ? $v : null;
    }

    /** Una lista JSON, o null si no lo es. */
    private function lista(mixed $v): ?array
    {
        return is_array($v) && array_is_list($v) ? $v : null;
    }

    /**
     * @param list<string>|null $tiposPermitidos null solo para la raíz
     * @param list<string>|null $marcasPermitidas marcas que admite el padre; null en el primer nivel
     *                                            de un fragmento (se decide por el tipo del nodo)
     */
    private function nodo(mixed $nodo, ?array $tiposPermitidos, ?array $marcasPermitidas, int $profundidad, string $ruta): void
    {
        if ($profundidad > self::PROFUNDIDAD_MAXIMA) {
            throw $this->error('la profundidad pasa de ' . self::PROFUNDIDAD_MAXIMA . ' en ' . self::ruta($ruta));
        }
        if (++$this->nodos > self::NODOS_MAXIMOS) {
            throw $this->error('el documento tiene más de ' . self::NODOS_MAXIMOS . ' nodos');
        }
        $n = $this->objeto($nodo, false);
        if ($n === null) {
            throw $this->error(self::ruta($ruta) . ' no es un nodo');
        }
        foreach ($n as $clave => $_) {
            if (!isset(self::CLAVES_NODO[$clave])) {
                throw $this->error('clave no permitida «' . self::eco($clave) . '» en ' . self::ruta($ruta));
            }
        }
        $tipo = $n['type'] ?? null;
        if (!is_string($tipo) || !isset($this->e['nodos'][$tipo])) {
            throw $this->error('tipo de nodo desconocido «' . self::eco($tipo) . '» en ' . self::ruta($ruta));
        }
        if ($tiposPermitidos !== null && !in_array($tipo, $tiposPermitidos, true)) {
            throw $this->error("«{$tipo}» no está permitido en " . self::ruta($ruta));
        }
        $spec = $this->e['nodos'][$tipo];

        if (array_key_exists('marks', $n)) {
            $this->marcas($n['marks'], $marcasPermitidas ?? $this->marcasInline($tipo), $profundidad, $ruta);
        }
        if (array_key_exists('attrs', $n)) {
            $this->attrs($n['attrs'], $spec['attrs'], $tipo, $profundidad, $ruta);
        }

        if ($spec['texto']) {
            $texto = $n['text'] ?? null;
            if (!is_string($texto) || $texto === '') {
                throw $this->error('texto vacío o que no es string en ' . self::ruta($ruta));
            }
            $this->largo($texto, "{$ruta}.text");
        } elseif (array_key_exists('text', $n)) {
            throw $this->error('clave no permitida «text» en ' . self::ruta($ruta));
        }

        if (array_key_exists('content', $n)) {
            if ($spec['hijos'] === []) {
                throw $this->error("«{$tipo}» no admite content en " . self::ruta($ruta));
            }
            $hijos = $this->lista($n['content']);
            if ($hijos === null) {
                throw $this->error(self::ruta($ruta) . '.content debe ser una lista');
            }
            foreach ($hijos as $i => $h) {
                $this->nodo($h, $spec['hijos'], $spec['marcas'], $profundidad + 1, "{$ruta}.content[{$i}]");
            }
        }
    }

    /**
     * Marcas que puede llevar un nodo suelto de tipo `$tipo`: las de algún padre que lo admita como hijo.
     * Así un bloque suelto (p. ej. un `parrafo`) no puede llevar marcas.
     * @return list<string>
     */
    private function marcasInline(string $tipo): array
    {
        $marcas = [];
        foreach ($this->e['nodos'] as $spec) {
            if (in_array($tipo, $spec['hijos'], true)) {
                $marcas = array_merge($marcas, $spec['marcas']);
            }
        }
        return array_values(array_unique($marcas));
    }

    /** @param list<string> $permitidas */
    private function marcas(mixed $valor, array $permitidas, int $profundidad, string $ruta): void
    {
        $marcas = $this->lista($valor);
        if ($marcas === null) {
            throw $this->error(self::ruta($ruta) . '.marks debe ser una lista');
        }
        $vistas = [];
        foreach ($marcas as $i => $marca) {
            $r = "{$ruta}.marks[{$i}]";
            $m = $this->objeto($marca, false);
            if ($m === null) {
                throw $this->error(self::ruta($r) . ' no es una marca');
            }
            foreach ($m as $clave => $_) {
                if (!isset(self::CLAVES_MARCA[$clave])) {
                    throw $this->error('clave no permitida «' . self::eco($clave) . '» en ' . self::ruta($r));
                }
            }
            $tipo = $m['type'] ?? null;
            if (!is_string($tipo) || !isset($this->e['marcas'][$tipo])) {
                throw $this->error('marca desconocida «' . self::eco($tipo) . '» en ' . self::ruta($r));
            }
            if (!in_array($tipo, $permitidas, true)) {
                throw $this->error("la marca «{$tipo}» no está permitida en " . self::ruta($r));
            }
            foreach ($vistas as $otra => $_) {
                if (
                    in_array($otra, $this->e['marcas'][$tipo]['excluye'], true)
                    || in_array($tipo, $this->e['marcas'][$otra]['excluye'], true)
                ) {
                    $detalle = $otra === $tipo ? "marca «{$tipo}» repetida" : "las marcas «{$otra}» y «{$tipo}» se excluyen";
                    throw $this->error("{$detalle} en " . self::ruta($ruta));
                }
            }
            $vistas[$tipo] = true;
            if (array_key_exists('attrs', $m)) {
                $this->attrs($m['attrs'], $this->e['marcas'][$tipo]['attrs'], $tipo, $profundidad, $r);
            }
        }
    }

    /** @param array<string,string> $declarados */
    private function attrs(mixed $valor, array $declarados, string $tipo, int $profundidad, string $ruta): void
    {
        // En modo arrays, `{}` llega como `[]`: una lista vacía vale como objeto vacío.
        $attrs = $this->objeto($valor, true);
        if ($attrs === null) {
            throw $this->error(self::ruta($ruta) . '.attrs debe ser un objeto');
        }
        foreach ($attrs as $nombre => $v) {
            $esperado = $declarados[$nombre] ?? null;
            if ($esperado === null) {
                throw $this->error('atributo no declarado «' . self::eco($nombre) . '» en ' . self::ruta($ruta));
            }
            $r = "{$ruta}.attrs.{$nombre}";
            $ok = match ($esperado) {
                'string' => is_string($v),
                'null|string' => $v === null || is_string($v),
                'boolean' => is_bool($v),
                'number' => is_int($v) || is_float($v),
                'json' => is_array($v) || $v instanceof \stdClass,
                default => false,
            };
            if (!$ok) {
                throw $this->error("el atributo «{$nombre}» debe ser {$esperado} en " . self::ruta($ruta));
            }
            if (is_string($v)) {
                $this->largo($v, $r);
            } elseif ($esperado === 'json') {
                $this->bloquesEnAtributo($v, $tipo, (string) $nombre, $profundidad, $r);
            }
        }
    }

    private function bloquesEnAtributo(mixed $valor, string $tipo, string $nombre, int $profundidad, string $ruta): void
    {
        if (!isset(self::ATRIBUTOS_CON_BLOQUES[$tipo][$nombre])) {
            throw $this->error("el atributo «{$nombre}» de «{$tipo}» no tiene validador en el servidor");
        }
        $bloques = $this->lista($valor);
        if ($bloques === null) {
            throw $this->error(self::ruta($ruta) . ' debe ser una lista de bloques');
        }
        $doc = $this->e['nodos']['doc'];
        $permitidos = array_values(array_diff($doc['hijos'], self::FUERA_DE_NOTAS));
        foreach ($bloques as $i => $b) {
            $this->nodo($b, $permitidos, $doc['marcas'], $profundidad + 1, "{$ruta}[{$i}]");
        }
    }

    private function largo(string $s, string $ruta): void
    {
        // Atajos por bytes: ≤ LARGO_MAXIMO bytes siempre cabe; > 4 × LARGO_MAXIMO nunca.
        $bytes = strlen($s);
        if ($bytes <= self::LARGO_MAXIMO) {
            return;
        }
        if ($bytes > 4 * self::LARGO_MAXIMO || mb_strlen($s, 'UTF-8') > self::LARGO_MAXIMO) {
            throw $this->error('un texto pasa de ' . self::LARGO_MAXIMO . ' caracteres en ' . self::ruta($ruta));
        }
    }
}
