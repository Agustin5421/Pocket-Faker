import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import {
  Activity, AlertTriangle, Archive, ArrowLeft, Bell, Bot, Box, BrainCircuit, ChevronDown, ChevronRight,
  Check, CheckCircle2, CircleDot, ClipboardCheck, Clock3, Crosshair, Eye, FileCode2, Flag,
  Gauge, Gamepad2, HelpCircle, History, LayoutDashboard, MessageSquareText, Pause, Play, Radio,
  RotateCcw, Save, Settings, SkipBack, SkipForward, SlidersHorizontal, Search, Sparkles, Tag,
  Wifi, XCircle, Zap,
} from 'lucide-react'
import { getAppInfo } from './desktop'
import './styles.css'

const INITIAL_EVENTS = [
  { time: '08:42.11', type: 'VISION', message: 'Opponent grounded · 92% confidence' },
  { time: '08:41.73', type: 'INPUT', message: 'P2 → crouch block' },
  { time: '08:40.26', type: 'STATE', message: 'Neutral advantage shifted to P1' },
  { time: '08:38.94', type: 'VISION', message: 'Projectile registered · frame 12401' },
  { time: '08:37.18', type: 'AGENT', message: 'Coaching response emitted' },
  { time: '08:35.60', type: 'COMBAT', message: 'Punish window missed · 9f' },
]

const EVENT_POOL = [
  ['VISION', 'Wake-up animation detected · 96% confidence'],
  ['STATE', 'Corner pressure state entered'],
  ['COMBAT', 'Counter hit confirmed · +142 damage'],
  ['INPUT', 'P1 → backdash'],
  ['AGENT', 'Tactical window recomputed'],
  ['VISION', 'Distance class changed: MID → CLOSE'],
]

const NAV = [
  ['Live', Radio],
  ['Sessions', History],
  ['Evaluations', ClipboardCheck],
  ['Prompts', FileCode2],
  ['Settings', Settings],
]

const INITIAL_EVALUATIONS = [
  {
    id: 'EV-0241', session: 'SF6-RANKED-0842', time: '08:41.73', frame: 28924,
    event: 'Projectile recovery window', category: 'Timing', opponent: 'Ryu', status: 'pending',
    message: 'Drive Rush through the projectile—you have enough gauge to convert safely.',
    confidence: '93%', latency: '284 ms', tokens: 186, promptVersion: 'Global v3.2 · Ryu v4.2',
    snapshot: [['Phase', 'Neutral'], ['Distance', '2.8 m'], ['Player', 'Grounded'], ['Opponent', 'Recovery · 9f'], ['Drive gauge', '3.2 bars'], ['Vision age', '34 ms']],
  },
  {
    id: 'EV-0240', session: 'SF6-RANKED-0842', time: '08:37.18', frame: 28630,
    event: 'Corner pressure entered', category: 'Positioning', opponent: 'Ryu', status: 'pending',
    message: 'Hold your ground and watch for the jump—his anti-air success is low.',
    confidence: '88%', latency: '301 ms', tokens: 171, promptVersion: 'Global v3.2 · Ryu v4.2',
    snapshot: [['Phase', 'Defense'], ['Distance', '1.6 m'], ['Player', 'Cornered'], ['Opponent', 'Advancing'], ['Drive gauge', '2.1 bars'], ['Vision age', '51 ms']],
  },
  {
    id: 'EV-0239', session: 'SF6-RANKED-0841', time: '06:12.40', frame: 22344,
    event: 'Low health modifier activated', category: 'Risk', opponent: 'JP', status: 'pending',
    message: 'Jump over the next spike and spend level three immediately.',
    confidence: '76%', latency: '338 ms', tokens: 204, promptVersion: 'Global v3.2 · JP v6.2 · Defense v1.8',
    snapshot: [['Phase', 'Defense'], ['Distance', 'Full screen'], ['Player', 'Low health'], ['Opponent', 'Unknown'], ['Super meter', '3 bars'], ['Vision age', '182 ms']],
  },
  {
    id: 'EV-0238', session: 'SF6-CUSTOM-0194', time: '11:04.92', frame: 39895,
    event: 'Whiff punish candidate', category: 'Relevance', opponent: 'Luke', status: 'reviewed',
    message: 'Walk forward and prepare to punish the next heavy normal.',
    confidence: '91%', latency: '267 ms', tokens: 158, promptVersion: 'Global v3.2 · Luke v2.4',
    snapshot: [['Phase', 'Neutral'], ['Distance', '2.2 m'], ['Player', 'Walking'], ['Opponent', 'Recovery · 14f'], ['Drive gauge', '4.0 bars'], ['Vision age', '29 ms']],
  },
  {
    id: 'EV-0237', session: 'SF6-RANKED-0839', time: '04:51.20', frame: 17472,
    event: 'Wake-up option detected', category: 'Grounding', opponent: 'Cammy', status: 'reviewed',
    message: 'Back away; she has shown an invincible reversal twice this round.',
    confidence: '95%', latency: '246 ms', tokens: 149, promptVersion: 'Global v3.2 · Cammy v5.2',
    snapshot: [['Phase', 'Oki'], ['Distance', '0.8 m'], ['Player', 'Advancing'], ['Opponent', 'Wake-up'], ['Drive gauge', '2.8 bars'], ['Vision age', '22 ms']],
  },
]

function formatClock(total) {
  const min = Math.floor(total / 60).toString().padStart(2, '0')
  const sec = (total % 60).toString().padStart(2, '0')
  return `${min}:${sec}`
}

function BrandMark() {
  return <div className="brand-mark">PF</div>
}

