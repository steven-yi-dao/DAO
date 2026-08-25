import { useEffect, useMemo, useRef, useState } from 'react';
import type { FileSource, FlowStep, NavTab, Segment, SessionState, TranscriptFile } from './types';
import {
  ALLOWED_EXTENSIONS,
  MAX_BYTES,
  buildJson,
  buildSrt,
  buildTxt,
  triggerDownload,
} from './lib/utils';
import {
  createJob,
  deleteJob,
  errorMessage,
  getTranscript,
  health,
  mapJob,
  retryJob,
} from './lib/api';
import { useJobPolling } from './hooks/useJobPolling';
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

  const [nav, setNavState] = useState<NavTab>('new');
  const [step, setStep] = useState<FlowStep>(1);
  const [playhead, setPlayhead] = useState(0);

  // Staged files plus every job the server currently knows about, reconciled by
  // the polling effect below. Rows without a `jobId` exist only in this browser.
  const [files, setFiles] = useState<TranscriptFile[]>([]);
  // Jobs uploaded from this browser this session. Not ownership — the backend
  // has no accounts — just which jobs belong to the flow the user is walking.
  const [sessionJobIds, setSessionJobIds] = useState<string[]>([]);
  // Fetched transcripts, keyed by job id. Review-step edits are applied here and
  // stay client-side; the backend keeps the original WhisperX output only.
  const [transcripts, setTranscripts] = useState<Record<string, Segment[]>>({});
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [selectedSource, setSelectedSource] = useState<FileSource | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // The picked File objects themselves, which the TranscriptFile rows can't
  // carry. Without these there is nothing to POST.
  const pendingFilesRef = useRef<Map<string, File>>(new Map());
  // Object URLs for the recordings picked this session, keyed by the same client
  // id. Unlike pendingFilesRef these outlive the upload, so the editor can still
  // play a file whose bytes the POST has already consumed. Playback is entirely
  // local; the server deletes source audio once the transcript is written.
  const mediaUrlsRef = useRef<Map<string, string>>(new Map());
  const filesRef = useRef(files);
  filesRef.current = files;

  const isConnected = session === 'connected';
  const { jobs, error: pollError } = useJobPolling(isConnected);

  // Fold the polled server state into the local rows. Staged and uploading rows
  // have no server counterpart yet and are carried through untouched; rows that
  // already have a job id keep their client id so React keys and the queue
  // announcer don't see them vanish and reappear.
  useEffect(() => {
    setFiles((prev) => {
      const local = prev.filter((f) => !f.jobId);
      const byJobId = new Map(prev.filter((f) => f.jobId).map((f) => [f.jobId as string, f]));
      // The API returns newest first; the queue reads oldest first, since
      // position 1 is the job that runs next.
      const server = [...jobs].reverse().map((job) => {
        const mapped = mapJob(job);
        const existing = byJobId.get(job.jobId);
        if (!existing) return mapped;
        const unchanged =
          existing.status === mapped.status &&
          existing.duration === mapped.duration &&
          existing.errorMsg === mapped.errorMsg &&
          existing.date === mapped.date &&
          existing.name === mapped.name;
        return unchanged ? existing : { ...mapped, id: existing.id };
      });
      const next = [...local, ...server];
      const same = next.length === prev.length && next.every((f, i) => f === prev[i]);
      return same ? prev : next;
    });
  }, [jobs]);

  // "Connecting" is a health check against the always-running server, not an
  // instance launch — there is nothing to start up.
  async function startSession() {
    setSession('connecting');
    setConnectError(null);
    try {
      await health();
      setSession('connected');
      setStep(1);
    } catch (err) {
      setSession('disconnected');
      setConnectError(errorMessage(err));
    }
  }

  // Only the local view is dropped. Jobs already on the server outlive the
  // browser and come back on the next connect.
  function endSession() {
    setSession('disconnected');
    pendingFilesRef.current.clear();
    revokeAllMediaUrls();
    setFiles([]);
    setSessionJobIds([]);
    setActionError(null);
    setNavState('new');
    setStep(1);
    setSelectedFileId(null);
    setSelectedSource(null);
  }

  // Validated client-side first so the user gets an answer without a round trip.
  // The messages match the ones the API returns for the same two rejections.
  function handleFiles(fileList: FileList | null) {
    const arr = Array.from(fileList ?? []);
    if (!arr.length) return;
    const additions: TranscriptFile[] = arr.map((f) => {
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const id = nextId('f');
      const base = { id, jobId: null, name: f.name, size: f.size, duration: 0, progress: 0 };
      if (!ALLOWED_EXTENSIONS.includes(ext)) {
        return { ...base, status: 'error' as const, errorMsg: 'Unsupported format — try MP3, WAV, M4A, FLAC, or OGG.' };
      }
      if (f.size > MAX_BYTES) {
        return { ...base, status: 'error' as const, errorMsg: 'File too large — 500MB max.' };
      }
      pendingFilesRef.current.set(id, f);
      mediaUrlsRef.current.set(id, URL.createObjectURL(f));
      return { ...base, status: 'selected' as const, errorMsg: null };
    });
    setFiles((prev) => [...prev, ...additions]);
  }

  function addSelectedToQueue() {
    const ready = filesRef.current.filter((f) => f.status === 'selected');
    if (!ready.length) return;
    setFiles((prev) =>
      prev.map((f) => (f.status === 'selected' ? { ...f, status: 'uploading' as const, progress: 0 } : f)),
    );
    setStep(2);
    ready.forEach(uploadOne);
  }

  async function uploadOne(row: TranscriptFile) {
    const blob = pendingFilesRef.current.get(row.id);
    if (!blob) return;
    try {
      const job = await createJob(blob, {
        onProgress: (percent) =>
          setFiles((prev) => prev.map((f) => (f.id === row.id ? { ...f, progress: percent } : f))),
      });
      setSessionJobIds((prev) => (prev.includes(job.jobId) ? prev : [...prev, job.jobId]));
      setFiles((prev) => prev.map((f) => (f.id === row.id ? { ...mapJob(job), id: f.id } : f)));
    } catch (err) {
      // The file never reached the server, so it drops back to the staging list
      // where a rejected-on-validation file sits: progress 0, no job id.
      setFiles((prev) =>
        prev.map((f) =>
          f.id === row.id ? { ...f, status: 'error' as const, progress: 0, errorMsg: errorMessage(err) } : f,
        ),
      );
    } finally {
      pendingFilesRef.current.delete(row.id);
    }
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

  async function retryFile(fileId: string) {
    const row = filesRef.current.find((f) => f.id === fileId);
    if (!row?.jobId) return;
    try {
      const job = await retryJob(row.jobId);
      setFiles((prev) => prev.map((f) => (f.id === fileId ? { ...mapJob(job), id: f.id } : f)));
      setActionError(null);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  // A running job can't be deleted — the API answers 409 — so the row stays put
  // and the reason is shown instead of the row silently refusing to disappear.
  async function removeFile(fileId: string) {
    const row = filesRef.current.find((f) => f.id === fileId);
    if (!row) return;
    if (!row.jobId) {
      pendingFilesRef.current.delete(fileId);
      releaseMediaUrl(fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      return;
    }
    try {
      await deleteJob(row.jobId);
      releaseMediaUrl(fileId);
      setFiles((prev) => prev.filter((f) => f.id !== fileId));
      setSessionJobIds((prev) => prev.filter((id) => id !== row.jobId));
      setActionError(null);
    } catch (err) {
      setActionError(errorMessage(err));
    }
  }

  function releaseMediaUrl(fileId: string) {
    const url = mediaUrlsRef.current.get(fileId);
    if (!url) return;
    mediaUrlsRef.current.delete(fileId);
    URL.revokeObjectURL(url);
  }

  function revokeAllMediaUrls() {
    mediaUrlsRef.current.forEach((url) => URL.revokeObjectURL(url));
    mediaUrlsRef.current.clear();
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

  function updateSegmentText(jobId: string, idx: number, text: string) {
    setTranscripts((prev) => {
      const segments = prev[jobId];
      if (!segments) return prev;
      return { ...prev, [jobId]: segments.map((seg, i) => (i === idx ? { ...seg, text } : seg)) };
    });
  }

  const sessionIds = useMemo(() => new Set(sessionJobIds), [sessionJobIds]);
  const isSessionFile = (f: TranscriptFile) => (f.jobId ? sessionIds.has(f.jobId) : f.status === 'uploading');

  // Picked but not yet sent, including the two client-side rejections.
  const stagedFiles = files.filter((f) => !f.jobId && f.status !== 'uploading');
  const sessionFiles = files.filter(isSessionFile);
  // The shared queue: everything in flight anywhere on the server, plus this
  // session's failures so they can be retried where they failed.
  const queueFiles = files.filter(
    (f) =>
      f.status === 'uploading' ||
      f.status === 'queued' ||
      f.status === 'processing' ||
      (f.status === 'error' && !!f.jobId && sessionIds.has(f.jobId)),
  );
  const history = useMemo(
    () => jobs.filter((j) => j.status === 'DONE' || j.status === 'ERROR').map(mapJob),
    [jobs],
  );

  function findSelected(): TranscriptFile | null {
    if (!selectedFileId) return null;
    const list = selectedSource === 'history' ? history : files;
    const found = list.find((f) => f.id === selectedFileId);
    if (!found) return null;
    return { ...found, segments: found.jobId ? transcripts[found.jobId] ?? null : null };
  }

  const selected = findSelected();
  const selectedJobId = selected?.jobId ?? null;
  const selectedIsDone = selected?.status === 'done';
  const transcriptPending = selectedIsDone && !!selectedJobId && !transcripts[selectedJobId];

  // Segments don't ride along on the job object, so the editor fetches them on
  // open. The guard means re-opening a transcript never overwrites local edits.
  useEffect(() => {
    if (!selectedJobId || !selectedIsDone || transcripts[selectedJobId]) return;
    let cancelled = false;
    getTranscript(selectedJobId)
      .then((t) => {
        if (!cancelled) setTranscripts((prev) => ({ ...prev, [selectedJobId]: t.segments }));
      })
      .catch((err) => {
        if (!cancelled) setActionError(errorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [selectedJobId, selectedIsDone, transcripts]);

  function download(format: 'txt' | 'srt' | 'json') {
    if (!selected?.segments) return;
    const base = selected.name.replace(/\.[^.]+$/, '');
    if (format === 'txt') triggerDownload(base + '.txt', buildTxt(selected), 'text/plain');
    if (format === 'srt') triggerDownload(base + '.srt', buildSrt(selected), 'text/plain');
    if (format === 'json') triggerDownload(base + '.json', buildJson(selected), 'application/json');
  }

  // Only this session's files are announced; narrating strangers' jobs as they
  // move through the shared queue would make the live region unusable.
  const queueAnnouncement = useQueueAnnouncements(sessionFiles);

  const connecting = session === 'connecting';
  const alert = actionError ?? pollError;
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
        {isConnected && alert && (
          <div className="app-alert" role="alert">
            {alert}
          </div>
        )}

        {showConnectGate && (
          <ConnectGate connecting={connecting} connectError={connectError} onStart={startSession} />
        )}

        {showHistoryScreen && <HistoryScreen history={history} onView={(id) => selectFile(id, 'history')} />}

        {selected && (
          <TranscriptEditor
            file={selected}
            mediaUrl={mediaUrlsRef.current.get(selected.id) ?? null}
            playhead={playhead}
            transcriptPending={transcriptPending}
            onBack={backFromEditor}
            onScrub={scrubTo}
            onSegmentEdit={(idx, text) => selected.jobId && updateSegmentText(selected.jobId, idx, text)}
            onDownload={download}
          />
        )}

        {showFlowScreen && (
          <FlowScreen
            step={step}
            onStepClick={setStep}
            stagedFiles={stagedFiles}
            queueFiles={queueFiles}
            sessionFiles={sessionFiles}
            fileInputRef={fileInputRef}
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
        <SessionBar session={session} onEndSession={endSession} />
      )}

    </div>
  );
}
