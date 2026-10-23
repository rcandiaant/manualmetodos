# Plataforma de consulta pública del Manual de Métodos — Diseño

- **Fecha:** 2026-10-23
- **Autor:** Rodrigo Candia (INIA), con Claude
- **Solicitante:** Fabio Corradini (Renalasch)
- **Estado:** borrador para aprobación

Convención: lo marcado **[decisión de Rodrigo]** fue definido explícitamente por el usuario. Lo marcado **[decisión técnica]** es una propuesta del diseño que el usuario puede objetar. Lo no marcado se deriva de lo anterior.

---

## 1. Intención y por qué

El Manual de Métodos será el estándar de metodologías analíticas de suelos para los laboratorios asociados a Renalasch. Antes de publicarlo pasa por un **período de consulta pública**: cada laboratorio revisa los capítulos, propone cambios y deja comentarios. Al cerrar la consulta, un equipo consolidador resuelve cada aporte, genera la edición final y prepara una reunión ampliada para las observaciones mayores.

El manual está escrito en LaTeX: un `.tex` por método, incluido con `\include{}` en un archivo marco con la diagramación. Los laboratorios no saben LaTeX y no deben verlo.

La plataforma existe porque **ninguna herramienta disponible cumple a la vez**:

1. **Privacidad por laboratorio:** cada laboratorio ve solo sus propias sugerencias y comentarios.
2. **Retorno limpio a `.tex`:** las sugerencias aceptadas vuelven al LaTeX del capítulo sin reescribirlo a mano.

Google Docs no cumple (1). Word por correo no escala a ~35 laboratorios × ~15 capítulos y rompe (2). Overleaf expone LaTeX. Las librerías comerciales de control de cambios cobran licencia y no resuelven (2).

## 2. Objetivos, no-objetivos y anti-objetivos

### Objetivos
- Edición visual (WYSIWYG) de cada capítulo, sin LaTeX a la vista, con **control de cambios estilo Word** **[decisión de Rodrigo]**.
- Comentarios anclados a fragmentos del texto.
- Cada laboratorio ve **solo lo suyo** **[decisión de Rodrigo]**.
- Un rol revisor que ve todo, resuelve (acepta, rechaza, reescribe o deriva a reunión) y genera el `.tex` final de cada capítulo.
- Trazabilidad completa: quién propuso qué, por qué, quién lo resolvió y cómo.
- Registro final de cambios: **en pantalla** (principal), **imprimible** y **descargable a Excel** (secundario) **[decisión de Rodrigo]**.
- Seguridad sólida (sección 8) y despliegue sin fricción en el hosting de Renalasch.

### No-objetivos
- La reunión ampliada en sí (la plataforma solo marca y lista lo derivado a ella).
- Compilar PDF en el servidor (el hosting no tiene LaTeX; el PDF se compila como hoy, en Overleaf o en local).
- Registro abierto de usuarios o recuperación de contraseña de autoservicio **[decisión de Rodrigo/Fabio]**.
- Edición colaborativa en tiempo real (varios cursores sobre el mismo documento).
- Guardar el manual en git: el repositorio es **solo para código** **[decisión de Rodrigo]**.
- Subida de imágenes por los laboratorios.

### Anti-objetivos (fracaso aunque funcione técnicamente) **[decisión de Rodrigo]**
- Que no recoja bien el feedback de los laboratorios.
- Que consolidar y manejar los cambios termine siendo **más trabajoso que haberlo hecho con Word**.
- Que el costo de desarrollo supere lo que habría costado usar una herramienta existente imperfecta.

**Medida de éxito:** consolidar un capítulo con todos sus aportes toma menos tiempo que hacerlo con Word, y el `.tex` final compila en el archivo marco sin correcciones manuales de estructura.

## 3. Restricciones

### Hosting (verificado en cPanel el 2026-10-23)
- **Hosting compartido** en `renalasch.cl`, cPanel (tema jupiter), CloudLinux. **Sin Docker** **[decisión de Rodrigo, por restricción del hosting]**.
- PHP **8.2**, con OPcache, APCu, pdo_mysql, sodium, intl, mbstring, zip y otras extensiones.
- MySQL o MariaDB (versión por confirmar en phpMyAdmin), 0/5 bases usadas, 10 GB.
- **512 MB de RAM, 20 procesos de entrada simultáneos**, I/O de 1 MB/s.
- **Sin Terminal/SSH y sin Git Version Control** en el servidor. Hay FTP, administrador de archivos, Cron Jobs y SSL activo.
- 5 subdominios disponibles (sin usar).
- "Setup Node.js App" y "Setup Python App" existen, pero no se usan por el límite de memoria **[decisión técnica]**.