function App() {
  const [view, setView] = useState('Live')
  const [running, setRunning] = useState(true)
  const [overlay, setOverlay] = useState(true)
  const [seconds, setSeconds] = useState(522)
  const [events, setEvents] = useState(INITIAL_EVENTS)
  const [fps, setFps] = useState(59.8)
  const [storageStatus, setStorageStatus] = useState('BROWSER PREVIEW')

  useEffect(() => {
    getAppInfo()
      .then((info) => {
        const readyLabel = info.runtime === 'desktop' && info.storageReady ? 'SQLITE READY' : 'BROWSER PREVIEW'
        setStorageStatus(readyLabel)
      })
      .catch(() => {
        setStorageStatus('STORAGE ERROR')
      })
  }, [])

  useEffect(() => {
    if (!running) return undefined
    const timer = window.setInterval(() => {
      setSeconds((value) => value + 1)
      setFps(Number((59.2 + Math.random() * 1.1).toFixed(1)))
    }, 1000)
    return () => window.clearInterval(timer)
  }, [running])

  useEffect(() => {
    if (!running) return undefined
    const ticker = window.setInterval(() => {
      const [type, message] = EVENT_POOL[Math.floor(Math.random() * EVENT_POOL.length)]
      const time = formatClock(seconds).replace(':', ':') + `.${String(Math.floor(Math.random() * 99)).padStart(2, '0')}`
      setEvents((current) => [{ time, type, message }, ...current.slice(0, 7)])
    }, 4300)
    return () => window.clearInterval(ticker)
  }, [running, seconds])

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
          <div className="device-status"><span className="pulse-dot"/><div><strong>LOCAL CORE</strong><small>{storageStatus}</small></div></div>
          <div className="version">BUILD 0.1.0 <span>DEV</span></div>
        </div>
      </aside>

      <main>
        <header className="topbar">
          <div className="breadcrumb"><span>Workspace</span><b>/</b><strong>{view}</strong></div>
          {view === 'Live' && <SessionStatus running={running} seconds={seconds} />}
          <div className="top-actions"><button aria-label="Notifications"><Bell size={17}/><em>2</em></button><div className="operator"><span>AD</span><div><b>Developer</b><small>Local workspace</small></div><ChevronDown size={14}/></div></div>
        </header>

        {view === 'Live' && <LiveView running={running} setRunning={setRunning} overlay={overlay} setOverlay={setOverlay} seconds={seconds} fps={fps} events={events} onOpenPrompts={() => setView('Prompts')} />}
        {view === 'Sessions' && <SessionsView />}
        {view === 'Evaluations' && <EvaluationsView />}
        {view === 'Prompts' && <PromptsView />}
        {view === 'Settings' && <SettingsView />}
      </main>
    </div>
  )
}

function SessionStatus({ running, seconds }) {
  return <div className="session-status">
    <span className={running ? 'live-light' : 'live-light paused'} />
    <b>{running ? 'Session live' : 'Session paused'}</b>
    <span className="divider" />
    <Clock3 size={14}/><strong>{formatClock(seconds)}</strong>
    <span className="divider" />
    <small>SF6-RANKED-0842</small>
  </div>
}

function LiveView({ running, setRunning, overlay, setOverlay, seconds, fps, events, onOpenPrompts }) {
  return <div className="live-layout page-enter">
    <section className="gameplay panel">
      <div className="panel-head">
        <div><span className="eyebrow">PRIMARY INPUT</span><h2>GAMEPLAY FEED <small>01</small></h2></div>
        <div className="feed-controls">
          <button className={overlay ? 'toggle on' : 'toggle'} onClick={() => setOverlay(!overlay)}><Eye size={14}/> DETECTIONS <i /></button>
          <button className="icon-button"><SlidersHorizontal size={15}/></button>
        </div>
      </div>
      <div className="game-window">
        <Arena overlay={overlay} running={running}/>
        <div className="scanline" />
        <div className="feed-corners"><i/><i/><i/><i/></div>
        <div className="rec-chip"><span /> REC · 1080P</div>
        <div className="model-chip">YOLOv8-fight-2.3</div>
        <button className="pause-button" onClick={() => setRunning(!running)}>{running ? <Pause size={19} fill="currentColor"/> : <Play size={19} fill="currentColor"/>}</button>
      </div>
      <div className="game-foot">
        <div><span>SOURCE</span><b>Street Fighter 6.exe</b></div>
        <div><span>RESOLUTION</span><b>1920 × 1080</b></div>
        <div><span>FRAME</span><b># 012,438</b></div>
        <div className="latency-good"><span>CAPTURE LATENCY</span><b>8.4 ms</b></div>
      </div>
    </section>

    <aside className="coach panel">
      <div className="panel-head compact"><div><span className="eyebrow">LANGUAGE AGENT</span><h2>COACH FEED</h2></div><div className="thinking"><Sparkles size={12}/> ACTIVE</div></div>
      <div className="coach-scroll">
        <article className="coach-card latest">
          <header><span><Bot size={15}/> COACH</span><time>08:41</time></header>
          <p>He's committing to a slow fireball at mid-range. <strong>Drive Rush through it</strong>—you have enough gauge to convert safely.</p>
          <footer><span><BrainCircuit size={12}/> tactical</span><b>93% relevance</b></footer>
        </article>
        <article className="coach-card">
          <header><span><Bot size={15}/> COACH</span><time>08:37</time></header>
          <p>You're giving up the corner too easily. Hold your ground and watch for the jump—his anti-air success is low.</p>
          <footer><span><BrainCircuit size={12}/> positioning</span><b>88% relevance</b></footer>
        </article>
        <div className="agent-working"><span/><span/><span/><small>Observing next decision window</small></div>
      </div>
      <div className="coach-foot"><button><Archive size={14}/> MARK INSIGHT</button><button><Bell size={14}/> AUDIO ON</button></div>
    </aside>

    <MinimapAnalysis running={running} />

    <ActiveSessionPrompts onOpenPrompts={onOpenPrompts} />

    <section className="event-log panel">
      <div className="panel-head compact"><div><span className="eyebrow">TELEMETRY STREAM</span><h2>EVENT LOG</h2></div><button className="plain-button">CLEAR</button></div>
      <div className="event-list">
        {events.map((event, index) => <div className="event-row" key={`${event.time}-${index}`}>
          <time>{event.time}</time><span className={`event-type ${event.type.toLowerCase()}`}>{event.type}</span><p>{event.message}</p>{index === 0 && <i>NEW</i>}
        </div>)}
      </div>
    </section>

    <section className="agent-state panel">
      <div className="panel-head compact"><div><span className="eyebrow">INFERENCE SNAPSHOT</span><h2>AGENT STATE</h2></div><CircleDot size={16} className="cyan"/></div>
      <div className="state-grid">
        <StateCell label="MATCH PHASE" value="NEUTRAL" accent />
        <StateCell label="SPACING" value="MID RANGE" />
        <StateCell label="PLAYER STATE" value="GROUNDED" />
        <StateCell label="OPPONENT" value="RECOVERY" warn />
      </div>
      <div className="confidence"><div><span>SCENE CONFIDENCE</span><b>94.2%</b></div><i><em /></i></div>
      <div className="intent"><Crosshair size={16}/><div><span>CURRENT INTENT</span><b>Detect punish opportunity after projectile recovery</b></div></div>
    </section>

    <section className="runtime panel">
      <div className="panel-head compact"><div><span className="eyebrow">SYSTEM HEALTH</span><h2>RUNTIME</h2></div><Activity size={16} className="green"/></div>
      <div className="metrics">
        <Metric icon={Gauge} label="CAPTURE" value={fps} unit="FPS" graph="cyan" />
        <Metric icon={Eye} label="VISION" value="18.6" unit="MS" graph="amber" />
        <Metric icon={Zap} label="INFERENCE" value="284" unit="MS" graph="green" />
      </div>
      <div className="runtime-foot"><Wifi size={13}/><span>ALL SYSTEMS NOMINAL</span><b>GPU 42%</b></div>
    </section>
  </div>
}

