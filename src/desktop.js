import { invoke } from '@tauri-apps/api/core'

const browserAppInfo = {
  appName: 'Pocket Faker',
  version: '0.1.0',
  runtime: 'browser',
  databasePath: 'Available in the desktop application',
  replayDirectory: 'Available in the desktop application',
  storageReady: true,
}

function isDesktopRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

export async function getAppInfo() {
  if (isDesktopRuntime()) {
    return invoke('get_app_info')
  }

  return browserAppInfo
}

export async function listSessions() {
  if (isDesktopRuntime()) {
    return invoke('list_sessions')
  }

  return []
}

export async function createSession(title) {
  if (isDesktopRuntime()) {
    return invoke('create_session', { title })
  }

  throw new Error('Sessions can only be persisted by the desktop application')
}

export async function finishSession(sessionId) {
  if (isDesktopRuntime()) {
    return invoke('finish_session', { sessionId })
  }

  throw new Error('Sessions can only be persisted by the desktop application')
}
