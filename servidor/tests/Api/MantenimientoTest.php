<?php

declare(strict_types=1);

namespace Manual\Pruebas\Api;

use Manual\Mantenimiento\Limpieza;
use Manual\Mantenimiento\Respaldo;
use Manual\Pruebas\Soporte\BaseDePruebas;
use Manual\Pruebas\Soporte\RelojFijo;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

final class MantenimientoTest extends TestCase
{
    use BaseDePruebas;

    private string $dir;

    protected function setUp(): void
    {
        // Directorio inexistente: Respaldo debe crearlo (0700).
        $this->dir = sys_get_temp_dir() . '/respaldos-prueba-' . bin2hex(random_bytes(6));
    }

    protected function tearDown(): void
    {
        if (is_dir($this->dir)) {
            foreach (scandir($this->dir) ?: [] as $f) {
                if ($f !== '.' && $f !== '..') {
                    unlink("$this->dir/$f");
                }
            }
            rmdir($this->dir);
        }
    }

    // ---------------------------------------------------------------- limpieza

    public function test_limpieza_borra_intentos_viejos_sin_bloqueo_y_conserva_bloqueos_vigentes(): void
    {
        $reloj = new RelojFijo('2026-11-02 12:00:00');
        $ins = self::$bd->prepare('INSERT INTO intentos_login (clave, fallos, bloqueos, bloqueado_hasta, actualizado) VALUES (?, 1, 0, ?, ?)');
        $ins->execute(['ip:viejo-sin-bloqueo', null, '2026-10-20 12:00:00']);          // 13 días: se borra
        $ins->execute(['ip:viejo-bloqueo-vencido', '2026-10-21 00:00:00', '2026-10-20 12:00:00']); // bloqueo pasado: se borra
        $ins->execute(['cuenta:viejo-bloqueo-vigente', '2026-11-02 13:00:00', '2026-10-20 12:00:00']); // bloqueo vigente: queda
        $ins->execute(['ip:reciente', null, '2026-10-30 12:00:00']);                    // 3 días: queda
        $ins->execute(['ip:justo-7-dias', null, '2026-10-26 12:00:00']);                // exactamente 7 días: queda

        $r = (new Limpieza(self::$bd, $reloj))->ejecutar();

        $this->assertSame(['intentos' => 2], $r);
        $quedan = self::$bd->query('SELECT clave FROM intentos_login ORDER BY clave')->fetchAll(\PDO::FETCH_COLUMN);
        $this->assertSame(['cuenta:viejo-bloqueo-vigente', 'ip:justo-7-dias', 'ip:reciente'], $quedan);

        $a = self::$bd->query('SELECT usuario_id, accion, detalle, creado FROM auditoria')->fetchAll();
        $this->assertCount(1, $a);
        $this->assertNull($a[0]['usuario_id']);
        $this->assertSame('cron_limpieza', $a[0]['accion']);
        $this->assertSame(['intentos' => 2], json_decode((string) $a[0]['detalle'], true));
        $this->assertSame('2026-11-02 12:00:00', $a[0]['creado']);
    }

    public function test_limpieza_no_toca_las_instantaneas_de_copias(): void
    {
        $u = $this->crearUsuario();
        self::$bd->exec("INSERT INTO capitulos (orden, slug, titulo) VALUES (1, 'c1', 'Cap')");
        $cap = (int) self::$bd->lastInsertId();
        self::$bd->prepare("INSERT INTO revisiones_copia (usuario_id, capitulo_id, doc_json, creado) VALUES (?, ?, '{}', '2020-01-01 00:00:00')")
            ->execute([$u['id'], $cap]);

        (new Limpieza(self::$bd, new RelojFijo()))->ejecutar();

        $this->assertSame(1, (int) self::$bd->query('SELECT COUNT(*) FROM revisiones_copia')->fetchColumn());
    }

    // ---------------------------------------------------------------- respaldo

    /** @return array<string,array{bool}> */
    public static function modosDeSesion(): array
    {
        return ['sql_mode normal' => [false], 'NO_BACKSLASH_ESCAPES en origen y destino' => [true]];
    }

    #[DataProvider('modosDeSesion')]
    public function test_respaldo_genera_sql_gz_restaurable(bool $sinBarras): void
    {
        $modoOriginal = (string) self::$bd->query('SELECT @@SESSION.sql_mode')->fetchColumn();
        try {
            $this->restaurableCon($sinBarras);
        } finally {
            self::$bd->prepare('SET SESSION sql_mode = ?')->execute([$modoOriginal]);
        }
    }