function MinimapAnalysis({ running }) {
  const [showDetections, setShowDetections] = useState(true)
  const metrics = [
    { label: 'DETECTED ENTITIES', value: '5' },
    { label: 'MEAN CONFIDENCE', value: '93.0%' },
    { label: 'MODEL INFERENCE', value: '14.2 ms' },
  ]
  const detections = [
    { id: 'D-018', entityClass: 'ALLY_CHAMPION', confidence: '97%', position: 'x .28 · y .79', tone: 'allied' },
    { id: 'D-021', entityClass: 'ALLY_CHAMPION', confidence: '95%', position: 'x .46 · y .61', tone: 'allied' },
    { id: 'D-024', entityClass: 'ENEMY_CHAMPION', confidence: '94%', position: 'x .74 · y .20', tone: 'enemy' },
    { id: 'D-029', entityClass: 'ENEMY_CHAMPION', confidence: '91%', position: 'x .58 · y .41', tone: 'enemy' },
    { id: 'D-033', entityClass: 'NEUTRAL_MARKER', confidence: '88%', position: 'x .52 · y .50', tone: 'neutral' },
  ]

  return <section className="minimap-analysis panel">
    <div className="panel-head">
      <div><span className="eyebrow">SECONDARY VISION INPUT</span><h2>MINIMAP MODEL <small>02</small></h2></div>
      <div className="feed-controls">
        <span className="raw-output-badge">RAW MODEL OUTPUT</span>
        <span className={running ? 'model-status' : 'model-status paused'}><i />{running ? 'PROCESSING' : 'PAUSED'}</span>
        <button className={showDetections ? 'toggle on' : 'toggle'} onClick={() => setShowDetections((current) => current === false)}><Eye size={14}/> DETECTIONS <i /></button>
      </div>
    </div>
    <div className="minimap-content">
      <div className="minimap-preview">
        <img src="/minimap-placeholder.svg" alt="Placeholder for the live League of Legends minimap crop" />
        {showDetections && <div className="minimap-detections" aria-label="Current minimap detections">
          <span className="map-marker allied marker-one">18</span>
          <span className="map-marker allied marker-two">21</span>
          <span className="map-marker enemy marker-three">24</span>
          <span className="map-marker enemy marker-four">29</span>
          <span className="map-objective">D-033 · .88</span>
        </div>}
        <div className="minimap-image-meta"><span>MAP CROP · 320 × 320</span><b>MinimapNet v1.4</b></div>
      </div>
      <div className="minimap-observations">
        <div className="observation-head">
          <div><span>MODEL RESPONSE</span><b>Detections for frame #012,438</b></div>
          <time>Captured 34 ms ago</time>
        </div>
        <div className="vision-metrics">
          {metrics.map((metric) => <div key={metric.label}><span>{metric.label}</span><b>{metric.value}</b></div>)}
        </div>
        <div className="detection-table">
          <div className="detection-table-head"><span>ID</span><span>CLASS</span><span>CONFIDENCE</span><span>POSITION</span></div>
          {detections.map((detection) => <div className="detection-table-row" key={detection.id}>
            <span>{detection.id}</span><b className={detection.tone}>{detection.entityClass}</b><span>{detection.confidence}</span><span>{detection.position}</span>
          </div>)}
        </div>
        <div className="vision-boundary"><Eye size={13}/><span>Computer vision output only</span><b>No tactical interpretation</b></div>
      </div>
    </div>
  </section>
}

function ActiveSessionPrompts({ onOpenPrompts }) {
  const prompts = [
    { name: 'Global Coach System', version: 'v3.2', type: 'System', scope: 'Always applied', tokens: '1,420' },
    { name: 'Ryu / Matchup Context', version: 'v4.2', type: 'Character', scope: 'Opponent: Ryu', tokens: '1,860' },
    { name: 'Defensive Recovery', version: 'v1.8', type: 'Modifier', scope: 'Health below 30%', tokens: '560' },
  ]
  return <section className="session-prompts panel">
    <div className="session-prompts-head">
      <div><span className="eyebrow">SESSION CONTEXT</span><h2>ACTIVE PROMPTS <small>{prompts.length} INJECTED</small></h2></div>
      <div className="context-summary"><span><CircleDot size={12}/> 3,840 tokens</span><button onClick={onOpenPrompts}>Manage library <ChevronRight size={13}/></button></div>
    </div>
    <div className="session-prompt-list">
      {prompts.map((prompt) => <article key={prompt.name}>
        <div className="prompt-file-icon"><FileCode2 size={16}/></div>
        <div className="session-prompt-info"><b>{prompt.name}</b><span>{prompt.type} · {prompt.version}</span></div>
        <div className="session-prompt-scope"><small>APPLIES TO</small><b>{prompt.scope}</b></div>
        <div className="session-prompt-tokens"><small>CONTEXT</small><b>{prompt.tokens} tokens</b></div>
        <span className="injected-status"><i/>Injected</span>
      </article>)}
    </div>
  </section>
}

function Arena({ overlay, running, pausedLabel = 'CAPTURE PAUSED', showPausedOverlay = true }) {
  return <div className={`arena ${running ? 'running' : ''}`}>
    <div className="arena-sky"><div className="moon"/><div className="skyline back"/><div className="skyline front"/></div>
    <div className="hud-bars"><div className="fighter-name"><small>YOU</small><b>KEN</b></div><div className="health"><i/><em/></div><div className="round-timer">63</div><div className="health enemy"><i/><em/></div><div className="fighter-name enemy"><small>CPU LV.7</small><b>RYU</b></div></div>
    <div className="floor-grid"/>
    <div className="fighter fighter-one"><div className="head"/><div className="body"/><div className="arm left"/><div className="arm right"/><div className="leg left"/><div className="leg right"/></div>
    <div className="fighter fighter-two"><div className="head"/><div className="body"/><div className="arm left"/><div className="arm right"/><div className="leg left"/><div className="leg right"/></div>
    <div className="projectile" />
    {overlay && <>
      <Detection className="detect-one" name="PLAYER_KEN" confidence="0.97" />
      <Detection className="detect-two" name="OPPONENT_RYU" confidence="0.94" />
      <Detection className="detect-ball" name="PROJECTILE" confidence="0.91" />
      <div className="vector"><span>DIST 2.8m</span></div>
      <div className="pose-dot p1"/><div className="pose-dot p2"/><div className="pose-dot p3"/><div className="pose-line l1"/><div className="pose-line l2"/>
    </>}
    {running === false && showPausedOverlay && <div className="paused-overlay"><Pause size={25}/><span>{pausedLabel}</span></div>}
  </div>
}

