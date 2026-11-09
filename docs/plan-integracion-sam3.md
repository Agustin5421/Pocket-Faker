# Plan de integración de SAM 3 en Pocket Faker

Fecha: 2 de octubre de 2026. Estado: primera integración de selector y streaming por texto implementada; inferencia con pesos reales, precisión y latencia todavía no validadas. Véase `sam3-runtime.md` para el alcance entregado. Las correcciones visuales y el entrenamiento descritos aquí siguen pendientes.

## 1. Resultado y alcance

Añadir un selector de análisis de gameplay en Settings con exactamente dos opciones:

| Opción | Gameplay | Minimapa |
| --- | --- | --- |
| Actual — Aatrox ONNX | `aatrox-grid-v1.onnx`, comportamiento existente | YOLO11x actual |
| SAM 3 — Experimental | Detección, segmentación y seguimiento mediante prompts | YOLO11x actual |

El modo actual será el predeterminado para instalaciones existentes. Ambos permanecerán disponibles; solo se cargará el backend de detección del personaje elegido. El selector tendrá alcance exclusivo sobre el personaje en gameplay.

**Restricción obligatoria:** conservar la detección del minimapa sin cambios: modelo YOLO11x, preprocesamiento, umbrales, frecuencia, salida y comportamiento existentes. La integración de SAM 3 no añadirá opciones ni modificará configuración del minimapa.

La primera entrega permitirá localizar un personaje, corregir la selección visualmente y seguirlo. Reconocer Q/W/E/R requiere una etapa temporal posterior y no será presentado como funcionalidad de SAM 3.

## 2. Base documental y elección de runtime

