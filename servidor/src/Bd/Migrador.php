<?php

declare(strict_types=1);

namespace Manual\Bd;

final class Migrador
{
    /**
     * Aplica en orden los NNN_*.sql de $dir que no estén en migraciones_aplicadas.
     * @return list<string> nombres aplicados
     */
    public static function aplicar(\PDO $bd, string $dir): array
    {
        $bd->exec(
            'CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
               nombre VARCHAR(190) NOT NULL,
               aplicada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
               PRIMARY KEY (nombre)
             ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci'
        );
        $hechas = $bd->query('SELECT nombre FROM migraciones_aplicadas')->fetchAll(\PDO::FETCH_COLUMN);
        $archivos = glob(rtrim($dir, '/\\') . '/[0-9][0-9][0-9]_*.sql') ?: [];
        sort($archivos, SORT_STRING);

        $aplicadas = [];
        foreach ($archivos as $ruta) {
            $nombre = basename($ruta);
            if (in_array($nombre, $hechas, true)) {
                continue;
            }
            $sql = file_get_contents($ruta);
            if ($sql === false) {
                throw new \RuntimeException("No se pudo leer $ruta");
            }
            foreach (self::sentencias($sql) as $sentencia) {
                $bd->exec($sentencia);
            }
            $bd->prepare('INSERT IGNORE INTO migraciones_aplicadas (nombre) VALUES (?)')->execute([$nombre]);
            $aplicadas[] = $nombre;
        }
        return $aplicadas;
    }

    /**
     * Parte un script en sentencias. Supone que no hay ";" dentro de cadenas ni de comentarios.
     * @return list<string>
     */
    public static function sentencias(string $sql): array
    {
        $lineas = [];
        foreach (preg_split('/\R/', $sql) ?: [] as $linea) {
            if (str_starts_with(ltrim($linea), '--')) {
                continue;
            }
            $lineas[] = $linea;
        }
        $res = [];
        foreach (explode(';', implode("\n", $lineas)) as $s) {
            $s = trim($s);
            if ($s !== '') {
                $res[] = $s;
            }
        }
        return $res;
    }
}
