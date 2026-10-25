<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Http\Respuesta;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\EscenarioRevision;
use PHPUnit\Framework\TestCase;

/**
 * Tabla (escritura, etapa) → 2xx o 409. Cubre todas las escrituras del contrato que dependen de la etapa.
 * Cada celda parte de un escenario nuevo; fuera de su etapa la escritura da 409 `etapa_no_permite`
 * y las tablas de datos no cambian.
 */
final class EtapasTest extends TestCase
{
    use BaseDePruebas;
    use EscenarioRevision;

    private const ETAPAS = ['preparacion', 'consulta', 'edicion_final'];
    private const TABLAS = ['capitulos', 'versiones_capitulo', 'copias_laboratorio', 'revisiones_copia', 'sugerencias', 'comentarios', 'consulta'];

    /** @return array<string,array{0:string,1:string}> nombre => [etapa permitida, clave de escritura] */
    public static function escrituras(): array
    {
        return [
            'POST /admin/capitulos' => ['preparacion', 'subir'],
            'PUT /admin/consulta (fechas)' => ['preparacion', 'fechas'],
            'PUT /capitulos/{id}/copia' => ['consulta', 'copia'],
            'PATCH /capitulos/{id}/sugerencias/{uid}' => ['consulta', 'motivo'],
            'POST /capitulos/{id}/comentarios' => ['consulta', 'comentar'],
            'PATCH /comentarios/{id}' => ['consulta', 'editar'],
            'DELETE /comentarios/{id}' => ['consulta', 'borrar'],
            'PATCH /sugerencias/{id}' => ['edicion_final', 'resolver'],
            'PATCH /comentarios/{id}/resolucion' => ['edicion_final', 'resolverComentario'],
            'PUT /capitulos/{id}/final' => ['edicion_final', 'final'],
        ];
    }

    private function ejecutar(string $clave): Respuesta
    {
        $uid = 'u' . $this->labU['id'] . ':f1-p1:a';
        return match ($clave) {
            'subir' => $this->admin->post('/admin/capitulos', [
                'slug' => 'cap-2', 'titulo' => 'Capítulo 2', 'orden' => 2, 'texOriginal' => 'x', 'docJson' => $this->docCopia(),
            ]),
            'fechas' => $this->admin->put('/admin/consulta', [
                'apertura' => '2027-01-01T00:00:00Z', 'cierre' => '2027-02-01T00:00:00Z', 'motivoObligatorio' => false,
            ]),
            'copia' => $this->lab->put("/capitulos/{$this->cap}/copia", ['versionId' => $this->ver, 'docJson' => $this->docCopia(), 'sugerencias' => []]),
            'motivo' => $this->lab->patch("/capitulos/{$this->cap}/sugerencias/$uid", ['motivo' => 'porque sí']),
            'comentar' => $this->lab->post("/capitulos/{$this->cap}/comentarios", ['bloqueId' => 'f1-p1', 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => 'nuevo']),
            'editar' => $this->lab->patch("/comentarios/{$this->comIds[0]}", ['texto' => 'editado']),
            'borrar' => $this->lab->delete("/comentarios/{$this->comIds[0]}"),
            'resolver' => $this->revisor->patch("/sugerencias/{$this->sugIds[0]}", ['estado' => 'aceptada']),
            'resolverComentario' => $this->revisor->patch("/comentarios/{$this->comIds[0]}/resolucion", ['estado' => 'resuelto']),
            'final' => $this->revisor->put("/capitulos/{$this->cap}/final", ['docJson' => $this->docFinal(), 'tex' => 'x']),
        };
    }

    /** Huella del contenido de las tablas de datos. */
    private function huella(): string
    {
        $h = '';
        foreach (self::TABLAS as $t) {
            $h .= $t . json_encode(self::$bd->query("SELECT * FROM `$t` ORDER BY 1, 2")->fetchAll()) . "\n";
        }
        return $h;
    }

    private function aEtapa(string $etapa): void
    {
        match ($etapa) {
            'preparacion' => self::$bd->exec("UPDATE consulta SET apertura = '2026-12-01 00:00:00', cierre = '2026-12-20 00:00:00'"),
            'consulta' => null,
            'edicion_final' => $this->cerrarConsulta(),
        };
    }

    public function test_cada_escritura_respeta_la_etapa(): void
    {
        $celdas = 0;
        foreach (self::escrituras() as $nombre => [$permitida, $clave]) {
            foreach (self::ETAPAS as $etapa) {
                $this->montar();
                $this->aEtapa($etapa);
                $antes = $this->huella();
                $r = $this->ejecutar($clave);
                $celda = "$nombre en $etapa";
                if ($etapa === $permitida) {
                    self::assertGreaterThanOrEqual(200, $r->estado, "$celda: " . $r->cuerpo());
                    self::assertLessThan(300, $r->estado, "$celda: " . $r->cuerpo());
                    self::assertNotSame($antes, $this->huella(), "$celda debía escribir");
                } else {
                    self::assertSame(409, $r->estado, "$celda: " . $r->cuerpo());
                    self::assertSame('etapa_no_permite', $r->datos['error']['codigo'], $celda);
                    self::assertSame($antes, $this->huella(), "$celda no debía escribir");
                }
                $celdas++;
            }
        }
        self::assertSame(30, $celdas);
    }

    public function test_las_etapas_de_escritura_no_se_solapan(): void
    {
        $permitidas = [];
        foreach (self::escrituras() as $nombre => [$etapa, $clave]) {
            $permitidas[$clave] = $etapa;
        }
        // Laboratorio: solo consulta. Revisor: solo edicion_final. Eso evita pisar un `estado` resuelto (M4 de Task 7).
        foreach (['copia', 'motivo', 'comentar', 'editar', 'borrar'] as $k) {
            self::assertSame('consulta', $permitidas[$k]);
        }
        foreach (['resolver', 'resolverComentario', 'final'] as $k) {
            self::assertSame('edicion_final', $permitidas[$k]);
        }
    }
}
