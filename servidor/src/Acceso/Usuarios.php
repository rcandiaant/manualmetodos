<?php

declare(strict_types=1);

namespace Manual\Acceso;

use Manual\Dominio\Rol;
use Manual\Seguridad\Cifrado;

/**
 * Acceso a usuarios. El correo se guarda cifrado (correo_cifrado) y se busca por índice ciego (correo_indice).
 * Las filas internas incluyen clave_hash: nunca salen de la API; para eso está dto().
 */
final class Usuarios
{
    private const COLUMNAS = 'id, nombre, laboratorio, clave_hash, roles, activo';

    public function __construct(private readonly \PDO $bd, private readonly Cifrado $cifrado)
    {
    }

    public function indice(string $correo): string
    {
        return $this->cifrado->indice($correo);
    }

    /** @return array{id:int,nombre:string,laboratorio:string,clave_hash:string,roles:list<string>,activo:bool}|null */
    public function porCorreo(string $correo): ?array
    {
        $st = $this->bd->prepare('SELECT ' . self::COLUMNAS . ' FROM usuarios WHERE correo_indice = ?');
        $st->bindValue(1, $this->cifrado->indice($correo), \PDO::PARAM_LOB);
        $st->execute();
        $fila = $st->fetch();
        return $fila === false ? null : self::fila($fila);
    }

    /** @return array{id:int,nombre:string,laboratorio:string,clave_hash:string,roles:list<string>,activo:bool}|null */
    public function porId(int $id): ?array
    {
        $st = $this->bd->prepare('SELECT ' . self::COLUMNAS . ' FROM usuarios WHERE id = ?');
        $st->execute([$id]);
        $fila = $st->fetch();
        return $fila === false ? null : self::fila($fila);
    }

    /** @param list<string> $roles */
    public function crear(string $nombre, string $correo, string $laboratorio, string $claveHash, array $roles, bool $activo = true): int
    {
        if ($roles === [] || array_filter($roles, fn ($r) => !is_string($r) || !Rol::valido($r)) !== []) {
            throw new \InvalidArgumentException('Roles inválidos.');
        }
        $st = $this->bd->prepare(
            'INSERT INTO usuarios (nombre, laboratorio, correo_cifrado, correo_indice, clave_hash, roles, activo) VALUES (?, ?, ?, ?, ?, ?, ?)'
        );
        $st->bindValue(1, $nombre);
        $st->bindValue(2, $laboratorio);
        $st->bindValue(3, $this->cifrado->cifrar(trim($correo)), \PDO::PARAM_LOB);
        $st->bindValue(4, $this->cifrado->indice($correo), \PDO::PARAM_LOB);
        $st->bindValue(5, $claveHash);
        $st->bindValue(6, implode(',', array_values(array_unique($roles))));
        $st->bindValue(7, $activo ? 1 : 0, \PDO::PARAM_INT);
        $st->execute();
        return (int) $this->bd->lastInsertId();
    }

    /**
     * DTO público del usuario de la sesión.
     * @param array{id:int,nombre:string,laboratorio:string,roles:list<string>} $u
     * @return array{id:int,nombre:string,laboratorio:string,roles:list<string>}
     */
    public static function dto(array $u): array
    {
        return ['id' => $u['id'], 'nombre' => $u['nombre'], 'laboratorio' => $u['laboratorio'], 'roles' => $u['roles']];
    }

    /** @param array<string,mixed> $f */
    private static function fila(array $f): array
    {
        return [
            'id' => (int) $f['id'],
            'nombre' => (string) $f['nombre'],
            'laboratorio' => (string) $f['laboratorio'],
            'clave_hash' => (string) $f['clave_hash'],
            'roles' => $f['roles'] === '' ? [] : explode(',', (string) $f['roles']),
            'activo' => (int) $f['activo'] === 1,
        ];
    }
}