- [Meta: instalación y uso de SAM 3](https://github.com/facebookresearch/sam3): modelo condicionado por texto o indicaciones visuales; checkpoints con acceso autorizado; implementación oficial orientada a CUDA.
- [Transformers: SAM3 Video](https://huggingface.co/docs/transformers/model_doc/sam3_video): sesión persistente, entrada incremental de frames, cajas, máscaras e IDs. Streaming elimina heurísticas que necesitan frames futuros y puede aumentar duplicados y falsos positivos. Bajar resolución puede degradar precisión.
- [Transformers: SAM3](https://huggingface.co/docs/transformers/model_doc/sam3): detección de conceptos con texto y cajas positivas/negativas en imágenes.
- [Transformers: SAM3 Tracker Video](https://huggingface.co/docs/transformers/main/model_doc/sam3_tracker_video): seguimiento de instancias con puntos, cajas o máscaras, también mediante entrada incremental.
- [Ultralytics: predictor SAM 3](https://docs.ultralytics.com/reference/models/sam/predict): alternativa que admite texto y cajas positivas/negativas en su predictor de video. No implica compatibilidad comprobada con MPS.
- [PyTorch: MPS](https://docs.pytorch.org/docs/main/notes/mps.html): ejecución sobre GPU Apple; disponibilidad del dispositivo no garantiza soporte de todos los operadores del modelo.
- [Tauri: sidecars](https://v2.tauri.app/develop/sidecar/): distribución y ejecución de binarios auxiliares por plataforma.
- [Meta: fine-tuning](https://github.com/facebookresearch/sam3/blob/main/README_TRAIN.md): entrenamiento con datasets propios, separado de inferencia y prompting.

Runtime propuesto: worker Python persistente con PyTorch y Transformers, administrado por Rust. Permite usar APIs documentadas de streaming y evaluar MPS. No se presupone exportación ONNX/CoreML de todo SAM 3. La elección definitiva depende de la prueba de compatibilidad de fase 0.

## 3. Fase 0 — Prueba de viabilidad local

Crear `scripts/benchmark_sam3.py` y dependencias opcionales separadas de los exporters existentes. Fijar versiones y revisión del checkpoint que superen las pruebas.

Probar en el Mac de desarrollo:

1. Carga desde archivos locales, detección por texto y seguimiento incremental con `Sam3VideoModel`.
2. Detección por texto más ejemplos positivos/negativos con `Sam3Model`.
3. Seguimiento desde caja o máscara con `Sam3TrackerVideoModel`; validar correspondencia de coordenadas, IDs y sesiones.
4. MPS y CPU con precisión numérica compatible; registrar operadores fallidos, memoria y latencia tras calentamiento.
5. Clips de Aatrox con orientación, cámara, oclusión, desaparición y otros campeones.

Registrar carga inicial, FPS efectivos, latencia p50/p95, consumo de memoria y falsos positivos. Probar resolución nativa primero y reducciones por separado.

**Condición para avanzar:** ejecución local de extremo a extremo y presupuesto de rendimiento documentado. Si MPS falla, evaluar CPU y reportar rendimiento; no añadir inferencia remota ni sustituir SAM 3 por otro modelo automáticamente. Una implementación lenta podrá ofrecerse como experimental, con frecuencia real visible; no se etiquetará como tiempo real sin evidencia.

## 4. Fase 1 — Selector y configuración persistente

Añadir `GameplayBackend = current | sam3` y configuración tipada. Persistir en un archivo versionado dentro del directorio de datos de la aplicación, con escritura atómica y valores predeterminados compatibles.

Settings permitirá elegir backend antes de iniciar captura. El cambio quedará deshabilitado durante una sesión; para aplicar otro modelo se detendrá y reiniciará captura. Esto evita mezclar resultados y estados de seguimiento.

Para SAM 3, configurar checkpoint local, personaje objetivo, texto descriptivo, umbral, frecuencia máxima de análisis y visualización de máscaras. Mostrar estado de preparación y errores concretos: dependencias, checkpoint, permisos o dispositivo no disponibles.

Añadir comandos Tauri `list_vision_backends`, `get_vision_config` y `set_vision_config`. Extender `start_capture` con configuración validada; mantener entrada antigua compatible o migrar todos sus consumidores juntos.

Cambiar `resolve_model_directory`: resolver artefactos independientemente, sin exigir archivos de Aatrox cuando está elegido SAM 3. Si SAM 3 falta, el modo actual debe continuar funcionando sin Python.

## 5. Fase 2 — Adaptador y worker SAM 3

Crear `src-tauri/src/vision/` con contrato común de inicio, procesamiento, actualización de prompts, reset y cierre. Adaptar el detector Aatrox existente sin cambiar su preprocesamiento ni decoder.

Worker propuesto: `scripts/sam3_worker.py`, cargado una vez por sesión SAM 3. Usar IPC local con mensajes versionados de control y transferencia binaria de frames; evitar imágenes base64 y archivos temporales por frame. Logs separados del protocolo, timeouts y tamaños acotados.

Rust será dueño de captura y ciclo de vida. El worker recibirá `sessionId`, `frameId`, timestamps, dimensiones y revisión de prompts; devolverá IDs, puntuaciones, cajas y máscaras opcionales. Gestionar cierre normal, errores, timeout y salida de la aplicación; impedir procesos huérfanos.

No descargar pesos ni instalar dependencias al iniciar captura. Documentar preparación explícita y usar checkpoints locales; no guardar tokens de acceso en configuración o registros.

## 6. Fase 3 — Prompts y seguimiento

Añadir acción “Configurar objetivo” en Live. Pausar la imagen de referencia para dibujar cajas positivas y negativas sobre un frame identificado. Guardar imagen, dimensiones y anotaciones; transformar coordenadas del SVG al frame original.

Separar dos operaciones de usuario:

- **Buscar concepto:** texto para detección automática de objetos coincidentes.
- **Seguir objeto señalado:** caja o máscara para iniciar seguimiento de esa instancia; nombre del personaje será etiqueta asignada por usuario, no una identificación automática demostrada.

Para combinar texto y ejemplos visuales con Transformers, validar puente entre detector de imágenes y tracker de video en fase 0. No asumir que `Sam3VideoProcessor.add_text_prompt` acepta cajas. Alternativa: adaptador Ultralytics si supera las mismas pruebas de macOS y streaming.

Cada cambio de prompt crea una revisión nueva y reinicia el estado necesario. Cajas de referencia no se reutilizarán como coordenadas sobre frames futuros. No asumir que una imagen de referencia arbitraria puede cargarse como una biblioteca permanente de conceptos sin adaptación adicional.

## 7. Fase 4 — Captura, eventos e interfaz

Separar captura y preview del worker lento. SAM 3 consumirá el frame pendiente más reciente, con un máximo de uno pendiente además del que está en procesamiento. Registrar saltos de frames y reiniciar seguimiento tras discontinuidades grandes; comprobar su efecto sobre precisión.

YOLO del minimapa conservará su frecuencia y lógica actuales. Cualquier ajuste de colas o frecuencia quedará limitado al análisis del personaje con SAM 3; verificar que no altera el comportamiento del minimapa. Una falla del worker debe permitir detener sesión y volver al modo actual; ningún fallback silencioso cambiará el modelo seleccionado.

Extender eventos con `backendId`, `modelRevision`, `promptRevision`, `frameId`, tiempos de captura/inferencia y detecciones. `trackId` será opcional para el modelo actual. Las cajas compartirán coordenadas normalizadas; máscaras usarán formato compacto con dimensiones explícitas.

Mostrar resultado sobre su frame correspondiente. Si preview ya avanzó, indicar antigüedad del resultado u ofrecer última imagen analizada; evitar dibujar cajas antiguas como si fueran actuales. Descartar respuestas de sesiones o revisiones anteriores.

Generalizar etiquetas Aatrox en Live para mostrar backend y objetivo elegidos. Añadir máscaras opcionales y métricas de latencia y FPS efectivos. Conservar lectura de replays antiguos; guardar configuración y revisión del modelo en metadatos de sesión.

## 8. Fase 5 — Dataset y ajuste opcional

Comenzar con prompting y un campeón/skin. Preparar un piloto de 50–100 imágenes variadas, cajas y negativos, con evaluación separada por partida. La cantidad es presupuesto experimental, no garantía de precisión.

Si prompting resulta insuficiente, preparar entrenamiento externo conforme a la guía de Meta. Cajas pueden servir para evaluar adaptación de detección; máscaras son necesarias para supervisión de segmentación. No incluir entrenamiento automático dentro de la app en la primera entrega.

Importar checkpoints ajustados solo tras comprobar arquitectura, formato y compatibilidad con el runtime elegido: checkpoint de Meta no se considera intercambiable automáticamente con Transformers.

## 9. Fase 6 — Validación y distribución

Pruebas Rust: selección de backend, validación por artefacto, configuración, transformación de coordenadas, mensajes inválidos, respuestas atrasadas y ciclo de vida del worker. Pruebas de integración con doble de worker, además de smoke tests con SAM 3 real.

Verificación del proyecto: `pnpm run build`, `cargo test --manifest-path src-tauri/Cargo.toml` y `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`.

Validación manual: ambos modos, reinicio de app, cambio de fuente, escala de pantalla, prompts positivos/negativos, oclusión, parada y cierre. Comparar modo actual antes/después usando los mismos frames y umbrales.

Distribución: primero entorno de desarrollo documentado; después empaquetar worker/dependencias por arquitectura según Tauri. Validar instalación limpia, lanzamiento desde app empaquetada y permisos. El backend actual seguirá disponible cuando SAM 3 no esté instalado.

## 10. Criterios de aceptación

- Dos opciones visibles y persistentes; modo actual predeterminado y funcional.
- Minimapa YOLO operativo en ambos modos; artefactos de gameplay validados solo para backend seleccionado.
- SAM 3 devuelve resultados reales con texto y permite iniciar seguimiento desde selección visual.
- Correcciones positivas/negativas tienen prueba de integración; capacidades no soportadas quedan explícitas.
- Sin cajas de otra sesión o frame mostradas como actuales; sin acumulación ilimitada de memoria o frames.
- Metadatos identifican modelo, prompts y rendimiento; sesiones antiguas permanecen legibles.
- Pruebas y app empaquetada verificadas; límites de rendimiento de macOS documentados.

Orden de ejecución: fase 0 → selector y contrato → worker → prompts y seguimiento → interfaz y medición → validación y distribución. Fine-tuning se realiza solo si la evaluación del prompting lo justifica.
