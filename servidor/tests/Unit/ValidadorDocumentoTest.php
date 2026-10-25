<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use Manual\Http\ErrorHttp;
use Manual\Http\Peticion;
use Manual\Validacion\ValidadorDocumento;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class ValidadorDocumentoTest extends TestCase
{
    /** @param list<array<string,mixed>> $bloques */
    private static function doc(array ...$bloques): array
    {
        return ['type' => 'doc', 'content' => [
            ['type' => 'analito', 'content' => [['type' => 'text', 'text' => 'pH']]],
            ['type' => 'metodo', 'content' => [['type' => 'text', 'text' => 'Potenciometría']]],
            ...$bloques,
        ]];
    }

    private static function parrafo(array ...$inline): array
    {
        return ['type' => 'parrafo', 'attrs' => ['bid' => 'p1', 'pegado' => false], 'content' => $inline];
    }

    private static function texto(string $t, array $marcas = []): array
    {
        $n = ['type' => 'text', 'text' => $t];
        if ($marcas !== []) {
            $n['marks'] = array_map(fn ($m) => ['type' => $m], $marcas);
        }
        return $n;
    }

    private static function nota(array ...$bloques): array
    {
        return ['type' => 'notaPie', 'attrs' => ['bloques' => $bloques]];
    }

    /** Lista anidada con `$niveles` niveles de listaVinetas > item. */
    private static function listaAnidada(int $niveles): array
    {
        $n = self::parrafo(self::texto('hoja'));
        for ($i = 0; $i < $niveles; $i++) {
            $n = ['type' => 'listaVinetas', 'content' => [
                ['type' => 'item', 'content' => [self::parrafo(self::texto('x')), $n]],
            ]];
        }
        return $n;
    }

    private function assertRechaza(mixed $doc, string $fragmento = ''): void
    {
        try {
            ValidadorDocumento::validar($doc);
        } catch (ErrorHttp $e) {
            $this->assertSame(422, $e->estado);
            $this->assertSame('documento_invalido', $e->codigo);
            if ($fragmento !== '') {
                $this->assertStringContainsString($fragmento, $e->getMessage());
            }
            return;
        }
        $this->fail('Se esperaba documento_invalido');
    }

    /** @return iterable<string,array{string}> */
    public static function fixtures(): iterable
    {
        $archivos = glob(__DIR__ . '/../fixtures/*.json') ?: [];
        foreach ($archivos as $a) {
            yield basename($a) => [$a];
        }
    }

    #[DataProvider('fixtures')]
    public function test_acepta_los_fixtures_del_cliente(string $archivo): void
    {
        $json = (string) file_get_contents($archivo);
        // Se acepta tanto decodificado como arrays asociativos como en forma de objetos (stdClass).
        ValidadorDocumento::validar(json_decode($json, true, 512, JSON_THROW_ON_ERROR));
        ValidadorDocumento::validar(json_decode($json, false, 512, JSON_THROW_ON_ERROR));
        $this->addToAssertionCount(2);
    }

    public function test_hay_tres_fixtures(): void
    {
        $this->assertCount(3, iterator_to_array(self::fixtures()));
    }

    public function test_rechaza_raiz_que_no_es_doc(): void
    {
        $this->assertRechaza(self::parrafo(self::texto('x')));
        $this->assertRechaza('doc');
        $this->assertRechaza(null);
        $this->assertRechaza([]);
    }

    public function test_rechaza_tipo_desconocido(): void
    {
        $this->assertRechaza(self::doc(['type' => 'html', 'attrs' => ['contenido' => '<script>']]), 'html');
        $this->assertRechaza(self::doc(self::parrafo(['type' => 'imagen'])), 'imagen');
    }

    public function test_rechaza_atributo_onclick(): void
    {
        $p = self::parrafo(self::texto('x'));
        $p['attrs']['onclick'] = 'alert(1)';
        $this->assertRechaza(self::doc($p), 'onclick');
        // Claves extra en el nodo tampoco.
        $q = self::parrafo(self::texto('x'));
        $q['onclick'] = 'alert(1)';
        $this->assertRechaza(self::doc($q), 'onclick');
    }

    public function test_rechaza_atributo_de_tipo_incorrecto(): void
    {
        $p = self::parrafo(self::texto('x'));
        $p['attrs']['pegado'] = 'si';
        $this->assertRechaza(self::doc($p), 'pegado');
        $p['attrs']['pegado'] = false;
        $p['attrs']['bid'] = 7;
        $this->assertRechaza(self::doc($p), 'bid');
        $this->assertRechaza(self::doc(self::parrafo(['type' => 'notaPie', 'attrs' => ['bloques' => 'texto']])), 'bloques');
    }

    public function test_acepta_atributos_omitidos_y_nulos_permitidos(): void
    {
        ValidadorDocumento::validar(self::doc(
            ['type' => 'parrafo', 'content' => [self::texto('x')]],
            ['type' => 'parrafo', 'attrs' => ['bid' => null], 'content' => []],
            ['type' => 'parrafo', 'attrs' => []],
        ));
        $this->addToAssertionCount(1);
    }

    public function test_rechaza_marca_desconocida(): void
    {
        $this->assertRechaza(self::doc(self::parrafo(self::texto('x', ['enlace']))), 'enlace');
        // Marca conocida con atributo no declarado.
        $t = self::texto('x');
        $t['marks'] = [['type' => 'negrita', 'attrs' => ['href' => 'javascript:']]];
        $this->assertRechaza(self::doc(self::parrafo($t)), 'href');
        // Marca en un nodo cuyo padre no admite marcas.
        $lista = self::listaAnidada(1);
        $lista['content'][0]['marks'] = [['type' => 'negrita']];
        $this->assertRechaza(self::doc($lista), 'negrita');
    }

    public function test_rechaza_hijo_no_permitido(): void
    {
        // Un párrafo dentro de un párrafo.
        $this->assertRechaza(self::doc(self::parrafo(self::parrafo(self::texto('x')))), 'parrafo');
        // Texto directamente en una lista.
        $this->assertRechaza(self::doc(['type' => 'listaVinetas', 'content' => [self::texto('x')]]));
        // Contenido dentro de un átomo.
        $this->assertRechaza(self::doc(['type' => 'ecuacion', 'attrs' => ['latex' => 'x'], 'content' => [self::texto('x')]]));
        // Un analito en los bloques de una nota al pie.
        $this->assertRechaza(self::doc(self::parrafo(self::nota(['type' => 'analito', 'content' => []]))), 'analito');
    }

    public function test_rechaza_texto_vacio_o_no_string(): void
    {
        $this->assertRechaza(self::doc(self::parrafo(['type' => 'text', 'text' => ''])));
        $this->assertRechaza(self::doc(self::parrafo(['type' => 'text', 'text' => 5])));
        $this->assertRechaza(self::doc(self::parrafo(['type' => 'text'])));
    }

    public function test_rechaza_profundidad_excesiva(): void
    {
        // doc > listaVinetas > item > ... : cada nivel suma 2.
        ValidadorDocumento::validar(self::doc(self::listaAnidada(30)));
        $this->assertRechaza(self::doc(self::listaAnidada(40)), 'profundidad');
        $this->assertRechaza(self::doc(self::listaAnidada(10000)), 'profundidad');
    }

    public function test_la_profundidad_cuenta_dentro_de_las_notas(): void
    {
        $n = self::parrafo(self::texto('hoja'));
        for ($i = 0; $i < 40; $i++) {
            $n = self::parrafo(self::nota($n));
        }
        $this->assertRechaza(self::doc($n), 'profundidad');
    }

    public function test_rechaza_demasiados_nodos(): void
    {
        $inline = array_fill(0, 50_000, ['type' => 'matematica', 'attrs' => ['latex' => 'x']]);
        $this->assertRechaza(self::doc(self::parrafo(...$inline)), 'nodos');
    }

    public function test_rechaza_texto_gigante(): void
    {
        $this->assertRechaza(self::doc(self::parrafo(self::texto(str_repeat('a', 20_001)))), '20000');
        $this->assertRechaza(self::doc(['type' => 'ecuacion', 'attrs' => ['latex' => str_repeat('x', 5_000_000)]]));
        // Los bloques de una nota también cuentan.
        $this->assertRechaza(self::doc(self::parrafo(self::nota(self::parrafo(self::texto(str_repeat('é', 20_001)))))));
        // 20 000 caracteres multibyte justos sí entran.
        ValidadorDocumento::validar(self::doc(self::parrafo(self::texto(str_repeat('é', 20_000)))));
    }

    public function test_valida_fragmentos_de_nodos(): void
    {
        ValidadorDocumento::validarNodos([self::texto('a', ['negrita']), ['type' => 'item', 'content' => [self::parrafo()]]], 'propuesta');
        try {
            ValidadorDocumento::validarNodos([['type' => 'doc', 'content' => []]], 'propuesta');
            $this->fail('doc no puede ir en un fragmento');
        } catch (ErrorHttp $e) {
            $this->assertSame('documento_invalido', $e->codigo);
            $this->assertStringContainsString('propuesta', $e->getMessage());
        }
    }

    public function test_fragmentos_sin_marcas_en_bloques(): void
    {
        $p = self::parrafo(self::texto('x'));
        $p['marks'] = [['type' => 'negrita']];
        try {
            ValidadorDocumento::validarNodos([$p], 'propuesta');
            $this->fail('Un bloque no puede llevar marcas');
        } catch (ErrorHttp $e) {
            $this->assertSame('documento_invalido', $e->codigo);
            $this->assertStringContainsString('negrita', $e->getMessage());
        }
        // En nodos inline sí.
        ValidadorDocumento::validarNodos([['type' => 'matematica', 'attrs' => ['latex' => 'x'], 'marks' => [['type' => 'cursiva']]]], 'original');
    }

    public function test_rechaza_marcas_que_se_excluyen(): void
    {
        $this->assertRechaza(self::doc(self::parrafo(self::texto('x', ['subindice', 'superindice']))), 'superindice');
        $this->assertRechaza(self::doc(self::parrafo(self::texto('x', ['superindice', 'negrita', 'subindice']))), 'subindice');
        $this->assertRechaza(self::doc(self::parrafo(self::texto('x', ['negrita', 'negrita']))), 'negrita');
        ValidadorDocumento::validar(self::doc(self::parrafo(self::texto('x', ['negrita', 'cursiva', 'subindice']))));
    }

    /** Con forma de objetos, un `{"0": …}` donde va una lista se distingue de `[…]` y se rechaza. */
    public function test_rechaza_objetos_donde_se_esperan_listas(): void
    {
        $texto = '{"type":"text","text":"x"}';
        $parrafo = fn (string $contenido) => '{"type":"parrafo","content":' . $contenido . '}';
        $doc = fn (string $bloque) => json_decode(
            '{"type":"doc","content":[{"type":"analito"},{"type":"metodo"},' . $bloque . ']}',
            false,
            512,
            JSON_THROW_ON_ERROR,
        );
        ValidadorDocumento::validar($doc($parrafo("[$texto]")));
        $this->assertRechaza($doc($parrafo("{\"0\":$texto}")), 'lista');
        $this->assertRechaza($doc($parrafo('{}')), 'lista');
        $this->assertRechaza($doc($parrafo('[{"type":"text","text":"x","marks":{"0":{"type":"negrita"}}}]')), 'lista');
        $this->assertRechaza($doc($parrafo('[{"type":"notaPie","attrs":{"bloques":{"0":' . $parrafo("[$texto]") . '}}}]')), 'lista');
        // Y al revés: una lista donde va un objeto.
        $this->assertRechaza($doc('{"type":"parrafo","attrs":[]}'), 'objeto');
        $this->assertRechaza($doc("[$texto]"), 'nodo');
        try {
            ValidadorDocumento::validarNodos(json_decode("{\"0\":$texto}", false), 'propuesta');
            $this->fail('Un objeto no es una lista de nodos');
        } catch (ErrorHttp $e) {
            $this->assertSame(422, $e->estado);
        }
    }

    public function test_rechaza_content_en_text_y_atomos(): void
    {
        $this->assertRechaza(self::doc(self::parrafo(['type' => 'text', 'text' => 'x', 'content' => []])), 'content');
        $this->assertRechaza(self::doc(['type' => 'ecuacion', 'attrs' => ['latex' => 'x'], 'content' => []]), 'content');
        $this->assertRechaza(self::doc(self::parrafo(['type' => 'referencia', 'content' => []])), 'content');
    }

    public function test_los_mensajes_no_repiten_entrada_larga(): void
    {
        $enorme = str_repeat('a', 100_000);
        $casos = [
            self::doc(['type' => $enorme]),
            self::doc(self::parrafo(self::texto('x', [$enorme]))),
            self::doc(['type' => 'parrafo', $enorme => 1]),
            self::doc(['type' => 'parrafo', 'attrs' => [$enorme => 1]]),
            self::doc(self::listaAnidada(40)),
        ];
        foreach ($casos as $i => $doc) {
            try {
                ValidadorDocumento::validar($doc);
                $this->fail("caso $i aceptado");
            } catch (ErrorHttp $e) {
                $this->assertLessThan(300, mb_strlen($e->getMessage()), "caso $i: " . mb_substr($e->getMessage(), 0, 100));
            }
        }
    }

    public function test_el_contador_de_nodos_se_acumula_entre_notas(): void
    {
        // 30 notas de ~2 000 nodos: ninguna pasa del límite por sí sola, juntas sí.
        $inline = array_fill(0, 2_000, ['type' => 'matematica', 'attrs' => ['latex' => 'x']]);
        $notas = array_fill(0, 30, self::nota(self::parrafo(...$inline)));
        ValidadorDocumento::validar(self::doc(self::parrafo(...array_slice($notas, 0, 20))));
        $this->assertRechaza(self::doc(self::parrafo(...$notas)), 'nodos');
    }

    /** JSON de una lista anidada de `$niveles` niveles, armado como texto (json_encode no pasa de 512). */
    private static function jsonListaAnidada(int $niveles): string
    {
        $parrafo = '{"type":"parrafo","content":[{"type":"text","text":"x"}]}';
        return str_repeat('{"type":"listaVinetas","content":[{"type":"item","content":[' . $parrafo . ',', $niveles)
            . $parrafo . str_repeat(']}]}', $niveles);
    }

    /**
     * Por HTTP, el límite de profundidad JSON de Peticion (64) llega antes que el del validador:
     * un documento muy profundo da 400 `entrada_invalida` (nunca 500), y todo lo que se decodifica
     * queda dentro de la profundidad de nodos permitida. El 422 por profundidad solo se alcanza
     * en llamadas directas (test_rechaza_profundidad_excesiva).
     */
    public function test_profundidad_por_http(): void
    {
        $cuerpo = fn (int $n) => '{"docJson":{"type":"doc","content":[{"type":"analito"},{"type":"metodo"},'
            . self::jsonListaAnidada($n) . ']}}';
        $decodificados = 0;
        foreach ([1, 5, 10, 14, 15, 16, 20, 32, 40, 10_000] as $n) {
            $peticion = new Peticion('PUT', '/api/x', [], $cuerpo($n), '127.0.0.1');
            try {
                $datos = $peticion->jsonObjeto();
            } catch (ErrorHttp $e) {
                $this->assertSame(400, $e->estado, "niveles $n");
                $this->assertSame('entrada_invalida', $e->codigo);
                $this->assertGreaterThan(10, $n);
                continue;
            }
            ValidadorDocumento::validar($datos->docJson);
            $decodificados++;
        }
        $this->assertGreaterThan(0, $decodificados);
    }
}

