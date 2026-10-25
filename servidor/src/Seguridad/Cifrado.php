<?php

declare(strict_types=1);

namespace Manual\Seguridad;

/**
 * Cifrado de datos sensibles (correos) con sodium y un índice ciego (HMAC) para buscarlos.
 * Las claves vienen de Config (CLAVE_CIFRADO y CLAVE_INDICE, 32 bytes cada una, distintas).
 */
final class Cifrado
{
    public function __construct(
        #[\SensitiveParameter] private readonly string $claveCifrado,
        #[\SensitiveParameter] private readonly string $claveIndice,
    ) {
        if (strlen($claveCifrado) !== SODIUM_CRYPTO_SECRETBOX_KEYBYTES || strlen($claveIndice) !== 32) {
            throw new \InvalidArgumentException('Las claves de cifrado e índice deben medir 32 bytes.');
        }
        if (hash_equals($claveCifrado, $claveIndice)) {
            throw new \InvalidArgumentException('CLAVE_CIFRADO y CLAVE_INDICE deben ser distintas.');
        }
    }

    /** Devuelve nonce (24 bytes) + texto cifrado y autenticado. */
    public function cifrar(string $texto): string
    {
        $nonce = random_bytes(SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        return $nonce . sodium_crypto_secretbox($texto, $nonce, $this->claveCifrado);
    }

    /** @throws \RuntimeException si el dato está alterado, truncado o se cifró con otra clave */
    public function descifrar(string $bin): string
    {
        if (strlen($bin) < SODIUM_CRYPTO_SECRETBOX_NONCEBYTES + SODIUM_CRYPTO_SECRETBOX_MACBYTES) {
            throw new \RuntimeException('Dato cifrado inválido.');
        }
        $nonce = substr($bin, 0, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES);
        $texto = sodium_crypto_secretbox_open(substr($bin, SODIUM_CRYPTO_SECRETBOX_NONCEBYTES), $nonce, $this->claveCifrado);
        if ($texto === false) {
            throw new \RuntimeException('Dato cifrado inválido.');
        }
        return $texto;
    }

    /** Índice ciego del correo: HMAC-SHA256 (32 bytes binarios) del correo normalizado. */
    public function indice(string $correo): string
    {
        return hash_hmac('sha256', mb_strtolower(trim($correo), 'UTF-8'), $this->claveIndice, true);
    }
}
