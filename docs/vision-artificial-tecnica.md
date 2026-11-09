# Visión artificial: detección de Aatrox y minimapa

Fecha de revisión: 6 de noviembre de 2026. Este documento describe los artefactos y el código disponibles localmente. Los resultados sintéticos no representan una evaluación de precisión sobre partidas reales.

## Componentes

El sistema procesa imágenes capturadas mediante dos detectores independientes:

| Componente | Modelo | Entrada | Objetivo |
|---|---|---|---|
| Personaje | YOLOv8n, una clase | Fotograma completo | Localizar Aatrox mediante cajas y confianza. |
| Minimapa | YOLO11x, multiclase | Recorte del minimapa | Localizar e identificar iconos de campeones. |

Ambos producen detecciones espaciales por fotograma. La selección de YOLOv8n es experimental; existe además un detector anterior de Aatrox, fuera del alcance de esta descripción. El seguimiento temporal de YOLOv8 es una etapa separada del detector.

## Detector de Aatrox: YOLOv8n

El modelo `aatrox-yolov8n-synthetic-v1` tiene una única clase, `0: aatrox`. Predice cajas delimitadoras y confianza para instancias con aspecto de Aatrox. Su entrenamiento utilizó la apariencia base; no identifica skins, habilidades, animaciones ni estados. Las imágenes del dataset contienen como máximo una instancia sintética positiva, aunque el decoder admite múltiples cajas.

### Dataset y particiones

ChampionForge generó `aatrox-yolo-bootstrap-v1` con imágenes de 1280 × 720 píxeles, anotaciones YOLO y máscaras. Cada positivo contiene una instancia sintética; los negativos son capturas sin inserción del personaje objetivo.

| Partición | Imágenes | Positivas | Negativas | Fondos distintos | Videos fuente |
|---|---:|---:|---:|---:|---:|
| Entrenamiento | 4200 (70 %) | 4102 | 98 | 98 | 2 |
| Validación | 900 (15 %) | 856 | 44 | 44 | 1 |
| Prueba | 900 (15 %) | 856 | 44 | 44 | 1 |
| **Total** | **6000** | **5814** | **186** | **186** | **4** |

Cada video completo se asignó a una sola partición; los fondos y renders no se comparten entre ellas. Además, se separaron las fases normalizadas de animación: 0,1/0,5/0,9 para entrenamiento, 0,3 para validación y 0,7 para prueba. Las particiones comparten el mismo modelo 3D, clips y orientaciones: la separación reduce filtraciones directas, pero no convierte la prueba sintética en una evaluación independiente de apariencia real. Las imágenes positivas reutilizan fondos; los negativos están limitados a un fondo único cada uno.

### Generación y anotaciones

1. Se obtuvo el modelo 3D de Aatrox base, skin `266000`, con sus animaciones. ChampionForge usó Blender para renderizar el personaje sobre fondo transparente.
2. Se muestrearon 24 clips, 24 orientaciones separadas por 15° y cinco fases por clip: 2880 poses renderizadas. El nombre de un clip no constituye una etiqueta de habilidad verificada.
3. Se procesaron 239 capturas procedentes de cuatro videos. Tras filtros y revisión visual por un agente, quedaron 186 fondos y 1134 puntos de inserción; la revisión no acredita ausencia exhaustiva de Aatrox ni equivale a revisión humana.
4. SAM 3 propuso regiones de suelo y exclusión. El generador compuso el render sobre cada fondo y rechazó siluetas que tocaban exclusiones o salían de la imagen. No simuló oclusión: rechazó esas combinaciones.
5. La máscara visible del render, incluyendo el arma, permitió derivar automáticamente la caja y las coordenadas YOLO normalizadas `clase centro_x centro_y ancho alto`. Las imágenes negativas no contienen caja objetivo.

Se utilizó cámara ortográfica fija, elevación de 56° y escala de 50 píxeles por unidad, sin calibración exacta respecto de la cámara real. No se simularon partículas, iluminación y shaders propios, sombras de contacto, barras ni oclusiones. El banco de fondos es limitado y no cubre toda la diversidad visual.

La auditoría registrada comprobó integridad de 6000 imágenes, correspondencia entre máscaras y etiquetas y ausencia de filtraciones entre particiones según sus controles. Esto verifica consistencia del dataset, no precisión del modelo.

### Entrenamiento y resultados disponibles

El artefacto instalado se identifica como YOLOv8n entrenado con el dataset anterior. Su metadato indica `trainingComplete: true`, exportación después de 20 épocas y las siguientes métricas de detección registradas en validación sintética:

