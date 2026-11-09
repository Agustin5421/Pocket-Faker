import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, Bell, Bot, Box, BrainCircuit, ChevronDown, ChevronRight, CircleDot,
  ClipboardCheck, Clock3, Crosshair, Database, Eye, FileCode2, Gauge, Gamepad2,
  History, Inbox, Play, Radio, Search, Settings, ShieldAlert, SlidersHorizontal, Wifi, Zap,
} from 'lucide-react'
import {
  defaultVisionConfig, getVisionConfig, setVisionConfig, onCharacterFrame, onCharacterStatus,
  getAppInfo, getCapturePermissionStatus, getModelInfo, getPipelineStatus,
  listCaptureSources, listSessions, onCaptureFrame, onPipelineError, onPipelineStatus,
  openCapturePermissionSettings, requestCapturePermission, startCapture, stopCapture,
} from './desktop'
import './styles.css'

// Character analysis is paused while its implementation remains available.
const CHARACTER_DETECTION_ENABLED = false

const NAV = [
  ['Live', Radio],
  ['Sessions', History],
  ['Evaluations', ClipboardCheck],
  ['Prompts', FileCode2],
  ['Settings', Settings],
]

const EMPTY_CONFIG = {
  captureSource: '',
  captureMethod: '',
  display: '',
  frameRate: '',
  captureAudio: false,
  model: '',
  device: '',
  precision: '',
  inputSize: '',
  confidence: 0,
  tracking: false,
  coachModel: '',
  responseMode: '',
  responseLength: '',
  cooldown: '',
  voiceOutput: false,
  includeConfidence: false,
}

function BrandMark() {
  return <div className="brand-mark">PF</div>
}

