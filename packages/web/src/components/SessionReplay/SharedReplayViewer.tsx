import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router-dom';
import { Users, Clock, Play, Pause, SkipBack, SkipForward, MapPin } from 'lucide-react';
import type { ShareableReplay } from './types';
import { AnnotationPin } from './AnnotationPin';
import { ReplayContent } from './ReplayContent';
import { useSharedReplay } from '../../hooks/useSharedReplay';

/**
 * Read-only shared replay viewer — /shared/:token route.
 * All data fetches go through the share token to enforce expiry/revocation.
 */
export function SharedReplayViewer() {
  const { token } = useParams<{ token: string }>();
  const [_searchParams] = useSearchParams();
  const [showAnnotations, setShowAnnotations] = useState(false);

  // Single source of truth for playback state and world data
  const {
    worldState, playing, currentTime, duration,
    loading, error, play, pause, seek, sharedData,
  } = useSharedReplay(token ?? null);

  // Treat sharedData as metadata — cast for annotations/stats display
  const replay = sharedData as unknown as ShareableReplay | null;

  const formatTime = (ms: number) => {
    const s = Math.floor(ms / 1000);
    return `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
  };

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

  if (error || !sharedData) {
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

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;
  const title = replay?.title ?? sharedData.label ?? 'Session Replay';
  const annotations = replay?.annotations ?? [];
  const createdBy = replay?.createdBy;
  const createdAt = replay?.createdAt ?? sharedData.keyframes[0]?.timestamp;
  const statsDuration = replay?.stats?.duration;
  const statsAgents = replay?.stats?.agentCount;

  return (
    <div className="min-h-screen bg-th-bg flex flex-col" data-testid="shared-replay-viewer">
      {/* Header */}
      <header className="border-b border-th-border px-6 py-4">
        <h1 className="text-lg font-semibold text-th-text-alt">📼 {title}</h1>
        <div className="flex items-center gap-4 mt-1">
          {createdBy && (
            <span className="text-xs text-th-text-muted">Shared by {createdBy}</span>
          )}
          {statsDuration != null && (
            <span className="text-xs text-th-text-muted flex items-center gap-1">
              <Clock className="w-3 h-3" /> {Math.round(statsDuration / 60)} min
            </span>
          )}
          {statsAgents != null && (
            <span className="text-xs text-th-text-muted flex items-center gap-1">
              <Users className="w-3 h-3" /> {statsAgents} agents
            </span>
          )}
        </div>
      </header>

      {/* Session content — rendered from replay world state */}
      <ReplayContent worldState={worldState} />

      {/* Scrubber */}
      <div className="border-t border-th-border px-4 py-3">
        <div className="flex items-center gap-3">
          <button onClick={() => seek(currentTime - 5000)} className="p-1 text-th-text-muted hover:text-th-text">
            <SkipBack className="w-4 h-4" />
          </button>
          <button
            onClick={() => playing ? pause() : play()}
            className="p-2 rounded-full bg-accent/20 text-accent hover:bg-accent/30"
          >
            {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
          </button>
          <button onClick={() => seek(currentTime + 5000)} className="p-1 text-th-text-muted hover:text-th-text">
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
              seek(((e.clientX - rect.left) / rect.width) * duration);
            }}
          >
            <div className="absolute inset-y-0 left-0 bg-accent/15 rounded" style={{ width: `${progressPct}%` }} />
            {/* Annotation pins */}
            {annotations.map((ann) => {
              const annTime = createdAt
                ? new Date(ann.timestamp).getTime() - new Date(createdAt).getTime()
                : 0;
              const pos = duration > 0 ? (annTime / duration) * 100 : 0;
              return (
                <AnnotationPin
                  key={ann.id}
                  annotation={ann}
                  position={Math.max(0, Math.min(100, pos))}
                  onClick={() => seek(Math.max(0, annTime))}
                />
              );
            })}
            <div
              className="absolute top-0 bottom-0 w-0.5 bg-accent"
              style={{ left: `${progressPct}%` }}
            />
          </div>

          {/* Annotations button */}
          {annotations.length > 0 && (
            <button
              onClick={() => setShowAnnotations(!showAnnotations)}
              className="flex items-center gap-1 px-2 py-1 text-[11px] text-th-text-muted hover:text-th-text rounded"
            >
              <MapPin className="w-3 h-3" /> {annotations.length}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
