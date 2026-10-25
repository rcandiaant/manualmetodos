<?php

declare(strict_types=1);

namespace Manual\Pruebas\Soporte;

use Manual\Aplicacion;

/**
 * Escenario común de RevisionTest y EtapasTest: capítulo subido, consulta abierta (el reloj está en su
 * inicio, cierre a +10 días) y dos laboratorios con una sugerencia y un comentario cada uno.
 * Requiere el trait BaseDePruebas en la clase que lo usa.
 */
trait EscenarioRevision
{
    private RelojFijo $reloj;
    private Aplicacion $app;
    private ClienteApi $admin;
    private ClienteApi $revisor;
    private ClienteApi $lab;
    private ClienteApi $lab2;
    /** @var array<string,mixed> */
    private array $labU;
    /** @var array<string,mixed> */
    private array $lab2U;
    private int $cap;
    private int $ver;
    /** @var array{0:int,1:int} ids de fila de las sugerencias de lab y lab2 */
    private array $sugIds;
    /** @var array{0:int,1:int} ids de los comentarios de lab y lab2 */
    private array $comIds;

    private function montar(): void
    {
        $this->vaciarBaseDePruebas();
        if (function_exists('apcu_clear_cache')) {
            apcu_clear_cache();
        }
        $this->reloj = new RelojFijo('2026-11-02 12:00:00');
        $this->app = $this->nuevaAplicacion($this->reloj);
        $nuevo = fn (array $u): ClienteApi => (new ClienteApi($this->app))->comoUsuario($u);

        $this->admin = $nuevo($this->crearUsuario(['roles' => ['admin'], 'correo' => 'admin-' . uniqid() . '@lab.cl']));
        $this->revisor = $nuevo($this->crearUsuario(['roles' => ['revisor'], 'laboratorio' => 'Comité revisor']));
        $this->labU = $this->crearUsuario(['laboratorio' => 'Laboratorio Norte']);
        $this->lab2U = $this->crearUsuario(['laboratorio' => 'Laboratorio Sur']);
        $this->lab = $nuevo($this->labU);
        $this->lab2 = $nuevo($this->lab2U);

        $doc = json_decode((string) file_get_contents(__DIR__ . '/../fixtures/doc-listas.json'), true);
        $r = $this->admin->post('/admin/capitulos', [
            'slug' => 'cap-1', 'titulo' => 'Capítulo 1', 'orden' => 1, 'texOriginal' => '\\section{Hola}', 'docJson' => $doc,
        ]);
        self::assertSame(201, $r->estado, $r->cuerpo());
        $this->cap = $r->datos['id'];
        $this->ver = $r->datos['versionId'];
        $r = $this->admin->put('/admin/consulta', [
            'apertura' => $this->reloj->ahora()->format('Y-m-d\TH:i:s\Z'),
            'cierre' => $this->reloj->ahora()->modify('+10 days')->format('Y-m-d\TH:i:s\Z'),
            'motivoObligatorio' => false,
        ]);
        self::assertSame(200, $r->estado, $r->cuerpo());

        $sug = [];
        $com = [];
        foreach ([[$this->lab, $this->labU, 'a'], [$this->lab2, $this->lab2U, 'b']] as [$c, $u, $n]) {
            $autor = 'u' . $u['id'];
            $r = $c->put("/capitulos/{$this->cap}/copia", [
                'versionId' => $this->ver,
                'docJson' => $this->docCopia(),
                'sugerencias' => [[
                    'id' => "$autor:f1-p1:$n", 'bloqueId' => 'f1-p1', 'autor' => $autor,
                    'base' => ['desde' => 0, 'hasta' => 4], 'copia' => ['desde' => 0, 'hasta' => 5],
                    'original' => [['type' => 'text', 'text' => 'hola']],
                    'propuesta' => [['type' => 'text', 'text' => "hola $n"]],
                    'tipo' => 'contenido',
                ]],
            ]);
            self::assertSame(200, $r->estado, $r->cuerpo());
            $r = $c->post("/capitulos/{$this->cap}/comentarios", ['bloqueId' => 'f1-p1', 'rango' => ['desde' => 0, 'hasta' => 2], 'texto' => "Comentario $n"]);
            self::assertSame(201, $r->estado, $r->cuerpo());
            $com[] = $r->datos['id'];
            $sug[] = (int) self::$bd->query("SELECT id FROM sugerencias WHERE usuario_id = {$u['id']}")->fetchColumn();
        }
        $this->sugIds = [$sug[0], $sug[1]];
        $this->comIds = [$com[0], $com[1]];
    }

    /** @return array<string,mixed> */
    private function docCopia(): array
    {
        return ['type' => 'doc', 'content' => [
            ['type' => 'parrafo', 'attrs' => ['bid' => 'p1'], 'content' => [['type' => 'text', 'text' => 'copia']]],
        ]];
    }

    private function cerrarConsulta(): void
    {
        // Se mueve el cierre (no el reloj): las sesiones vencerían tras once días de inactividad.
        self::$bd->exec("UPDATE consulta SET apertura = '2026-10-20 00:00:00', cierre = '2026-11-02 11:00:00'");
    }

    /** @return array<string,mixed> */
    private function docFinal(): array
    {
        return ['type' => 'doc', 'content' => [
            ['type' => 'parrafo', 'attrs' => ['bid' => 'p1'], 'content' => [['type' => 'text', 'text' => 'versión final']]],
        ]];
    }
}