function Detection({ className, name, confidence }) {
  return <div className={`detection ${className}`}><span>{name}</span><b>{confidence}</b><i/><i/><i/><i/></div>
}

function StateCell({ label, value, accent, warn }) {
  return <div className="state-cell"><span>{label}</span><b className={accent ? 'accent' : warn ? 'warn' : ''}>{value}</b></div>
}

function Metric({ icon: Icon, label, value, unit, graph }) {
  return <div className="metric"><div className="metric-label"><Icon size={14}/><span>{label}</span></div><div className="metric-value"><b>{value}</b><small>{unit}</small></div><div className={`spark ${graph}`}><i/><i/><i/><i/><i/><i/><i/><i/><i/></div></div>
}

function SessionsView() {
  const sessions = [
    { id: 'SF6-RANKED-0842', started: 'Today, 14:28', matchup: 'KEN vs RYU', result: 'WIN', duration: '18:42', totalFrames: 67320 },
    { id: 'SF6-RANKED-0841', started: 'Today, 13:51', matchup: 'KEN vs JP', result: 'LOSS', duration: '12:08', totalFrames: 43680 },
    { id: 'SF6-CUSTOM-0194', started: 'Yesterday, 21:04', matchup: 'KEN vs LUKE', result: 'WIN', duration: '24:16', totalFrames: 87360 },
    { id: 'SF6-RANKED-0839', started: 'Yesterday, 20:32', matchup: 'KEN vs CAMMY', result: 'WIN', duration: '09:55', totalFrames: 35700 },
  ]
  const [selectedSession, setSelectedSession] = useState(null)
  const sessionList = <div className="generic-page page-enter">
    <PageIntro kicker="ARCHIVE / 138 RECORDS" title="SESSION HISTORY" text="Open a recorded session to replay its frames, detections, and coaching decisions." icon={History}/>
    <div className="table session-table panel">
      <div className="table-head"><span>SESSION ID</span><span>STARTED</span><span>MATCHUP</span><span>RESULT</span><span>DURATION</span><span /></div>
      {sessions.map((session) => <button className="table-row session-row" onClick={() => setSelectedSession(session)} key={session.id}>
        <span>{session.id}</span><span>{session.started}</span><span>{session.matchup}</span><span className={session.result.toLowerCase()}>{session.result}</span><span>{session.duration}</span><span className="open-session">Open replay <ChevronRight size={14}/></span>
      </button>)}
    </div>
  </div>
  const sessionDetail = selectedSession && <SessionDetail session={selectedSession} onBack={() => setSelectedSession(null)} />
  return selectedSession ? sessionDetail : sessionList
}

