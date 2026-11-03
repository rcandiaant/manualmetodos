<?php

declare(strict_types=1);

namespace Manual\Mantenimiento;

/**
 * «Reiniciar datos de prueba» (POST /api/admin/reiniciar, solo con REINICIO_PRUEBAS=1): borra el trabajo de los
 * laboratorios y del revisor y devuelve la consulta a preparación. Conserva capítulos (versiones base),
 * usuarios, auditoría e intentos de login. El respaldo previo lo hace el controlador (ReinicioCtl).
 */
final class ReinicioPruebas
{
    public function __construct(private readonly \PDO $bd)
    {
    }

    /**
     * En una transacción, en este orden (hijas antes que padres): comentarios, sugerencias, instantáneas,
     * copias y versiones finales; después quita las fechas de la consulta (motivoObligatorio se conserva).
     * @return array{comentarios:int,sugerencias:int,revisiones_copia:int,copias_laboratorio:int,versiones_final:int}
     */
    public function borrar(): array
    {
        $this->bd->beginTransaction();
        try {
            $n = [];
            foreach (['comentarios', 'sugerencias', 'revisiones_copia', 'copias_laboratorio'] as $tabla) {
                $n[$tabla] = (int) $this->bd->exec("DELETE FROM `$tabla`");
            }
            $n['versiones_final'] = (int) $this->bd->exec("DELETE FROM versiones_capitulo WHERE tipo = 'final'");
            $this->bd->exec('UPDATE consulta SET apertura = NULL, cierre = NULL WHERE id = 1');
            $this->bd->commit();
        } catch (\Throwable $e) {
            if ($this->bd->inTransaction()) {
                $this->bd->rollBack();
            }
            throw $e;
        }
        return $n;
    }
}
