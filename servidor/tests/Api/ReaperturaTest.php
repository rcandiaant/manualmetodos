<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Acceso\Comentarios;
use Manual\Acceso\Copias;
use Manual\Acceso\Sugerencias;
use Manual\Acceso\VersionObsoleta;
use Manual\Bd\Conexion;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\ClienteApi;
use Manual\Pruebas\Soporte\EscenarioRevision;
use PHPUnit\Framework\TestCase;

/**
 * Flujos nuevos de la flexibilidad del admin:
 * - reabrir la consulta después de decidir. El uid de una sugerencia es un hash de su contenido
 *   (cliente/src/cambios/identidad.ts), así que con el mismo uid solo cambian posiciones (`copia`, `orden`…):
 *   la decisión se conserva. Si el laboratorio cambia la propuesta, llega con otro uid: la vieja se borra con su
 *   decisión y la nueva entra pendiente;
 * - reemplazar el texto de un capítulo con la consulta abierta: la copia y los comentarios sobre la versión
 *   vieja dan 409 `version_obsoleta`, también con la comprobación bajo bloqueo dentro de la transacción.
 */
final class ReaperturaTest extends TestCase
{
    use BaseDePruebas;
    use EscenarioRevision;

    /**
     * Re-guardado de la copia de un laboratorio con una sugerencia, con la forma que produce el cliente.
     * @param array<string,mixed> $extra campos posicionales (copia, orden…) u otros
     */
    private function guardarCopia(ClienteApi $c, array $u, string $n, string $propuesta, array $extra = []): void
    {
        $autor = 'u' . $u['id'];
        $r = $c->put("/capitulos/{$this->cap}/copia", [
            'versionId' => $this->ver,
            'docJson' => $this->docCopia(),
            'sugerencias' => [$extra + [
                'id' => "$autor:f1-p1:$n", 'bloqueId' => 'f1-p1', 'autor' => $autor,
                'base' => ['desde' => 0, 'hasta' => 4], 'copia' => ['desde' => 0, 'hasta' => 5],
                'original' => [['type' => 'text', 'text' => 'hola']],
                'propuesta' => [['type' => 'text', 'text' => $propuesta]],
                'tipo' => 'contenido',
            ]],
        ]);
        self::assertSame(200, $r->estado, $r->cuerpo());
    }

    private function fila(int $id): array|false
    {
        $st = self::$bd->prepare('SELECT estado, nota_resolucion, derivada_reunion, resuelto_por, resuelto_en, datos FROM sugerencias WHERE id = ?');
        $st->execute([$id]);
        return $st->fetch();
    }

    private function reabrir(): void
    {
        $r = $this->admin->put('/admin/consulta', [
            'apertura' => '2026-10-20T00:00:00Z', 'cierre' => '2026-11-09T12:00:00Z', 'motivoObligatorio' => false,
        ]);
        self::assertSame('consulta', $r->datos['etapa'], $r->cuerpo());
    }

    /** Decide las dos sugerencias del escenario (aceptada con nota y derivada; rechazada con nota) y reabre. */
    private function decidirYReabrir(): void
    {
        $this->montar();
        $this->cerrarConsulta();
        self::assertSame(200, $this->revisor->patch("/sugerencias/{$this->sugIds[0]}", ['estado' => 'aceptada', 'notaResolucion' => 'Bien', 'derivadaReunion' => true])->estado);
        self::assertSame(200, $this->revisor->patch("/sugerencias/{$this->sugIds[1]}", ['estado' => 'rechazada', 'notaResolucion' => 'No'])->estado);
        $this->reabrir();
    }

    public function test_al_reabrir_mover_una_propuesta_decidida_conserva_su_decision(): void
    {
        $this->decidirYReabrir();
        $antes = $this->fila($this->sugIds[0]);

        // Norte escribió una palabra antes en el mismo bloque: misma propuesta (mismo uid), otra posición en
        // la copia y un `orden`. Sur vuelve a guardar todo idéntico.
        $this->guardarCopia($this->lab, $this->labU, 'a', 'hola a', ['copia' => ['desde' => 3, 'hasta' => 8], 'orden' => 2]);
        $this->guardarCopia($this->lab2, $this->lab2U, 'b', 'hola b');

        $movida = $this->fila($this->sugIds[0]);
        self::assertSame('aceptada', $movida['estado']);
        self::assertSame('Bien', $movida['nota_resolucion']);
        self::assertSame(1, (int) $movida['derivada_reunion']);
        self::assertSame($antes['resuelto_por'], $movida['resuelto_por']);
        self::assertSame($antes['resuelto_en'], $movida['resuelto_en']);
        $datos = json_decode($movida['datos'], true);
        self::assertSame(['desde' => 3, 'hasta' => 8], $datos['copia'], 'las posiciones sí se actualizan');
        self::assertSame(2, $datos['orden']);

        $igual = $this->fila($this->sugIds[1]);
        self::assertSame('rechazada', $igual['estado']);
        self::assertSame('No', $igual['nota_resolucion']);
    }

