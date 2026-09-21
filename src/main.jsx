import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, Bell, Bot, Box, BrainCircuit, ChevronDown, ChevronRight, CircleDot,
  ClipboardCheck, Clock3, Crosshair, Database, Eye, FileCode2, Gauge, Gamepad2,
  History, Inbox, Play, Radio, Search, Settings, ShieldAlert, SlidersHorizontal, Wifi, Zap,
} from 'lucide-react'
import {
  getAppInfo, getCapturePermissionStatus, getModelInfo, getPipelineStatus,
  listCaptureSources, listSessions, onCaptureFrame, onPipelineError, onPipelineStatus,
  requestCapturePermission, startCapture, stopCapture,
} from './desktop'
import './styles.css'

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
  const [framesPerSecond, setFramesPerSecond] = useState(2)
  const [capturePermission, setCapturePermission] = useState({ supported: false, granted: false, requestedThisLaunch: false, requiresRestart: false })

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

  const refreshSources = async () => {
    try {
      const permission = await getCapturePermissionStatus()
      setCapturePermission(permission)
      if (permission.supported && !permission.granted) {
        setSources([])
        setSelectedSourceId('')
        return
      }
      const discovered = await listCaptureSources()
      setSources(discovered)
      setPipelineError('')
      setSelectedSourceId((current) => {
        if (discovered.some((source) => String(source.id) === String(current))) return current
        const preferred = discovered.find((source) => source.isLeague) || discovered[0]
        return preferred ? String(preferred.id) : ''
      })
    } catch (reason) {
      setPipelineError(String(reason))
    }
  }

  useEffect(() => {
    let active = true
    const unlisteners = []
    Promise.all([getModelInfo(), getPipelineStatus(), requestCapturePermission()])
      .then(async ([model, status, permission]) => {
        if (!active) return
        const discovered = permission.supported && !permission.granted ? [] : await listCaptureSources()
        if (!active) return
        setModelInfo(model)
        setPipelineStatus(status)
        setCapturePermission(permission)
        setSources(discovered)
        const preferred = discovered.find((source) => source.isLeague) || discovered[0]
        if (preferred) setSelectedSourceId(String(preferred.id))
      })
      .catch((reason) => active && setPipelineError(String(reason)))

    ;[
      onCaptureFrame((nextFrame) => active && setFrame(nextFrame)),
      onPipelineStatus((status) => active && setPipelineStatus(status)),
      onPipelineError((error) => active && setPipelineError(String(error))),
    ].forEach((subscription) => subscription.then((unlisten) => active ? unlisteners.push(unlisten) : unlisten()))

    return () => {
      active = false
      unlisteners.forEach((unlisten) => unlisten())
    }
  }, [])

  const handleCapture = async () => {
    try {
      setPipelineError('')
      if (pipelineStatus.running) {
        setPipelineStatus(await stopCapture())
      } else {
        if (!selectedSourceId) throw new Error('Select a capture source in Settings first')
        setFrame(null)
        setPipelineStatus(await startCapture(selectedSourceId, confidence, framesPerSecond))
      }
    } catch (reason) {
      setPipelineError(String(reason))
    }
  }

  const vision = {
    appInfo, sources, selectedSourceId, setSelectedSourceId, modelInfo, pipelineStatus,
    frame, pipelineError, confidence, setConfidence, framesPerSecond, setFramesPerSecond,
    capturePermission, refreshSources, handleCapture,
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
  return <div className="live-layout page-enter">
    <section className="gameplay panel">
      <div className="panel-head">
        <div><span className="eyebrow">PRIMARY INPUT</span><h2>GAMEPLAY FEED <small>01</small></h2></div>
        <div className="feed-controls">
          <button className="toggle" disabled><Eye size={14}/> MINIMAP DETECTIONS <i /></button>
          <button className="icon-button" onClick={onOpenSettings} aria-label="Open capture settings"><SlidersHorizontal size={15}/></button>
        </div>
      </div>
      <div className={`game-window ${frame ? 'active-capture' : 'empty-capture'}`}>
        {frame ? <img className="capture-frame" src={frame.fullFrameDataUrl} alt="Current captured League of Legends window" /> :
          <EmptyState icon={Gamepad2} title={running ? 'Starting capture…' : 'No captured frame'} text={source ? 'Press start to load the model and begin recording.' : 'Choose the League of Legends window in Settings.'} compact />}
        <div className="feed-corners"><i/><i/><i/><i/></div>
        <div className={`rec-chip ${running ? '' : 'idle'}`}><span /> {running ? 'RECORDING LOCALLY' : 'NOT RECORDING'}</div>
        <div className="model-chip">{pipelineStatus.modelLoaded ? 'YOLO ACTIVE' : modelInfo?.runtimeExists ? 'MODEL READY' : 'MODEL NOT EXPORTED'}</div>
        <button className="pause-button" onClick={handleCapture} disabled={!running && !selectedSourceId} aria-label={running ? 'Stop capture' : 'Start capture'}>
          {running ? <span className="stop-symbol" /> : <Play size={19} fill="currentColor"/>}
        </button>
      </div>
      {pipelineError && <div className="pipeline-error">{pipelineError}</div>}
      <div className="game-foot">
        <DataField label="SOURCE" value={source ? `${source.appName} · ${source.title || 'Untitled'}` : undefined} />
        <DataField label="RESOLUTION" value={source ? `${source.width} × ${source.height}` : undefined} />
        <DataField label="FRAME" value={frame ? `#${frame.frameNumber}` : undefined} />
        <DataField label="CAPTURE LATENCY" value={frame ? `${frame.captureMs.toFixed(1)} ms` : undefined} />
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
        <Metric icon={Eye} label="ENTITIES" value={frame ? frame.detections.length : undefined} unit="found" />
        <Metric icon={Zap} label="INFERENCE" value={frame ? frame.inferenceMs.toFixed(1) : undefined} unit="ms" />
      </div>
      <div className={`runtime-foot ${running ? '' : 'inactive'}`}><Wifi size={13}/><span>{running ? 'CAPTURE + YOLO PIPELINE ACTIVE' : 'PIPELINES NOT STARTED'}</span><b>{modelInfo?.executionProvider || '—'}</b></div>
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
    confidence, setConfidence, framesPerSecond, setFramesPerSecond, refreshSources,
  } = vision
  const selectedSource = sources.find((source) => String(source.id) === String(selectedSourceId))
  const windowSources = sources.filter((source) => source.sourceType === 'window')
  const displaySources = sources.filter((source) => source.sourceType === 'display')

  return <div className="settings-page page-enter">
    <div className="settings-titlebar">
      <PageIntro kicker="LOCAL ENVIRONMENT" title="SYSTEM SETTINGS" text="Configure the local capture and inference pipeline. Capture selections apply immediately." icon={Settings}/>
      <div className="settings-actions"><span className="save-state">SESSION CONFIGURATION</span><button className="secondary-action" onClick={refreshSources}>Refresh windows</button><button className="primary-action" disabled>Save as default</button></div>
      {vision.capturePermission.supported && !vision.capturePermission.granted && <div className="permission-warning"><ShieldAlert size={18}/><div><b>Screen Recording permission required</b><span>macOS was asked once for access. Enable Pocket Faker in Privacy &amp; Security → Screen &amp; System Audio Recording, then fully quit and restart the app.</span></div></div>}
      {vision.pipelineError && <div className="settings-error"><b>Capture discovery error</b><span>{vision.pipelineError}</span></div>}
    </div>
    <div className="settings-stack">
      <SettingsSection icon={Gamepad2} index="01" title="Capture Source" description="Select the game window and define how frames enter the processing pipeline." status={pipelineStatus.running ? 'Capturing' : selectedSource ? 'Ready' : 'Not selected'} active={Boolean(selectedSource)}>
        <Field label="Application or display" help="Full-screen Metal games may not expose a window on macOS. In that case select the display where League is running."><select value={selectedSourceId} disabled={pipelineStatus.running} onChange={(event) => setSelectedSourceId(event.target.value)}><option value="">Select a capture source</option>{windowSources.length > 0 && <optgroup label="Application windows">{windowSources.map((source) => <option value={source.id} key={source.id}>{source.isLeague ? 'League · ' : ''}{source.appName} — {source.title || 'Untitled'}</option>)}</optgroup>}{displaySources.length > 0 && <optgroup label="Displays (recommended for full-screen games)">{displaySources.map((source) => <option value={source.id} key={source.id}>{source.title} — {source.width} × {source.height}</option>)}</optgroup>}</select></Field>
        <Field label="Capture method" help="macOS uses a persistent ScreenCaptureKit stream that remains attached when you change windows or Spaces."><select value={selectedSource?.sourceType || 'native'} disabled><option value="native">Native capture</option><option value="window">Application window · ScreenCaptureKit</option><option value="display">Full display · ScreenCaptureKit</option></select></Field>
        <Field label="Display and resolution"><select value={selectedSource ? `${selectedSource.width} × ${selectedSource.height}` : ''} disabled><option value="">Not available</option>{selectedSource && <option value={`${selectedSource.width} × ${selectedSource.height}`}>{selectedSource.width} × {selectedSource.height}</option>}</select></Field>
        <Field label="Target frame rate" help="Kept deliberately low while full frames are recorded locally."><select value={framesPerSecond} disabled={pipelineStatus.running} onChange={(event) => setFramesPerSecond(Number(event.target.value))}>{[1, 2, 5, 10].map((fps) => <option value={fps} key={fps}>{fps} FPS</option>)}</select></Field>
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

function ToggleField({ label, description, checked }) {
  return <label className="toggle-field disabled"><span><b>{label}</b><small>{description}</small></span><input type="checkbox" checked={checked} disabled readOnly/><i /></label>
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