    private function restaurableCon(bool $sinBarras): void
    {
        $this->sembrarDatosVariados();
        $antes = $this->huella();
        if ($sinBarras) {
            // El servidor que genera y la sesión que importa tienen NO_BACKSLASH_ESCAPES:
            // el archivo fija su propio sql_mode, así que el escape con barras sigue siendo válido.
            self::$bd->exec("SET SESSION sql_mode = CONCAT(@@SESSION.sql_mode, ',NO_BACKSLASH_ESCAPES')");
        }

        $ruta = (new Respaldo(self::$bd, new RelojFijo('2026-11-02 03:30:05')))->ejecutar($this->dir);

        $this->assertSame($this->dir . '/respaldo-20261102-033005.sql.gz', $ruta);
        $this->assertFileExists($ruta);
        $this->assertSame(0700, fileperms($this->dir) & 0777);
        $sql = (string) gzdecode((string) file_get_contents($ruta));
        $this->assertTrue(mb_check_encoding($sql, 'UTF-8'), 'El respaldo debe ser UTF-8 válido');
        $cabecera = substr($sql, 0, 600);
        $this->assertStringContainsString("SET NAMES utf8mb4;\n", $cabecera);
        $this->assertStringContainsString("SET FOREIGN_KEY_CHECKS=0;\n", $cabecera);
        $this->assertLessThan(strpos($sql, 'CREATE TABLE'), strpos($sql, 'SET FOREIGN_KEY_CHECKS=0;'));
        $this->assertStringContainsString('Ñandú 🧪', $sql, 'El texto va legible en UTF-8, no en hexadecimal');

        // Restaurar en la misma base de pruebas, ya vacía: se borran TODAS las tablas.
        // (El usuario de desarrollo/CI solo tiene permisos sobre manual_pruebas; ver informe Task 2.)
        $this->borrarTodasLasTablas();
        $this->assertSame([], self::$bd->query('SHOW TABLES')->fetchAll(\PDO::FETCH_COLUMN));
        $this->restaurar($ruta);
        if ($sinBarras) {
            $this->assertStringContainsString('NO_BACKSLASH_ESCAPES', (string) self::$bd->query('SELECT @@SESSION.sql_mode')->fetchColumn(), 'El respaldo repone el sql_mode de la sesión');
        }

        $this->assertSame($antes, $this->huella(), 'Conteos y CHECKSUM TABLE de cada tabla deben coincidir tras restaurar');
        $f = self::$bd->query("SELECT nombre, correo_cifrado FROM usuarios WHERE laboratorio = 'Raro'")->fetch();
        $this->assertSame("Ñandú 🧪 'comilla' \"doble\" \\barra\nlínea\r\x1a;\n-- no es comentario", $f['nombre']);
        $this->assertSame("\0\x27\x5c\xff\x00\n", $f['correo_cifrado']);

        $a = self::$bd->query('SELECT COUNT(*) FROM auditoria WHERE accion = \'cron_respaldo\'')->fetchColumn();
        $this->assertSame(0, (int) $a, 'La auditoría del respaldo se escribe después del volcado');
    }

    public function test_respaldo_registra_auditoria(): void
    {
        $ruta = (new Respaldo(self::$bd, new RelojFijo('2026-11-02 03:30:00')))->ejecutar($this->dir);
        $a = self::$bd->query('SELECT usuario_id, accion, detalle FROM auditoria')->fetchAll();
        $this->assertCount(1, $a);
        $this->assertNull($a[0]['usuario_id']);
        $this->assertSame('cron_respaldo', $a[0]['accion']);
        $detalle = json_decode((string) $a[0]['detalle'], true);
        $this->assertSame(basename($ruta), $detalle['archivo']);
        $this->assertSame(filesize($ruta), $detalle['bytes']);
    }

    public function test_respaldo_conserva_solo_los_14_mas_recientes(): void
    {
        mkdir($this->dir, 0700);
        // 20 respaldos anteriores (1 a 20 de octubre) y archivos ajenos que no deben tocarse.
        for ($d = 1; $d <= 20; $d++) {
            touch(sprintf('%s/respaldo-202610%02d-033000.sql.gz', $this->dir, $d));
        }
        touch("$this->dir/notas.txt");
        touch("$this->dir/respaldo-manual.sql.gz");

        $ruta = (new Respaldo(self::$bd, new RelojFijo('2026-11-02 03:30:00')))->ejecutar($this->dir);

        $respaldos = array_values(array_filter(scandir($this->dir) ?: [], fn (string $f) => (bool) preg_match('/^respaldo-\d{8}-\d{6}\.sql\.gz$/', $f)));
        $this->assertCount(14, $respaldos);
        $this->assertSame('respaldo-20261008-033000.sql.gz', $respaldos[0]);
        $this->assertSame(basename($ruta), $respaldos[13]);
        $this->assertFileExists("$this->dir/notas.txt");
        $this->assertFileExists("$this->dir/respaldo-manual.sql.gz");

        // Con $conservar explícito.
        (new Respaldo(self::$bd, new RelojFijo('2026-11-03 03:30:00')))->ejecutar($this->dir, 3);
        $respaldos = array_values(array_filter(scandir($this->dir) ?: [], fn (string $f) => (bool) preg_match('/^respaldo-\d{8}-\d{6}\.sql\.gz$/', $f)));
        $this->assertSame(['respaldo-20261020-033000.sql.gz', 'respaldo-20261102-033000.sql.gz', 'respaldo-20261103-033000.sql.gz'], $respaldos);
    }

