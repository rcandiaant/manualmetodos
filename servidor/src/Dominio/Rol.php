<?php

declare(strict_types=1);

namespace Manual\Dominio;

/** Roles de usuario (columna usuarios.roles, tipo SET). Un usuario puede tener varios. */
final class Rol
{
    public const LABORATORIO = 'laboratorio';
    public const REVISOR = 'revisor';
    public const ADMIN = 'admin';

    /** En el orden en que los devuelve la columna SET. */
    public const TODOS = [self::LABORATORIO, self::REVISOR, self::ADMIN];

    public static function valido(string $rol): bool
    {
        return in_array($rol, self::TODOS, true);
    }
}
