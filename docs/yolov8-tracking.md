# Seguimiento de Aatrox con YOLOv8

El seguimiento temporal mantiene una identidad entre frames y ofrece una posición
estimada durante omisiones breves del detector. Se activa por defecto para YOLOv8
y puede desactivarse en Settings → Modelo del personaje → Seguimiento temporal
de Aatrox. Guarde la configuración antes de iniciar la próxima captura.
Los demás backends conservan su comportamiento.

## Asociación y límites

Implementación nativa en Rust inspirada en la asociación de dos etapas de
[ByteTrack](https://arxiv.org/abs/2110.06864), con filtros de Kalman de posición y
velocidad y asignación global húngara por solapamiento y clase. Es una adaptación
propia; no ejecuta el tracker de Ultralytics ni requiere otro modelo o Python.

- Las detecciones que superan la confianza configurada pueden iniciar una identidad.
- Los candidatos débiles, desde min(0,10, umbral configurado), solo recuperan una
  identidad existente; nunca crean una por sí solos.
- Una identidad necesita dos observaciones antes de mostrar posiciones estimadas.
- Las predicciones aparecen hasta 300 ms desde la última observación, con borde
  discontinuo ámbar y etiqueta «estimado». Después desaparecen de la salida.
- El ID se conserva internamente hasta 1000 ms para una posible recuperación con
  detección fuerte. No implica que exista una caja visible durante todo ese tiempo.
- Una nueva sesión, cambio de dimensiones, retroceso del reloj o intervalo entre
  frames mayor que 1000 ms invalida el estado anterior. Los IDs pertenecen a la sesión.
- El cálculo usa tiempo monotónico del frame capturado, no cantidad de frames ni
  duración de inferencia. El costo se registra como `trackingMs`.

No hay reconocimiento de apariencia, compensación de movimiento de cámara ni
garantía de identidad tras teletransportes, saltos grandes o oclusiones largas.
El seguimiento puede conservar brevemente un falso positivo confirmado. Todavía
requiere evaluación con partidas reales anotadas.

## Replay y futuro modelo de habilidades

Cada línea de `detections.jsonl` conserva el frame real y su contexto
(`sessionId`, `frameNumber`, `capturedAt` y ruta del frame), más:

| Campo | Contenido |
| --- | --- |
| `gameplayDetections` | Cajas originales de YOLO que superan el umbral del usuario. |
| `gameplayTrackingCandidates` | Candidatos medidos usados por el tracker, incluidos los débiles. |
| `gameplayTracks` | Cajas filtradas o estimadas con `trackId`, clase y posición normalizada. |
| `characterTrackingEnabled` | Indica si se aplicó este seguimiento al frame. |
| `trackingMs` | Costo del seguimiento, separado de inferencia. |

Cada track indica `state: observed` o `predicted`. Una observación incluye
`confidence` y `detectorDetectionId`, que referencia el ID de su candidato en ese
frame. Una predicción lleva ambos campos en `null`; `lastObservedConfidence` y
`lastObservedAgeMs` describen su última evidencia real. Las cajas observadas del
tracker están suavizadas; la caja original sigue en los candidatos y, si supera
el umbral configurado, también en las detecciones originales.

Para un clasificador temporal de habilidades, agrupe por sesión y `trackId`,
ordene por timestamp y recorte los frames reales usando las cajas del seguimiento.
Conserve estado, confianza, tiempo transcurrido y huecos. Una posición predicha
no confirma presencia ni habilidad: únicamente propone dónde buscar en la imagen
real. No se generan imágenes intermedias ni se implementa todavía el clasificador
o la exportación automática de secuencias. `recordingDropped: true` señala un
frame cuya imagen no se guardó; no debe contarse como una imagen disponible.

## Verificación

Las pruebas Rust cubren pérdida y recuperación, candidatos débiles, expiración
por tiempo, cambios de resolución, cruces y cambios de orden de detecciones,
asignación global e identificación explícita de predicciones en JSON. No miden
precisión sobre gameplay. El build web valida la interfaz; la captura e inferencia
de escritorio requieren Tauri y una partida real.
