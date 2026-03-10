import { create } from 'zustand';
import { useEffect } from 'react';
import { X, CheckCircle, AlertTriangle, Info } from 'lucide-react';

export interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

interface ToastState {
  toasts: Toast[];
  add: (type: Toast['type'], message: string) => void;
  remove: (id: string) => void;
}

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  add: (type, message) => {
    const id = `toast-${Date.now()}`;
    set((s) => ({ toasts: [...s.toasts, { id, type, message }] }));
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
    }, 5000);
  },
  remove: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}));

const ICONS = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info,
};

const ICON_COLORS = {
  success: 'text-green-600 dark:text-green-300',
  error: 'text-red-600 dark:text-red-300',
  info: 'text-blue-600 dark:text-blue-300',
};

export function ToastContainer() {
  const { toasts, remove } = useToastStore();

  if (toasts.length === 0) return null;

  return (
    <div className="fixed bottom-4 right-4 z-50 space-y-2 max-w-sm">
      {toasts.map((toast) => {
        const Icon = ICONS[toast.type];
        return (
          <div
            key={toast.id}
            className="glass-toast flex items-center gap-2 px-4 py-3 rounded-xl animate-slide-in"
          >
            <Icon size={16} className={`shrink-0 ${ICON_COLORS[toast.type]}`} />
            <span className="text-sm flex-1 text-th-text/90 whitespace-pre-line">{toast.message}</span>
            <button onClick={() => remove(toast.id)} className="shrink-0 opacity-60 hover:opacity-100 text-th-text/70">
              <X size={14} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