function SessionDetail({ session, onBack }) {
  const [frame, setFrame] = useState(Math.round(session.totalFrames * .43))
  const [playing, setPlaying] = useState(false)
  const [overlay, setOverlay] = useState(true)
  const [speed, setSpeed] = useState(1)

  useEffect(() => {
    let replayTimer
    if (playing) {
      replayTimer = window.setInterval(() => {
        setFrame((current) => Math.min(current + Math.round(12 * speed), session.totalFrames))
      }, 200)
    }
    return () => window.clearInterval(replayTimer)
  }, [playing, speed, session.totalFrames])

  const elapsedSeconds = Math.floor(frame / 60)
  const elapsed = formatClock(elapsedSeconds)
  const frameConfidence = (91 + (frame % 43) / 10).toFixed(1)
  const replayEvents = [
    { frame: 28640, time: '07:57.33', type: 'STATE', text: 'Neutral advantage shifted to P1' },
    { frame: 28784, time: '07:59.73', type: 'VISION', text: 'Projectile startup detected' },
    { frame: 28812, time: '08:00.20', type: 'INPUT', text: 'P1 initiated Drive Rush' },
    { frame: 28852, time: '08:00.86', type: 'AGENT', text: 'Punish opportunity classified' },
    { frame: 28924, time: '08:02.06', type: 'COACH', text: 'Coaching response delivered' },
  ]

  const stepFrame = (amount) => {
    setPlaying(false)
    setFrame((current) => Math.max(0, Math.min(current + amount, session.totalFrames)))
  }

  return <div className="session-detail page-enter">
    <header className="session-detail-header">
      <button className="back-button" onClick={onBack}><ArrowLeft size={15}/> Session history</button>
      <div className="session-detail-title"><span>RECORDED SESSION</span><h1>{session.id}</h1><p>{session.started} · {session.matchup}</p></div>
      <div className="session-summary"><span className={session.result.toLowerCase()}>{session.result}</span><div><small>DURATION</small><b>{session.duration}</b></div><div><small>TOTAL FRAMES</small><b>{session.totalFrames.toLocaleString()}</b></div></div>
    </header>

    <div className="replay-grid">
      <section className="replay-player panel">
        <div className="replay-head"><div><span>SESSION REPLAY</span><b>{elapsed} / {session.duration}</b></div><button className={overlay ? 'toggle on' : 'toggle'} onClick={() => setOverlay((current) => current === false)}><Eye size={14}/> DETECTIONS <i /></button></div>
        <div className="replay-canvas"><Arena overlay={overlay} running={playing} pausedLabel="REPLAY PAUSED" showPausedOverlay={false}/><div className="frame-badge">FRAME {frame.toLocaleString()}</div></div>
        <div className="replay-controls">
          <div className="transport"><button onClick={() => setFrame(0)} aria-label="Restart replay"><RotateCcw size={15}/></button><button onClick={() => stepFrame(-1)} aria-label="Previous frame"><SkipBack size={15}/></button><button className="play-control" onClick={() => setPlaying((current) => current === false)} aria-label={playing ? 'Pause replay' : 'Play replay'}>{playing ? <Pause size={17}/> : <Play size={17}/>}</button><button onClick={() => stepFrame(1)} aria-label="Next frame"><SkipForward size={15}/></button></div>
          <input className="frame-scrubber" aria-label="Replay frame" type="range" min="0" max={session.totalFrames} value={frame} onChange={(event) => { setPlaying(false); setFrame(Number(event.target.value)) }}/>
          <span className="frame-counter">#{frame.toLocaleString()}</span>
          <select value={speed} onChange={(event) => setSpeed(Number(event.target.value))}><option value="0.25">0.25×</option><option value="0.5">0.5×</option><option value="1">1×</option><option value="2">2×</option></select>
        </div>
      </section>

      <aside className="frame-inspector panel">
        <div className="inspector-head"><div><span>FRAME INSPECTOR</span><b>#{frame.toLocaleString()}</b></div><time>{elapsed}.46</time></div>
        <div className="inspector-section"><h3>Detections <span>3 objects</span></h3>
          <DetectionRow label="PLAYER_KEN" confidence="97.4%" box="[412, 221, 168, 402]" color="green"/>
          <DetectionRow label="OPPONENT_RYU" confidence={`${frameConfidence}%`} box="[1038, 218, 172, 408]" color="blue"/>
          <DetectionRow label="PROJECTILE" confidence="91.2%" box="[824, 362, 64, 58]" color="amber"/>
        </div>
        <div className="inspector-section state-snapshot"><h3>Agent input <span>snapshot</span></h3><dl><div><dt>Phase</dt><dd>Neutral</dd></div><div><dt>Distance</dt><dd>2.8 m</dd></div><div><dt>P1 state</dt><dd>Drive Rush</dd></div><div><dt>P2 state</dt><dd>Recovery · 9f</dd></div></dl></div>
        <div className="inspector-section coach-decision"><h3>Coach decision</h3><span className="decision-tag">PUNISH WINDOW</span><p>Drive Rush through the projectile—you have enough gauge to convert safely.</p><footer><span>Relevance 93%</span><span>Latency 284 ms</span></footer></div>
      </aside>
    </div>

    <section className="replay-timeline panel">
      <div className="timeline-head"><div><span>EVENT TIMELINE</span><b>Reconstructed agent activity</b></div><small>Click any event to jump to its source frame</small></div>
      <div className="timeline-events">{replayEvents.map((event) => <button className={Math.abs(frame - event.frame) < 40 ? 'current' : ''} onClick={() => { setPlaying(false); setFrame(event.frame) }} key={event.frame}><time>{event.time}</time><span className={`event-type ${event.type.toLowerCase()}`}>{event.type}</span><p>{event.text}</p><b>#{event.frame.toLocaleString()}</b><ChevronRight size={14}/></button>)}</div>
    </section>
  </div>
}

function DetectionRow({ label, confidence, box, color }) {
  return <div className="detection-row"><i className={color}/><div><b>{label}</b><small>{box}</small></div><span>{confidence}</span></div>
}

function EvaluationsView() {
  const [evaluations, setEvaluations] = useState(INITIAL_EVALUATIONS)
  const [selectedId, setSelectedId] = useState(INITIAL_EVALUATIONS[0].id)
  const [filter, setFilter] = useState('pending')
  const [savedId, setSavedId] = useState(null)
  const [feedbackById, setFeedbackById] = useState({
    'EV-0238': { verdict: 'correct', issues: [], betterResponse: '', notes: 'Good timing and sufficiently concrete.', saved: true },
    'EV-0237': { verdict: 'needs-revision', issues: ['Too generic'], betterResponse: 'Take one step back and block; her reversal is available.', notes: 'The advice is directionally correct but should name the safer action.', saved: true },
  })

  const issueOptions = [
    'Incorrect game state', 'Unsupported information', 'Tactically incorrect', 'Delivered too late',
    'Low relevance', 'Too generic', 'Unclear or verbose', 'Excessive risk', 'Should abstain', 'Missed important data',
  ]
  const verdictOptions = [
    { id: 'correct', label: 'Correct', icon: CheckCircle2 },
    { id: 'needs-revision', label: 'Needs revision', icon: AlertTriangle },
    { id: 'incorrect', label: 'Incorrect', icon: XCircle },
    { id: 'abstain', label: 'Should abstain', icon: HelpCircle },
  ]
  const filteredEvaluations = useMemo(() => evaluations.filter((evaluation) => filter === 'all' || evaluation.status === filter), [evaluations, filter])
  const selectedEvaluation = evaluations.find((evaluation) => evaluation.id === selectedId) || evaluations[0]
  const selectedFeedback = feedbackById[selectedEvaluation.id] || { verdict: '', issues: [], betterResponse: '', notes: '', saved: false }
  const pendingCount = evaluations.filter((evaluation) => evaluation.status === 'pending').length
  const reviewedCount = evaluations.filter((evaluation) => evaluation.status === 'reviewed').length
  const revisionCount = Object.values(feedbackById).filter((feedback) => feedback.verdict === 'needs-revision' || feedback.verdict === 'incorrect').length

  const updateFeedback = (changes) => {
    setSavedId(null)
    setFeedbackById((current) => ({
      ...current,
      [selectedEvaluation.id]: { ...selectedFeedback, ...changes, saved: false },
    }))
  }

  const toggleIssue = (issue) => {
    const includesIssue = selectedFeedback.issues.includes(issue)
    const nextIssues = includesIssue ? selectedFeedback.issues.filter((item) => item !== issue) : [...selectedFeedback.issues, issue]
    updateFeedback({ issues: nextIssues })
  }

  const saveReview = () => {
    setEvaluations((current) => current.map((evaluation) => evaluation.id === selectedEvaluation.id ? { ...evaluation, status: 'reviewed' } : evaluation))
    setFeedbackById((current) => ({
      ...current,
      [selectedEvaluation.id]: { ...selectedFeedback, saved: true },
    }))
    setSavedId(selectedEvaluation.id)
  }

  return <div className="evaluation-page page-enter">
    <PageIntro kicker={`${pendingCount} DECISIONS PENDING`} title="EVALUATIONS" text="Review coaching decisions and turn recurring problems into evidence for the next prompt version." icon={ClipboardCheck}/>

    <section className="evaluation-summary" aria-label="Evaluation summary">
      <EvaluationMetric label="Pending review" value={pendingCount} detail="decisions in queue" tone="amber" />
      <EvaluationMetric label="Reviewed" value={reviewedCount} detail="of this sample" tone="green" />
      <EvaluationMetric label="Prompt issues" value={revisionCount} detail="need a revision" tone="red" />
      <EvaluationMetric label="Current baseline" value="v3.2" detail="Global Coach System" tone="blue" />
    </section>

    <div className="evaluation-workspace panel">
      <aside className="evaluation-queue">
        <header className="queue-header">
          <div><span>REVIEW QUEUE</span><b>{filteredEvaluations.length} decisions</b></div>
          <Flag size={16}/>
        </header>
        <div className="queue-filters">
          {['pending', 'reviewed', 'all'].map((item) => <button className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)} key={item}>{item}</button>)}
        </div>
        <div className="queue-items">
          {filteredEvaluations.map((evaluation) => {
            const feedback = feedbackById[evaluation.id]
            return <button className={`queue-item ${selectedEvaluation.id === evaluation.id ? 'selected' : ''}`} onClick={() => { setSelectedId(evaluation.id); setSavedId(null) }} key={evaluation.id}>
              <div className="queue-item-top"><span className={`review-state ${evaluation.status}`}><i />{evaluation.status}</span><time>{evaluation.time}</time></div>
              <b>{evaluation.event}</b>
              <p>{evaluation.message}</p>
              <footer><span>{evaluation.opponent}</span><span>{evaluation.category}</span>{feedback?.verdict && <strong>{feedback.verdict.replace('-', ' ')}</strong>}</footer>
            </button>
          })}
          {filteredEvaluations.length === 0 && <div className="queue-empty"><CheckCircle2 size={20}/><b>Queue cleared</b><span>No decisions match this filter.</span></div>}
        </div>
      </aside>

      <section className="evaluation-detail">
        <header className="evaluation-detail-header">
          <div><span>DECISION {selectedEvaluation.id}</span><h2>{selectedEvaluation.event}</h2><p>{selectedEvaluation.session} · Frame #{selectedEvaluation.frame.toLocaleString()} · {selectedEvaluation.time}</p></div>
          <span className={`review-state ${selectedEvaluation.status}`}><i />{selectedEvaluation.status}</span>
        </header>

        <div className="evaluation-content">
          <div className="evidence-column">
            <section className="evaluation-block evidence-block">
              <BlockTitle eyebrow="VISUAL EVIDENCE" title="Decision window" meta="± 2.0 seconds" />
              <div className="evaluation-canvas"><Arena overlay running={false} showPausedOverlay={false}/><span className="evidence-frame">FRAME {selectedEvaluation.frame.toLocaleString()}</span></div>
              <div className="evidence-transport"><button aria-label="Previous frame"><SkipBack size={14}/></button><button className="play-control" aria-label="Play evidence"><Play size={14}/></button><button aria-label="Next frame"><SkipForward size={14}/></button><input type="range" min="0" max="100" defaultValue="52" aria-label="Evidence timeline"/><time>{selectedEvaluation.time}</time></div>
            </section>

            <section className="evaluation-block agent-input-block">
              <BlockTitle eyebrow="AGENT INPUT" title="Structured state" meta={`${selectedEvaluation.confidence} scene confidence`} />
              <dl>{selectedEvaluation.snapshot.map(([label, value]) => <div key={label}><dt>{label}</dt><dd className={value === 'Unknown' || label === 'Vision age' && Number.parseInt(value, 10) > 100 ? 'uncertain' : ''}>{value}</dd></div>)}</dl>
              <div className="input-provenance"><CircleDot size={12}/><span>Snapshot consolidated from vision model and deterministic HUD extraction.</span></div>
            </section>
          </div>

          <div className="review-column">
            <section className="evaluation-block response-block">
              <BlockTitle eyebrow="COACH OUTPUT" title="Generated recommendation" meta={selectedEvaluation.category} />
              <blockquote><MessageSquareText size={17}/><p>{selectedEvaluation.message}</p></blockquote>
              <div className="response-meta"><span><b>{selectedEvaluation.latency}</b> latency</span><span><b>{selectedEvaluation.tokens}</b> tokens</span><span><b>{selectedEvaluation.confidence}</b> relevance</span></div>
              <div className="prompt-trace"><FileCode2 size={14}/><div><span>PROMPT TRACE</span><b>{selectedEvaluation.promptVersion}</b></div></div>
            </section>

            <section className="evaluation-block feedback-block">
              <BlockTitle eyebrow="HUMAN FEEDBACK" title="Review this decision" meta={selectedFeedback.saved ? 'Saved review' : 'Unsaved'} />
              <fieldset className="verdict-field"><legend>Verdict</legend><div className="verdict-options">
                {verdictOptions.map(({ id, label, icon: Icon }) => <button className={selectedFeedback.verdict === id ? `selected ${id}` : ''} onClick={() => updateFeedback({ verdict: id })} type="button" key={id}><Icon size={15}/><span>{label}</span></button>)}
              </div></fieldset>

              <fieldset className="issue-field"><legend><Tag size={12}/> What influenced this rating?</legend><div className="issue-options">
                {issueOptions.map((issue) => <button className={selectedFeedback.issues.includes(issue) ? 'selected' : ''} onClick={() => toggleIssue(issue)} type="button" key={issue}>{issue}</button>)}
              </div></fieldset>

              <label className="feedback-textarea"><span>Better recommendation <small>optional</small></span><textarea value={selectedFeedback.betterResponse} onChange={(event) => updateFeedback({ betterResponse: event.target.value })} placeholder="Write what the coach should have said instead." /></label>
              <label className="feedback-note"><span>Review note <small>optional</small></span><input value={selectedFeedback.notes} onChange={(event) => updateFeedback({ notes: event.target.value })} placeholder="Add context for the next prompt revision." /></label>

              <footer className="feedback-actions">
                <span>{savedId === selectedEvaluation.id ? <><Check size={13}/> Review saved and linked to {selectedEvaluation.promptVersion}</> : 'Feedback remains attached to this decision and prompt version.'}</span>
                <button className="primary-action" disabled={selectedFeedback.verdict.length === 0} onClick={saveReview}><Save size={14}/> Save review</button>
              </footer>
            </section>
          </div>
        </div>
      </section>
    </div>
  </div>
}

