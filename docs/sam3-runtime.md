# SAM 3 sin entrenamiento

Esta integración añade un segundo backend para el **personaje en gameplay**. El selector está en **Settings → Modelo del personaje**. `Actual — Aatrox ONNX` sigue siendo el valor predeterminado. Modelo, recorte, umbral y lógica del minimapa permanecen iguales.

## Preparación local

El modo actual no requiere Python. SAM 3 requiere un entorno separado y un checkpoint oficial compatible con Transformers:

```bash
uv venv --python 3.12 .sam3-venv
uv pip install --python .sam3-venv/bin/python -r requirements-sam3.lock.txt
.sam3-venv/bin/python -c 'from transformers import Sam3VideoModel, Sam3VideoProcessor; print(Sam3VideoProcessor.init_video_session)'
```

El archivo lock registra versiones instaladas para verificar imports y firmas de API en macOS. Todavía no acredita precisión, latencia ni compatibilidad completa de operadores MPS con pesos reales.

Obtenga acceso al checkpoint en [facebook/sam3](https://huggingface.co/facebook/sam3), siguiendo sus condiciones de acceso. Después de autorizar su cuenta, puede preparar una copia local fuera de la captura:

```bash
.sam3-venv/bin/hf auth login
.sam3-venv/bin/hf download facebook/sam3 --local-dir models/sam3
```

No comparta tokens ni los añada a la configuración. El worker carga con `local_files_only=True` y modo offline; iniciar captura no descarga pesos ni instala paquetes. Use un snapshot Transformers completo, no un archivo `.pt` aislado.

## Configuración y uso

1. Detenga la captura y seleccione **SAM 3 — Experimental (sin entrenamiento)**.
2. Indique la ruta absoluta de `.sam3-venv/bin/python` y del checkpoint local.
3. Describa el personaje en el prompt, preferentemente en inglés. Ejemplo: `red armored warrior with a large sword`. Ajuste la descripción a la skin; este texto no garantiza identificar Aatrox.
4. Configure la etiqueta del objetivo, dispositivo y frecuencia máxima. MPS es experimental; CPU se selecciona expresamente, sin fallback automático.
5. Guarde la configuración e inicie captura. Los ajustes también se guardan al iniciar.

La configuración del personaje se persiste en `character-vision.json`, dentro del directorio de datos de la aplicación. El selector queda bloqueado durante captura. El umbral del personaje continúa siendo independiente del minimapa y mantiene el comportamiento anterior de configuración por sesión.

SAM 3 recibe frames sucesivos en una sesión persistente. Un thread separado mantiene como máximo un frame pendiente, reemplazándolo por el más reciente. Su latencia no bloquea la llamada de inferencia del minimapa; ambos pueden competir por recursos de hardware. La frecuencia máxima del personaje está limitada también por la frecuencia de captura existente.

La vista del personaje muestra el fotograma que SAM 3 realmente analizó, con sus cajas e instante de captura. El minimapa continúa mostrando los frames de captura. Una pausa superior a cinco segundos, un cambio de resolución o 60 frames procesados reinician la memoria; los IDs se interpretan junto con `trackEpoch` y `sessionId`.

Los errores del worker aparecen en Live y detienen ese backend, conservando la captura y el minimapa. Un directorio de checkpoint ausente se rechaza antes de iniciar. Detenga captura para corregir configuración o seleccionar el modelo actual. Carga e inferencia tienen timeout de 180 segundos; Stop termina el proceso sin esperar ese timeout.

## Registro y distribución

Cada replay incluye `character-config.json`. Los frames del minimapa y del modo actual conservan `detections.jsonl`; SAM 3 registra sus resultados asíncronos en `character-detections.jsonl`, asociados al número de frame, y diagnóstico en `sam3-worker.log`. Un frame cuyo JPEG se descartó por disco lento puede tener resultado de SAM 3 sin imagen archivada; consulte `recordingDropped` en el registro principal.

El script Python está embebido en el binario Rust y se escribe en el cache al usar SAM 3. En instalaciones empaquetadas, Python y el checkpoint siguen siendo requisitos externos que deben configurarse con rutas absolutas; esta entrega no distribuye esos artefactos.

## Verificación y límites

```bash
npm run build
cargo test --manifest-path src-tauri/Cargo.toml
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
python3 scripts/test_sam3_worker.py
# Pruebas opcionales con los ONNX existentes:
cargo test --manifest-path src-tauri/Cargo.toml loads_and_runs_local_ -- --ignored
```

Las pruebas del worker usan APIs simuladas para verificar framing binario, coordenadas, continuidad y reinicio ante saltos. No sustituyen una prueba con pesos reales. Aún pendientes: precisión en Aatrox, p50/p95, FPS efectivos, consumo de memoria, estabilidad MPS e instalación en un Mac limpio.

Esta entrega usa **prompts de texto y cajas de salida con IDs**. El modelo calcula máscaras internamente, pero la aplicación todavía no las presenta. Correcciones por cajas positivas/negativas, evaluación con el dataset existente y reconocimiento de animaciones quedan para siguientes etapas. No se entrenó ningún modelo.

## Fuentes oficiales

- [Transformers: SAM 3 Video, streaming y límites](https://huggingface.co/docs/transformers/model_doc/sam3_video).
- [Meta: SAM 3 y acceso a checkpoints](https://github.com/facebookresearch/sam3).
- [PyTorch: dispositivo MPS](https://docs.pytorch.org/docs/main/notes/mps.html).
