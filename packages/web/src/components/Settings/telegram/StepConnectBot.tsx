// packages/web/src/components/Settings/telegram/StepConnectBot.tsx
// Step 1: Enter and validate bot token, confirm bot identity.

import { useState, useCallback } from 'react';
import { Shield, Loader2, Check, AlertCircle, Eye, EyeOff } from 'lucide-react';
import { apiFetch } from '../../../hooks/useApi';
import type { StepProps, ValidateTokenResponse, BotInfo } from './types';

export function StepConnectBot({ config, onUpdate, onNext }: StepProps) {
  const [token, setToken] = useState(config.botToken || '');
  const [masked, setMasked] = useState(!!config.botToken);
  const [validating, setValidating] = useState(false);
  const [botInfo, setBotInfo] = useState<BotInfo | null>(null);
  const [error, setError] = useState<string | null>(null);

  const maskedToken = token
    ? `${'•'.repeat(Math.max(0, token.length - 4))}${token.slice(-4)}`
    : '';

  const handleVerify = useCallback(async () => {
    if (!token.trim()) return;
    setValidating(true);
    setError(null);
    setBotInfo(null);

    try {
      const result = await apiFetch<ValidateTokenResponse>('/integrations/telegram/validate-token', {
        method: 'POST',
        body: JSON.stringify({ botToken: token }),
      });

      if (result.valid && result.bot) {
        setBotInfo(result.bot);
        onUpdate({ botToken: token, enabled: true });
      } else {
        setError(result.error || 'Invalid token — check with @BotFather');
      }
    } catch (err) {
      setError((err as Error).message || 'Connection error — check your network and try again');
    } finally {
      setValidating(false);
    }
  }, [token, onUpdate]);

  const handleTokenChange = (value: string) => {
    setToken(value);
    setMasked(false);
    setBotInfo(null);
    setError(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleVerify();
  };

  return (
    <div data-testid="telegram-wizard-step-1" className="space-y-4">
      <div>
        <h4 className="text-sm font-medium text-th-text mb-1">Connect Your Telegram Bot</h4>
        <p className="text-xs text-th-text-muted">
          Create a bot with{' '}
          <a
            href="https://t.me/BotFather"
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            @BotFather
          </a>{' '}
          on Telegram, then paste the token below.
        </p>
      </div>

      {/* Token input */}
      <div>
        <label className="text-xs text-th-text-muted block mb-1.5 flex items-center gap-1.5">
          <Shield className="w-3 h-3" /> Bot Token
        </label>
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <input
              type={masked ? 'password' : 'text'}
              value={masked ? maskedToken : token}
              onChange={(e) => handleTokenChange(e.target.value)}
              onFocus={() => { if (masked) setMasked(false); }}
              onKeyDown={handleKeyDown}
              placeholder="Enter your Telegram bot token"
              disabled={validating}
              data-testid="telegram-token-input"
              aria-label="Telegram bot token"
              className="w-full bg-th-bg-alt border border-th-border rounded-md px-3 py-1.5 text-sm font-mono focus:outline-none focus:border-accent disabled:opacity-50"
            />
            {token && !validating && (
              <button
                onClick={() => setMasked(!masked)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-th-text-muted hover:text-th-text"
                aria-label={masked ? 'Show token' : 'Hide token'}
              >
                {masked ? <Eye className="w-3.5 h-3.5" /> : <EyeOff className="w-3.5 h-3.5" />}
              </button>
            )}
          </div>
          <button
            onClick={handleVerify}
            disabled={validating || !token.trim() || !!botInfo}
            data-testid="telegram-verify-btn"
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md transition-colors disabled:opacity-50 ${
              botInfo
                ? 'bg-green-400/10 text-green-400'
                : 'bg-accent/10 text-accent hover:bg-accent/20'
            }`}
          >
            {validating ? (
              <><Loader2 className="w-3 h-3 animate-spin" /> Verifying…</>
            ) : botInfo ? (
              <><Check className="w-3 h-3" /> Verified</>
            ) : error ? (
              'Retry'
            ) : (
              'Verify'
            )}
          </button>
        </div>
        <p className="text-[10px] text-th-text-muted mt-1">
          💡 You can also set <code className="text-th-text-muted">TELEGRAM_BOT_TOKEN</code> environment variable.
        </p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-400/10 border border-red-400/30 rounded-md p-3 flex items-start gap-2" role="alert">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
          <div className="text-xs text-red-400">{error}</div>
        </div>
      )}

      {/* Bot info card */}
      {botInfo && (
        <div
          className="bg-green-400/10 border border-green-400/30 rounded-md p-3"
          data-testid="telegram-bot-info"
        >
          <div className="flex items-center gap-2 text-sm text-green-400 font-medium">
            <Check className="w-4 h-4" />
            Connected as @{botInfo.username}
          </div>
          <div className="text-xs text-th-text-muted mt-1">
            Bot ID: {botInfo.id} • Name: {botInfo.firstName}
          </div>
        </div>
      )}

      {/* Next button */}
      {botInfo && (
        <div className="flex justify-end pt-2">
          <button
            onClick={onNext}
            data-testid="telegram-next-1"
            className="px-4 py-1.5 text-xs bg-accent text-black rounded-md font-semibold hover:bg-accent-muted transition-colors"
          >
            Next: Link Chat →
          </button>
        </div>
      )}
    </div>
  );
}