    public function test_respaldo_fuerza_0700_aunque_el_directorio_ya_exista(): void
    {
        mkdir($this->dir, 0755);
        chmod($this->dir, 0755);
        (new Respaldo(self::$bd, new RelojFijo()))->ejecutar($this->dir);
        clearstatcache();
        $this->assertSame(0700, fileperms($this->dir) & 0777);
    }

    public function test_respaldo_borra_parciales_huerfanos_de_mas_de_un_dia(): void
    {
        mkdir($this->dir, 0700);
        $ahora = (new RelojFijo('2026-11-02 03:30:00'))->ahora()->getTimestamp();
        $viejo = "$this->dir/respaldo-20261030-033000.sql.gz.parcial";
        $reciente = "$this->dir/respaldo-20261102-020000.sql.gz.parcial";
        $ajeno = "$this->dir/otra-cosa.parcial";
        touch($viejo, $ahora - 2 * 86400);
        touch($reciente, $ahora - 3600);    // podría ser otro respaldo en curso: no se toca
        touch($ajeno, $ahora - 10 * 86400); // no calza con el patrón: no se toca

        (new Respaldo(self::$bd, new RelojFijo('2026-11-02 03:30:00')))->ejecutar($this->dir);

        $this->assertFileDoesNotExist($viejo);
        $this->assertFileExists($reciente);
        $this->assertFileExists($ajeno);
        $detalle = json_decode((string) self::$bd->query("SELECT detalle FROM auditoria WHERE accion = 'cron_respaldo'")->fetchColumn(), true);
        $this->assertSame(1, $detalle['parciales']);
    }

    public function test_respaldo_omite_columnas_generadas_y_las_restaura(): void
    {
        self::$bd->exec('CREATE TABLE zz_generada (id INT NOT NULL PRIMARY KEY, a INT NOT NULL, doble INT AS (a * 2) VIRTUAL, creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci');
        try {
            self::$bd->exec("INSERT INTO zz_generada (id, a, creado) VALUES (1, 21, '2026-01-02 03:04:05')");
            $ruta = (new Respaldo(self::$bd, new RelojFijo()))->ejecutar($this->dir);
            $sql = (string) gzdecode((string) file_get_contents($ruta));
            $this->assertStringContainsString("INSERT INTO `zz_generada` (`id`, `a`, `creado`) VALUES (1,21,'2026-01-02 03:04:05');", $sql);
            $this->borrarTodasLasTablas();
            $this->restaurar($ruta);
            $this->assertSame([1, 21, 42, '2026-01-02 03:04:05'], self::$bd->query('SELECT id, a, doble, creado FROM zz_generada')->fetch(\PDO::FETCH_NUM));
        } finally {
            self::$bd->exec('DROP TABLE IF EXISTS zz_generada');
        }
    }

    public function test_respaldo_de_20000_filas_no_supera_32_mb_de_pico(): void
    {
        // 20 000 filas de ~2 KB (≈ 40 MB de datos): cargarlas enteras en memoria superaría 32 MB.
        $valores = implode(',', array_fill(0, 500, "('x', 'prueba', 'memoria', REPEAT(MD5(RAND()), 64), '2026-11-01 00:00:00')"));
        for ($i = 0; $i < 40; $i++) {
            self::$bd->exec("INSERT INTO auditoria (accion, entidad, entidad_id, detalle, creado) VALUES $valores");
        }
        unset($valores);
        $this->assertSame(20000, (int) self::$bd->query('SELECT COUNT(*) FROM auditoria')->fetchColumn());
        $respaldo = new Respaldo(self::$bd, new RelojFijo('2026-11-02 03:30:00'));

        gc_collect_cycles();
        memory_reset_peak_usage();
        $base = memory_get_usage(true);
        $ruta = $respaldo->ejecutar($this->dir);
        $delta = memory_get_peak_usage(true) - $base;

        $this->assertLessThan(32 * 1024 * 1024, $delta, sprintf('Pico de memoria del respaldo: %.1f MB', $delta / 1048576));
        // El volcado está completo: 20 000 filas en INSERT de a lo más 100 filas.
        $filas = 0;
        $inserts = 0;
        $gz = gzopen($ruta, 'rb');
        while (($linea = gzgets($gz)) !== false) {
            if (str_starts_with($linea, 'INSERT INTO `auditoria`')) {
                $inserts++;
                $filas += substr_count($linea, "'memoria'");
            }
        }
        gzclose($gz);
        $this->assertSame(20000, $filas);
        $this->assertGreaterThanOrEqual(200, $inserts);
    }

