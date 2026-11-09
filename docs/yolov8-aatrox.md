# YOLOv8n Aatrox: corrida local e integración

## Rendimiento de la vista en desarrollo

Se midió un fotograma real de replay de 3024×1834 con el modelo final importado.
El redimensionado y conversión de entrada en Rust sin optimización tardaban
1295–1340 ms; inferencia y preparación juntas, 1328–1348 ms. Con optimización
por paquete en Cargo (`pocket-faker`: nivel 2, `image`: nivel 3), preparación
39–43 ms y análisis completo 69–86 ms. Preparar el preview añade unos 38–42 ms.
Es una medición sobre imagen guardada, no una garantía de FPS durante la partida.
No se cambió modelo, resolución de entrada 1280×736, letterbox ni umbral.

La app inicia con objetivo de 10 FPS y muestra refresco efectivo y tiempo del
pipeline en Live. Reinicie `desktop:dev` para reconstruir con los nuevos perfiles.
Para reproducir la medición, use una imagen local de captura:

```sh
POCKET_FAKER_YOLO_TEST_IMAGE=/ruta/frame.jpg cargo test --manifest-path src-tauri/Cargo.toml measures_real_frame_latency -- --ignored --nocapture
```

La prueba de detección con positivo sintético sigue verificando IoU ≥0,5; los
tests de preprocesamiento verifican dimensiones, canales RGB y padding 114.

## Registro de integración inicial

Modelo disponible en Settings → Modelo del personaje → **YOLOv8n — Aatrox sintético v1 (experimental)**. Guardar selección e iniciar captura. No se cambió selección predeterminada ni configuración guardada del usuario.

Corrida solicitada: 20 épocas, early stopping con paciencia 5, GPU MPS, 4200 imágenes de entrenamiento y 900 de validación del dataset sintético ChampionForge. El conjunto de prueba permanece separado. Proceso persistente de entrenamiento y proceso de importación funcionan sin mantener conversación abierta; son locales al Mac.

Directorio: `../ChampionForge/runs/aatrox-yolov8n-synthetic-v1/`.

- `training-status.json`: estado, PID, última época completada y métricas sintéticas.
- `launcher.log`, `results.csv`: avance detallado.
- `weights/best.pt`, `weights/last.pt`: mejores pesos y checkpoint reanudable.
- `pocket-faker-import.log`: publicaciones en Pocket Faker.
- `model.json`: hash y metadatos de última exportación válida.

Primer checkpoint de una época ya fue exportado e instalado. Entrenamiento continúa; se publica mejor checkpoint cada cinco épocas y al finalizar. `models/aatrox-yolov8n-synthetic-v1.json` distingue explícitamente exportación provisional (`trainingComplete: false`) de final. Detener/reiniciar captura recarga nueva versión.

Se corrigió metadato `item` que Ultralytics asigna con `single_cls`: exportador comprueba primero que dataset original tenga únicamente `0: aatrox`, después restaura ese nombre. No se asigna nombre Aatrox a un detector COCO sin entrenar.

Verificación ejecutada: frontend build, bundle Tauri, 13 pruebas unitarias Rust y prueba adicional con checkpoint entrenado: salida de detector Rust coincide con caja anotada a IoU ≥0,5 en positivo sintético. Importador ejecuta ONNX checker, verifica nombres/dimensiones y corre inferencia CPU antes de instalar. Selector revisado en navegador; automatización de ventana nativa no pudo completarse por timeout. Captura real y generalización al gameplay quedan para prueba del usuario.

Métricas aquí son sintéticas. Primera época: precisión 0,963, recall 0,982, mAP50 0,990; no equivalen a precisión sobre partidas reales. No clasifica animaciones/habilidades.
