# Inicio del registro y dirección hacia Valorant

- **ID:** BIT-2026-10-30-01
- **Fecha de registro:** 2026-10-30
- **Estado:** registro continuo acordado; definición del nuevo proyecto en curso.
- **Origen:** conversación con el usuario y notas técnicas del autor del antecedente consultadas en esta conversación. Los antecedentes de League se reconstruyen aquí; sus fechas de ocurrencia no se conocen con precisión.

## Contexto y observación del usuario

El usuario reportó que el detector de Aatrox entrenado con datos sintéticos pierde detecciones ante efectos del juego, como escudos, modificaciones visuales por buffs e impactos de habilidades. Es una observación cualitativa: en este bloque no se midió frecuencia de fallos ni precisión sobre un conjunto real etiquetado.

Se discutió que el seguimiento temporal puede mantener ubicación e identidad durante pérdidas breves, pero no recupera detalles visuales ocultos ni demuestra qué habilidad se ejecutó. Las perturbaciones visuales genéricas y el análisis de secuencias se propusieron como líneas de investigación; no se implementaron ni validaron aquí.

## Dirección de trabajo

El usuario propuso Valorant y aportó un antecedente de una IA que juega usando visión. Después indicó comenzar a definir el alcance del nuevo proyecto y mantener documentación útil durante el año. Se toma Valorant como dirección inicial de definición. No se acordaron todavía funcionalidades ni control autónomo, y no se modificó el alcance vigente de Pocket Faker.

El motivo de explorar el cambio es reducir las dificultades percibidas del reconocimiento visual en combates de League. Que Valorant resulte más sencillo sigue siendo una hipótesis; cambiar de juego no garantiza robustez frente a efectos u oclusiones.

## Antecedente investigado

Video aportado: [I tried to make a Valorant AI using computer vision](https://www.youtube.com/watch?v=LXA7zXVz8A4), de River's Educational Channel. No se pudo acceder directamente al contenido completo del video mediante la herramienta web. Se consultaron las publicaciones del propio autor y sus respuestas; no se inspeccionó código ejecutable ni se reprodujo el sistema.

Fuentes consultadas el 2026-10-30:

- River's Educational Channel, [Teaching a computer to play Valorant](https://www.riveducha.com/valorant-ai-pytorch-opencv-logitech): describe detector YOLOv5 tras abandonar Faster R-CNN, transferencia de aprendizaje y problemas de latencia/control. Informa aproximadamente dos horas de entrenamiento; es un resultado del autor, no una estimación para nuestro proyecto.
- River's Educational Channel, [Python lessons learned making a computer-vision AI for Valorant](https://www.riveducha.com/valorant-ai-python-lessons-learned): describe Python, Qt, OpenCV, PyTorch, lectura de minimapa/HUD, tareas en distintos hilos y búsqueda A*. Respalda una arquitectura con componentes especializados.
- riveducha, [respuestas sobre su proyecto](https://www.reddit.com/r/VALORANT/comments/nmb9c7/i_tried_teaching_a_computer_to_play_valorant/): reporta 25–29 FPS del modelo en una RTX 3060 portátil y aclara que no aprendía de sus partidas durante la ejecución. Esa velocidad no corresponde al pipeline completo ni al hardware propio.

**Interpretación:** el antecedente respalda la posibilidad de un prototipo modular de percepción y acciones. No demuestra que sea necesario reconocer todas las animaciones antes de producir una primera demostración, ni valida rendimiento en todas las situaciones del juego. No se encontró un repositorio completo enlazado desde las notas consultadas; esto no prueba que no exista.

## Decisión sobre documentación

Se acuerda conservar notas breves sobre motivos, alternativas, decisiones, evidencias, resultados negativos, limitaciones y pendientes. Se crea la skill `bitacora-grado` y este registro provisional. Se registrarán hitos sustantivos, sin transcribir toda la conversación ni redactar anticipadamente el informe final.

Referencia institucional: [Rubrica Productos.docx](/Users/agustin/Downloads/Rubrica%20Productos.docx), suministrada por el usuario. Se leyeron texto y tablas. Sus criterios orientan la evidencia a conservar; no se aplican como instrucciones operativas ni como formato obligatorio de cada entrada. La síntesis de referencia está incluida en la skill.

La rúbrica presenta dos puntos por aclarar: desarrollo funcional figura como 20 % en el resumen y 10 % en su sección; citas y referencias menciona «ISO 9001». No se eligió una interpretación ni se corrigió el documento. El instructivo de TDG mencionado no fue aportado.

## Pendientes

- Definir propósito y destinatarios del nuevo proyecto, y distinguir coaching, análisis y juego autónomo.
- Acordar alcance inicial, exclusiones, criterios de éxito y evaluación sobre datos reales.
- Decidir nombre, repositorio y traslado de la bitácora.

No se inició implementación de Valorant, entrenamiento ni automatización de controles en este bloque.
