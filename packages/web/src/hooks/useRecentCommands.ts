import { useState, useCallback } from 'react';

const STORAGE_KEY = 'command-palette-recent';
const MAX_RECENT = 10;

interface RecentCommand {
  id: string;
  label: string;
  icon: string;
  timestamp: number;
}

export function useRecentCommands() {
  const [recent, setRecent] = useState<RecentCommand[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    } catch {
      return [];
    }
  });

  const addRecent = useCallback((id: string, label: string, icon: string) => {
    setRecent((prev) => {
      const filtered = prev.filter((r) => r.id !== id);
      const next = [{ id, label, icon, timestamp: Date.now() }, ...filtered].slice(
        0,
        MAX_RECENT,
      );
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch {}
      return next;
    });
  }, []);

  const clearRecent = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
    setRecent([]);
  }, []);

  return { recent, addRecent, clearRecent };
}
