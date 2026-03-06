import { useMemo, useCallback } from 'react';
import { Play, Pause, SkipBack, SkipForward, Zap, Users, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useSessionReplay } from '../../hooks/useSessionReplay';
import type { ReplayKeyframe, UseSessionReplayResult } from '../../hooks/useSessionReplay';

// ── Helpers ──────────────────────────────────────────────────────────

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const KEYFRAME_COLORS: Record<ReplayKeyframe['type'], string> = {
  spawn: 'bg-green-400',
  agent_exit: 'bg-gray-400',
  decision: 'bg-amber-400',
  delegation: 'bg-blue-400',
  task: 'bg-cyan-400',
  milestone: 'bg-purple-400',
  progress: 'bg-indigo-400',
  error: 'bg-red-400',
  commit: 'bg-emerald-400',
};

const SPEED_OPTIONS = [4, 8, 16, 32, 64, 120, 240, 720];

// ── Component ────────────────────────────────────────────────────────

interface ReplayScrubberProps {
  leadId: string;
  /** Pre-created replay state — avoids duplicate hook calls when parent also needs replay state */
  replay?: UseSessionReplayResult;
}

export function ReplayScrubber({ leadId, replay: externalReplay }: ReplayScrubberProps) {
  const internalReplay = useSessionReplay(externalReplay ? null : leadId);
  const {
    keyframes, worldState, playing, currentTime, duration,
    loading, error, play, pause, seek, setSpeed, speed,
  } = externalReplay ?? internalReplay;

  // Map keyframes to positions on the scrubber
  const keyframeMarkers = useMemo(() => {
    if (duration === 0 || keyframes.length < 2) return [];
    const startMs = new Date(keyframes[0].timestamp).getTime();
    return keyframes.map((kf) => ({
      ...kf,
      position: ((new Date(kf.timestamp).getTime() - startMs) / duration) * 100,
    }));
  }, [keyframes, duration]);

  const progressPct = duration > 0 ? (currentTime / duration) * 100 : 0;

  const handleScrubberClick = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    seek(pct * duration);
  }, [seek, duration]);

  const skipBack = useCallback(() => seek(Math.max(0, currentTime - 5000)), [seek, currentTime]);
  const skipForward = useCallback(() => seek(Math.min(duration, currentTime + 5000)), [seek, currentTime, duration]);

  if (loading) {
    return (
      <div className="bg-surface border border-th-border rounded-lg p-4">
        <div className="flex items-center gap-2 text-th-text-muted text-sm">
          <div className="w-4 h-4 border-2 border-th-text-muted/30 border-t-accent rounded-full animate-spin" />
          Loading session replay…
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="bg-surface border border-th-border rounded-lg p-4">
        <p className="text-xs text-red-400">Replay unavailable: {error}</p>
      </div>
    );
  }

  if (keyframes.length === 0) {
    return (
      <div className="bg-surface border border-th-border rounded-lg p-4 text-center">
        <p className="text-xs text-th-text-muted">No replay data available for this session.</p>
      </div>
    );
  }

  return (
    <div className="bg-surface border border-th-border rounded-lg overflow-hidden" data-testid="replay-scrubber">
      {/* Controls bar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-th-border">
        <button onClick={skipBack} title="Back 5s" className="p-1 rounded text-th-text-muted hover:text-th-text transition-colors">
          <SkipBack className="w-3.5 h-3.5" />
        </button>
        <button
          onClick={playing ? pause : play}
          title={playing ? 'Pause' : 'Play'}
          className="p-1.5 rounded-full bg-accent/20 text-accent hover:bg-accent/30 transition-colors"
        >
          {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
        </button>
        <button onClick={skipForward} title="Forward 5s" className="p-1 rounded text-th-text-muted hover:text-th-text transition-colors">
          <SkipForward className="w-3.5 h-3.5" />
        </button>

        <span className="text-xs font-mono text-th-text-alt ml-1">
          {formatTime(currentTime)}
        </span>
        <span className="text-xs text-th-text-muted">/</span>
        <span className="text-xs font-mono text-th-text-muted">
          {formatTime(duration)}
        </span>

        <div className="flex-1" />

        {/* Speed selector */}
        <div className="flex items-center gap-1">
          <Zap className="w-3 h-3 text-th-text-muted" />
          {SPEED_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setSpeed(s)}
              className={`px-1.5 py-0.5 text-[10px] rounded transition-colors ${
                speed === s
                  ? 'bg-accent/20 text-accent font-medium'
                  : 'text-th-text-muted hover:text-th-text-alt'
              }`}
            >
              {s}×
            </button>
          ))}
        </div>
      </div>

      {/* Scrubber track */}
      <div
        className="relative h-8 bg-th-bg-alt cursor-pointer group"
        onClick={handleScrubberClick}
        role="slider"
        aria-label="Session timeline scrubber"
        aria-valuemin={0}
        aria-valuemax={duration}
        aria-valuenow={currentTime}
      >
        {/* Progress fill */}
        <div
          className="absolute inset-y-0 left-0 bg-accent/15 transition-[width] duration-100"
          style={{ width: `${progressPct}%` }}
        />

        {/* Keyframe markers */}
        {keyframeMarkers.map((kf, i) => (
          <div
            key={i}
            className={`absolute top-1 w-1.5 h-6 rounded-full ${KEYFRAME_COLORS[kf.type]} opacity-60 group-hover:opacity-100 transition-opacity`}
            style={{ left: `${kf.position}%`, transform: 'translateX(-50%)' }}
            title={`${kf.label} (${kf.type})`}
          />
        ))}

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-accent shadow-[0_0_4px_rgba(var(--accent-rgb),0.5)]"
          style={{ left: `${progressPct}%`, transform: 'translateX(-50%)' }}
        />
      </div>

      {/* World state summary */}
      {worldState && (
        <div className="flex items-center gap-4 px-3 py-1.5 border-t border-th-border text-[11px]">
          <span className="flex items-center gap-1 text-th-text-muted">
            <Users className="w-3 h-3" />
            {worldState.agents.length} agents
          </span>
          <span className="flex items-center gap-1 text-th-text-muted">
            {worldState.agents.filter((a) => a.status === 'running').length} running
          </span>
          {worldState.totalTasks > 0 && (
            <span className="flex items-center gap-1 text-th-text-muted">
              <CheckCircle2 className="w-3 h-3" />
              {worldState.completedTasks}/{worldState.totalTasks} tasks
            </span>
          )}
          {worldState.pendingDecisions > 0 && (
            <span className="flex items-center gap-1 text-amber-400">
              <AlertTriangle className="w-3 h-3" />
              {worldState.pendingDecisions} pending
            </span>
          )}
        </div>
      )}
    </div>
  );
}