    public function test_al_reabrir_cambiar_la_propuesta_la_trae_como_nueva_y_pendiente(): void
    {
        $this->decidirYReabrir();
        // El cliente da a la propuesta cambiada otro uid (hash de su contenido): la anterior ya no viene.
        $this->guardarCopia($this->lab, $this->labU, 'c', 'hola cambiado');

        self::assertFalse($this->fila($this->sugIds[0]), 'la propuesta anterior se borra con su decisión');
        $nueva = self::$bd->query("SELECT estado, nota_resolucion, resuelto_por FROM sugerencias WHERE uid LIKE '%:c'")->fetch();
        self::assertSame(['pendiente', null, null], [$nueva['estado'], $nueva['nota_resolucion'], $nueva['resuelto_por']]);

        // La composición de la final (revisor/componer.ts) solo aplica las aceptadas: ya no hay ninguna.
        $this->cerrarConsulta();
        $aportes = json_decode($this->revisor->get("/capitulos/{$this->cap}/aportes")->cuerpo(), true)['sugerencias'];
        self::assertSame([], array_values(array_filter($aportes, fn ($s) => $s['estado'] === 'aceptada')));
    }

    /**
     * Defensa: el cliente real nunca reutiliza un uid con otro contenido (el uid es su hash). Si un cliente lo
     * hiciera, la decisión no debe quedar pegada a un contenido que el revisor no vio: vuelve a pendiente.
     */
    public function test_defensa_mismo_uid_con_otro_contenido_vuelve_a_pendiente(): void
    {
        $this->decidirYReabrir();
        $this->guardarCopia($this->lab, $this->labU, 'a', 'hola cambiado');

        $cambiada = $this->fila($this->sugIds[0]);
        self::assertSame('pendiente', $cambiada['estado']);
        self::assertNull($cambiada['nota_resolucion']);
        self::assertSame(0, (int) $cambiada['derivada_reunion']);
        self::assertNull($cambiada['resuelto_por']);
        self::assertNull($cambiada['resuelto_en']);
        self::assertStringContainsString('hola cambiado', $cambiada['datos']);
    }

    // ---------------------------------------------------------------- reemplazo durante la consulta

    /** Capítulo subido, consulta abierta, un laboratorio que leyó la versión V1, y el admin la reemplaza por V2. */
    private function reemplazoEnConsulta(): array
    {
        $this->vaciarBaseDePruebas();
        $this->reloj = new \Manual\Pruebas\Soporte\RelojFijo('2026-11-02 12:00:00');
        $this->app = $this->nuevaAplicacion($this->reloj);
        $this->admin = (new ClienteApi($this->app))->comoUsuario($this->crearUsuario(['roles' => ['admin']]));
        $this->labU = $this->crearUsuario();
        $this->lab = (new ClienteApi($this->app))->comoUsuario($this->labU);
        $doc = json_decode((string) file_get_contents(__DIR__ . '/../fixtures/doc-listas.json'), true);
        $subir = fn () => $this->admin->post('/admin/capitulos', ['slug' => 'cap-1', 'titulo' => 'C', 'orden' => 1, 'texOriginal' => 'x', 'docJson' => $doc]);
        $v1 = $subir()->datos;
        $this->admin->put('/admin/consulta', ['apertura' => '2026-11-01T00:00:00Z', 'cierre' => '2026-11-30T00:00:00Z', 'motivoObligatorio' => false]);
        self::assertSame($v1['versionId'], $this->lab->get("/capitulos/{$v1['id']}/base")->datos['versionId']);
        $r = $subir();
        self::assertSame(201, $r->estado, $r->cuerpo());
        return [$v1['id'], $v1['versionId'], $r->datos['versionId']];
    }

    private function contar(string $tabla): int
    {
        return (int) self::$bd->query("SELECT COUNT(*) FROM `$tabla`")->fetchColumn();
    }

    public function test_tras_reemplazar_en_consulta_copia_y_comentario_sobre_la_version_vieja_dan_409(): void
    {
        [$cap, $v1, $v2] = $this->reemplazoEnConsulta();
        $r = $this->lab->put("/capitulos/$cap/copia", ['versionId' => $v1, 'docJson' => $this->docCopia(), 'sugerencias' => []]);
        self::assertSame(409, $r->estado);
        self::assertSame('version_obsoleta', $r->datos['error']['codigo']);

        $comentario = ['bloqueId' => 'f1-p1', 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => 'hola'];
        $r = $this->lab->post("/capitulos/$cap/comentarios", $comentario + ['versionId' => $v1]);
        self::assertSame(409, $r->estado, $r->cuerpo());
        self::assertSame('version_obsoleta', $r->datos['error']['codigo']);
        self::assertSame(0, $this->contar('comentarios'));
        self::assertSame(0, $this->contar('copias_laboratorio'));

        // Sin versionId (o mal formado) es 400; con la vigente, se crea.
        foreach ([[], ['versionId' => "$v2"], ['versionId' => null]] as $i => $extra) {
            $r = $this->lab->post("/capitulos/$cap/comentarios", $comentario + $extra);
            self::assertSame(400, $r->estado, "caso $i");
            self::assertArrayHasKey('versionId', $r->datos['error']['campos']);
        }
        self::assertSame(201, $this->lab->post("/capitulos/$cap/comentarios", $comentario + ['versionId' => $v2])->estado);
        self::assertSame(200, $this->lab->put("/capitulos/$cap/copia", ['versionId' => $v2, 'docJson' => $this->docCopia(), 'sugerencias' => []])->estado);
    }

