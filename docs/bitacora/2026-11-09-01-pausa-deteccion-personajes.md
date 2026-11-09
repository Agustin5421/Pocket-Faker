# BIT-2026-11-09-01 — Pausa de detección de personajes

- **Fecha:** 2026-11-09
- **Estado:** Implementado; validación de captura de escritorio pendiente.
- **Origen:** Cambio de prioridades indicado por Agustín en conversación.

Se pospone la detección de personajes en gameplay y el futuro reconocimiento de animaciones. El reconocimiento de animaciones todavía no estaba implementado. Se mantienen el código, los modelos y la configuración para retomarlos más adelante.

La interfaz oculta controles, cajas y métricas de detección de personajes. El pipeline no carga Aatrox ni YOLOv8 ni inicia SAM 3; tampoco exige sus archivos o checkpoint para iniciar. La captura de gameplay y el modelo del minimapa continúan. Los archivos `src/main.jsx` y `src-tauri/src/pipeline.rs` contienen los interruptores de esta pausa.

La compilación frontend y las pruebas unitarias de Rust se ejecutaron localmente. La captura real con League, permisos de macOS y modelos locales queda pendiente de comprobación manual. Esta decisión corresponde a Pocket Faker y no define el alcance del proyecto de Valorant.