function App() {
  const [view, setView] = useState('Live')
  const [appInfo, setAppInfo] = useState({ runtime: 'browser', storageReady: false, version: '0.1.0' })
  const [storageStatus, setStorageStatus] = useState('CHECKING STORAGE')
  const [sources, setSources] = useState([])
  const [selectedSourceId, setSelectedSourceId] = useState('')
  const [modelInfo, setModelInfo] = useState(null)
  const [pipelineStatus, setPipelineStatus] = useState({ phase: 'idle', running: false, modelLoaded: false, source: null, sessionId: null })
  const [frame, setFrame] = useState(null)
  const [pipelineError, setPipelineError] = useState('')
  const [confidence, setConfidence] = useState(0.35)
  const [gameplayConfidence, setGameplayConfidence] = useState(0.5)
  const [framesPerSecond, setFramesPerSecond] = useState(10)
  const [visionConfig, setVisionConfigState] = useState(defaultVisionConfig)
  const [visionConfigLoaded, setVisionConfigLoaded] = useState(false)
  const [savingVisionConfig, setSavingVisionConfig] = useState(false)
  const [capturePending, setCapturePending] = useState(false)
  const [characterFrame, setCharacterFrame] = useState(null)
  const [characterStatus, setCharacterStatus] = useState(null)
  const [visionConfigMessage, setVisionConfigMessage] = useState('')
  const [capturePermission, setCapturePermission] = useState({ supported: false, granted: false, requestedThisLaunch: false, requiresRestart: false })

  const sourceRefreshInFlight = useRef(false)
  const activeSessionId = useRef(null)
  const [requestingPermission, setRequestingPermission] = useState(false)

  useEffect(() => {
    getAppInfo()
      .then((info) => {
        setAppInfo(info)
        const runtimeReady = info.runtime === 'desktop' && info.storageReady
        setStorageStatus(runtimeReady ? 'SQLITE READY' : 'BROWSER PREVIEW')
      })
      .catch(() => {
        setStorageStatus('STORAGE ERROR')
      })
  }, [])

  const refreshSources = useCallback(async () => {
    if (sourceRefreshInFlight.current === false) {
      sourceRefreshInFlight.current = true
      try {
        const permission = await getCapturePermissionStatus()
        setCapturePermission(permission)
        const canDiscover = permission.supported === false || permission.granted
        const available = canDiscover ? await listCaptureSources() : []
        const discovered = available.filter((source) =>
          source.sourceType === 'window' &&
          `${source.appName || ''} ${source.title || ''}`.toLowerCase().includes('league'),
        )
        setSources(discovered)
        setPipelineError('')
        setSelectedSourceId((current) => {
          const currentExists = discovered.some((source) => String(source.id) === String(current))
          const preferred = discovered.find((source) => source.isLeague) || discovered[0]
          return currentExists ? current : preferred ? String(preferred.id) : ''
        })
      } catch (reason) {
        setPipelineError(String(reason))
      } finally {
        sourceRefreshInFlight.current = false
      }
    }
  }, [])

  const handlePermissionRequest = async () => {
    setRequestingPermission(true)
    try {
      const permission = await requestCapturePermission()
      setCapturePermission(permission)
      if (permission.supported && permission.granted === false) {
        await openCapturePermissionSettings()
      }
      await refreshSources()
    } catch (reason) {
      setPipelineError(String(reason))
    } finally {
      setRequestingPermission(false)
    }
  }

  const handlePermissionSettings = async () => {
    try {
      await openCapturePermissionSettings()
    } catch (reason) {
      setPipelineError(String(reason))
    }
  }

  useEffect(() => {
    const refresh = () => { refreshSources().catch((reason) => setPipelineError(String(reason))) }
    window.addEventListener('focus', refresh)
    // Permission dialogs and System Settings can grant access after the request resolves.
    const timer = capturePermission.supported && capturePermission.granted === false
      ? window.setInterval(refresh, 2000)
      : null
    return () => {
      window.removeEventListener('focus', refresh)
      if (timer !== null) window.clearInterval(timer)
    }
  }, [capturePermission.supported, capturePermission.granted, refreshSources])

  useEffect(() => {
    let active = true
    const unlisteners = []
    Promise.all([getModelInfo(), getPipelineStatus(), requestCapturePermission(), CHARACTER_DETECTION_ENABLED ? getVisionConfig() : Promise.resolve(defaultVisionConfig)])
      .then(async ([model, status, permission, savedConfig]) => {
        if (active) {
          setVisionConfigState(savedConfig)
          setVisionConfigLoaded(true)
          setModelInfo(model)
          activeSessionId.current = status.running ? status.sessionId : null
          setPipelineStatus(status)
          setCapturePermission(permission)
          await refreshSources()
        }
      })
      .catch((reason) => active && setPipelineError(String(reason)))

    ;[
      onCharacterFrame((nextFrame) => {
        if (active && nextFrame.sessionId === activeSessionId.current) setCharacterFrame(nextFrame)
      }),
      onCharacterStatus((status) => {
        if (active && status.sessionId === activeSessionId.current) setCharacterStatus(status)
      }),
      onCaptureFrame((nextFrame) => active && setFrame(nextFrame)),
      onPipelineStatus((status) => {
        if (active) {
          activeSessionId.current = status.running ? status.sessionId : null
          setPipelineStatus(status)
        }
      }),
      onPipelineError((error) => active && setPipelineError(String(error))),
    ].forEach((subscription) => subscription
      .then((unlisten) => active ? unlisteners.push(unlisten) : unlisten())
      .catch((reason) => active && setPipelineError(String(reason))))

    return () => {
      active = false
      unlisteners.forEach((unlisten) => unlisten())
    }
  }, [refreshSources])

  const updateVisionConfig = (key, value) => {
    setVisionConfigState((current) => ({ ...current, [key]: value }))
    setVisionConfigMessage('Cambios pendientes de guardar')
    setCharacterFrame(null)
    setCharacterStatus(null)
  }

  useEffect(() => {
    let active = true
    const refreshModelInfo = () => getModelInfo()
      .then((info) => { if (active) setModelInfo(info) })
      .catch((reason) => { if (active) setPipelineError(String(reason)) })
    refreshModelInfo()
    window.addEventListener('focus', refreshModelInfo)
    const timer = visionConfig.backend === 'yolov8' && !pipelineStatus.running
      ? window.setInterval(refreshModelInfo, 5000)
      : null
    return () => {
      active = false
      window.removeEventListener('focus', refreshModelInfo)
      if (timer !== null) window.clearInterval(timer)
    }
  }, [visionConfig.backend, pipelineStatus.running])

  const saveVisionConfig = async () => {
    setSavingVisionConfig(true)
    try {
      const saved = await setVisionConfig(visionConfig)
      setVisionConfigState(saved)
      setVisionConfigMessage('Configuración del personaje guardada')
    } catch (reason) {
      setPipelineError(String(reason))
    } finally {
      setSavingVisionConfig(false)
    }
  }

  const handleCapture = async () => {
    setCapturePending(true)
    try {
      setPipelineError('')
      if (pipelineStatus.running) {
        setPipelineStatus(await stopCapture())
      } else {
        if (!selectedSourceId) throw new Error('Select a capture source in Settings first')
        if (CHARACTER_DETECTION_ENABLED) {
          if (visionConfigLoaded === false) throw new Error('Espere a que se cargue la configuración del personaje')
          await setVisionConfig(visionConfig)
        }
        setFrame(null)
        setCharacterFrame(null)
        setCharacterStatus(null)
        setPipelineStatus(await startCapture(selectedSourceId, confidence, gameplayConfidence, framesPerSecond))
      }
    } catch (reason) {
      setPipelineError(String(reason))
    } finally {
      setCapturePending(false)
    }
  }

  const vision = {
    capturePending,
    appInfo, sources, selectedSourceId, setSelectedSourceId, modelInfo, pipelineStatus,
    visionConfig, visionConfigLoaded, updateVisionConfig, saveVisionConfig, savingVisionConfig, visionConfigMessage, characterFrame, characterStatus,
    frame, pipelineError, confidence, setConfidence, gameplayConfidence, setGameplayConfidence, framesPerSecond, setFramesPerSecond,
    capturePermission, requestingPermission, handlePermissionRequest, handlePermissionSettings, refreshSources, handleCapture,
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><BrandMark /><div><b>Pocket Faker</b><small>Development console</small></div></div>
        <nav>
          <p className="nav-label">WORKSPACE</p>
          {NAV.map(([label, Icon]) => (
            <button className={view === label ? 'active' : ''} onClick={() => setView(label)} key={label}>
              <Icon size={17} strokeWidth={1.8}/><span>{label}</span>{label === 'Live' && <i />}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div className="device-status"><span className={appInfo.runtime === 'desktop' && appInfo.storageReady ? 'pulse-dot' : 'pulse-dot offline'}/><div><strong>LOCAL CORE</strong><small>{storageStatus}</small></div></div>
          <div className="version">BUILD {appInfo.version} <span>DEV</span></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{view}</strong></div>
          {view === 'Live' && <SessionStatus status={pipelineStatus} frame={frame} />}
          <div className="top-actions"><button aria-label="Notifications"><Bell size={17}/></button><div className="operator"><span>AD</span><div><b>Developer</b><small>Local workspace</small></div><ChevronDown size={14}/></div></div>
        </header>

        {view === 'Live' && <LiveView onOpenPrompts={() => setView('Prompts')} vision={vision} onOpenSettings={() => setView('Settings')} />}
        {view === 'Sessions' && <SessionsView />}
        {view === 'Evaluations' && <EvaluationsView />}
        {view === 'Prompts' && <PromptsView />}
        {view === 'Settings' && <SettingsView vision={vision} />}
      </main>
    </div>
  )
}

function SessionStatus({ status, frame }) {
  const active = status.running
  return <div className="session-status">
    <span className={`live-light ${active ? '' : 'paused'}`} />
    <b>{active ? status.phase.replace('-', ' ') : 'No active session'}</b>
    <span className="divider" />
    <Clock3 size={14}/><strong>{frame ? `FRAME ${frame.frameNumber}` : '—'}</strong>
    <span className="divider" />
    <small>SESSION {status.sessionId ? status.sessionId.slice(0, 8) : '—'}</small>
  </div>
}

function LiveView({ onOpenPrompts, onOpenSettings, vision }) {
  const { frame, pipelineStatus, pipelineError, modelInfo, selectedSourceId, handleCapture } = vision
  const source = pipelineStatus.source || vision.sources.find((item) => String(item.id) === String(selectedSourceId))
  const running = pipelineStatus.running
  const sam3 = vision.visionConfig.backend === 'sam3'
  const selectedModel = modelInfo?.characterModels?.find((model) => model.id === vision.visionConfig.backend)
  const samFrame = vision.characterFrame?.sessionId === pipelineStatus.sessionId ? vision.characterFrame : null
  const characterFrame = sam3 ? samFrame : frame?.backendId === vision.visionConfig.backend ? frame : null
  const tracked = !sam3 && characterFrame?.characterTrackingEnabled === true
  const characterBoxes = (tracked ? characterFrame?.gameplayTracks : characterFrame?.gameplayDetections) || []
  const predictedCount = tracked ? characterBoxes.filter((box) => box.state === 'predicted').length : 0
  const status = vision.characterStatus?.sessionId === pipelineStatus.sessionId ? vision.characterStatus : null
  const characterName = sam3 ? 'SAM 3' : vision.visionConfig.backend === 'yolov8' ? 'AATROX · YOLOv8' : 'AATROX'
  return <div className="live-layout page-enter">
    <section className="gameplay panel">
      <div className="panel-head">
        <div><span className="eyebrow">PRIMARY INPUT</span><h2>GAMEPLAY FEED <small>01</small></h2></div>
        <div className="feed-controls">
          {CHARACTER_DETECTION_ENABLED && <span className="raw-output-badge">{characterName} · {sam3 ? 'SEGUIMIENTO EXPERIMENTAL' : tracked ? 'SEGUIMIENTO TEMPORAL' : 'RAW MODEL OUTPUT'}</span>}
          <button className="icon-button" onClick={onOpenSettings} aria-label="Open capture settings"><SlidersHorizontal size={15}/></button>
        </div>
      </div>
      <div className={`game-window ${frame ? 'active-capture' : 'empty-capture'}`}>
        {!CHARACTER_DETECTION_ENABLED && frame ? <img className="gameplay-frame" src={frame.fullFrameDataUrl} alt="Gameplay capturado" /> : CHARACTER_DETECTION_ENABLED && characterFrame ? <svg className="gameplay-frame" viewBox={`0 0 ${characterFrame.frameWidth} ${characterFrame.frameHeight}`} role="img" aria-label="Personaje detectado en el fotograma analizado">
          <image href={characterFrame.fullFrameDataUrl} width={characterFrame.frameWidth} height={characterFrame.frameHeight} />
          {characterBoxes.map((detection) => <g key={`${characterFrame.trackEpoch || 0}:${tracked ? detection.trackId : detection.id}`}>
            <rect className={`gameplay-detection-box ${detection.state === 'predicted' ? 'predicted-track' : ''}`} x={detection.x * characterFrame.frameWidth} y={detection.y * characterFrame.frameHeight} width={detection.width * characterFrame.frameWidth} height={detection.height * characterFrame.frameHeight} />
            <text className="gameplay-detection-label" fontSize={Math.max(18, characterFrame.frameWidth / 65)} x={detection.x * characterFrame.frameWidth} y={Math.max(18, detection.y * characterFrame.frameHeight - 7)}>{detection.label}{tracked ? ` #${detection.trackId}` : ''} · {detection.state === 'predicted' ? `estimado (${detection.lastObservedAgeMs} ms)` : `${Math.round(detection.confidence * 100)}%`}</text>
          </g>)}
        </svg> :
          <EmptyState icon={Gamepad2} title={running ? sam3 ? 'Esperando análisis de SAM 3…' : 'Starting capture…' : 'No captured frame'} text={source ? 'Press start to load the model and begin recording.' : 'Choose the League of Legends window in Settings.'} compact />}
        <div className="feed-corners"><i/><i/><i/><i/></div>
        <div className={`rec-chip ${running ? '' : 'idle'}`}><span /> {running ? 'RECORDING LOCALLY' : 'NOT RECORDING'}</div>
        {CHARACTER_DETECTION_ENABLED && <div className="model-chip">{sam3 ? status?.phase === 'error' ? 'SAM 3 ERROR' : status?.phase === 'ready' ? 'SAM 3 ACTIVO' : 'SAM 3 EXPERIMENTAL' : pipelineStatus.gameplayModelLoaded ? `${characterName} ACTIVE` : selectedModel?.runtimeExists ? `${characterName} READY` : `${characterName} MODEL MISSING`}</div>}
        <button className="pause-button" onClick={handleCapture} disabled={vision.capturePending || CHARACTER_DETECTION_ENABLED && vision.savingVisionConfig || !running && (!selectedSourceId || CHARACTER_DETECTION_ENABLED && !vision.visionConfigLoaded)} aria-label={running ? 'Stop capture' : 'Start capture'}>
          {running ? <span className="stop-symbol" /> : <Play size={19} fill="currentColor"/>}
        </button>
      </div>
      {pipelineError && <div className="pipeline-error">{pipelineError}</div>}
      {CHARACTER_DETECTION_ENABLED && sam3 && status?.phase === 'error' && <div className="pipeline-error">SAM 3: {status.message}. El minimapa sigue activo. Detenga la captura para cambiar la configuración.</div>}
      {CHARACTER_DETECTION_ENABLED && sam3 && characterFrame && <div className="character-timing">Fotograma analizado #{characterFrame.frameNumber} · {characterFrame.capturedAt} · IDs del tramo {characterFrame.trackEpoch}. La vista del personaje muestra su propio fotograma; el minimapa continúa en vivo.</div>}
      {CHARACTER_DETECTION_ENABLED && tracked && <div className="character-timing">{characterBoxes.length - predictedCount} observados · {predictedCount} estimados. Las cajas ámbar discontinuas son predicciones de hasta 300 ms.</div>}
      <div className="game-foot">
        <DataField label="SOURCE" value={source ? `${source.appName} · ${source.title || 'Untitled'}` : undefined} />
        <DataField label="RESOLUTION" value={source ? `${source.width} × ${source.height}` : undefined} />
        <DataField label="FRAME" value={frame ? `#${frame.frameNumber}` : undefined} />
        <DataField label="FPS / PIPELINE" value={frame?.refreshFps != null && frame?.processingMs != null ? `${frame.refreshFps.toFixed(1)} / ${frame.processingMs.toFixed(0)} ms` : undefined} />
        {CHARACTER_DETECTION_ENABLED && <DataField label={characterName} value={characterFrame ? `${characterBoxes.length} · ${characterFrame.gameplayInferenceMs.toFixed(1)} ms` : undefined} />}
      </div>
    </section>

    <aside className="coach panel">
      <div className="panel-head compact"><div><span className="eyebrow">LANGUAGE AGENT</span><h2>COACH FEED</h2></div><StatusBadge label="NOT CONNECTED" /></div>
      <div className="coach-scroll"><EmptyState icon={Bot} title="No coach output" text="The coach provider has not been configured." compact /></div>
      <div className="coach-foot"><button disabled>MARK INSIGHT</button><button disabled>AUDIO OFF</button></div>
    </aside>

    <MinimapAnalysis frame={frame} status={pipelineStatus} modelInfo={modelInfo} />
    <ActiveSessionPrompts onOpenPrompts={onOpenPrompts} />

    <section className="event-log panel">
      <div className="panel-head compact"><div><span className="eyebrow">TELEMETRY STREAM</span><h2>EVENT LOG</h2></div><button className="plain-button" disabled>CLEAR</button></div>
      <div className="event-list"><EmptyState icon={Inbox} title="No events received" text="Events will appear after a real session starts." compact /></div>
    </section>

    <section className="agent-state panel">
      <div className="panel-head compact"><div><span className="eyebrow">INFERENCE SNAPSHOT</span><h2>AGENT STATE</h2></div><CircleDot size={16} className="muted-icon"/></div>
      <div className="state-grid">
        <StateCell label="MATCH PHASE" />
        <StateCell label="SPACING" />
        <StateCell label="PLAYER STATE" />
        <StateCell label="OPPONENT" />
      </div>
      <div className="confidence"><div><span>SCENE CONFIDENCE</span><b>—</b></div><i /></div>
      <div className="intent"><Crosshair size={16}/><div><span>CURRENT INTENT</span><b>Waiting for agent state</b></div></div>
    </section>

    <section className="runtime panel">
      <div className="panel-head compact"><div><span className="eyebrow">SYSTEM HEALTH</span><h2>RUNTIME</h2></div><Activity size={16} className="muted-icon"/></div>
      <div className="metrics">
        <Metric icon={Gauge} label="CAPTURE" value={frame ? frame.captureMs.toFixed(1) : undefined} unit="ms" />
        {CHARACTER_DETECTION_ENABLED && <Metric icon={Eye} label={characterName} value={characterFrame ? (characterFrame.gameplayDetections || []).length : undefined} unit="found" />}
        {CHARACTER_DETECTION_ENABLED && <Metric icon={Zap} label={`${characterName} MODEL`} value={characterFrame ? characterFrame.gameplayInferenceMs.toFixed(1) : undefined} unit="ms" />}
      </div>
      <div className={`runtime-foot ${running ? '' : 'inactive'}`}><Wifi size={13}/><span>{running ? 'CAPTURE + MINIMAP ACTIVE' : 'PIPELINES NOT STARTED'}</span><b>{modelInfo?.executionProvider || '—'}</b></div>
    </section>
  </div>
}

function MinimapAnalysis({ frame, status, modelInfo }) {
  const detections = frame?.detections || []
  return <section className="minimap-analysis panel">
    <div className="panel-head">
      <div><span className="eyebrow">SECONDARY VISION INPUT</span><h2>MINIMAP MODEL <small>02</small></h2></div>
      <div className="feed-controls"><span className="raw-output-badge">RAW MODEL OUTPUT</span><StatusBadge label={status.modelLoaded ? 'RUNNING' : modelInfo?.runtimeExists ? 'READY' : 'NOT AVAILABLE'} active={status.modelLoaded} /><button className={`toggle ${frame ? 'on' : ''}`} disabled={!frame}><Eye size={14}/> DETECTIONS <i /></button></div>
    </div>
    <div className="minimap-content">
      <div className={`minimap-preview ${frame ? '' : 'empty-minimap'}`}>
        {frame ? <div className="minimap-canvas"><img src={frame.minimapDataUrl} alt="Current bottom-right minimap crop"/><div className="minimap-detections">{detections.map((detection) => <div className="detection-box" key={detection.id} style={{ left: `${detection.x * 100}%`, top: `${detection.y * 100}%`, width: `${detection.width * 100}%`, height: `${detection.height * 100}%` }}><span>{detection.label} {Math.round(detection.confidence * 100)}%</span></div>)}</div></div> :
          <EmptyState icon={Eye} title="No minimap frame" text="Waiting for the capture pipeline." compact />}
        <div className="minimap-image-meta"><span>BOTTOM-RIGHT CROP · 30%</span><b>{frame ? `FRAME ${frame.frameNumber}` : 'MODEL —'}</b></div>
      </div>
      <div className="minimap-observations">
        <div className="observation-head"><div><span>MODEL RESPONSE</span><b>{frame ? `${detections.length} detections returned` : 'No inference available'}</b></div><time>{frame ? formatTime(frame.capturedAt) : '—'}</time></div>
        <div className="vision-metrics">
          <DataField label="DETECTED ENTITIES" value={frame ? String(detections.length) : undefined} />
          <DataField label="MEAN CONFIDENCE" value={frame ? `${Math.round(frame.meanConfidence * 100)}%` : undefined} />
          <DataField label="MODEL INFERENCE" value={frame ? `${frame.inferenceMs.toFixed(1)} ms` : undefined} />
        </div>
        <div className="detection-table">
          <div className="detection-table-head"><span>ID</span><span>CLASS</span><span>CONFIDENCE</span><span>POSITION</span></div>
          {detections.slice(0, 5).map((detection) => <div className="detection-table-row" key={detection.id}><span>{detection.id}</span><b>{detection.label}</b><span>{Math.round(detection.confidence * 100)}%</span><span>{Math.round(detection.x * 256)}, {Math.round(detection.y * 256)}</span></div>)}
          {detections.length === 0 && <div className="detection-empty">{frame ? 'No objects passed the confidence threshold.' : 'No detections received.'}</div>}
        </div>
        <div className="vision-boundary"><Eye size={13}/><span>Computer vision output only</span><b>No tactical interpretation</b></div>
      </div>
    </div>
  </section>
}

function ActiveSessionPrompts({ onOpenPrompts }) {
  return <section className="session-prompts panel">
    <div className="session-prompts-head">
      <div><span className="eyebrow">SESSION CONTEXT</span><h2>ACTIVE PROMPTS <small>0 INJECTED</small></h2></div>
      <div className="context-summary"><span><CircleDot size={12}/> — tokens</span><button onClick={onOpenPrompts}>Manage library <ChevronRight size={13}/></button></div>
    </div>
    <div className="session-prompt-list"><EmptyState icon={FileCode2} title="No active prompts" text="The prompt repository is empty." compact /></div>
  </section>
}

function SessionsView() {
  const [sessions, setSessions] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    listSessions()
      .then((storedSessions) => {
        setSessions(storedSessions)
        setLoading(false)
      })
      .catch((reason) => {
        setError(String(reason))
        setLoading(false)
      })
  }, [])

  return <div className="generic-page page-enter">
    <PageIntro kicker={`ARCHIVE / ${sessions.length} RECORDS`} title="SESSION HISTORY" text="Recorded sessions from the local SQLite database will appear here." icon={History}/>
    <div className="table session-table panel">
      <div className="table-head"><span>SESSION ID</span><span>STARTED</span><span>MATCHUP</span><span>RESULT</span><span>DURATION</span><span /></div>
      {sessions.map((session) => <div className="table-row session-row" key={session.id}>
        <span>{session.id}</span><span>{formatDate(session.startedAt)}</span><span>—</span><span>—</span><span>—</span><span className="open-session">Replay unavailable</span>
      </div>)}
      {loading && <TableEmpty text="Loading local sessions…" />}
      {loading === false && error && <TableEmpty text="The local session database could not be read." />}
      {loading === false && error.length === 0 && sessions.length === 0 && <TableEmpty text="No sessions have been recorded." />}
    </div>
  </div>
}

function EvaluationsView() {
  return <div className="evaluation-page page-enter">
    <PageIntro kicker="0 DECISIONS PENDING" title="EVALUATIONS" text="Real coaching decisions awaiting human feedback will appear here." icon={ClipboardCheck}/>
    <section className="evaluation-summary" aria-label="Evaluation summary">
      <EvaluationMetric label="Pending review" value="0" detail="decisions in queue" tone="amber" />
      <EvaluationMetric label="Reviewed" value="0" detail="stored evaluations" tone="green" />
      <EvaluationMetric label="Prompt issues" value="0" detail="identified issues" tone="red" />
      <EvaluationMetric label="Current baseline" value="—" detail="no prompt baseline" tone="blue" />
    </section>
    <div className="evaluation-workspace panel empty-workspace">
      <aside className="evaluation-queue">
        <header className="queue-header"><div><span>REVIEW QUEUE</span><b>0 decisions</b></div><ClipboardCheck size={16}/></header>
        <div className="queue-items"><EmptyState icon={Inbox} title="No decisions to review" text="The queue will be populated from real coach output." /></div>
      </aside>
      <section className="evaluation-detail empty-detail"><EmptyState icon={ClipboardCheck} title="No evaluation selected" text="Select a persisted decision when evaluation capture is implemented." /></section>
    </div>
  </div>
}

function PromptsView() {
  const [query, setQuery] = useState('')

  return <div className="generic-page prompts-page page-enter">
    <PageIntro kicker="0 OF 0 ENABLED" title="PROMPT LIBRARY" text="Persisted prompts will be managed from this workspace." icon={FileCode2}/>
    <div className="prompt-workspace panel">
      <aside className="prompt-list">
        <div className="prompt-list-head"><div><b>Prompt registry</b><span>0 active</span></div></div>
        <label className="prompt-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prompts" /></label>
        <div className="prompt-filters">{['all', 'active', 'inactive'].map((item, index) => <button key={item} className={index === 0 ? 'selected' : ''} disabled>{item}</button>)}</div>
        <div className="prompt-items"><div className="prompt-empty">No prompts have been created.</div></div>
      </aside>
      <section className="editor empty-editor">
        <div className="editor-head"><div><span>EDITING</span><b>No prompt selected</b><small>Version —</small></div><div className="editor-actions"><StatusBadge label="NOT IMPLEMENTED" /><button disabled>SAVE VERSION</button></div></div>
        <div className="prompt-editor-body"><label>Prompt content</label><textarea value="" disabled placeholder="Create a prompt to begin editing." /><div className="editor-meta"><span>0 characters</span><span>Never edited</span></div></div>
      </section>
    </div>
  </div>
}

function SettingsView({ vision }) {
  const config = EMPTY_CONFIG
  const {
    appInfo, sources, selectedSourceId, setSelectedSourceId, modelInfo, pipelineStatus,
    confidence, setConfidence, gameplayConfidence, setGameplayConfidence, framesPerSecond, setFramesPerSecond, refreshSources,
  } = vision
  const selectedSource = sources.find((source) => String(source.id) === String(selectedSourceId))
  const selectedModel = modelInfo?.characterModels?.find((model) => model.id === vision.visionConfig.backend)

  return <div className="settings-page page-enter">
    <div className="settings-titlebar">
      <PageIntro kicker="LOCAL ENVIRONMENT" title="SYSTEM SETTINGS" text="Configure the local capture and inference pipeline. Capture selections apply immediately." icon={Settings}/>
      <div className="settings-actions"><span className="save-state">SESSION CONFIGURATION</span><button className="secondary-action" onClick={refreshSources}>Actualizar ventanas de League</button><button className="primary-action" disabled>Save as default</button></div>
      {vision.capturePermission.supported && !vision.capturePermission.granted && <div className="permission-warning"><ShieldAlert size={18}/><div><b>Permiso de grabación de pantalla requerido</b><span>Autorice Pocket Faker en Privacidad y seguridad → Grabación de pantalla y audio del sistema. El listado se actualizará automáticamente. Si macOS solicita reiniciar, cierre y vuelva a abrir la aplicación.</span><div className="permission-actions"><button className="primary-action" disabled={vision.requestingPermission} onClick={vision.handlePermissionRequest}>{vision.requestingPermission ? 'Solicitando…' : 'Solicitar permiso'}</button><button className="secondary-action" onClick={vision.handlePermissionSettings}>Abrir ajustes de macOS</button></div></div></div>}
      {vision.pipelineError && <div className="settings-error"><b>Capture discovery error</b><span>{vision.pipelineError}</span></div>}
    </div>
    <div className="settings-stack">
      <SettingsSection icon={Gamepad2} index="01" title="Capture Source" description="Select the game window and define how frames enter the processing pipeline." status={pipelineStatus.running ? 'Capturing' : selectedSource ? 'Ready' : 'Not selected'} active={Boolean(selectedSource)}>
        <Field label="Ventana de League of Legends" help="Solo se muestran ventanas cuyo nombre o título contiene “league”, sin distinguir mayúsculas. Si no aparece ninguna, abra el juego y actualice el listado."><select value={selectedSourceId} disabled={pipelineStatus.running} onChange={(event) => setSelectedSourceId(event.target.value)}><option value="">{sources.length > 0 ? 'Seleccione una ventana de League' : 'No se encontraron ventanas de League'}</option>{sources.map((source) => <option value={source.id} key={source.id}>{source.appName} — {source.title || 'Sin título'}</option>)}</select></Field>
        <Field label="Capture method" help="macOS uses a persistent ScreenCaptureKit stream that remains attached when you change windows or Spaces."><select value={selectedSource?.sourceType || 'native'} disabled><option value="native">Native capture</option><option value="window">Application window · ScreenCaptureKit</option><option value="display">Full display · ScreenCaptureKit</option></select></Field>
        <Field label="Display and resolution"><select value={selectedSource ? `${selectedSource.width} × ${selectedSource.height}` : ''} disabled><option value="">Not available</option>{selectedSource && <option value={`${selectedSource.width} × ${selectedSource.height}`}>{selectedSource.width} × {selectedSource.height}</option>}</select></Field>
        <Field label="Target frame rate" help="Frecuencia objetivo. La velocidad efectiva depende del análisis y se muestra en Live."><select value={framesPerSecond} disabled={pipelineStatus.running} onChange={(event) => setFramesPerSecond(Number(event.target.value))}>{[1, 2, 5, 10, 15, 30].map((fps) => <option value={fps} key={fps}>{fps} FPS</option>)}</select></Field>
        <ToggleField label="Capture game audio" description="Make the audio track available to future multimodal models." checked={config.captureAudio} />
        <PipelineNote label="Current signal" value={pipelineStatus.running ? `${pipelineStatus.source?.appName} · recording` : selectedSource ? `${selectedSource.appName} · ${selectedSource.title || 'Untitled'}` : appInfo.runtime === 'desktop' ? `${sources.length} sources found · none selected` : 'Window discovery requires the desktop app'} active={pipelineStatus.running} />
      </SettingsSection>

      <SettingsSection icon={Box} index="02" title="Vision Model" description="Control the model, execution provider, and threshold used on the minimap crop." status={pipelineStatus.modelLoaded ? 'Loaded' : modelInfo?.runtimeExists ? 'Ready on demand' : 'Export required'} active={Boolean(modelInfo?.runtimeExists)}>
        <Field label="Active model" help={modelInfo?.runtimePath || 'Runtime model path is available in the desktop app.'}><select value={modelInfo?.runtimeExists ? 'yolo11x-minimap.onnx' : ''} disabled><option value="">Not available</option>{modelInfo?.runtimeExists && <option value="yolo11x-minimap.onnx">yolo11x-minimap.onnx</option>}</select></Field>
        <Field label="Compute device"><select value={modelInfo?.executionProvider || ''} disabled><option value="">Not available</option>{modelInfo?.executionProvider && <option value={modelInfo.executionProvider}>{modelInfo.executionProvider}</option>}</select></Field>
        <Field label="Inference precision"><select value="FP32" disabled><option value="FP32">FP32</option></select></Field>
        <Field label="Model input size"><select value={modelInfo?.inputSize ? `${modelInfo.inputSize} × ${modelInfo.inputSize}` : ''} disabled><option value="">Not available</option>{modelInfo?.inputSize && <option value={`${modelInfo.inputSize} × ${modelInfo.inputSize}`}>{modelInfo.inputSize} × {modelInfo.inputSize}</option>}</select></Field>
        <RangeField label="Minimum confidence" value={Math.round(confidence * 100)} suffix="%" disabled={pipelineStatus.running || !modelInfo?.runtimeExists} onChange={(value) => setConfidence(value / 100)} help="Applied to the embedded-NMS model output." />
        <ToggleField label="Persistent object tracking" description="Keep stable IDs for detected objects across frames." checked={config.tracking} />
        <PipelineNote label="Runtime artifact" value={modelInfo?.runtimeExists ? `${formatBytes(modelInfo.runtimeSizeBytes)} · loaded only when capture starts` : 'Run the model export script first'} active={Boolean(modelInfo?.runtimeExists)} />
      </SettingsSection>

      {CHARACTER_DETECTION_ENABLED && <SettingsSection icon={Crosshair} index="03" title="Modelo del personaje" description="Seleccione el detector del personaje en gameplay. La detección del minimapa conserva su configuración." status={vision.visionConfig.backend === 'sam3' ? 'Experimental · preparación local' : selectedModel?.runtimeExists ? 'Disponible' : 'Modelo todavía no disponible'} active={vision.visionConfigLoaded}>
        <Field label="Modelo" help="Los cambios se aplican al iniciar la próxima captura."><select value={vision.visionConfig.backend} disabled={pipelineStatus.running || vision.capturePending || !vision.visionConfigLoaded || vision.savingVisionConfig} onChange={(event) => vision.updateVisionConfig('backend', event.target.value)}><option value="current">Actual — Aatrox ONNX</option><option value="yolov8">YOLOv8n — Aatrox sintético v1 (experimental)</option><option value="sam3">SAM 3 — Experimental (sin entrenamiento)</option></select></Field>
        {vision.visionConfig.backend === 'yolov8' && <ToggleField label="Seguimiento temporal de Aatrox" description="IDs estables y predicción marcada durante pérdidas de hasta 300 ms. Las detecciones originales se conservan por separado." checked={vision.visionConfig.trackingEnabled ?? true} disabled={pipelineStatus.running || vision.capturePending || vision.savingVisionConfig || !vision.visionConfigLoaded} onChange={(checked) => vision.updateVisionConfig('trackingEnabled', checked)} />}
        {vision.visionConfig.backend !== 'sam3' ? <>
          <Field label="Archivo del modelo" help={selectedModel?.runtimePath || 'Disponible en la aplicación de escritorio.'}><input value={vision.visionConfig.backend === 'yolov8' ? 'aatrox-yolov8n-synthetic-v1.onnx' : 'aatrox-grid-v1.onnx'} disabled /></Field>
          <Field label="Compute device"><select value="cpu" disabled><option value="cpu">ONNX Runtime CPU</option></select></Field>
          <PipelineNote label="Modelo local" value={selectedModel?.runtimeExists ? `${formatBytes(selectedModel.runtimeSizeBytes)} · ${selectedModel.inputWidth} × ${selectedModel.inputHeight} · se carga al iniciar captura` : vision.visionConfig.backend === 'yolov8' ? 'Entrenamiento y exportación pendientes. Disponibilidad se actualiza automáticamente.' : 'Ejecute scripts/export_aatrox.py primero'} active={Boolean(selectedModel?.runtimeExists)} />
          {vision.visionConfig.backend === 'yolov8' && <PipelineNote label="Alcance" value="Aatrox base · entrenamiento sintético · sin validación en partidas reales. Detecta personaje; no clasifica habilidades." />}
        </> : <>
          <Field label="Python" help="Ruta absoluta del ejecutable en el entorno dedicado a SAM 3."><input value={vision.visionConfig.pythonPath} disabled={pipelineStatus.running || vision.capturePending || vision.savingVisionConfig} onChange={(event) => vision.updateVisionConfig('pythonPath', event.target.value)} /></Field>
          <Field label="Checkpoint local" help="Directorio Transformers con pesos y configuración de facebook/sam3. Sin descargas durante captura."><input value={vision.visionConfig.checkpointPath} disabled={pipelineStatus.running || vision.capturePending || vision.savingVisionConfig} onChange={(event) => vision.updateVisionConfig('checkpointPath', event.target.value)} placeholder="/ruta/al/checkpoint/sam3" /></Field>
          <Field label="Prompt de detección" help="Describa apariencia visual, preferentemente en inglés. El nombre Aatrox por sí solo puede no funcionar."><input value={vision.visionConfig.prompt} maxLength={512} disabled={pipelineStatus.running || vision.capturePending || vision.savingVisionConfig} onChange={(event) => vision.updateVisionConfig('prompt', event.target.value)} /></Field>
          <Field label="Etiqueta del objetivo" help="Nombre solicitado para mostrar; no confirma la identidad del personaje."><input value={vision.visionConfig.targetLabel} maxLength={128} disabled={pipelineStatus.running || vision.capturePending || vision.savingVisionConfig} onChange={(event) => vision.updateVisionConfig('targetLabel', event.target.value)} /></Field>
          <Field label="Dispositivo" help="MPS requiere GPU Apple y operadores compatibles. Si falla, seleccione CPU expresamente."><select value={vision.visionConfig.device} disabled={pipelineStatus.running || vision.capturePending || vision.savingVisionConfig} onChange={(event) => vision.updateVisionConfig('device', event.target.value)}><option value="mps">Apple GPU · MPS (experimental)</option><option value="cpu">CPU</option></select></Field>
          <Field label="Frecuencia máxima del personaje" help="Límite independiente. La frecuencia efectiva depende del hardware; no afecta el ajuste del minimapa."><select value={vision.visionConfig.maxFps} disabled={pipelineStatus.running || vision.capturePending || vision.savingVisionConfig} onChange={(event) => vision.updateVisionConfig('maxFps', Number(event.target.value))}>{[1, 2, 5, 10].map((fps) => <option value={fps} key={fps}>{fps} FPS</option>)}</select></Field>
          <PipelineNote label="Alcance" value="Prompt de texto y seguimiento con IDs. Sin entrenamiento ni clasificación de animaciones. Reinicio de memoria cada 60 fotogramas analizados o tras una pausa larga." />
        </>}
        <RangeField label="Confianza del personaje" value={Math.round(gameplayConfidence * 100)} suffix="%" disabled={pipelineStatus.running || vision.capturePending} onChange={(value) => setGameplayConfidence(value / 100)} help="Umbral independiente del minimapa." />
        <div className="character-config-actions"><button className="primary-action" disabled={appInfo.runtime !== 'desktop' || pipelineStatus.running || vision.capturePending || !vision.visionConfigLoaded || vision.savingVisionConfig} onClick={vision.saveVisionConfig}>{vision.savingVisionConfig ? 'Guardando…' : 'Guardar modelo del personaje'}</button><span>{vision.visionConfigMessage}</span></div>
      </SettingsSection>}

      <SettingsSection icon={BrainCircuit} index="03" title="Coach Agent" description="Define how the language agent consumes match state and delivers real-time guidance." status="Not connected">
        <EmptySelect label="Agent model" help="No coach provider has been configured." />
        <EmptySelect label="Response trigger" />
        <EmptySelect label="Response length" />
        <EmptySelect label="Minimum cooldown" />
        <ToggleField label="Voice output" description="Read coaching messages aloud while keeping the text feed." checked={config.voiceOutput} />
        <ToggleField label="Include model confidence" description="Attach confidence and relevance metadata to every response." checked={config.includeConfidence} />
        <PipelineNote label="Prompt context" value="No active prompt context" />
      </SettingsSection>
    </div>
  </div>
}

function EmptyState({ icon: Icon, title, text, compact = false }) {
  return <div className={compact ? 'data-empty compact' : 'data-empty'}><Icon size={compact ? 18 : 24}/><b>{title}</b><span>{text}</span></div>
}

function StatusBadge({ label, active = false }) {
  return <span className={`model-status ${active ? '' : 'paused'}`}><i />{label}</span>
}

function DataField({ label, value }) {
  return <div><span>{label}</span><b>{value ?? '—'}</b></div>
}

function StateCell({ label }) {
  return <div className="state-cell"><span>{label}</span><b>—</b></div>
}

function Metric({ icon: Icon, label, value, unit }) {
  return <div className="metric"><div className="metric-label"><Icon size={14}/><span>{label}</span></div><div className="metric-value"><b>{value ?? '—'}</b><small>{value === undefined ? '—' : unit}</small></div><div className={`spark ${value === undefined ? 'inactive' : ''}`}><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div>
}

function TableEmpty({ text }) {
  return <div className="table-empty"><Database size={20}/><span>{text}</span></div>
}

function EvaluationMetric({ label, value, detail, tone }) {
  return <article className={`evaluation-metric ${tone}`}><span>{label}</span><b>{value}</b><small>{detail}</small></article>
}

function PageIntro({ kicker, title, text, icon: Icon }) {
  return <div className="page-intro"><div><span>{kicker}</span><h1>{title}</h1><p>{text}</p></div><Icon size={56} strokeWidth={1}/></div>
}

function SettingsSection({ icon: Icon, index, title, description, status, active = false, children }) {
  return <section className="settings-section panel">
    <header className="settings-section-header"><div className="settings-section-identity"><span className="settings-index">{index}</span><div className="settings-icon"><Icon size={19}/></div><div><h2>{title}</h2><p>{description}</p></div></div><span className={`section-status ${active ? '' : 'inactive'}`}><i />{status}</span></header>
    <div className="settings-fields">{children}</div>
  </section>
}

function Field({ label, help, children }) {
  return <label className="settings-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>
}

function EmptySelect({ label, help }) {
  return <Field label={label} help={help}><select value="" disabled><option value="">Not configured</option></select></Field>
}

function ToggleField({ label, description, checked, onChange, disabled = false }) {
  const unavailable = disabled || !onChange
  return <label className={`toggle-field ${unavailable ? 'disabled' : ''}`}><span><b>{label}</b><small>{description}</small></span><input type="checkbox" checked={checked} disabled={unavailable} readOnly={!onChange} onChange={onChange ? (event) => onChange(event.target.checked) : undefined}/><i /></label>
}

function RangeField({ label, value, suffix, disabled, onChange, help }) {
  return <label className={`settings-field range-field ${disabled ? 'disabled' : ''}`}><span>{label}<b>{value}{suffix}</b></span><input type="range" min="5" max="95" value={value} disabled={disabled} onChange={(event) => onChange(Number(event.target.value))}/><small>{help}</small></label>
}

function PipelineNote({ label, value, active = false }) {
  return <div className={`pipeline-note ${active ? '' : 'inactive'}`}><span><CircleDot size={13}/>{label}</span><b>{value}</b></div>
}

function formatDate(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleString()
}

function formatTime(value) {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? '—' : parsed.toLocaleTimeString()
}

function formatBytes(value) {
  if (!Number.isFinite(value)) return '—'
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

createRoot(document.getElementById('root')).render(<App />)
