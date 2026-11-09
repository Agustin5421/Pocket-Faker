# Pocket Faker

Aplicación de escritorio local para desarrollar, observar y evaluar un agente de coaching para League of Legends.

El [documento de contexto del proyecto](docs/contexto-proyecto.md) describe los objetivos, el alcance y la estrategia experimental de la tesis.

## Arquitectura inicial

- **Tauri 2** contiene la aplicación de escritorio.
- **React + Vite** renderizan la consola visual existente.
- **Rust** administra el ciclo de vida local, la captura de ventanas, la inferencia ONNX, las sesiones y la persistencia.
- **SQLite embebido** almacena datos estructurados sin servidor ni Docker.
- **Sistema de archivos local** almacena los replays fuera de la base de datos.
- **ONNX Runtime** ejecuta el modelo YOLO bajo demanda. En macOS intenta usar CoreML y conserva CPU como fallback.
- El detector de **Aatrox** usa un segundo modelo ONNX sobre el frame completo del juego, con un umbral independiente. No usa el recorte del minimapa.
- El ONNX de Aatrox se ejecuta en CPU por ahora: CoreML rechaza una operación de padding del modelo exportado. El minimapa conserva su configuración CoreML con fallback.
- **ScreenCaptureKit** mantiene un stream persistente de la ventana o display en macOS, incluso al cambiar de ventana o Space.
- **xcap** queda aislado como adaptador de captura para futuros builds en otros sistemas operativos.

El archivo `yolo11x-minimap.pt` existente no es modificado por la aplicación ni se incluye en Git. El modo actual no necesita Python durante una sesión. El backend opcional SAM 3 utiliza un worker Python persistente sobre el frame completo, con prompts de texto y sin entrenamiento. Consulte [preparación y límites de SAM 3](docs/sam3-runtime.md).

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

Exportá también el modelo de Aatrox entrenado en `league-scrapper`:

```bash
# Se puede usar el entorno Python donde se entrenó el modelo.
python -m pip install -r requirements-gameplay-export.txt
python scripts/export_aatrox.py --model /ruta/a/league-scrapper/artifacts/aatrox-grid-v1/best.keras
```

Esto genera `models/aatrox-grid-v1.onnx` (ignorado por Git). La app necesita
ambos ONNX para iniciar el modo actual. En modo SAM 3 necesita el ONNX del minimapa y el checkpoint SAM 3 local; no carga Aatrox ONNX. Para usar otro directorio de modelos,
`POCKET_FAKER_MODEL_DIR` debe apuntar a una carpeta con
`yolo11x-minimap.onnx` y `models/aatrox-grid-v1.onnx`.

### 2. Levantar la aplicación

```bash
npm install
npm run desktop:dev
```

En macOS, Pocket Faker solicita el permiso de grabación de pantalla al iniciar. Si se rechaza, use **Settings → Solicitar permiso** para reintentar o **Abrir ajustes de macOS** para autorizarlo desde el sistema. La app vuelve a consultar el permiso mientras está pendiente y actualiza las fuentes al recuperar el foco. Si macOS solicita reiniciar la aplicación, ciérrela por completo y vuelva a ejecutar `npm run desktop:dev`.

1. Abrí League of Legends.
2. En `Settings → Capture Source`, actualice el listado y seleccione la ventana de League. El selector solo muestra ventanas con “league” en el nombre de la aplicación o en el título, sin distinguir mayúsculas. Si no aparece ninguna, abra el juego; si macOS no expone la ventana en pantalla completa, use el modo ventana o sin bordes.
3. Ajustá FPS y confianza.
4. Volvé a `Live` y presioná el botón central para iniciar o detener la sesión.

La frecuencia objetivo inicial es 10 FPS; puede cambiarse a 1, 2, 5, 10, 15 o 30
FPS en Settings antes de iniciar captura. Live muestra `FPS / PIPELINE`: refresco medido y milisegundos de
procesamiento completo, incluyendo análisis y preparación de previews. El límite
configurado no garantiza esa frecuencia si el hardware tarda más por imagen.
Los mismos tiempos se guardan como `refreshFps` y `processingMs` en el replay.

La compilación de desarrollo optimiza los bucles de imagen y el código del
pipeline conservando símbolos de depuración. Después de cambiar estos perfiles,
reinicie `desktop:dev` para reconstruir el binario; refrescar sólo la página no
actualiza el backend Rust.

