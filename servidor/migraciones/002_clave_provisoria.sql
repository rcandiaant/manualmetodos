-- Manual de métodos: clave provisoria.
-- clave_provisoria = 1: la cuenta entra con una clave entregada por el administrador y debe
-- definir una propia antes de usar la plataforma.
-- Importable tal cual en phpMyAdmin (MariaDB >= 10.3 / MySQL >= 8.0). Es idempotente:
-- la columna se agrega solo si falta, y las cuentas existentes se marcan solo la primera vez
-- (si 002 ya figura en migraciones_aplicadas, no se vuelve a marcar a nadie).
-- Sin comentarios con punto y coma, ni punto y coma dentro de cadenas: el Migrador parte por punto y coma.

SET NAMES utf8mb4;

SET @falta_columna = (
  SELECT COUNT(*) = 0 FROM information_schema.columns
  WHERE table_schema = DATABASE() AND table_name = 'usuarios' AND column_name = 'clave_provisoria'
);

SET @sql_columna = IF(@falta_columna,
  'ALTER TABLE usuarios ADD COLUMN clave_provisoria TINYINT(1) NOT NULL DEFAULT 0 AFTER clave_hash',
  'DO 0');

PREPARE agregar_columna FROM @sql_columna;
EXECUTE agregar_columna;
DEALLOCATE PREPARE agregar_columna;

-- Las cuentas que ya existen recibieron una clave del administrador. Los admin quedan fuera.
UPDATE usuarios SET clave_provisoria = 1
WHERE NOT FIND_IN_SET('admin', roles)
  AND NOT EXISTS (SELECT 1 FROM migraciones_aplicadas WHERE nombre = '002_clave_provisoria.sql');

INSERT IGNORE INTO migraciones_aplicadas (nombre) VALUES ('002_clave_provisoria.sql');
