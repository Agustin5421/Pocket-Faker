# Resumen del Proyecto y Alcance

## 1. Descripción general

El proyecto consiste en el desarrollo de una aplicación de asistencia inteligente para jugadores de **League of Legends**, capaz de analizar una partida en tiempo real utilizando principalmente técnicas de **visión artificial** e **inteligencia artificial**.

El objetivo es construir un sistema que pueda observar lo que ocurre en pantalla, identificar los personajes presentes y reconocer determinadas acciones relevantes realizadas durante la partida, especialmente el uso de habilidades. A partir de esta información, el sistema podrá mantener una representación del estado reciente de la partida y generar observaciones o recomendaciones útiles para el jugador.

La propuesta se plantea principalmente como un proyecto de investigación y desarrollo, donde el principal desafío técnico se encuentra en la interpretación automática del gameplay mediante visión artificial.

---

## 2. Problema

Durante una partida de League of Legends, una gran cantidad de información estratégica depende de eventos que ocurren visualmente dentro del juego.

Por ejemplo, reconocer que un personaje acaba de utilizar una habilidad importante permite inferir que dicha habilidad no estará disponible durante un determinado período de tiempo. Esta información puede modificar decisiones posteriores, como iniciar un combate, realizar un objetivo, rotar hacia otra zona del mapa o adoptar una posición más agresiva.

Aunque parte del estado del juego puede obtenerse mediante información estructurada o interfaces provistas por el propio juego, determinadas acciones relevantes deben ser identificadas directamente a partir de lo que ocurre en pantalla.

El proyecto busca investigar hasta qué punto es posible obtener esta información automáticamente utilizando visión artificial.

---

## 3. Objetivo principal

Desarrollar un prototipo capaz de analizar visualmente una partida de League of Legends en tiempo real y extraer eventos relevantes que posteriormente puedan ser utilizados por un sistema de inteligencia artificial para generar asistencia estratégica.

El foco principal del proyecto estará en la construcción del pipeline de percepción visual necesario para transformar imágenes del juego en información estructurada.

---

## 4. Objetivos específicos

El sistema buscará cubrir progresivamente los siguientes objetivos:

1. Capturar y procesar frames del juego mientras se ejecuta una partida.

2. Detectar los personajes visibles en pantalla mediante modelos de visión artificial.

3. Identificar qué personaje corresponde a cada detección.

4. Analizar una secuencia temporal de imágenes del personaje detectado.

5. Reconocer determinadas animaciones o acciones realizadas por el personaje.

6. Asociar dichas animaciones con eventos del juego, principalmente el uso de habilidades.

7. Mantener un registro temporal de los eventos detectados.

8. Proporcionar esta información a un componente de razonamiento capaz de generar observaciones o recomendaciones relacionadas con el estado de la partida.

9. Mostrar mediante una aplicación de escritorio el funcionamiento interno del sistema, permitiendo visualizar tanto las detecciones realizadas como los comentarios generados.

---

## 5. Arquitectura conceptual

El sistema puede dividirse conceptualmente en cuatro etapas principales.

### Captura

La aplicación obtiene imágenes del gameplay de forma continua.

Estas imágenes constituyen la entrada principal del sistema de visión artificial.

### Percepción visual

Sobre los frames capturados se ejecutan diferentes modelos encargados de detectar los elementos relevantes.

Inicialmente, el sistema debe poder localizar personajes dentro de la imagen. Una vez localizado un personaje, la región correspondiente puede analizarse de manera independiente.

Esta separación permite evitar que un único modelo tenga que interpretar toda la escena y todas las posibles acciones simultáneamente.

### Reconocimiento temporal

Muchas habilidades no pueden identificarse correctamente utilizando solamente una imagen.

La diferencia entre varias acciones puede encontrarse en el movimiento realizado durante una secuencia de frames.

Por este motivo, el reconocimiento de habilidades se plantea como un problema de **reconocimiento de acciones en video**, donde el sistema analiza una pequeña ventana temporal correspondiente al personaje detectado.

