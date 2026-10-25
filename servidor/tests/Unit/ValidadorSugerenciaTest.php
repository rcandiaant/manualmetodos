<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use Manual\Http\ErrorHttp;
use Manual\Validacion\ValidadorSugerencia;
use PHPUnit\Framework\TestCase;

final class ValidadorSugerenciaTest extends TestCase
{
    private static function sugerencia(array $cambios = []): array
    {
        return array_merge([
            'id' => 'LabA:p1:0a1b2c3d',
            'autor' => 'Lab A',
            'bloqueId' => 'p1',
            'base' => ['desde' => 2, 'hasta' => 4],
            'copia' => ['desde' => 2, 'hasta' => 3],
            'original' => [['type' => 'text', 'text' => 'dos palabras']],
            'propuesta' => [['type' => 'text', 'text' => 'una', 'marks' => [['type' => 'negrita']]]],
            'tipo' => 'contenido',
        ], $cambios);
    }

    private function assertFalla(mixed $s, string $codigo = 'entrada_invalida'): ErrorHttp
    {
        try {
            ValidadorSugerencia::validar($s);
        } catch (ErrorHttp $e) {
            $this->assertSame($codigo, $e->codigo);
            $this->assertSame($codigo === 'entrada_invalida' ? 400 : 422, $e->estado);
            return $e;
        }
        $this->fail("Se esperaba $codigo");
    }

    public function test_sugerencia_valida_sin_autor(): void
    {
        $s = self::sugerencia();
        $r = ValidadorSugerencia::validar($s);
        unset($s['autor']);
        $this->assertSame($s, $r);
        $this->assertArrayNotHasKey('autor', $r);
    }

    public function test_acepta_los_campos_opcionales(): void
    {
        $s = self::sugerencia([
            'tipo' => 'bloque-insertado',
            'original' => [],
            'propuesta' => [['type' => 'item', 'attrs' => ['etiqueta' => null], 'content' => [
                ['type' => 'parrafo', 'attrs' => ['bid' => null, 'pegado' => false], 'content' => []],
            ]]],
            'profundidad' => 2,
            'siguiente' => 'p2',
            'primerHijo' => true,
            'grupo' => 'Lab A:g:1',
            'orden' => 0,
            'motivo' => 'Aclara el paso.',
        ]);
        $r = ValidadorSugerencia::validar($s);
        unset($s['autor']);
        $this->assertSame($s, $r);
    }

    public function test_sugerencia_con_campos_extra_los_descarta(): void
    {
        $r = ValidadorSugerencia::validar(self::sugerencia([
            'estado' => 'aceptada',
            'usuario_id' => 99,
            'notaResolucion' => 'x',
            'base' => ['desde' => 0, 'hasta' => 1, 'extra' => true],
        ]));
        $this->assertSame(['id', 'bloqueId', 'base', 'copia', 'original', 'propuesta', 'tipo'], array_keys($r));
        $this->assertSame(['desde' => 0, 'hasta' => 1], $r['base']);
    }

    public function test_sugerencia_con_tipo_invalido_falla(): void
    {
        $e = $this->assertFalla(self::sugerencia(['tipo' => 'borrado']));
        $this->assertArrayHasKey('tipo', $e->campos);
    }

    public function test_campos_obligatorios_y_limites(): void
    {
        foreach (['id', 'autor', 'bloqueId', 'base', 'copia', 'original', 'propuesta', 'tipo'] as $campo) {
            $s = self::sugerencia();
            unset($s[$campo]);
            $e = $this->assertFalla($s);
            $this->assertArrayHasKey($campo, $e->campos, $campo);
        }
        $this->assertFalla(self::sugerencia(['id' => str_repeat('a', 191)]));
        $this->assertFalla(self::sugerencia(['id' => '']));
        // El id usa el mismo alfabeto que el parámetro {uid} de la ruta.
        foreach (['a b:c', 'a.b:c', 'a/b', 'á:b', "a:b
"] as $id) {
            $this->assertFalla(self::sugerencia(['id' => $id]));
        }
        $this->assertFalla(self::sugerencia(['base' => ['desde' => -1, 'hasta' => 0]]));
        $this->assertFalla(self::sugerencia(['copia' => ['desde' => '1', 'hasta' => 2]]));
        $this->assertFalla(self::sugerencia(['copia' => ['desde' => 3, 'hasta' => 2]]));
        $this->assertFalla(self::sugerencia(['original' => 'texto']));
        $this->assertFalla(self::sugerencia(['motivo' => str_repeat('m', 2001)]));
        $this->assertFalla(self::sugerencia(['profundidad' => -1]));
        $this->assertFalla(self::sugerencia(['orden' => 1.5]));
        $this->assertFalla(self::sugerencia(['primerHijo' => 'si']));
        $this->assertFalla('no es objeto');
        $this->assertFalla([self::sugerencia()]);
    }

    public function test_nodos_fuera_del_esquema_son_documento_invalido(): void
    {
        $this->assertFalla(self::sugerencia(['propuesta' => [['type' => 'html']]]), 'documento_invalido');
        $this->assertFalla(self::sugerencia(['original' => [['type' => 'text', 'text' => 'x', 'onclick' => 'y']]]), 'documento_invalido');
    }

    public function test_acepta_forma_de_objetos_y_devuelve_arrays(): void
    {
        $s = self::sugerencia();
        $r = ValidadorSugerencia::validar(json_decode(json_encode($s, JSON_THROW_ON_ERROR), false));
        unset($s['autor']);
        $this->assertSame($s, $r);
    }

    public function test_rechaza_objetos_donde_van_listas_de_nodos(): void
    {
        $s = json_decode(json_encode(self::sugerencia(), JSON_THROW_ON_ERROR), false);
        $s->propuesta = json_decode('{"0":{"type":"text","text":"x"}}', false);
        $e = $this->assertFalla($s);
        $this->assertArrayHasKey('propuesta', $e->campos);
        $s->propuesta = json_decode('[{"type":"text","text":"x","marks":{"0":{"type":"negrita"}}}]', false);
        $this->assertFalla($s, 'documento_invalido');
    }
}