    // ---------------------------------------------------------------- cron.php

    public function test_cron_fuera_de_cli_no_hace_nada_y_avisa(): void
    {
        // Servidor embebido de PHP (PHP_SAPI = 'cli-server') con un router que simula la tarea "todo"
        // contra la base de pruebas. Sin la guarda, cron.php imprimiría líneas y escribiría en auditoria.
        $cron = dirname(__DIR__, 2) . '/bin/cron.php';
        $router = sys_get_temp_dir() . '/router-cron-' . bin2hex(random_bytes(4)) . '.php';
        file_put_contents($router, '<?php $argv = ["cron.php", "todo"]; $argc = 2; $_SERVER["argv"] = $argv; require ' . var_export($cron, true) . ';');
        $puerto = $this->puertoLibre();
        $config = self::configPruebas();
        $entorno = getenv() + [];
        $entorno['BD_DSN'] = $config->bdDsn;
        $entorno['BD_USUARIO'] = $config->bdUsuario;
        $entorno['BD_CLAVE'] = $config->bdClave;
        $entorno['CLAVE_CIFRADO'] = base64_encode($config->claveCifrado);
        $entorno['CLAVE_INDICE'] = base64_encode($config->claveIndice);
        $salidaError = (string) tempnam(sys_get_temp_dir(), 'cron-stderr-');
        $registro = (string) tempnam(sys_get_temp_dir(), 'cron-error-log-');
        $proc = proc_open(
            [PHP_BINARY, '-d', 'log_errors=1', '-d', "error_log=$registro", '-S', "127.0.0.1:$puerto", $router],
            [1 => ['file', '/dev/null', 'w'], 2 => ['file', $salidaError, 'w']],
            $tubos,
            sys_get_temp_dir(),
            $entorno,
        );
        $this->assertIsResource($proc);
        try {
            $listo = false;
            for ($i = 0; $i < 100 && !$listo; $i++) {
                $s = @fsockopen('127.0.0.1', $puerto, $errno, $errstr, 0.1);
                if ($s !== false) {
                    fclose($s);
                    $listo = true;
                } else {
                    usleep(50000);
                }
            }
            $this->assertTrue($listo, 'El servidor embebido no arrancó');
            $cuerpo = file_get_contents("http://127.0.0.1:$puerto/", false, stream_context_create(['http' => ['timeout' => 10, 'ignore_errors' => true]]));
        } finally {
            proc_terminate($proc);
            proc_close($proc);
            unlink($router);
            $stderr = (string) file_get_contents($salidaError);
            $log = (string) file_get_contents($registro);
            unlink($salidaError);
            unlink($registro);
        }
        $this->assertSame('', $cuerpo);
        $this->assertSame(0, (int) self::$bd->query('SELECT COUNT(*) FROM auditoria')->fetchColumn());
        // Con un binario equivocado (p. ej. un ea-phpXX que es php-cgi) el cron no debe fallar en silencio.
        $aviso = 'cron.php debe ejecutarse con PHP CLI (SAPI=cli-server)';
        $this->assertStringContainsString($aviso, $log, 'Aviso en error_log()');
        $this->assertStringContainsString($aviso, $stderr, 'Aviso en STDERR');
    }

    // ---------------------------------------------------------------- apoyo

    private function puertoLibre(): int
    {
        $s = stream_socket_server('tcp://127.0.0.1:0');
        $nombre = stream_socket_get_name($s, false);
        fclose($s);
        return (int) substr((string) $nombre, strrpos((string) $nombre, ':') + 1);
    }