El objetivo es clasificar dicha secuencia como una determinada acción, por ejemplo:

- movimiento normal;
- ataque básico;
- habilidad Q;
- habilidad W;
- habilidad E;
- habilidad R.

Las clases concretas dependerán del personaje analizado.

### Razonamiento

Los eventos detectados serán convertidos en información estructurada.

Por ejemplo:

`Twisted Fate -> Ultimate utilizada -> tiempo 14:32`

A partir de esta información, otro componente podrá mantener contexto sobre los eventos recientes de la partida y generar recomendaciones.

La visión artificial, por lo tanto, funciona como el mecanismo encargado de observar el juego, mientras que el componente de inteligencia artificial utiliza las observaciones obtenidas para interpretar la situación.

---

## 6. Aplicación de escritorio

El proyecto incluirá una aplicación que permita visualizar y supervisar el funcionamiento del sistema.

La interfaz está orientada principalmente al desarrollo, experimentación y evaluación del proyecto, más que a constituir inicialmente un producto comercial destinado a jugadores finales.

La aplicación deberá permitir visualizar el gameplay analizado y superponer información proveniente de los modelos de visión artificial, como bounding boxes, personajes detectados, acciones reconocidas y nivel de confianza de las predicciones.

Además, deberá existir una sección destinada a mostrar eventos y comentarios generados por el sistema.

Conceptualmente, la interfaz tendrá dos áreas principales:

**Visualización del gameplay**

Permitirá observar qué está detectando el sistema en cada momento.

**Panel de eventos y razonamiento**

Permitirá inspeccionar las últimas detecciones realizadas y los comentarios generados a partir de ellas.

Esta interfaz funcionará también como herramienta de debugging y evaluación de los modelos.

---

## 7. Dataset

Uno de los desafíos centrales del proyecto será obtener datos suficientes para entrenar los modelos.

La detección de personajes requiere imágenes del juego acompañadas de anotaciones que indiquen la posición y la identidad de cada personaje.

El reconocimiento de habilidades requiere además información temporal, es decir, clips o secuencias de frames etiquetados indicando qué acción está realizando el personaje.

Debido al elevado costo de generar manualmente este tipo de dataset, el proyecto contempla investigar estrategias de generación automática o semiautomática de datos.

Entre ellas se encuentra la posibilidad de generar datos sintéticos a partir de modelos y animaciones de los personajes, siguiendo aproximaciones similares a las utilizadas en proyectos previos de detección de campeones.

Los datos sintéticos podrían posteriormente combinarse con imágenes reales del juego para mejorar la capacidad de generalización del modelo.

---

## 8. Alcance inicial

El objetivo del proyecto no es resolver desde el comienzo el reconocimiento de todas las habilidades de todos los personajes de League of Legends.

El desarrollo se realizará de manera incremental.

La primera etapa buscará validar la arquitectura completa utilizando una cantidad limitada de personajes.

Por ejemplo, el sistema podría comenzar trabajando con uno o varios campeones seleccionados y detectar:

- presencia del personaje;
- posición dentro de la pantalla;
- algunas de sus animaciones principales;
- uso de determinadas habilidades.

Una vez validado el funcionamiento del pipeline, se podrá analizar la escalabilidad de la solución hacia un conjunto mayor de personajes.

Por lo tanto, el principal objetivo académico no será necesariamente alcanzar cobertura completa del juego, sino demostrar que la metodología propuesta permite detectar de forma suficientemente confiable eventos relevantes del gameplay.

---

## 9. Fuera de alcance

En una primera versión del proyecto no se plantea:

- reconocer necesariamente todos los campeones existentes;
- detectar todas las posibles animaciones del juego;
- reconstruir completamente el estado interno de una partida;
- desarrollar un sistema capaz de jugar automáticamente;
- controlar el personaje del jugador;
- generar inputs automáticos hacia el juego;
- reemplazar completamente la toma de decisiones del jugador.