El modelo del minimapa, el backend del personaje seleccionado en Settings y el stream de ScreenCaptureKit se cargan al iniciar la captura. El selector ofrece Actual — Aatrox ONNX y SAM 3 — Experimental, conservando el primero como predeterminado.
Cada frame completo pasa al detector de Aatrox; sólo el recorte inferior derecho
pasa a YOLO. Los frames se comprimen y escriben en un proceso de fondo para no
frenar la vista en vivo; si el disco no logra seguir el ritmo,
`detections.jsonl` marca ese frame con `recordingDropped: true` en vez de
bloquear el pipeline. La vista principal dibuja la caja de Aatrox cuando pasa
su umbral. El panel del minimapa conserva sus propias detecciones.

El modelo Aatrox es experimental: en validación sintética logró F1@IoU0,5 de
0,53. Un umbral de 0,50 reduce falsos positivos a costa de más omisiones.
Todavía no se ha validado con juego en vivo.

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
- La captura, YOLO del minimapa y el detector de Aatrox del frame completo están conectados. SAM 3 añade un backend opcional de seguimiento por texto cuya inferencia con pesos reales sigue pendiente de validación local. El coach y el reconocimiento de animaciones permanecen desconectados.
- La interfaz web aislada (`npm run dev`) sirve para revisar el layout, pero el descubrimiento de ventanas, SQLite y la inferencia sólo existen dentro de Tauri.

## YOLOv8 de Aatrox sintético

Settings → **Modelo del personaje → YOLOv8n — Aatrox sintético v1 (experimental)** → Guardar modelo del personaje. Al iniciar próxima captura se carga `models/aatrox-yolov8n-synthetic-v1.onnx`. El detector anterior sigue disponible. Si archivo falta, interfaz indica indisponibilidad y captura falla explícitamente, sin detecciones inventadas. Disponibilidad se actualiza cada cinco segundos al seleccionar YOLOv8 y detener captura.

Entrada RGB float32 NCHW 1280×736, letterbox sin deformar imagen; salida cruda `[1,5,N]`, clase única `0: aatrox`, NMS IoU 0,5 y confianza configurable. Inferencia ONNX Runtime CPU; Python se usa solamente para entrenamiento/exportación. Dataset sintético de ChampionForge: 6000 imágenes, Aatrox base, 24 clips y orientaciones, cámara fija sin calibración exacta. No clasifica habilidades ni acredita precisión real.

YOLOv8 incluye **Seguimiento temporal de Aatrox**, activado por defecto en Settings.
Asigna IDs estables y cubre pérdidas breves con cajas estimadas durante un máximo
de 300 ms; aparecen discontinuas y ámbar. Las detecciones originales se conservan
por separado en cada replay. Guarde la configuración y reinicie la captura para
aplicar cambios. Consulte [seguimiento y datos para habilidades](docs/yolov8-tracking.md).

Corrida local en `../ChampionForge/runs/aatrox-yolov8n-synthetic-v1/`: 20 épocas solicitadas, early stopping tras cinco sin mejora, GPU MPS. `training-status.json`, `launcher.log`, `results.csv` y `weights/{best,last}.pt` registran avance. Entrenamiento e importador corren como procesos independientes de esta conversación. No iniciar otra corrida sobre mismo directorio mientras esté activa.

Exportaciones intermedias después de primera época y cada cinco; final al terminar. Se publica **mejor checkpoint por validación sintética**, no necesariamente última época. Cada exportación conserva metadatos y pasa ONNX checker e inferencia CPU antes de instalarse. La app carga archivo al iniciar captura; para usar versión nueva, detener y volver a iniciar captura.

Importación manual o seguimiento de una corrida, usando entorno YOLO que incluya ONNX/ONNX Runtime:

```sh
../ChampionForge/.yolo-venv/bin/python scripts/import_yolov8.py \
  --run ../ChampionForge/runs/aatrox-yolov8n-synthetic-v1 --watch
```

`models/aatrox-yolov8n-synthetic-v1.json` registra SHA, época de exportación, estado de entrenamiento y límites. `trainingComplete: false` indica checkpoint provisional, aunque sea seleccionable. Métricas sintéticas no deben presentarse como precisión sobre gameplay.
