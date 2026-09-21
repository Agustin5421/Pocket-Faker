import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'

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

function desktopOnly(command, arguments_) {
  if (isDesktopRuntime()) {
    return invoke(command, arguments_)
  }

  return Promise.reject(new Error('This feature is available in the desktop application'))
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

export async function listCaptureSources() {
  return isDesktopRuntime() ? invoke('list_capture_sources') : []
}

export async function getCapturePermissionStatus() {
  return isDesktopRuntime()
    ? invoke('get_capture_permission_status')
    : { supported: false, granted: false, requestedThisLaunch: false, requiresRestart: false }
}

export async function requestCapturePermission() {
  return isDesktopRuntime()
    ? invoke('request_capture_permission')
    : { supported: false, granted: false, requestedThisLaunch: false, requiresRestart: false }
}

export async function getModelInfo() {
  return isDesktopRuntime()
    ? invoke('get_model_info')
    : { sourceExists: false, runtimeExists: false, inputSize: 256, executionProvider: 'Desktop only' }
}

export async function getPipelineStatus() {
  return isDesktopRuntime()
    ? invoke('get_pipeline_status')
    : { phase: 'idle', running: false, modelLoaded: false, source: null, sessionId: null }
}

export async function startCapture(sourceId, confidence, framesPerSecond) {
  return desktopOnly('start_capture', { sourceId, confidence, framesPerSecond })
}

export async function stopCapture() {
  return desktopOnly('stop_capture')
}

function subscribe(eventName, handler) {
  if (!isDesktopRuntime()) {
    return Promise.resolve(() => {})
  }

  return listen(eventName, (event) => handler(event.payload))
}

export function onCaptureFrame(handler) {
  return subscribe('capture-frame', handler)
}

export function onPipelineStatus(handler) {
  return subscribe('pipeline-status', handler)
}

export function onPipelineError(handler) {
  return subscribe('pipeline-error', handler)
}
