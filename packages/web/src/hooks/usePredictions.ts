import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from './useApi';
import type { Prediction, PredictionAccuracy, PredictionConfig } from '../components/Predictions/types';

export function usePredictions(refreshMs = 30_000) {
  const [predictions, setPredictions] = useState<Prediction[]>([]);
  const [loading, setLoading] = useState(true);
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  const fetchPredictions = useCallback(async () => {
    try {
      const data = await apiFetch<Prediction[]>('/predictions');
      setPredictions(Array.isArray(data) ? data : []);
    } catch {
      // silent — predictions are non-critical
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPredictions();
    intervalRef.current = setInterval(fetchPredictions, refreshMs);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [fetchPredictions, refreshMs]);

  const dismiss = useCallback(async (id: string) => {
    try {
      await apiFetch(`/predictions/${id}/dismiss`, { method: 'POST' });
      setPredictions(prev => prev.filter(p => p.id !== id));
    } catch {
      /* silent */
    }
  }, []);

  return { predictions, loading, dismiss, refetch: fetchPredictions };
}

export function usePredictionAccuracy() {
  const [accuracy, setAccuracy] = useState<PredictionAccuracy | null>(null);
  useEffect(() => {
    apiFetch<PredictionAccuracy>('/predictions/accuracy')
      .then(setAccuracy)
      .catch(() => { /* initial fetch — will retry */ });
  }, []);
  return accuracy;
}

export function usePredictionConfig() {
  const [config, setConfig] = useState<PredictionConfig | null>(null);

  useEffect(() => {
    apiFetch<PredictionConfig>('/predictions/config')
      .then(setConfig)
      .catch(() => { /* initial fetch — will retry */ });
  }, []);

  const saveConfig = useCallback(async (updates: Partial<PredictionConfig>) => {
    try {
      const updated = await apiFetch<PredictionConfig>('/predictions/config', {
        method: 'PUT',
        body: JSON.stringify(updates),
      });
      setConfig(updated);
    } catch {
      /* silent */
    }
  }, []);

  return { config, saveConfig };
}