    /** Datos con UTF-8 de 4 bytes, binarios, NULL, saltos de línea, comillas y barras invertidas. */
    private function sembrarDatosVariados(): void
    {
        $u = $this->crearUsuario(['nombre' => 'Ñandú 🧪 revisor']);
        self::$bd->prepare('INSERT INTO usuarios (nombre, laboratorio, correo_cifrado, correo_indice, clave_hash, roles) VALUES (?,?,?,?,?,?)')
            ->execute(["Ñandú 🧪 'comilla' \"doble\" \\barra\nlínea\r\x1a;\n-- no es comentario", 'Raro', "\0\x27\x5c\xff\x00\n", str_repeat("\x5c", 32), 'h', 'laboratorio,revisor']);
        self::$bd->exec("INSERT INTO capitulos (orden, slug, titulo) VALUES (1, 'c1', 'Capítulo «uno»')");
        $cap = (int) self::$bd->lastInsertId();
        $doc = json_encode(['bloques' => [['id' => 'b1', 'texto' => "α β γ\n\t\\ \"x\" ;\n"]]], JSON_UNESCAPED_UNICODE);
        self::$bd->prepare("INSERT INTO versiones_capitulo (capitulo_id, tipo, tex_original, doc_json, tex_final, creado_por) VALUES (?, 'base', ?, ?, NULL, ?)")
            ->execute([$cap, "\\section{Á}\n% comentario;\n", $doc, $u['id']]);
        $ver = (int) self::$bd->lastInsertId();
        $ins = self::$bd->prepare("INSERT INTO sugerencias (usuario_id, capitulo_id, version_base_id, uid, bloque_id, tipo, datos, motivo) VALUES (?, ?, ?, ?, 'b1', 'reemplazo', ?, ?)");
        for ($i = 0; $i < 250; $i++) { // más de un lote de 100
            $ins->execute([$u['id'], $cap, $ver, "s$i", $doc, $i % 3 === 0 ? null : "motivo $i ’"]);
        }
        self::$bd->exec("INSERT INTO intentos_login (clave, fallos, bloqueos, bloqueado_hasta, actualizado) VALUES ('ip:1', 2, 1, '2026-11-02 13:00:00', '2026-11-02 12:00:00')");
        self::$bd->exec("UPDATE consulta SET apertura = '2026-11-01 00:00:00', motivo_obligatorio = 1 WHERE id = 1");
    }

    /** @return array<string,array{0:int,1:string}> conteo y CHECKSUM TABLE por tabla */
    private function huella(): array
    {
        $r = [];
        foreach (self::$bd->query('SHOW TABLES')->fetchAll(\PDO::FETCH_COLUMN) as $t) {
            $conteo = (int) self::$bd->query("SELECT COUNT(*) FROM `$t`")->fetchColumn();
            $suma = (string) self::$bd->query("CHECKSUM TABLE `$t`")->fetch()['Checksum'];
            $r[$t] = [$conteo, $suma];
        }
        ksort($r);
        return $r;
    }

    private function borrarTodasLasTablas(): void
    {
        self::$bd->exec('SET FOREIGN_KEY_CHECKS = 0');
        foreach (self::$bd->query('SHOW TABLES')->fetchAll(\PDO::FETCH_COLUMN) as $t) {
            self::$bd->exec("DROP TABLE `$t`");
        }
        self::$bd->exec('SET FOREIGN_KEY_CHECKS = 1');
    }

    /** Importa el .sql.gz como lo haría phpMyAdmin: sentencias terminadas en ";" al final de línea. */
    private function restaurar(string $ruta): void
    {
        $gz = gzopen($ruta, 'rb');
        $sentencia = '';
        while (($linea = gzgets($gz)) !== false) {
            if ($sentencia === '' && (str_starts_with($linea, '--') || trim($linea) === '')) {
                continue;
            }
            $sentencia .= $linea;
            if (str_ends_with($linea, ";\n")) {
                self::$bd->exec($sentencia);
                $sentencia = '';
            }
        }
        gzclose($gz);
        $this->assertSame('', $sentencia, 'Quedó una sentencia sin terminar');
    }

    public function test_respaldo_deja_la_sesion_de_importacion_como_estaba(): void
    {
        $antes = self::$bd->query('SELECT @@SESSION.sql_mode, @@SESSION.foreign_key_checks, @@SESSION.time_zone')->fetch(\PDO::FETCH_NUM);
        $ruta = (new Respaldo(self::$bd, new RelojFijo()))->ejecutar($this->dir);
        $this->borrarTodasLasTablas();
        $this->restaurar($ruta);
        $despues = self::$bd->query('SELECT @@SESSION.sql_mode, @@SESSION.foreign_key_checks, @@SESSION.time_zone')->fetch(\PDO::FETCH_NUM);
        $this->assertSame($antes, $despues);
    }
}