### Usuarios
- **~35 laboratorios, una cuenta por laboratorio** **[decisión de Rodrigo]**. Fabio entregará la lista (nombre, correo, laboratorio).
- Pocos revisores (se estima entre 2 y 5).

### Proceso
- **Dos etapas separadas** **[decisión de Rodrigo]**: (1) consulta, con fechas definidas y texto base congelado; (2) edición final, con la consulta cerrada.
- La fecha de la consulta **aún no está definida**. Los `.tex` estarían listos aproximadamente la semana del 2026-10-26.

### Contenido LaTeX (inventariado sobre los 15 capítulos actuales)
- Macros del marco: `\analito{}`, `\metodo{}` y `\degree`.
- `\section{}` estándar: Principio y alcance, Equipos y materiales especiales, Reactivos, Procedimiento, Cálculos, Informe(s).
- `enumerate` e `itemize` anidados.
- `\footnote{}`, a veces con listas adentro.
- `\label{itm:<prefijo>:<nombre>}` y `\ref{}` entre ítems (reactivos y equipos referenciados desde el procedimiento). Los prefijos son únicos por capítulo, pero comparten espacio de nombres al compilar.
- Matemática en línea (`H$_2$SO$_4$`, `$(105 \pm 5)\degree C$`, `$CaCl_2\cdot2H_2O$`) y ecuaciones destacadas `\[ ... \]` con `\frac`, `\text`, `\mathrm` y `\times`.
- `tabular` (típicamente `{cl}` para "donde: a = ..."), con `\\` y `&`.
- No hay `\includegraphics` ni figuras.
- Archivos en UTF-8 con CRLF y nombres con tildes (`NITRÓGENO1.1.tex`).

## 4. Usuarios, roles y acceso

| Rol | Puede |
|---|---|
| **Laboratorio** | Durante la consulta: ver capítulos, editar su copia con control de cambios y comentar. Ve solo lo suyo. Al cerrar la consulta: solo lectura, y puede ver la resolución de sus aportes. |
| **Revisor** | Ve todos los aportes. Durante la edición final: resuelve, reescribe y genera la versión final e informes. |
| **Administrador** | Sube los capítulos `.tex`, crea y desactiva cuentas, regenera contraseñas, define las fechas de la consulta y asigna roles. |

Una persona puede tener los roles de revisor y administrador a la vez.

**Acceso [decisión técnica]:**
- El administrador importa la lista desde CSV o planilla (nombre, correo, laboratorio).
- La plataforma genera una contraseña robusta por cuenta y la envía por correo desde el servidor. El envío va en lotes vía cron, para respetar los límites de correo del hosting.
- No hay registro abierto. "Olvidé mi contraseña" lleva a contactar al administrador, que la regenera.
- La cuenta es del laboratorio: si cambia la persona responsable, se regenera la contraseña sin perder aportes.

## 5. Experiencia de uso

### 5.1 Laboratorio: edición con control de cambios **[decisión de Rodrigo: opción A de la maqueta]**
- Lista de capítulos con su estado ("sin aportes", "N cambios, M comentarios").
- El capítulo se muestra formateado como documento. El usuario escribe directamente sobre el texto: lo agregado aparece en verde subrayado y lo eliminado en rojo tachado, como Word.
- Barra de herramientas: negrita, cursiva, subíndice, superíndice, listas numeradas y con viñetas (con sangría para anidar), tabla (insertar, quitar filas y columnas), nota al pie, símbolos (° ± ≤ ≥ µ · etc.), fórmula, "referenciar ítem" y comentar.
- **Elementos protegidos:** las referencias `\ref` se ven como etiquetas (p. ej., `3.1`) que no se rompen al editar texto alrededor. Se pueden borrar o insertar como unidad desde "referenciar ítem", que lista los ítems etiquetados del capítulo. Las notas al pie se editan en un panel.
- **Fórmulas:** se ven renderizadas. Al hacer clic se abre un editor visual de fórmulas (fracciones, subíndices, símbolos), sin LaTeX a la vista.
- **Contenido no soportado:** cualquier construcción LaTeX fuera del subconjunto conocido aparece como bloque gris protegido de "contenido especial", no editable pero comentable.
- Panel lateral con la lista de sus cambios y comentarios. Cada cambio admite un **motivo** (opcional por defecto, configurable como obligatorio por el administrador) **[decisión técnica]**.
- Guardado automático con indicador visible ("Guardado hace 5 s").
- Los cambios de formato (p. ej., poner negrita) se distinguen visualmente de los de contenido.
- Al cerrar la consulta: modo solo lectura y, en la etapa de edición final o después, el estado de cada aporte (pendiente, aceptado, rechazado, modificado o derivado a reunión).

