import { useState } from 'react';
import { FolderOpen, Check, X } from 'lucide-react';
import { useAppStore } from '../../stores/appStore';
import { apiFetch } from '../../hooks/useApi';

export function CwdBar({ leadId, cwd }: { leadId: string; cwd?: string }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(cwd || '');
  const updateAgent = useAppStore((s) => s.updateAgent);

  const startEditing = () => {
    setValue(cwd || '');
    setEditing(true);
  };

  const save = async () => {
    const trimmed = value.trim();
    await apiFetch(`/lead/${leadId}`, {
      method: 'PATCH',
      body: JSON.stringify({ cwd: trimmed || undefined }),
    });
    updateAgent(leadId, { cwd: trimmed || undefined });
    setEditing(false);
  };

  return (
    <div className="border-b border-th-border px-4 py-1.5 flex items-center gap-2 text-xs font-mono bg-th-bg-alt/30">
      <FolderOpen className="w-3 h-3 text-th-text-muted shrink-0" />
      {editing ? (
        <>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => { if (e.nativeEvent.isComposing) return; if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(false); }}
            placeholder="/path/to/project"
            className="flex-1 bg-th-bg-alt border border-th-border rounded px-2 py-0.5 text-xs font-mono text-th-text-alt focus:outline-none focus:border-yellow-500"
            autoFocus
          />
          <button type="button" aria-label="Save working directory" onClick={save} className="text-green-400 hover:text-green-600 dark:hover:text-green-300 p-0.5"><Check className="w-3 h-3" /></button>
          <button type="button" aria-label="Cancel edit" onClick={() => setEditing(false)} className="text-th-text-muted hover:text-th-text p-0.5"><X className="w-3 h-3" /></button>
        </>
      ) : (
        <>
          <span className="text-th-text-muted truncate flex-1" title={cwd}>{cwd || '(server default)'}</span>
          <button
            onClick={() => startEditing()}
            className="text-th-text-muted hover:text-yellow-600 dark:hover:text-yellow-400 text-[10px] shrink-0"
          >
            edit
          </button>
        </>
      )}
    </div>
  );
}