    public function test_la_comprobacion_bajo_bloqueo_rechaza_una_version_reemplazada_entre_medio(): void
    {
        // Simula la carrera: el controlador ya comprobó V1, pero el admin confirmó V2 antes de la transacción.
        [$cap, $v1] = $this->reemplazoEnConsulta();
        $u = (int) $this->labU['id'];
        $sug = new Sugerencias(self::$bd);
        foreach ([
            'copia' => fn () => (new Copias(self::$bd, $sug))->guardar($u, $cap, $v1, '{}', [], new \DateTimeImmutable('2026-11-02 12:00:00')),
            'comentario' => fn () => (new Comentarios(self::$bd))->crear($u, $cap, $v1, 'f1-p1', ['desde' => 0, 'hasta' => 1], 'x', new \DateTimeImmutable('2026-11-02 12:00:00')),
        ] as $caso => $f) {
            try {
                $f();
                self::fail("$caso: debía rechazar la versión vieja");
            } catch (VersionObsoleta) {
                $this->addToAssertionCount(1);
            }
            self::assertFalse(self::$bd->inTransaction(), "$caso: la transacción se deshizo");
        }
        self::assertSame(0, $this->contar('copias_laboratorio'));
        self::assertSame(0, $this->contar('revisiones_copia'));
        self::assertSame(0, $this->contar('comentarios'));
    }

    public function test_copia_y_comentario_esperan_al_reemplazo_en_curso(): void
    {
        // Un reemplazo en curso tiene la fila del capítulo con FOR UPDATE: el guardado (LOCK IN SHARE MODE)
        // espera y, con la espera agotada, responde 409 conflicto_concurrente sin escribir nada.
        [$cap, , $v2] = $this->reemplazoEnConsulta();
        $otra = Conexion::crear(self::configPruebas());
        $otra->beginTransaction();
        $otra->query("SELECT id FROM capitulos WHERE id = $cap FOR UPDATE")->fetchAll();
        self::$bd->exec('SET SESSION innodb_lock_wait_timeout = 1');
        try {
            $r = $this->lab->put("/capitulos/$cap/copia", ['versionId' => $v2, 'docJson' => $this->docCopia(), 'sugerencias' => []]);
            self::assertSame(409, $r->estado, $r->cuerpo());
            self::assertSame('conflicto_concurrente', $r->datos['error']['codigo']);
            $r = $this->lab->post("/capitulos/$cap/comentarios", ['bloqueId' => 'f1-p1', 'rango' => ['desde' => 0, 'hasta' => 1], 'texto' => 'x', 'versionId' => $v2]);
            self::assertSame(409, $r->estado, $r->cuerpo());
            self::assertSame('conflicto_concurrente', $r->datos['error']['codigo']);
        } finally {
            self::$bd->exec('SET SESSION innodb_lock_wait_timeout = 50');
            $otra->rollBack();
        }
        self::assertSame(0, $this->contar('copias_laboratorio'));
        self::assertSame(0, $this->contar('comentarios'));
    }

    public function test_subida_con_espera_de_bloqueo_agotada_da_409(): void
    {
        [$cap] = $this->reemplazoEnConsulta();
        $otra = Conexion::crear(self::configPruebas());
        $otra->beginTransaction();
        $otra->query("SELECT id FROM capitulos WHERE id = $cap LOCK IN SHARE MODE")->fetchAll();
        self::$bd->exec('SET SESSION innodb_lock_wait_timeout = 1');
        try {
            $doc = json_decode((string) file_get_contents(__DIR__ . '/../fixtures/doc-listas.json'), true);
            $r = $this->admin->post('/admin/capitulos', ['slug' => 'cap-1', 'titulo' => 'C', 'orden' => 1, 'texOriginal' => 'y', 'docJson' => $doc]);
            self::assertSame(409, $r->estado, $r->cuerpo());
            self::assertSame('conflicto_concurrente', $r->datos['error']['codigo']);
        } finally {
            self::$bd->exec('SET SESSION innodb_lock_wait_timeout = 50');
            $otra->rollBack();
        }
    }
}
