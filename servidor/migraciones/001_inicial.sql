-- Manual de métodos: esquema inicial.
-- Importable tal cual en phpMyAdmin (MariaDB >= 10.3 / MySQL >= 8.0). Es idempotente.
-- Antes del primer despliegue, los cambios de esquema se hacen aquí mismo (no hay 002+).
-- Sin comentarios con punto y coma, ni punto y coma dentro de cadenas: el Migrador parte por ";".

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS migraciones_aplicadas (
  nombre VARCHAR(190) NOT NULL,
  aplicada_en DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (nombre)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usuarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(190) NOT NULL,
  laboratorio VARCHAR(190) NOT NULL,
  correo_cifrado VARBINARY(255) NOT NULL,
  correo_indice BINARY(32) NOT NULL,
  clave_hash VARCHAR(255) NOT NULL,
  roles SET('laboratorio','revisor','admin') NOT NULL DEFAULT 'laboratorio',
  activo TINYINT(1) NOT NULL DEFAULT 1,
  creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_usuarios_correo_indice (correo_indice)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS capitulos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  orden INT NOT NULL,
  slug VARCHAR(190) NOT NULL,
  titulo VARCHAR(255) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_capitulos_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS versiones_capitulo (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  capitulo_id INT UNSIGNED NOT NULL,
  tipo ENUM('base','final') NOT NULL,
  tex_original LONGTEXT NOT NULL,
  doc_json LONGTEXT NOT NULL,
  tex_final LONGTEXT NULL,
  creado_por INT UNSIGNED NULL,
  creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_versiones_capitulo_tipo (capitulo_id, tipo, id),
  CONSTRAINT fk_versiones_capitulo FOREIGN KEY (capitulo_id) REFERENCES capitulos (id),
  CONSTRAINT fk_versiones_creado_por FOREIGN KEY (creado_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS copias_laboratorio (
  usuario_id INT UNSIGNED NOT NULL,
  capitulo_id INT UNSIGNED NOT NULL,
  version_base_id INT UNSIGNED NOT NULL,
  doc_json LONGTEXT NOT NULL,
  actualizado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (usuario_id, capitulo_id),
  KEY ix_copias_capitulo (capitulo_id),
  CONSTRAINT fk_copias_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_copias_capitulo FOREIGN KEY (capitulo_id) REFERENCES capitulos (id),
  CONSTRAINT fk_copias_version FOREIGN KEY (version_base_id) REFERENCES versiones_capitulo (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS revisiones_copia (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  capitulo_id INT UNSIGNED NOT NULL,
  doc_json LONGTEXT NOT NULL,
  creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_revisiones_usuario_capitulo (usuario_id, capitulo_id, creado),
  CONSTRAINT fk_revisiones_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_revisiones_capitulo FOREIGN KEY (capitulo_id) REFERENCES capitulos (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sugerencias (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  capitulo_id INT UNSIGNED NOT NULL,
  version_base_id INT UNSIGNED NOT NULL,
  uid VARCHAR(190) NOT NULL,
  bloque_id VARCHAR(190) NOT NULL,
  tipo VARCHAR(64) NOT NULL,
  grupo VARCHAR(190) NULL,
  datos LONGTEXT NOT NULL,
  motivo TEXT NULL,
  estado ENUM('pendiente','aceptada','rechazada','modificada') NOT NULL DEFAULT 'pendiente',
  nota_resolucion TEXT NULL,
  derivada_reunion TINYINT(1) NOT NULL DEFAULT 0,
  resuelto_por INT UNSIGNED NULL,
  resuelto_en DATETIME NULL,
  creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sugerencias_uid (usuario_id, capitulo_id, version_base_id, uid),
  KEY ix_sugerencias_usuario_capitulo (usuario_id, capitulo_id),
  KEY ix_sugerencias_capitulo_estado (capitulo_id, estado),
  KEY ix_sugerencias_bloque (capitulo_id, bloque_id),
  CONSTRAINT fk_sugerencias_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_sugerencias_capitulo FOREIGN KEY (capitulo_id) REFERENCES capitulos (id),
  CONSTRAINT fk_sugerencias_version FOREIGN KEY (version_base_id) REFERENCES versiones_capitulo (id),
  CONSTRAINT fk_sugerencias_resuelto_por FOREIGN KEY (resuelto_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS comentarios (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NOT NULL,
  capitulo_id INT UNSIGNED NOT NULL,
  bloque_id VARCHAR(190) NOT NULL,
  rango LONGTEXT NOT NULL,
  texto TEXT NOT NULL,
  estado ENUM('abierto','resuelto') NOT NULL DEFAULT 'abierto',
  nota_resolucion TEXT NULL,
  resuelto_por INT UNSIGNED NULL,
  resuelto_en DATETIME NULL,
  creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_comentarios_usuario_capitulo (usuario_id, capitulo_id),
  KEY ix_comentarios_capitulo_estado (capitulo_id, estado),
  CONSTRAINT fk_comentarios_usuario FOREIGN KEY (usuario_id) REFERENCES usuarios (id),
  CONSTRAINT fk_comentarios_capitulo FOREIGN KEY (capitulo_id) REFERENCES capitulos (id),
  CONSTRAINT fk_comentarios_resuelto_por FOREIGN KEY (resuelto_por) REFERENCES usuarios (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS consulta (
  id TINYINT UNSIGNED NOT NULL,
  apertura DATETIME NULL,
  cierre DATETIME NULL,
  motivo_obligatorio TINYINT(1) NOT NULL DEFAULT 0,
  PRIMARY KEY (id),
  CONSTRAINT ck_consulta_una_fila CHECK (id = 1)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS auditoria (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  usuario_id INT UNSIGNED NULL,
  accion VARCHAR(64) NOT NULL,
  entidad VARCHAR(64) NOT NULL,
  entidad_id VARCHAR(64) NULL,
  detalle LONGTEXT NULL,
  creado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY ix_auditoria_entidad (entidad, entidad_id),
  KEY ix_auditoria_usuario (usuario_id, creado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS intentos_login (
  clave VARCHAR(190) NOT NULL,
  fallos INT UNSIGNED NOT NULL DEFAULT 0,
  bloqueado_hasta DATETIME NULL,
  actualizado DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (clave),
  KEY ix_intentos_actualizado (actualizado)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO consulta (id, apertura, cierre, motivo_obligatorio) VALUES (1, NULL, NULL, 0);

INSERT IGNORE INTO migraciones_aplicadas (nombre) VALUES ('001_inicial.sql');
