# Documentación técnica de visión artificial

- **ID:** BIT-2026-11-06-01
- **Fecha de registro:** 2026-11-06
- **Estado:** documentación reconstruida a partir de artefactos locales.
- **Origen:** solicitud del usuario, código de Pocket Faker y registros de ChampionForge.

Se documentaron detector de Aatrox, dataset sintético y detector del minimapa en [visión artificial técnica](../vision-artificial-tecnica.md). No se entrenaron modelos ni ejecutaron evaluaciones nuevas.

El metadato instalado de YOLOv8n declara 20 épocas completas y métricas de validación sintética; la corrida local conservada se detuvo en época 3. Se registraron como evidencias distintas. No se encontró registro completo del entrenamiento final ni evaluación real anotada. Para el minimapa no se pudo reconstruir la generación o partición del dataset a partir de los artefactos revisados.

La observación previa de pérdidas ante efectos sigue siendo cualitativa; véase [BIT-2026-10-30-01](2026-10-30-01-inicio-valorant.md). Pendiente: evaluar ambos detectores con datos reales anotados y recuperar procedencia del modelo y dataset del minimapa.
