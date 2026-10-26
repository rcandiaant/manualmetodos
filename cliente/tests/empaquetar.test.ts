import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { cabeceraSql, listaPaquete, nombrePaquete, validarPaquete } from '../scripts/empaquetar';

const OBLIGATORIOS = [
  'public/index.php',
  'public/.htaccess',
  'public/index.html',
  'vendor/autoload.php',
  'migraciones/001_inicial.sql',
];

const PAQUETE_VALIDO = [
  ...OBLIGATORIOS,
  'public/assets/index-abc123.js',
  'bin/crear-admin.php',
  'bin/migrar.php',
  'config/esquema-documento.json',
  'src/Config.php',
  'vendor/composer/autoload_real.php',
  'composer.json',
  '.env.produccion.example',
];

describe('validarPaquete', () => {
  it('validarPaquete exige archivos obligatorios', () => {
    expect(validarPaquete(PAQUETE_VALIDO)).toEqual([]);
    for (const falta of OBLIGATORIOS) {
      const errores = validarPaquete(PAQUETE_VALIDO.filter((r) => r !== falta));
      expect(errores).toHaveLength(1);
      expect(errores[0]).toContain(falta);
    }
    expect(validarPaquete([])).toHaveLength(OBLIGATORIOS.length);
  });

  it('validarPaquete rechaza tests env var manual-fuente', () => {
    const prohibidas = [
      'tests/Unit/ConfigTest.php',
      'src/tests/algo.php',
      'phpunit.xml',
      'vendor/phpunit/phpunit/src/Framework/TestCase.php',
      '.env',
      'public/.env',
      '.env.local',
      'var/sesiones/sess_abc',
      'manual-fuente/capitulo1.tex',
      'public/manual-fuente/x.tex',
      'node_modules/fflate/package.json',
      '.git/HEAD',
      'vendor/algo/.git/config',
      'public/assets/index-abc123.js.map',
      'composer.lock',
    ];
    for (const ruta of prohibidas) {
      const errores = validarPaquete([...PAQUETE_VALIDO, ruta]);
      expect(errores, ruta).toHaveLength(1);
      expect(errores[0]).toContain(ruta);
    }
    // El ejemplo de producción sí viaja; .gitignore o .github no son .git ni .env.
    expect(validarPaquete([...PAQUETE_VALIDO, '.env.produccion.example', 'vendor/x/.gitignore'])).toEqual([]);
  });

  it('acepta rutas con barras invertidas de Windows', () => {
    expect(validarPaquete(PAQUETE_VALIDO.map((r) => r.replaceAll('/', '\\')))).toEqual([]);
    expect(validarPaquete([...PAQUETE_VALIDO, 'tests\\x.php'])).toHaveLength(1);
  });
});

describe('nombrePaquete', () => {
  it('nombre del paquete lleva fecha y sha', () => {
    // 2026-10-27T02:30Z es todavía 26 de octubre en Santiago (UTC−3).
    const fecha = new Date('2026-10-27T02:30:00Z');
    const sha = '8c2065c1f0e9d8a7b6c5d4e3f2a1b0c9d8e7f6a5';
    expect(nombrePaquete(fecha, sha, 'zip')).toBe('manualmetodos-20261026-8c2065c.zip');
    expect(nombrePaquete(fecha, sha, 'sql')).toBe('manualmetodos-20261026-8c2065c.sql');
    expect(nombrePaquete(new Date('2026-01-05T15:00:00Z'), 'ABCDEF1234', 'zip')).toBe('manualmetodos-20260105-abcdef1.zip');
  });

  it('con el árbol sucio el nombre lleva el sufijo -sucio', () => {
    const fecha = new Date('2026-10-27T02:30:00Z');
    expect(nombrePaquete(fecha, '8c2065c1f0', 'zip', true)).toBe('manualmetodos-20261026-8c2065c-sucio.zip');
    expect(nombrePaquete(fecha, '8c2065c1f0', 'sql', true)).toBe('manualmetodos-20261026-8c2065c-sucio.sql');
    expect(nombrePaquete(fecha, '8c2065c1f0', 'zip', false)).toBe('manualmetodos-20261026-8c2065c.zip');
  });

  it('rechaza un sha que no es hexadecimal', () => {
    expect(() => nombrePaquete(new Date(), 'no-es-sha', 'zip')).toThrow();
  });
});

describe('cabeceraSql', () => {
  it('explica cómo importarlo sin cambiar el charset, todo en comentarios', () => {
    const cabecera = cabeceraSql('manualmetodos-20261026-8c2065c', ['001_inicial.sql']);
    expect(cabecera).toContain('phpMyAdmin');
    expect(cabecera).toMatch(/charset/i);
    expect(cabecera).toContain('001_inicial.sql');
    for (const linea of cabecera.trimEnd().split('\n')) expect(linea.startsWith('--')).toBe(true);
  });
});

describe('listaPaquete', () => {
  let raiz = '';
  afterEach(() => {
    if (raiz) rmSync(raiz, { recursive: true, force: true });
  });

  it('lista los archivos con rutas relativas y barras normales, ordenadas', () => {
    raiz = mkdtempSync(join(tmpdir(), 'paquete-'));
    mkdirSync(join(raiz, 'public', 'assets'), { recursive: true });
    mkdirSync(join(raiz, 'vendor', 'composer'), { recursive: true });
    writeFileSync(join(raiz, 'public', 'index.php'), '<?php');
    writeFileSync(join(raiz, 'public', '.htaccess'), '');
    writeFileSync(join(raiz, 'public', 'assets', 'a.js'), '');
    writeFileSync(join(raiz, 'vendor', 'composer', 'x.php'), '');
    writeFileSync(join(raiz, 'composer.json'), '{}');
    expect(listaPaquete(raiz)).toEqual([
      'composer.json',
      'public/.htaccess',
      'public/assets/a.js',
      'public/index.php',
      'vendor/composer/x.php',
    ]);
  });
});