function EvaluationMetric({ label, value, detail, tone }) {
  return <article className={`evaluation-metric ${tone}`}><span>{label}</span><b>{value}</b><small>{detail}</small></article>
}

function BlockTitle({ eyebrow, title, meta }) {
  return <header className="block-title"><div><span>{eyebrow}</span><h3>{title}</h3></div><small>{meta}</small></header>
}

function PromptsView() {
  const initialPrompts = [
    { id: 'global', name: 'Global Coach System', version: '3.2', type: 'system', enabled: true, scope: 'Every session', content: 'You are a real-time fighting game coach.\nPrioritize actionable advice under 24 words.\nOnly respond when a clear decision window is detected.\nNever interrupt an active combo.' },
    { id: 'ryu', name: 'Ryu / Matchup Context', version: '4.2', type: 'character', enabled: true, scope: 'Opponent: Ryu', content: 'Opponent archetype: balanced / shoto.\n\nWhen Ryu is at mid-range:\n- Watch for slow projectile startup.\n- Suggest Drive Rush on confirmed recovery.\n- Track anti-air success across the round.' },
    { id: 'cammy', name: 'Cammy / Matchup Context', version: '5.2', type: 'character', enabled: true, scope: 'Opponent: Cammy', content: 'Opponent archetype: rushdown.\n\nPrioritize spacing outside dive-kick range.\nCall out unsafe Spiral Arrow recovery.\nAvoid long explanations during corner pressure.' },
    { id: 'jp', name: 'JP / Matchup Context', version: '6.2', type: 'character', enabled: false, scope: 'Opponent: JP', content: 'Opponent archetype: zoner.\n\nTrack portal placement and projectile cadence.\nRecommend patient movement over speculative jumps.' },
    { id: 'luke', name: 'Luke / Matchup Context', version: '2.4', type: 'character', enabled: false, scope: 'Opponent: Luke', content: 'Opponent archetype: balanced.\n\nIdentify Sand Blast recovery windows.\nTrack perfect Flash Knuckle conversions.' },
    { id: 'defense', name: 'Defensive Recovery', version: '1.8', type: 'modifier', enabled: true, scope: 'Low health state', content: 'Activate when player health falls below 30%.\nPrioritize safe defensive options and resource preservation.\nDo not recommend high-risk reversals without meter.' },
  ]
  const [prompts, setPrompts] = useState(initialPrompts)
  const [selectedId, setSelectedId] = useState('ryu')
  const [filter, setFilter] = useState('all')
  const [query, setQuery] = useState('')
  const [saved, setSaved] = useState(true)
  const selectedPrompt = prompts.find((prompt) => prompt.id === selectedId)
  const activeCount = prompts.filter((prompt) => prompt.enabled).length
  const filteredPrompts = useMemo(() => prompts.filter((prompt) => {
    const matchesQuery = prompt.name.toLowerCase().includes(query.toLowerCase())
    const matchesFilter = filter === 'all' || (filter === 'active' && prompt.enabled) || (filter === 'inactive' && prompt.enabled === false)
    return matchesQuery && matchesFilter
  }), [prompts, query, filter])

  const togglePrompt = (id) => {
    setPrompts((current) => current.map((prompt) => prompt.id === id ? { ...prompt, enabled: prompt.enabled === false } : prompt))
  }

  const updatePromptContent = (content) => {
    setPrompts((current) => current.map((prompt) => prompt.id === selectedId ? { ...prompt, content } : prompt))
    setSaved(false)
  }

  return <div className="generic-page prompts-page page-enter">
    <PageIntro kicker={`${activeCount} OF ${prompts.length} ENABLED`} title="PROMPT LIBRARY" text="Choose which contexts are injected into the coach and edit their current versions." icon={FileCode2}/>
    <div className="prompt-workspace panel">
      <aside className="prompt-list">
        <div className="prompt-list-head"><div><b>Prompt registry</b><span>{activeCount} active</span></div></div>
        <label className="prompt-search"><Search size={14}/><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search prompts" /></label>
        <div className="prompt-filters">
          {['all', 'active', 'inactive'].map((item) => <button key={item} className={filter === item ? 'selected' : ''} onClick={() => setFilter(item)}>{item}</button>)}
        </div>
        <div className="prompt-items">
          {filteredPrompts.map((prompt) => <div className={`prompt-row ${selectedId === prompt.id ? 'selected' : ''}`} key={prompt.id}>
            <button className="prompt-select" onClick={() => setSelectedId(prompt.id)}>
              <FileCode2 size={15}/><span><b>{prompt.name}</b><small>v{prompt.version} · {prompt.type}</small></span>
            </button>
            <label className="prompt-switch" title={prompt.enabled ? 'Disable prompt' : 'Enable prompt'}>
              <input type="checkbox" checked={prompt.enabled} onChange={() => togglePrompt(prompt.id)}/><i />
            </label>
          </div>)}
          {filteredPrompts.length === 0 && <div className="prompt-empty">No prompts match this filter.</div>}
        </div>
      </aside>
      <section className="editor">
        <div className="editor-head">
          <div><span>EDITING</span><b>{selectedPrompt.name}</b><small>{selectedPrompt.scope} · version {selectedPrompt.version}</small></div>
          <div className="editor-actions"><span className={selectedPrompt.enabled ? 'prompt-status active' : 'prompt-status'}><i />{selectedPrompt.enabled ? 'Enabled' : 'Disabled'}</span><button disabled={saved} onClick={() => setSaved(true)}>{saved ? 'VERSION SAVED' : 'SAVE VERSION'}</button></div>
        </div>
        {selectedPrompt.enabled === false && <div className="inactive-notice">This prompt is disabled and will not be injected into new sessions.</div>}
        <div className="prompt-editor-body">
          <label>Prompt content</label>
          <textarea value={selectedPrompt.content} onChange={(event) => updatePromptContent(event.target.value)} spellCheck="false" />
          <div className="editor-meta"><span>{selectedPrompt.content.length} characters</span><span>Last edited today, 14:32</span></div>
        </div>
      </section>
    </div>
  </div>
}