### 5.2 Revisor: documento con todos los aportes **[decisión de Rodrigo: opción A; B como respaldo]**
- Texto base con los cambios de todos los laboratorios superpuestos, **un color por laboratorio**.
- Filtros: por laboratorio, "solo conflictos", "solo pendientes" y cambios o comentarios.
- **Conflicto:** dos o más laboratorios modifican el mismo fragmento. Se marca con un recuadro y una tarjeta en el margen con las propuestas lado a lado. Acciones: aceptar una, **redactar otra** (el revisor escribe su versión), rechazar todas.
- Por aporte: aceptar, rechazar, **derivar a reunión ampliada**, con nota de resolución opcional.
- Comentarios: marcar como resuelto con nota de resolución. Los laboratorios no reciben respuestas durante la consulta **[decisión técnica]**: ven la resolución después.
- El revisor también puede editar directamente el texto final. Esas ediciones quedan registradas como "cambio del revisor".
- **Respaldo:** si la vista de documento superpuesto resulta inviable con muchos aportes, se usa la **bandeja de pendientes** (opción B: tabla agrupada por fragmento, con clic para ver en contexto). Si el control de cambios estilo Word del laboratorio (5.1) resultara inviable, se pasa a la sugerencia por bloque (opción B de esa maqueta) **[decisión de Rodrigo]**.

### 5.3 Administrador
- Subir o reemplazar capítulos `.tex` (solo antes de abrir la consulta; durante la consulta el texto base está congelado).
- Vista previa de la conversión de cada capítulo, con un reporte de "contenido especial" encontrado.
- Gestión de cuentas, roles y fechas de la consulta (apertura y cierre automáticos por fecha).
- Panel de avance: aportes por laboratorio y por capítulo.

### 5.4 Registro final de cambios **[decisión de Rodrigo]**
- **En pantalla (principal):** informe por capítulo y consolidado. Por aporte: ubicación (sección e ítem), texto original → propuesta, laboratorio, motivo, decisión, quién y cuándo resolvió y nota de resolución. Filtros por capítulo, laboratorio, estado y "solo reunión ampliada".
- **Impresión:** el mismo informe con hoja de estilos de impresión ("Imprimir → Guardar como PDF").
- **Excel (secundario):** descarga `.xlsx` o `.csv` con una fila por aporte.
- **Exportación final:** `.tex` de cada capítulo en su versión final (individual o `.zip`), compatible con el archivo marco existente.

## 6. Arquitectura **[decisión técnica, salvo donde se indica]**

### 6.1 Visión general
- **Servidor:** PHP 8.2 + MySQL/MariaDB en el hosting compartido. API JSON delgada: autentica, autoriza, valida, guarda y entrega datos.
- **Cliente:** aplicación de una sola página (SPA) en JavaScript/TypeScript, compilada a archivos estáticos con Vite. **Todo el trabajo pesado ocurre en el navegador:** conversión LaTeX ↔ documento, edición, cálculo de diferencias, superposición para el revisor, generación del `.tex` final y del Excel.
- Justificación: 512 MB de RAM y 20 procesos simultáneos no soportan procesos permanentes ni conversiones pesadas en el servidor. Con 35 usuarios, un backend PHP delgado sobra.

### 6.2 Editor
- Basado en **ProseMirror**, vía **TipTap** (núcleo MIT, sin extensiones Pro pagadas).
- Esquema de documento propio que refleja el subconjunto LaTeX del manual: título de capítulo (analito y método), sección, párrafo, lista ordenada y no ordenada anidada, ítem con etiqueta opcional (`label`), referencia (nodo atómico), nota al pie (nodo con contenido propio), matemática en línea y en bloque (nodos atómicos con fuente LaTeX), tabla y bloque especial (nodo atómico con LaTeX crudo).
- Matemática: render con **KaTeX** y edición visual con **MathLive** (ambos MIT).
- **Cada bloque del documento base recibe un ID estable** al importar, para anclar cambios y comentarios.