El sistema se limita a **observar, interpretar y proporcionar asistencia**.

El jugador continúa siendo responsable de ejecutar todas las acciones dentro del juego.

---

## 10. Principal desafío técnico

El mayor desafío del proyecto se encuentra en el reconocimiento visual de las acciones de los personajes.

Detectar que un personaje está presente dentro de una imagen puede abordarse mediante técnicas tradicionales de detección de objetos.

Reconocer qué habilidad está utilizando representa un problema considerablemente más complejo.

Una misma habilidad puede verse diferente dependiendo de factores como:

- orientación del personaje;
- posición de la cámara;
- skins;
- efectos visuales;
- resolución;
- otros personajes presentes;
- efectos de partículas;
- superposición de elementos;
- diferentes momentos de una misma animación.

Además, una imagen aislada puede no contener información suficiente para identificar la acción.

Por este motivo, el proyecto considera el problema como una combinación de:

**detección espacial + análisis temporal.**

Primero se identifica dónde se encuentra el personaje y posteriormente se analiza su comportamiento durante una secuencia de frames.

---

## 11. Estrategia experimental

El desarrollo seguirá una estrategia incremental.

En una primera etapa se buscará reproducir o adaptar técnicas existentes de detección de personajes para comprender las limitaciones del problema.

Posteriormente se seleccionará un personaje como caso de estudio y se construirá un dataset que contenga diferentes animaciones.

Sobre este dataset se evaluarán modelos de reconocimiento de acciones en video.

Las métricas obtenidas permitirán determinar si el enfoque resulta viable.

En caso de obtener resultados satisfactorios, se incorporarán progresivamente nuevos personajes y nuevas habilidades.

Finalmente, los eventos detectados se integrarán con el componente de razonamiento y con la aplicación de escritorio.

---

## 12. Flujo esperado del sistema

El funcionamiento general puede representarse mediante el siguiente pipeline:

**Gameplay**

↓

**Captura de frames**

↓

**Detección de personajes**

↓

**Recorte y seguimiento del personaje**

↓

**Secuencia temporal de frames**

↓

**Modelo de reconocimiento de acciones**

↓

**Detección de habilidad**

↓

**Registro del evento**

↓

**Estado contextual de la partida**

↓

**Sistema de razonamiento**

↓

**Observación o recomendación para el jugador**

Este pipeline permite separar el problema en componentes relativamente independientes y facilita tanto el desarrollo como la evaluación de cada etapa.

---

## 13. Resultado esperado

El resultado final esperado es un prototipo funcional que demuestre la posibilidad de construir un sistema capaz de observar una partida de League of Legends y transformar determinados eventos visuales en información estructurada utilizable por un agente inteligente.

Una demostración satisfactoria podría consistir, por ejemplo, en ejecutar una partida o grabación y observar cómo la aplicación:

1. detecta correctamente determinados personajes;
2. realiza seguimiento de ellos durante algunos segundos;
3. identifica el uso de una habilidad;
4. registra el evento;
5. actualiza el contexto de la partida;
6. genera una observación relacionada con dicho evento.

La contribución principal del proyecto estará en la investigación y construcción de este pipeline de percepción y razonamiento aplicado al análisis de videojuegos en tiempo real.

---

## 14. Alcance de la tesis

En términos académicos, el proyecto busca responder principalmente la siguiente pregunta:

**¿Es posible utilizar técnicas modernas de visión artificial y reconocimiento temporal de acciones para identificar automáticamente habilidades utilizadas por personajes de League of Legends a partir exclusivamente del gameplay visible en pantalla?**

La tesis buscará responder esta pregunta mediante el diseño de una arquitectura, la generación de datasets, el entrenamiento de modelos, la experimentación y la evaluación de sus resultados.

El valor del proyecto no dependerá exclusivamente de alcanzar una cobertura completa del juego, sino de establecer una metodología reproducible y evaluar experimentalmente sus posibilidades, limitaciones y capacidad de escalamiento.