# Repository Guidelines

## Project Structure & Module Organization

Pocket Faker is a League of Legends research prototype. Read `docs/contexto-proyecto.md` for scope and `README.md` for current capabilities. Tracking, action recognition, and coaching remain planned.

- `src/main.jsx`: React console and view state; `src/desktop.js`: Tauri commands and event subscriptions; `src/styles.css`: UI styling.
- `src-tauri/src/`: Rust backend. `capture.rs` and `capture/macos.rs` handle capture; `inference.rs` handles minimap YOLO; `gameplay.rs` handles Aatrox detection; `pipeline.rs` coordinates processing; `storage.rs` manages SQLite sessions.
- `scripts/`: Python model exporters. `public/` and `src-tauri/icons/`: assets. Rust unit tests live alongside modules.

## Build, Test, and Development Commands

- `pnpm install`: install frontend and Tauri CLI dependencies.
- `pnpm run dev`: browser preview on port 1420; desktop services require Tauri.
- `pnpm run desktop:dev`: run the desktop application.
- `pnpm run build`: build the frontend.
- `pnpm run desktop:build`: package the desktop application.
- `cargo test --manifest-path src-tauri/Cargo.toml`: run Rust tests.
- `cargo fmt --manifest-path src-tauri/Cargo.toml -- --check`: check Rust formatting.

## Coding Style & Naming Conventions

Follow existing JavaScript style: two-space indentation, single quotes, no semicolons, camelCase functions, PascalCase React components. Use rustfmt for Rust, snake_case functions, and PascalCase types. No dedicated frontend lint configuration exists. Keep command names and serialized camelCase payloads synchronized across Rust and `src/desktop.js`. Handle rejected promises and release event listeners during cleanup.

## Testing Guidelines

Use Rust's built-in `#[test]` functions inside `#[cfg(test)] mod tests`, with descriptive snake_case names. No frontend test runner or numerical coverage threshold is configured. Add meaningful regression tests for behavior changes. Validate frontend builds and manually check relevant desktop flows; browser preview cannot validate capture, inference, or SQLite.

## Commit & Pull Request Guidelines

History uses imperative subjects, such as `Add Aatrox gameplay detection pipeline`; no formal prefix convention exists. Keep commits focused. PRs should explain changes, validation, and limitations. Link relevant issues and include screenshots for UI changes.

## Configuration & Agent Instructions

Models, recordings, databases, and environment files are ignored; keep them out of commits. See README for model export commands and `POCKET_FAKER_MODEL_DIR`. Preserve existing local changes and show explicit unavailable states instead of fabricated detections.

The `caveman` skill is mandatory for every request. Consult its session-catalog location before responding when available; currently `/Users/agustin/.codex/skills/caveman/SKILL.md`. Once read, keep it active throughout the conversation. Default to `full`, preserve technical accuracy, and follow its clarity exceptions. If unavailable, report briefly and remain concise. Explicit user instructions may change its level or disable it.
