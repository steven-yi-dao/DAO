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
  buildJson,
  buildSrt,
  buildTxt,
  estimateDuration,
  genSegments,
  seedHistory,
  seedQueue,
  triggerDownload,
} from './lib/utils';
import { useQueueAnnouncements } from './hooks/useQueueAnnouncements';
import { Header } from './components/Header';
import { LiveAnnouncer } from './components/LiveAnnouncer';
import { ConnectGate } from './components/ConnectGate';
import { HistoryScreen } from './components/HistoryScreen';
import { TranscriptEditor } from './components/TranscriptEditor';
import { FlowScreen } from './components/FlowScreen';
import { SessionBar } from './components/SessionBar';
import './App.css';

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

  const [nav, setNavState] = useState<NavTab>('new');
  const [step, setStep] = useState<FlowStep>(1);
  const [playhead, setPlayhead] = useState(0);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settings, setSettings] = useState<TranscriptionSettings>({
    language: 'en-US',
    model: 'balanced',
    diarization: false,
  });

  const [files, setFiles] = useState<TranscriptFile[]>(() => seedQueue());
  const [history, setHistory] = useState<TranscriptFile[]>(() => seedHistory());
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<FileSource | null>(null);

  // Set once the user hits "Start transcription" — until then their own queued
  // files wait, while external jobs may take the shared processing slot.
  const [transcriptionStarted, setTranscriptionStarted] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const seedStartedRef = useRef(false);
  const intervalsRef = useRef<Set<ReturnType<typeof setInterval>>>(new Set());
  // File ids whose completion (history entry / queue removal) is already handled,
  // so the effect below stays idempotent across re-renders.
  const completionHandledRef = useRef<Set<string>>(new Set());
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const filesRef = useRef(files);
  filesRef.current = files;
  // Object URLs for recordings uploaded in this session, keyed by file id (a history
  // entry shares the URL of the queue entry it came from). Playback is entirely local:
  // the audio is never fetched back from the server, which does not keep it.
  const mediaUrlsRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const mediaUrls = mediaUrlsRef.current;
    return () => {
      intervalsRef.current.forEach((id) => clearInterval(id));
      intervalsRef.current.clear();
      new Set(mediaUrls.values()).forEach((url) => URL.revokeObjectURL(url));
      mediaUrls.clear();
    };
  }, []);

  // Once the user connects, kick off any external (other users') jobs already in the
  // shared cloud queue: uploads advance in the background, then join the queue.
  useEffect(() => {
    if (session !== 'connected' || seedStartedRef.current) return;
    seedStartedRef.current = true;
    files.forEach((f) => {
      if (f.external && f.status === 'uploading') runSeedJob(f.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  // Queue engine: the shared instance works one file at a time, in queue order.
  // Whenever the processing slot is free, promote the next eligible queued file —
  // external jobs run on their own; the user's files wait for "Start transcription".
  useEffect(() => {
    if (session !== 'connected') return;
    if (files.some((f) => f.status === 'processing')) return;
    const next = files.find((f) => f.status === 'queued' && (f.external || transcriptionStarted));
    if (!next) return;
    const timer = setTimeout(() => {
      setFiles((prev) => {
        if (prev.some((f) => f.status === 'processing')) return prev;
        return prev.map((f) => (f.id === next.id ? { ...f, status: 'processing' as FileStatus, progress: 1 } : f));
      });
      runProgress(next.id);
    }, 150);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files, session, transcriptionStarted]);

  // React to files finishing: log the user's own results to history once, and drop
  // other users' completed jobs from the shared queue after showing them briefly.
  useEffect(() => {
    files.forEach((f) => {
      const finished = (f.status === 'done' || f.status === 'error') && f.progress >= 100;
      if (!finished || completionHandledRef.current.has(f.id)) return;
      completionHandledRef.current.add(f.id);
      if (f.external) {
        setTimeout(() => {
          setFiles((cur) => cur.filter((x) => x.id !== f.id));
        }, 2500);
      } else {
        addHistoryEntry(f);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [files]);


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
        setInstance({ type: 'ml.g4dn.xlarge', region: 'us-east-2', id });
        setStep(1);
      }
    }, 1300);
  }

  function endSession() {
    setSession('disconnected');
    setInstance(null);
    setTranscriptionStarted(false);
    completionHandledRef.current.clear();
    setNavState('new');
    setStep(1);
    setSelectedFileId(null);
    setSelectedSource(null);
    setFiles([]);
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
          uploader: 'Dawson Ash',
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
          uploader: 'Dawson Ash',
        };
      }
      mediaUrlsRef.current.set(id, URL.createObjectURL(f));
      return {
        id,
        name: f.name,
        size: f.size,
        duration: estimateDuration(f.size),
        status: 'selected',
        progress: 0,
        errorMsg: null,
        uploader: 'Dawson Ash',
      };
    });
    setFiles((prev) => [...prev, ...additions]);
  }

  // Moves every staged ("selected") file into the shared cloud queue and starts
  // its upload. From there the queue engine drives it through processing and
  // completion automatically — no one has to click "start", so a shared instance
  // never stalls waiting on a single user. Advances to the Process step to watch.
  function addSelectedToQueue() {
    const ready = filesRef.current.filter((f) => f.status === 'selected' && !f.external);
    if (!ready.length) return;
    setTranscriptionStarted(true);
    setFiles((prev) =>
      prev.map((f) => (f.status === 'selected' ? { ...f, status: 'uploading' as FileStatus, progress: 0 } : f)),
    );
    ready.forEach((f) => runUploadProgress(f.id));
    setStep(2);
  }

  // Advances a file's upload phase. The updater stays pure (the random step is
  // drawn outside it) and the interval retires itself once the file leaves the
  // 'uploading' state; queued files are picked up by the queue engine effect.
  function driveUpload(fileId: string, base: number, jitter: number, tickMs: number) {
    const interval = setInterval(() => {
      const current = filesRef.current.find((f) => f.id === fileId);
      if (!current || current.status !== 'uploading') {
        clearTrackedInterval(interval);
        return;
      }
      const delta = base + Math.random() * jitter;
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== fileId || f.status !== 'uploading') return f;
          const nextProgress = f.progress + delta;
          if (nextProgress >= 100) return { ...f, status: 'queued' as FileStatus, progress: 100 };
          return { ...f, progress: nextProgress };
        }),
      );
    }, tickMs);
    trackInterval(interval);
  }

  function runUploadProgress(fileId: string) {
    driveUpload(fileId, 14, 20, 660);
  }

  // Drives an external (another user's) job through its upload phase; once uploaded
  // it joins the shared cloud queue and waits its turn like everything else.
  function runSeedJob(fileId: string) {
    driveUpload(fileId, 6, 9, 900);
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

  // Advances the processing phase. Like driveUpload, the updater is pure and the
  // interval retires itself once the file finishes; the completion effect takes
  // care of history entries and clearing external jobs from the shared queue.
  function runProgress(fileId: string) {
    const interval = setInterval(() => {
      const current = filesRef.current.find((f) => f.id === fileId);
      if (!current || current.status !== 'processing') {
        clearTrackedInterval(interval);
        return;
      }
      const delta = 8 + Math.random() * 14;
      const diarization = settingsRef.current.diarization;
      setFiles((prev) =>
        prev.map((f) => {
          if (f.id !== fileId || f.status !== 'processing') return f;
          const nextProgress = f.progress + delta;
          if (nextProgress < 100) return { ...f, progress: nextProgress };
          const failed = !f.external && f.name.toLowerCase().includes('fail');
          return failed
            ? {
                ...f,
                status: 'error' as FileStatus,
                progress: 100,
                errorMsg: "We couldn't transcribe this file. It may be corrupted or unreadable.",
              }
            : {
                ...f,
                status: 'done' as FileStatus,
                progress: 100,
                segments: genSegments(diarization),
              };
        }),
      );
    }, 1050);
    trackInterval(interval);
  }

  function addHistoryEntry(file: TranscriptFile) {
    const entry: TranscriptFile = {
      id: nextId('h'),
      name: file.name,
      size: file.size,
      duration: file.duration,
      status: file.status,
      progress: file.progress,
      errorMsg: file.errorMsg,
      date: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }),
      segments: file.segments,
    };
    const mediaUrl = mediaUrlsRef.current.get(file.id);
    if (mediaUrl) mediaUrlsRef.current.set(entry.id, mediaUrl);
    setHistory((prev) => [entry, ...prev]);
  }

  function retryFile(fileId: string) {
    // A retried file gets a fresh completion (and, if it succeeds, a fresh history entry).
    completionHandledRef.current.delete(fileId);
    setFiles((prev) =>
      prev.map((f) => (f.id === fileId ? { ...f, status: 'queued' as FileStatus, progress: 0, errorMsg: null } : f)),
    );
  }

  function removeFile(fileId: string) {
    releaseMediaUrl(fileId);
    setFiles((prev) => prev.filter((f) => f.id !== fileId));
  }

  // Drops this file's claim on its recording, revoking the URL only once nothing
  // else — a history entry made from the same upload — still points at it.
  function releaseMediaUrl(fileId: string) {
    const url = mediaUrlsRef.current.get(fileId);
    if (!url) return;
    mediaUrlsRef.current.delete(fileId);
    if (![...mediaUrlsRef.current.values()].includes(url)) URL.revokeObjectURL(url);
  }

  function selectFile(fileId: string, source: FileSource) {
    setSelectedFileId(fileId);
    setSelectedSource(source);
    setPlayhead(0);
  }

  function scrubTo(seconds: number) {
    setPlayhead(seconds);
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

  const queueAnnouncement = useQueueAnnouncements(files);

  const isConnected = session === 'connected';
  const connecting = session === 'connecting';
  const selected = getSelectedFile();
  const showConnectGate = !isConnected;
  const showFlowScreen = isConnected && nav === 'new' && !selected;
  const showHistoryScreen = isConnected && nav === 'history' && !selected;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main">
        Skip to main content
      </a>

      <LiveAnnouncer announcement={queueAnnouncement} />

      <Header isConnected={isConnected} nav={nav} onToggleHistory={() => setNav(nav === 'history' ? 'new' : 'history')} />

      <main id="main" className="app-main" tabIndex={-1}>
        {showConnectGate && (
          <ConnectGate connecting={connecting} connectError={connectError} onStart={startSession} />
        )}

        {showHistoryScreen && <HistoryScreen history={history} onView={(id) => selectFile(id, 'history')} />}

        {selected && (
          <TranscriptEditor
            file={selected}
            source={selectedSource!}
            mediaUrl={mediaUrlsRef.current.get(selected.id) ?? null}
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
            onAddToQueue={addSelectedToQueue}
            onBackToTools={endSession}
            onRetryFile={retryFile}
            onBackToUpload={() => setStep(1)}
            onContinueToReview={() => setStep(3)}
            onBackToProcess={() => setStep(2)}
            onViewFile={(id) => selectFile(id, 'queue')}
          />
        )}
      </main>

      {isConnected && (
        <SessionBar session={session} instance={instance} onEndSession={endSession} />
      )}

    </div>
  );
}