### 6.3 Modelo de cambios ("control de cambios" sin licencia comercial)
- El laboratorio edita **su propia copia** del documento base, guardada como JSON de ProseMirror.
- La plataforma calcula las diferencias entre el documento base y la copia (por bloque, con diff a nivel de palabras o caracteres dentro de cada bloque; `prosemirror-changeset` u otro equivalente) y las muestra como marcas de inserción y eliminación.
- Al guardar, el cliente extrae **sugerencias discretas** ("hunks"): `{bloque_id, rango en el base, contenido original, contenido propuesto, tipo (contenido/formato)}`. El servidor las guarda como filas, que son la unidad de motivo, resolución, informe y Excel.
- **Revisor:** superpone las sugerencias de todos los laboratorios sobre el documento base. Hay conflicto cuando dos sugerencias de laboratorios distintos tienen rangos que se solapan en el mismo bloque.
- **Versión final:** se aplican las sugerencias aceptadas (y las redacciones del revisor) sobre el documento base, en orden de posición, y se genera el `.tex`.
- Este modelo es el **mayor riesgo técnico** (sección 10) y se valida en la Fase 0.

### 6.4 Conversión LaTeX ↔ documento
- **Importación (navegador del administrador):** parser del subconjunto LaTeX del manual a JSON de ProseMirror. Se puede partir de `@unified-latex` (MIT) o de un parser propio. Todo lo no reconocido se convierte en "bloque especial" con su LaTeX crudo.
- **Exportación:** serializador del JSON a `.tex` con el mismo estilo del original (secciones, `enumerate`, `\label{itm:...}`, `\footnote`, `\[ \]`, `tabular`).
- **Criterio de calidad (ida y vuelta):** para cada capítulo real, `exportar(importar(tex))` debe compilar en el archivo marco y producir el mismo resultado visual. Se aceptan diferencias de espacios en blanco, nunca de contenido ni de estructura. Los 15 capítulos de `manual-fuente/tex/` (fuera de git) son el conjunto de pruebas.
- Se guarda siempre el `.tex` original subido, junto al JSON convertido.

### 6.5 Datos (esquema orientativo)
- `usuarios` (id, laboratorio, nombre, correo cifrado + índice ciego para buscarlo en el login, hash de contraseña, rol, activo, creado).
- `capitulos` (id, orden, slug, título).
- `versiones_capitulo` (id, capitulo_id, tipo: base/final, tex_original, doc_json, creado_por, creado). La versión base es inmutable una vez abierta la consulta.
- `copias_laboratorio` (usuario_id, capitulo_id, doc_json, actualizado). Única por (usuario, capítulo).
- `revisiones_copia` (instantáneas periódicas del borrador, para historial y recuperación).
- `sugerencias` (id, usuario_id, capitulo_id, version_base_id, bloque_id, rango, original, propuesta, tipo, motivo, estado, resuelto_por, resuelto_en, nota_resolucion, derivada_reunion).
- `comentarios` (id, usuario_id, capitulo_id, bloque_id, rango, texto, estado, nota_resolucion, resuelto_por).
- `consulta` (apertura, cierre, motivo_obligatorio).
- `auditoria` (quién, qué, cuándo, sobre qué entidad).
- `intentos_login` (para limitar intentos).
- **Índices:** (usuario_id, capitulo_id) en copias, sugerencias y comentarios; (capitulo_id, estado) en sugerencias y comentarios; FULLTEXT sobre el texto plano de cada capítulo para la búsqueda.

### 6.6 Versionado
- Base inmutable por consulta. Final como versión nueva.
- Borradores de laboratorio con instantáneas (p. ej., cada N minutos de edición o al salir), con retención acotada.
- Auditoría de todas las acciones de resolución.

### 6.7 Caché y rendimiento
- El documento base es inmutable durante la consulta: se cachea en APCu en el servidor y con `ETag`/`Cache-Control` en el navegador.
- Archivos estáticos con hash en el nombre y caché de larga duración. OPcache activo.
- Guardado automático con espera (debounce) y envío de diferencias acotadas, no del documento completo en cada tecla.
- Respuestas de la API recortadas a los campos necesarios (DTO explícitos).

### 6.8 Procesos asíncronos
- Sin colas ni workers. La apertura y el cierre de la consulta se evalúan por fecha en cada petición.
- **Cron Jobs de cPanel** para: envío de correos en lotes, limpieza de instantáneas antiguas y de intentos de login, y respaldo lógico de la base (además de JetBackup del hosting).
- Generar el `.tex` final y los informes ocurre en el navegador del revisor.