function SettingsView() {
  const initialConfig = {
    captureSource: 'Street Fighter 6.exe',
    captureMethod: 'DXGI Desktop Duplication',
    display: 'Display 1 · 1920 × 1080',
    frameRate: '60 FPS',
    captureAudio: false,
    model: 'YOLOv8-fight-2.3',
    device: 'NVIDIA RTX 4070 · CUDA:0',
    precision: 'FP16',
    inputSize: '1280 × 720',
    confidence: 72,
    tracking: true,
    coachModel: 'Coach Agent · Local',
    responseMode: 'Decision windows',
    responseLength: 'Short · up to 24 words',
    cooldown: '4 seconds',
    voiceOutput: true,
    includeConfidence: true,
  }
  const [config, setConfig] = useState(initialConfig)
  const [saved, setSaved] = useState(true)

  const updateConfig = (field, value) => {
    setConfig((current) => ({ ...current, [field]: value }))
    setSaved(false)
  }

  const restoreDefaults = () => {
    setConfig(initialConfig)
    setSaved(false)
  }

  const saveConfiguration = () => {
    setSaved(true)
  }

  return <div className="settings-page page-enter">
    <div className="settings-titlebar">
      <PageIntro kicker="LOCAL ENVIRONMENT" title="SYSTEM SETTINGS" text="Configure the complete capture, vision, and coaching pipeline from one place." icon={Settings}/>
      <div className="settings-actions">
        <span className={saved ? 'save-state saved' : 'save-state'}>{saved ? <><Check size={13}/> All changes saved</> : 'Unsaved changes'}</span>
        <button className="secondary-action" onClick={restoreDefaults}>Restore defaults</button>
        <button className="primary-action" onClick={saveConfiguration} disabled={saved}>Save changes</button>
      </div>
    </div>

    <div className="settings-stack">
      <SettingsSection icon={Gamepad2} index="01" title="Capture Source" description="Select the game window and define how frames enter the processing pipeline." status="Connected">
        <Field label="Application window" help="Window used as the primary video source.">
          <select value={config.captureSource} onChange={(event) => updateConfig('captureSource', event.target.value)}><option>Street Fighter 6.exe</option><option>Desktop preview</option><option>OBS Virtual Camera</option></select>
        </Field>
        <Field label="Capture method" help="DXGI provides the lowest latency on Windows.">
          <select value={config.captureMethod} onChange={(event) => updateConfig('captureMethod', event.target.value)}><option>DXGI Desktop Duplication</option><option>Windows Graphics Capture</option><option>OBS Virtual Camera</option></select>
        </Field>
        <Field label="Display and resolution">
          <select value={config.display} onChange={(event) => updateConfig('display', event.target.value)}><option>Display 1 · 1920 × 1080</option><option>Display 2 · 2560 × 1440</option></select>
        </Field>
        <Field label="Target frame rate">
          <select value={config.frameRate} onChange={(event) => updateConfig('frameRate', event.target.value)}><option>60 FPS</option><option>30 FPS</option><option>Native frame rate</option></select>
        </Field>
        <ToggleField label="Capture game audio" description="Make the audio track available to future multimodal models." checked={config.captureAudio} onChange={(checked) => updateConfig('captureAudio', checked)}/>
        <PipelineNote label="Current signal" value="1920 × 1080 · 59.8 FPS · 8.4 ms capture latency" />
      </SettingsSection>

      <SettingsSection icon={Box} index="02" title="Vision Model" description="Control the model, execution device, and detection thresholds used for every captured frame." status="Ready">
        <Field label="Active model" help="Model loaded when a session starts.">
          <select value={config.model} onChange={(event) => updateConfig('model', event.target.value)}><option>YOLOv8-fight-2.3</option><option>YOLOv8-fight-2.2</option><option>Experimental pose model</option></select>
        </Field>
        <Field label="Compute device">
          <select value={config.device} onChange={(event) => updateConfig('device', event.target.value)}><option>NVIDIA RTX 4070 · CUDA:0</option><option>CPU · Intel AVX2</option></select>
        </Field>
        <Field label="Inference precision">
          <select value={config.precision} onChange={(event) => updateConfig('precision', event.target.value)}><option>FP16</option><option>FP32</option><option>INT8</option></select>
        </Field>
        <Field label="Model input size">
          <select value={config.inputSize} onChange={(event) => updateConfig('inputSize', event.target.value)}><option>1280 × 720</option><option>960 × 544</option><option>640 × 640</option></select>
        </Field>
        <RangeField label="Minimum confidence" value={config.confidence} onChange={(value) => updateConfig('confidence', value)} suffix="%" />
        <ToggleField label="Persistent object tracking" description="Keep stable IDs for players and projectiles across frames." checked={config.tracking} onChange={(checked) => updateConfig('tracking', checked)}/>
        <PipelineNote label="Expected performance" value="18.6 ms inference · ~53 processed FPS · 2.8 GB VRAM" />
      </SettingsSection>

      <SettingsSection icon={BrainCircuit} index="03" title="Coach Agent" description="Define how the language agent consumes match state and delivers real-time guidance." status="Active">
        <Field label="Agent model" help="Runtime responsible for tactical responses.">
          <select value={config.coachModel} onChange={(event) => updateConfig('coachModel', event.target.value)}><option>Coach Agent · Local</option><option>Coach Agent · Cloud</option><option>Evaluation mode · No output</option></select>
        </Field>
        <Field label="Response trigger" help="Controls when the agent is allowed to interrupt.">
          <select value={config.responseMode} onChange={(event) => updateConfig('responseMode', event.target.value)}><option>Decision windows</option><option>Every important event</option><option>Manual trigger only</option></select>
        </Field>
        <Field label="Response length">
          <select value={config.responseLength} onChange={(event) => updateConfig('responseLength', event.target.value)}><option>Short · up to 24 words</option><option>Compact · up to 40 words</option><option>Detailed · up to 80 words</option></select>
        </Field>
        <Field label="Minimum cooldown">
          <select value={config.cooldown} onChange={(event) => updateConfig('cooldown', event.target.value)}><option>4 seconds</option><option>6 seconds</option><option>10 seconds</option></select>
        </Field>
        <ToggleField label="Voice output" description="Read coaching messages aloud while keeping the text feed." checked={config.voiceOutput} onChange={(checked) => updateConfig('voiceOutput', checked)}/>
        <ToggleField label="Include model confidence" description="Attach confidence and relevance metadata to every response." checked={config.includeConfidence} onChange={(checked) => updateConfig('includeConfidence', checked)}/>
        <PipelineNote label="Prompt context" value="Global Coach System v3.2 + matchup profile · 3,840 tokens" />
      </SettingsSection>
    </div>
  </div>
}

