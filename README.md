# Pocket Faker

Aplicación de escritorio local para desarrollar, observar y evaluar un agente de coaching para League of Legends.

## Arquitectura inicial

- **Tauri 2** contiene la aplicación de escritorio.
- **React + Vite** renderizan la consola visual existente.
- **Rust** administra el ciclo de vida local, las sesiones y la persistencia.
- **SQLite embebido** almacena datos estructurados sin servidor ni Docker.
- **Sistema de archivos local** almacena los replays fuera de la base de datos.
- La integración de captura y modelos de visión queda aislada para una etapa posterior.

El archivo `yolo11x-minimap.pt` existente no forma parte del proceso de compilación actual y no es modificado por la aplicación.

## Desarrollo

```bash
npm install
npm run desktop:dev
```

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
