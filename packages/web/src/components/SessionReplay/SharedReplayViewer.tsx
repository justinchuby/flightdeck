import { useState, useEffect } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Users, Clock, Play, Pause, SkipBack, SkipForward, MapPin } from 'lucide-react';
import type { ShareableReplay } from './types';
import { AnnotationPin } from './AnnotationPin';
import { apiFetch } from '../../hooks/useApi';

/**
 * Read-only shared replay viewer — /shared/:token route.
 * Fetches replay data via the share token (no auth required).
 */
export function SharedReplayViewer() {
  const { token } = useParams<{ token: string }>();
  const [_searchParams] = useSearchParams();
  const [replay, setReplay] = useState<ShareableReplay | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [showAnnotations, setShowAnnotations] = useState(false);

  useEffect(() => {
    if (!token) return;
    setLoading(true);
    apiFetch<ShareableReplay>(`/shared/${token}`)
      .then((data) => setReplay(data))
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg.includes('404') ? 'Replay not found or link expired' : msg);
      })
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen bg-th-bg flex items-center justify-center">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm text-th-text-muted">Loading shared replay...</p>
        </div>
      </div>
    );
  }

  if (error || !replay) {
    return (
      <div className="min-h-screen bg-th-bg flex items-center justify-center" data-testid="shared-replay-error">
        <div className="text-center">
          <p className="text-3xl mb-2">📼</p>
          <p className="text-sm text-th-text-alt mb-1">{error ?? 'Replay not found'}</p>
          <p className="text-xs text-th-text-muted">This link may have expired or been removed.</p>
        </div>
      </div>
    );
  }

  const duration = replay.stats.duration * 1000;
  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-th-bg flex flex-col" data-testid="shared-replay-viewer">
      {/* Header */}
      <header className="border-b border-th-border px-6 py-4">
        <h1 className="text-lg font-semibold text-th-text-alt">📼 {replay.title}</h1>
        <div className="flex items-center gap-4 mt-1">
          <span className="text-xs text-th-text-muted">
            Shared by {replay.createdBy}
          </span>
          <span className="text-xs text-th-text-muted flex items-center gap-1">
            <Clock className="w-3 h-3" /> {Math.round(replay.stats.duration / 60)} min
          </span>
          <span className="text-xs text-th-text-muted flex items-center gap-1">
            <Users className="w-3 h-3" /> {replay.stats.agentCount} agents
          </span>
        </div>
      </header>

      {/* Content placeholder — simplified read-only view */}
      <div className="flex-1 flex items-center justify-center text-center p-8">
        <div>
          <p className="text-4xl mb-3">📼</p>
          <p className="text-sm text-th-text-alt">Session replay at {formatTime(currentTime)}</p>
          <p className="text-xs text-th-text-muted mt-1">
            {replay.stats.taskCount} tasks
          </p>
        </div>
      </div>

      {/* Scrubber */}
      <div className="border-t border-th-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => setCurrentTime(Math.max(0, currentTime - 5000))} className="p-1 text-th-text-muted hover:text-th-text">
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() => setPlaying(!playing)}
            className="p-2 rounded-full bg-accent/20 text-accent hover:bg-accent/30"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => setCurrentTime(Math.min(duration, currentTime + 5000))} className="p-1 text-th-text-muted hover:text-th-text">
            <SkipForward className="w-4 h-4" />
          </button>

          <span className="text-xs font-mono text-th-text-alt">{formatTime(currentTime)}</span>
          <span className="text-xs text-th-text-muted">/</span>
          <span className="text-xs font-mono text-th-text-muted">{formatTime(duration)}</span>

          {/* Scrubber bar */}
          <div
            className="flex-1 h-6 bg-th-bg-alt rounded relative cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setCurrentTime(((e.clientX - rect.left) / rect.width) * duration);
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-accent/15 rounded" style={{ width: `${progressPct}%` }} />
            {/* Annotation pins */}
            {replay.annotations.map((ann) => {
              const annTime = new Date(ann.timestamp).getTime() - new Date(replay.createdAt).getTime();
              const pos = duration > 0 ? (annTime / duration) * 100 : 0;
              return (
                <AnnotationPin
                  key={ann.id}
                  annotation={ann}
                  position={Math.max(0, Math.min(100, pos))}
                  onClick={() => setCurrentTime(Math.max(0, annTime))}
                />
              );
            })}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-accent"
              style={{ left: `${progressPct}%` }}
            />
          </div>

          {/* Annotations button */}
          {replay.annotations.length > 0 && (
            <button
              onClick={() => setShowAnnotations(!showAnnotations)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-th-text-muted hover:text-th-text rounded"
            >
              <MapPin className="w-3 h-3" /> {replay.annotations.length}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