function PageIntro({ kicker, title, text, icon: Icon }) {
  return <div className="page-intro"><div><span>{kicker}</span><h1>{title}</h1><p>{text}</p></div><Icon size={56} strokeWidth={1}/></div>
}

function SettingsSection({ icon: Icon, index, title, description, status, children }) {
  return <section className="settings-section panel">
    <header className="settings-section-header">
      <div className="settings-section-identity"><span className="settings-index">{index}</span><div className="settings-icon"><Icon size={19}/></div><div><h2>{title}</h2><p>{description}</p></div></div>
      <span className="section-status"><i />{status}</span>
    </header>
    <div className="settings-fields">{children}</div>
  </section>
}

function Field({ label, help, children }) {
  return <label className="settings-field"><span>{label}</span>{children}{help && <small>{help}</small>}</label>
}

function ToggleField({ label, description, checked, onChange }) {
  return <label className="toggle-field"><span><b>{label}</b><small>{description}</small></span><input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)}/><i /></label>
}

function RangeField({ label, value, onChange, suffix }) {
  return <label className="settings-field range-field"><span>{label}<b>{value}{suffix}</b></span><input type="range" min="40" max="95" value={value} onChange={(event) => onChange(Number(event.target.value))}/><small>Lower values increase recall; higher values reduce false positives.</small></label>
}

function PipelineNote({ label, value }) {
  return <div className="pipeline-note"><span><CircleDot size={13}/>{label}</span><b>{value}</b></div>
}

createRoot(document.getElementById('root')).render(<App />)
