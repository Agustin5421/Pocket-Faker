# Pocket Faker

Aplicación de escritorio local para desarrollar, observar y evaluar un agente de coaching para League of Legends.

## Arquitectura inicial

- **Tauri 2** contiene la aplicación de escritorio.
- **React + Vite** renderizan la consola visual existente.
- **Rust** administra el ciclo de vida local, la captura de ventanas, la inferencia ONNX, las sesiones y la persistencia.
- **SQLite embebido** almacena datos estructurados sin servidor ni Docker.
- **Sistema de archivos local** almacena los replays fuera de la base de datos.
- **ONNX Runtime** ejecuta el modelo YOLO bajo demanda. En macOS intenta usar CoreML y conserva CPU como fallback.
- **ScreenCaptureKit** mantiene un stream persistente de la ventana o display en macOS, incluso al cambiar de ventana o Space.
- **xcap** queda aislado como adaptador de captura para futuros builds en otros sistemas operativos.

El archivo `yolo11x-minimap.pt` existente no es modificado por la aplicación ni se incluye en Git. Python se utiliza únicamente para producir el artefacto ONNX; no se necesita un proceso Python durante una sesión.

La interfaz no incluye datos de demostración. Los paneles sin integración muestran explícitamente `Not connected`, `Not implemented` o `No data`; el historial de sesiones consulta SQLite directamente.

## Desarrollo

### 1. Preparar el runtime del modelo

Este paso se ejecuta al recibir una nueva versión del `.pt`, no cada vez que se inicia la aplicación:

```bash
python3 -m venv .model-tools
.model-tools/bin/pip install -r requirements-model.txt
.model-tools/bin/python scripts/export_model.py
```

Esto genera `yolo11x-minimap.onnx` y, según la versión de ONNX, `yolo11x-minimap.onnx.data`. Ambos son artefactos locales ignorados por Git.

### 2. Levantar la aplicación

```bash
npm install
npm run desktop:dev
```

En macOS, Pocket Faker solicita automáticamente una sola vez el permiso de grabación de pantalla. Si el sistema pide reiniciar la aplicación, cerrala por completo y volvé a ejecutar `npm run desktop:dev`. El permiso puede revisarse en **System Settings → Privacy & Security → Screen & System Audio Recording**.

1. Abrí League of Legends.
2. En `Settings → Capture Source`, actualizá las fuentes y seleccioná la ventana de League. Si el juego está en pantalla completa y macOS no expone esa ventana, seleccioná el display donde se ejecuta.
3. Ajustá FPS y confianza.
4. Volvé a `Live` y presioná el botón central para iniciar o detener la sesión.

El modelo y el stream de ScreenCaptureKit se cargan al iniciar la captura. Los frames se comprimen y escriben en un proceso de fondo para no frenar la vista en vivo; si el disco no logra seguir el ritmo, `detections.jsonl` marca ese frame con `recordingDropped: true` en vez de bloquear el pipeline. El panel del minimapa muestra el recorte inferior derecho, el output crudo de YOLO y sus bounding boxes; no genera interpretaciones tácticas.

Para abrir únicamente la interfaz en el navegador:

```bash
npm run dev
```

## Verificación

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
```

En macOS, SQLite se crea dentro del directorio estándar de Application Support. Los replays se reservan en `Movies/Pocket Faker/Replays`; la base de datos conserva únicamente la ruta y los metadatos de cada sesión.

## Alcance actual

- El minimapa se obtiene como un recorte cuadrado del 30% de la altura, anclado abajo a la derecha. Esta estrategia es explícita y podrá sustituirse por calibración cuando se soporten más resoluciones o layouts.
- La captura y YOLO están integrados; el modelo de gameplay, el seguimiento entre frames y el coach todavía permanecen desconectados.
- La interfaz web aislada (`npm run dev`) sirve para revisar el layout, pero el descubrimiento de ventanas, SQLite y la inferencia sólo existen dentro de Tauri.