### 6.9 Estructura de despliegue
- Subdominio dedicado, p. ej., `manual.renalasch.cl`, con HTTPS.
- Solo `public/` (el `index.php` de entrada, los estáticos compilados y `.htaccess`) queda en la raíz web. Código PHP, `vendor/` y configuración con secretos quedan **fuera de la raíz web** (en el home de la cuenta).
- Las dependencias de Composer van incluidas en el paquete (no hay SSH para ejecutar `composer install`).

## 7. Desarrollo y despliegue **[decisión de Rodrigo: Docker para evitar problemas de despliegue; decisión técnica: solo en desarrollo]**
- **Docker Compose local** que replica el hosting: PHP 8.2 (Apache, con las mismas extensiones) y la misma versión de MySQL/MariaDB (confirmar en phpMyAdmin).
- **Entrega:** un `.zip` listo para subir (estructura de la sección 6.9) y un `.sql` de creación de la base. Coincide con lo que ofreció Fabio ("generes el .sql… y yo los subo").
- Opcional: GitHub Actions que compila, prueba y sube por FTP(S).
- Repositorio: `github.com/rcandiaant/manualmetodos` (solo código). `manual-fuente/` está en `.gitignore`.

## 8. Seguridad

| Requisito (lista de Rodrigo) | Cómo se cumple |
|---|---|
| Esconder API keys | Secretos en un archivo de configuración **fuera de la raíz web** y fuera de git (`.env` en `.gitignore`, `.env.example` versionado). El cliente no recibe secretos. |
| Purgar secretos de git | `gitleaks` en pre-commit y en CI. El repositorio es nuevo, así que no hay historial que purgar. |
| "Public DB key" | No aplica: el navegador nunca se conecta directo a la base; todo pasa por la API PHP. Equivalente: el usuario de base de datos de la app tiene solo los privilegios necesarios. |
| Row-level security | MySQL no la ofrece como Postgres: **toda consulta pasa por una capa de acceso que filtra por el usuario de la sesión**. Un laboratorio no puede leer ni escribir datos de otro aunque manipule IDs. Con pruebas automáticas que lo verifican. |
| Encriptar datos sensibles | Contraseñas con hash. Correos cifrados con `sodium` e índice ciego (HMAC) para buscar en el login. Clave en la configuración fuera de la raíz web. HTTPS obligatorio. |
| Autenticación del lado del servidor | Cada endpoint verifica sesión y rol en el servidor. La UI que oculta botones no es seguridad. |
| Lock record access | Además del filtro por usuario: las sugerencias solo se modifican durante la consulta y por su dueño; las resoluciones, solo los revisores en la etapa de edición final. La base es inmutable. |
| Block field tampering | El servidor nunca acepta `usuario_id`, `rol`, `estado` ni fechas desde el cliente cuando no corresponde. Lista blanca de campos por endpoint. |
| Secure session cookies | Sesión PHP con `Secure`, `HttpOnly`, `SameSite=Lax/Strict`, regeneración de ID al iniciar sesión, expiración por inactividad y token CSRF en cada escritura. |
| Hash passwords | `password_hash` con Argon2id (o bcrypt si el PHP del hosting no tiene Argon2). |
| Rate limit login | Por IP y por cuenta, en la tabla `intentos_login`, con bloqueo temporal progresivo. |
| Bot protection | Campo trampa (honeypot) + límite de intentos. Opcional: Cloudflare Turnstile (implica un servicio externo; decidir). Imunify360 del hosting suma una capa. |
| Validar todas las entradas | Validación de tipos, largos y formatos en cada endpoint. El JSON del documento se valida contra el esquema permitido en el servidor. |
| Escapar contenido de usuarios | Sin HTML crudo en el documento: el esquema de ProseMirror solo admite nodos y marcas conocidos. Escape en toda salida. El LaTeX exportado escapa caracteres especiales (`% & $ # _ { } ~ ^ \`) del texto de usuario. |
| Restringir subida de archivos | Solo el administrador sube `.tex` (extensión y tipo verificados, tamaño máximo, guardado en la base, nunca en una carpeta ejecutable). Los laboratorios no suben archivos. |
| Recortar respuestas de la API | DTO explícitos; nunca se devuelven filas completas ni datos de otros laboratorios. |
| Cabeceras de seguridad | Vía `.htaccess`: `Content-Security-Policy` estricta, `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy` y `frame-ancestors 'none'`. |
| Escanear dependencias | `npm audit`, `composer audit` y Dependabot en GitHub. |

**Recomendado fuera del proyecto:** activar 2FA en la cuenta cPanel de Renalasch y no usar el puerto 2082 (HTTP sin cifrar) para entrar a cPanel.

## 9. Fases y entregables **[decisión técnica, para cuidar el anti-objetivo de costo]**

**Fase 0. Prueba de viabilidad (decide si se sigue):**
- Conversor LaTeX ↔ ProseMirror contra los 15 capítulos reales, con el criterio de ida y vuelta de 6.4.
- Prototipo mínimo del control de cambios (6.3) sobre un capítulo, con dos laboratorios simulados y un conflicto.
- **Si falla:** se informa con evidencia y se evalúan la opción B (sugerencia por bloque) o una alternativa existente (Word o Google Docs con plantilla) antes de invertir más.

**Fase 1. Versión mínima usable:**
- Login, roles, importación de capítulos, edición con control de cambios, comentarios, motivo, guardado automático.
- Vista del revisor con resolución y conflictos, exportación `.tex` final, informe en pantalla e imprimible.
- Paquete de despliegue (`.zip` + `.sql`) y Docker local.

**Fase 2. Complementos (si hay tiempo y se justifican):**
- Correo automático de credenciales (en Fase 1 basta con entregarlas manualmente).
- Exportación a Excel, panel de avance, filtros finos y búsqueda FULLTEXT.
- Despliegue automático por FTP desde GitHub Actions.

## 10. Riesgos

| Riesgo | Mitigación |
|---|---|
| La ida y vuelta LaTeX ↔ editor pierde estructura (refs, notas, tablas, fórmulas) | Fase 0 con capítulos reales; subconjunto acotado; bloque especial para lo desconocido |
| Control de cambios por diferencias produce marcas confusas (p. ej., en tablas o listas reordenadas) | Diff por bloque con ID estable; Fase 0; respaldo a opción B |
| La superposición de muchos laboratorios en la vista del revisor se vuelve ilegible | Filtros y "solo conflictos"; respaldo a bandeja (opción B) |
| Límites del hosting (RAM, procesos, envío de correo) | Backend delgado, trabajo en el navegador, correos en lotes |
| Cambios en los `.tex` después de abrir la consulta | Base congelada; reemplazar un capítulo solo antes de abrir |
| Fechas aún no definidas | Fase 0 primero; Fase 1 dimensionada para lo mínimo |

## 11. Pendientes (no bloquean el inicio)
- Fecha de inicio y duración de la consulta.
- Versión exacta de MySQL/MariaDB (phpMyAdmin) y versiones de PHP disponibles en el selector.
- Lista de laboratorios y de revisores (la entrega Fabio).
- Subdominio definitivo.
- Archivo marco: confirmar que no hay otras macros en uso aparte de `\analito`, `\metodo` y `\degree`.
- Si se usa Cloudflare Turnstile (servicio externo) o solo honeypot + rate limit.

## 12. Decisiones menores tomadas en el diseño **[decisión técnica]**
- **Una sola ronda de consulta.** El modelo de datos (`version_base_id` en las sugerencias) permite una segunda ronda en el futuro sin rediseño.
- **Interfaz solo en español.** Navegadores modernos de escritorio (Chrome, Edge, Firefox, Safari recientes). En móvil basta con lectura.
- **Ítems nuevos agregados por un laboratorio** no reciben `\label` automáticamente. Si hace falta referenciarlos, el revisor les asigna etiqueta en la edición final, con el prefijo del capítulo.
- **El servidor no confía en las sugerencias enviadas por el cliente para nada más que su dueño:** valida que pertenezcan al usuario de la sesión, al capítulo y a la versión base vigente, y que la consulta esté abierta.
- **Los revisores ven el nombre del laboratorio en cada aporte.** Los informes impresos o exportados también lo incluyen; si se requiere anonimizar para la reunión ampliada, se agrega como opción de exportación.

## 13. Lo que queda a criterio de quien construya
- Microframework PHP (o ninguno) y organización interna del backend.
- Framework de UI del cliente alrededor de TipTap.
- Algoritmo concreto de diff dentro de cada bloque y formato exacto del rango de una sugerencia.
- Diseño visual (colores por laboratorio, tipografía), respetando las maquetas aprobadas.
- Herramienta de pruebas y estructura de carpetas del repositorio.
