import { useEffect, useRef, useState } from 'react';
import type {
  FileSource,
  FileStatus,
  FlowStep,
  Instance,
  NavTab,
  SessionState,
  TranscriptFile,
  TranscriptionSettings,
} from './types';
import {
  ALLOWED_EXTENSIONS,
  MAX_BYTES,
  IDLE_WARN_MS,
  IDLE_LIMIT_S,
  buildJson,
  buildSrt,
  buildTxt,
  estimateDuration,
  formatDuration,
  genSegments,
  seedHistory,
  triggerDownload,
} from './lib/utils';
import { Header } from './components/Header';
import { ConnectGate } from './components/ConnectGate';
import { HistoryScreen } from './components/HistoryScreen';
import { TranscriptEditor } from './components/TranscriptEditor';
import { FlowScreen } from './components/FlowScreen';
import { SessionBar } from './components/SessionBar';
import { IdleModal } from './components/IdleModal';

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${Date.now().toString(36)}-${idCounter}`;
}

export default function App() {
  const [session, setSession] = useState<SessionState>('disconnected');
  const [connectError, setConnectError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState(0);
  const [instance, setInstance] = useState<Instance | null>(null);
  const [lastActivity, setLastActivity] = useState(Date.now());
  const [idleWarn, setIdleWarn] = useState(false);
  const [idleSecondsLeft, setIdleSecondsLeft] = useState(0);

  const [nav, setNavState] = useState<NavTab>('new');
  const [step, setStep] = useState<FlowStep>(1);
  const [playhead, setPlayhead] = useState(0);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<TranscriptionSettings>({
    language: 'en-US',
    model: 'balanced',
    diarization: false,
  });

  const [files, setFiles] = useState<TranscriptFile[]>([]);
  const [history, setHistory] = useState<TranscriptFile[]>(() => seedHistory());
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<FileSource | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const intervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  useEffect(() => {
    return () => {
      intervalsRef.current.forEach((id) => clearInterval(id));
      intervalsRef.current.clear();
    };
  }, []);

  // Idle-timeout ticker: warns then ends the session after sitting idle too long.
  useEffect(() => {
    const tick = setInterval(() => {
      if (session !== 'connected') return;
      const elapsed = Date.now() - lastActivity;
      if (elapsed >= IDLE_WARN_MS) {
        const secondsLeft = IDLE_LIMIT_S - Math.floor((elapsed - IDLE_WARN_MS) / 1000);
        if (secondsLeft <= 0) {
          endSession();
        } else {
          setIdleWarn(true);
          setIdleSecondsLeft(secondsLeft);
        }
      }
    }, 1000);
    return () => clearInterval(tick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, lastActivity]);

  function touchActivity() {
    setLastActivity(Date.now());
  }

  function startSession() {
    setSession('connecting');
    setConnectError(null);
    const attemptNumber = attempts + 1;
    setTimeout(() => {
      if (attemptNumber === 1) {
        setAttempts(attemptNumber);
        setSession('disconnected');
        setConnectError("Couldn't provision a SageMaker instance. This is usually temporary.");
      } else {
        const id = 'sess-' + Math.random().toString(16).slice(2, 8);
        setAttempts(attemptNumber);
        setSession('connected');
        setConnectError(null);
        setInstance({ type: 'ml.g4dn.xlarge', region: 'us-east-1', id });
        setLastActivity(Date.now());
        setIdleWarn(false);
        setStep(1);
      }
    }, 1300);
  }

  function endSession() {
    setSession('disconnected');
    setInstance(null);
    setIdleWarn(false);
    setNavState('new');
    setStep(1);
    setSelectedFileId(null);
    setSelectedSource(null);
    setFiles([]);
  }

  function keepWorking() {
    setLastActivity(Date.now());
    setIdleWarn(false);
  }

  function toggleSettings() {
    setSettingsOpen((v) => !v);
  }

  function updateSetting<K extends keyof TranscriptionSettings>(key: K, value: TranscriptionSettings[K]) {
    setSettings((s) => ({ ...s, [key]: value }));
  }

  function trackInterval(id: ReturnType<typeof setInterval>) {
    intervalsRef.current.add(id);
    return id;
  }

  function clearTrackedInterval(id: ReturnType<typeof setInterval>) {
    clearInterval(id);
    intervalsRef.current.delete(id);
  }

  function handleFiles(fileList: FileList | null) {
    const arr = Array.from(fileList ?? []);
    if (!arr.length) return;
    const additions: TranscriptFile[] = arr.map((f) => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const id = nextId('f');
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return {
          id,
          name: f.name,
          size: f.size,
          duration: 0,
          status: 'error',
          progress: 0,
          errorMsg: 'Unsupported format — try MP3, WAV, M4A, FLAC, or OGG.',
        };
      }
      if (f.size > MAX_BYTES) {
        return {
          id,
          name: f.name,
          size: f.size,
          duration: 0,
          status: 'error',
          progress: 0,
          errorMsg: 'File too large — 500MB max.',
        };
      }
      return {
        id,
        name: f.name,
        size: f.size,
        duration: estimateDuration(f.size),
        status: 'uploading',
        progress: 0,
        errorMsg: null,
      };
    });
    setFiles((prev) => [...prev, ...additions]);
    touchActivity();
    additions.forEach((a) => {
      if (a.status === 'uploading') runUploadProgress(a.id);
    });
  }

  function runUploadProgress(fileId: string) {
    const interval = setInterval(() => {
      setFiles((prev) => {
        const file = prev.find((f) => f.id === fileId);
        if (!file) {
          clearTrackedInterval(interval);
          return prev;
        }
        const nextProgress = file.progress + 14 + Math.random() * 20;
        if (nextProgress >= 100) {
          clearTrackedInterval(interval);
          return prev.map((f) => (f.id === fileId ? { ...f, status: 'queued' as FileStatus, progress: 100 } : f));
        }
        return prev.map((f) => (f.id === fileId ? { ...f, progress: nextProgress } : f));
      });
    }, 220);
    trackInterval(interval);
  }

  function onFileInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    handleFiles(e.target.files);
    e.target.value = '';
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
    handleFiles(e.dataTransfer.files);
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault();
  }

  function openPicker() {
    fileInputRef.current?.click();
  }

  function startTranscription() {
    setStep(2);
    processQueue();
  }

  function processQueue() {
    setFiles((prev) => {
      if (prev.some((f) => f.status === 'processing')) return prev;
      const next = prev.find((f) => f.status === 'queued');
      if (!next) return prev;
      runProgress(next.id);
      return prev.map((f) => (f.id === next.id ? { ...f, status: 'processing' as FileStatus, progress: 1 } : f));
    });
  }

  function runProgress(fileId: string) {
    const interval = setInterval(() => {
      setFiles((prev) => {
        const file = prev.find((f) => f.id === fileId);
        if (!file) {
          clearTrackedInterval(interval);
          return prev;
        }
        const nextProgress = file.progress + 8 + Math.random() * 14;
        if (nextProgress >= 100) {
          clearTrackedInterval(interval);
          const failed = file.name.toLowerCase().includes('fail');
          const finished: TranscriptFile = failed
            ? {
                ...file,
                status: 'error',
                progress: 100,
                errorMsg: "We couldn't transcribe this file. It may be corrupted or unreadable.",
              }
            : {
                ...file,
                status: 'done',
                progress: 100,
                segments: genSegments(settingsRef.current.diarization),
              };
          addHistoryEntry(finished);
          setTimeout(() => processQueue(), 150);
          return prev.map((f) => (f.id === fileId ? finished : f));
        }
        return prev.map((f) => (f.id === fileId ? { ...f, progress: nextProgress } : f));
      });
    }, 350);
    trackInterval(interval);
  }

  function addHistoryEntry(file: TranscriptFile) {
    const entry: TranscriptFile = {
      id: 'h-' + file.id,
      name: file.name,
      size: file.size,
      duration: file.duration,
      status: file.status,
      progress: file.progress,
      errorMsg: file.errorMsg,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      segments: file.segments,
    };
    setHistory((prev) => [entry, ...prev]);
  }

  function retryFile(fileId: string) {
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, status: 'queued' as FileStatus, progress: 0, errorMsg: null } : f)),
    );
    setTimeout(() => processQueue(), 50);
  }

  function removeFile(fileId: string) {
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }

  function selectFile(fileId: string, source: FileSource) {
    setSelectedFileId(fileId);
    setSelectedSource(source);
    setPlayhead(0);
  }

  function scrubTo(seconds: number) {
    setPlayhead(seconds);
    touchActivity();
  }

  function backFromEditor() {
    setSelectedFileId(null);
    setSelectedSource(null);
  }

  function setNav(next: NavTab) {
    setNavState(next);
    setSelectedFileId(null);
    setSelectedSource(null);
  }

  function updateSegmentText(source: FileSource, fileId: string, idx: number, text: string) {
    const updater = (list: TranscriptFile[]) =>
      list.map((f) => {
        if (f.id !== fileId || !f.segments) return f;
        const segments = f.segments.map((seg, i) => (i === idx ? { ...seg, text } : seg));
        return { ...f, segments };
      });
    if (source === 'history') setHistory(updater);
    else setFiles(updater);
  }

  function getSelectedFile(): TranscriptFile | null {
    if (!selectedFileId) return null;
    const list = selectedSource === 'history' ? history : files;
    return list.find((f) => f.id === selectedFileId) ?? null;
  }

  function download(format: 'txt' | 'srt' | 'json') {
    const file = getSelectedFile();
    if (!file || !file.segments) return;
    const base = file.name.replace(/\.[^.]+$/, '');
    if (format === 'txt') triggerDownload(base + '.txt', buildTxt(file), 'text/plain');
    if (format === 'srt') triggerDownload(base + '.srt', buildSrt(file), 'text/plain');
    if (format === 'json') triggerDownload(base + '.json', buildJson(file), 'application/json');
  }

  const isConnected = session === 'connected';
  const connecting = session === 'connecting';
  const selected = getSelectedFile();
  const showConnectGate = !isConnected;
  const showFlowScreen = isConnected && nav === 'new' && !selected;
  const showHistoryScreen = isConnected && nav === 'history' && !selected;
  const idleTimeoutLabel = formatDuration(Math.round(IDLE_WARN_MS / 1000 + IDLE_LIMIT_S));

  return (
    <div
      onClick={touchActivity}
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        background: '#F5F4F1',
        position: 'relative',
        boxSizing: 'border-box',
      }}
    >
      <Header isConnected={isConnected} nav={nav} onToggleHistory={() => setNav(nav === 'history' ? 'new' : 'history')} />

      {showConnectGate && (
        <ConnectGate connecting={connecting} connectError={connectError} onStart={startSession} />
      )}

      {showHistoryScreen && <HistoryScreen history={history} onView={(id) => selectFile(id, 'history')} />}

      {selected && (
        <TranscriptEditor
          file={selected}
          source={selectedSource!}
          playhead={playhead}
          onBack={backFromEditor}
          onScrub={scrubTo}
          onSegmentEdit={(idx, text) => updateSegmentText(selectedSource!, selected.id, idx, text)}
          onDownload={download}
        />
      )}

      {showFlowScreen && (
        <FlowScreen
          step={step}
          onStepClick={setStep}
          files={files}
          settingsOpen={settingsOpen}
          settings={settings}
          fileInputRef={fileInputRef}
          onToggleSettings={toggleSettings}
          onUpdateSetting={updateSetting}
          onDragOver={onDragOver}
          onDrop={onDrop}
          onOpenPicker={openPicker}
          onFileInputChange={onFileInputChange}
          onRemoveFile={removeFile}
          onStartTranscription={startTranscription}
          onRetryFile={retryFile}
          onBackToUpload={() => setStep(1)}
          onContinueToReview={() => setStep(3)}
          onBackToProcess={() => setStep(2)}
          onViewFile={(id) => selectFile(id, 'queue')}
        />
      )}

      {isConnected && (
        <SessionBar session={session} instance={instance} idleTimeoutLabel={idleTimeoutLabel} onEndSession={endSession} />
      )}

      {idleWarn && <IdleModal idleSecondsLeft={idleSecondsLeft} onEndNow={endSession} onKeepWorking={keepWorking} />}
    </div>
  );
}
