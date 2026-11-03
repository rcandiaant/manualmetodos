<?php

declare(strict_types=1);

namespace Manual\Acceso;

/**
 * La versión base con que trabaja el laboratorio ya no es la vigente (el admin reemplazó el texto del capítulo).
 * Se comprueba dentro de la transacción del guardado, con la fila del capítulo bloqueada
 * (Capitulos::exigirVersionVigente). Los controladores la traducen a 409 `version_obsoleta`.
 */
final class VersionObsoleta extends \RuntimeException
{
}
