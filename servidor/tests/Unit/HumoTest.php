<?php

declare(strict_types=1);

namespace Manual\Pruebas\Unit;

use PHPUnit\Framework\TestCase;

final class HumoTest extends TestCase
{
    public function test_php_tiene_extensiones(): void
    {
        foreach (['pdo_mysql', 'sodium', 'intl', 'mbstring', 'apcu'] as $extension) {
            $this->assertTrue(extension_loaded($extension), "Falta la extensión $extension");
        }
        $this->assertTrue(defined('PASSWORD_ARGON2ID'), 'PASSWORD_ARGON2ID no está definido');
    }
}