| Métrica | Valor |
|---|---:|
| Precisión | 0,98158 |
| Recall | 0,99589 |
| mAP@0,50 | 0,99486 |
| mAP@0,50:0,95 | 0,98681 |

Son valores declarados por el metadato del modelo instalado, no una medición nueva. El registro local de ChampionForge corresponde a una corrida anterior detenida por el usuario en la época 3; su checkpoint y métricas no deben confundirse con el modelo final importado desde `Downloads`. No se encontró aquí el registro completo de entrenamiento del artefacto final, por lo que no se atribuyen a este parámetros de hardware o aumentos de la corrida anterior. Tampoco se encontró una evaluación del conjunto de prueba o de gameplay real para el modelo instalado.

### Inferencia y seguimiento

El modelo ONNX recibe RGB `float32` normalizado a [0, 1], formato NCHW `[1, 3, 736, 1280]`. El preprocesamiento aplica *letterbox*: conserva proporciones y rellena con valor 114. La salida `[1, 5, 19320]` contiene coordenadas `xywh` y puntuación de clase, sin NMS integrado. Rust filtra por confianza configurable, transforma cajas al fotograma original y aplica supresión de no máximos con IoU 0,5. ONNX Runtime ejecuta este modelo en CPU.

El seguimiento opcional, activado por defecto para este backend, asocia cajas entre fotogramas mediante filtro de Kalman y asignación global, inspirado en ByteTrack. Detecciones débiles pueden recuperar una identidad existente, sin crear una nueva. Tras dos observaciones, el tracker puede presentar una posición estimada durante hasta 300 ms desde la última detección; conserva el ID internamente hasta 1000 ms. Una predicción es una estimación, no una detección visual. No hay reconocimiento de apariencia ni compensación de cámara.

Una medición documentada con un fotograma guardado de 3024 × 1834 informó 69–86 ms para preparación e inferencia optimizadas, más aproximadamente 38–42 ms para preparar la vista previa. Es una medición puntual, no FPS del sistema completo ni garantía en vivo. El usuario también reportó pérdidas cualitativas ante escudos, buffs e impactos; no existe una tasa medida de estos errores.

## Detector del minimapa: YOLO11x

`yolo11x-minimap.onnx` es un detector distinto de YOLOv8n. Los metadatos del ONNX enumeran 170 clases de campeones, entre ellas Aatrox. Devuelve clase, confianza y caja de los iconos detectados; las coordenadas que expone la aplicación están normalizadas respecto del recorte.

El recorte es un cuadrado en la esquina inferior derecha, de lado igual al 30 % de la altura del fotograma, limitado por su ancho. Se redimensiona a 256 × 256, se convierte a RGB `float32` normalizado y se organiza como `[1, 3, 256, 256]`. La exportación ONNX usa NMS integrado; la aplicación filtra sus salidas por un umbral de confianza independiente del usado para Aatrox. En macOS, ONNX Runtime intenta CoreML y dispone de CPU como alternativa. La regla de recorte supone una ubicación y tamaño determinados del minimapa y puede fallar con otras configuraciones visuales.

El archivo ONNX identifica una configuración de entrenamiento llamada `lol_minimap_256_replay_only.yaml`, pero ese nombre no permite reconstruir por sí solo procedencia, generación, particiones, tamaños o métricas de su dataset. Estos datos no están documentados en los artefactos revisados; no deben extrapolarse del dataset de Aatrox. Tampoco se encontró una evaluación propia del minimapa en este análisis.

## Evidencia y archivos

- [Integración YOLOv8 y medición de latencia](yolov8-aatrox.md); [seguimiento temporal](yolov8-tracking.md).
- [Detector YOLOv8](../src-tauri/src/vision/yolov8.rs), [detector de minimapa](../src-tauri/src/inference.rs), [recorte](../src-tauri/src/capture.rs) y [exportación del minimapa](../scripts/export_model.py).
- [Metadatos del modelo instalado](../models/aatrox-yolov8n-synthetic-v1.json): artefacto local ignorado por Git.
- ChampionForge: [dataset y método](../../ChampionForge/docs/dataset-aatrox-bootstrap.md), [resultado de generación](../../ChampionForge/docs/resultados-aatrox-bootstrap-v1.md), [receta](../../ChampionForge/config/aatrox-detector-recipe.json) y [auditoría](../../ChampionForge/datasets/aatrox-yolo-bootstrap-v1/validation.json). Los datos y resultados locales pueden no acompañar una copia del repositorio.
