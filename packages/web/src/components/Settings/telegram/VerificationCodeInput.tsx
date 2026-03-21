// packages/web/src/components/Settings/telegram/VerificationCodeInput.tsx
// 6-digit verification code entry with auto-advance, paste support, and error state.

import { useState, useRef, useCallback } from 'react';

interface VerificationCodeInputProps {
  length?: number;
  onComplete: (code: string) => void;
  error?: boolean;
  disabled?: boolean;
}

export function VerificationCodeInput({
  length = 6,
  onComplete,
  error = false,
  disabled = false,
}: VerificationCodeInputProps) {
  const [digits, setDigits] = useState<string[]>(Array(length).fill(''));
  const inputRefs = useRef<Array<HTMLInputElement | null>>([]);

  const focusInput = (index: number) => {
    if (index >= 0 && index < length) {
      inputRefs.current[index]?.focus();
    }
  };

  const updateDigit = useCallback((index: number, value: string) => {
    const newDigits = [...digits];
    newDigits[index] = value;
    setDigits(newDigits);

    if (value && index < length - 1) {
      focusInput(index + 1);
    }

    // Check if all digits are filled
    if (newDigits.every(d => d !== '')) {
      onComplete(newDigits.join(''));
    }
  }, [digits, length, onComplete]);

  const handleChange = useCallback((index: number, value: string) => {
    // Only accept single digits
    const digit = value.replace(/\D/g, '').slice(-1);
    updateDigit(index, digit);
  }, [updateDigit]);

  const handleKeyDown = useCallback((index: number, e: React.KeyboardEvent) => {
    if (e.key === 'Backspace') {
      if (digits[index]) {
        updateDigit(index, '');
      } else if (index > 0) {
        focusInput(index - 1);
        updateDigit(index - 1, '');
      }
      e.preventDefault();
    } else if (e.key === 'ArrowLeft' && index > 0) {
      focusInput(index - 1);
    } else if (e.key === 'ArrowRight' && index < length - 1) {
      focusInput(index + 1);
    }
  }, [digits, length, updateDigit]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    e.preventDefault();
    const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (pasted.length === 0) return;

    const newDigits = [...digits];
    for (let i = 0; i < pasted.length; i++) {
      newDigits[i] = pasted[i];
    }
    setDigits(newDigits);

    // Focus the next empty slot, or the last one
    const nextEmpty = newDigits.findIndex(d => d === '');
    focusInput(nextEmpty >= 0 ? nextEmpty : length - 1);

    if (newDigits.every(d => d !== '')) {
      onComplete(newDigits.join(''));
    }
  }, [digits, length, onComplete]);

  return (
    <div
      role="group"
      aria-label="Verification code"
      className="flex items-center gap-2"
      data-testid="telegram-verification-code"
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(el) => { inputRefs.current[index] = el; }}
          type="text"
          inputMode="numeric"
          maxLength={1}
          value={digit}
          onChange={(e) => handleChange(index, e.target.value)}
          onKeyDown={(e) => handleKeyDown(index, e)}
          onPaste={index === 0 ? handlePaste : undefined}
          disabled={disabled}
          aria-label={`Digit ${index + 1} of ${length}`}
          className={`w-10 h-12 text-center text-lg font-mono bg-th-bg-alt border rounded-md
            focus:outline-none transition-colors disabled:opacity-50
            ${error
              ? 'border-red-500 focus:border-red-500 animate-shake'
              : 'border-th-border focus:border-accent'
            }`}
        />
      ))}
    </div>
  );
}
