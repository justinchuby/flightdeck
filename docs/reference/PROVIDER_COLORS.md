# Provider Colors Utility

Consistent color theming for CLI provider badges and UI elements.

**Location:** `packages/web/src/utils/providerColors.ts`

## API

```typescript
import { getProviderColors, type ProviderColorSet } from '../../utils/providerColors';

interface ProviderColorSet {
  /** Background class for pills/badges (e.g. 'bg-purple-500/15') */
  bg: string;
  /** Text color class (e.g. 'text-purple-400') */
  text: string;
  /** Border color class for card left-border accent (e.g. 'border-purple-500') */
  border: string;
}

function getProviderColors(provider: string | undefined): ProviderColorSet;
```

## Usage

```tsx
const colors = getProviderColors(agent.provider);

<span className={`${colors.bg} ${colors.text} px-2 py-0.5 rounded-full text-xs`}>
  {agent.provider}
</span>

<div className={`border-l-2 ${colors.border} pl-3`}>
  {agent.role}
</div>
```

## Color Mappings

| Provider | Background | Text | Border | Visual |
|----------|-----------|------|--------|--------|
| **copilot** | `bg-purple-500/15` | `text-purple-400` | `border-purple-500` | Purple |
| **gemini** | `bg-blue-500/15` | `text-blue-400` | `border-blue-500` | Blue |
| **claude** | `bg-amber-500/15` | `text-amber-400` | `border-amber-500` | Amber |
| **codex** | `bg-green-500/15` | `text-green-400` | `border-green-500` | Green |
| **cursor** | `bg-cyan-500/15` | `text-cyan-400` | `border-cyan-500` | Cyan |
| **opencode** | `bg-zinc-500/15` | `text-zinc-400` | `border-zinc-500` | Gray |
| *(unknown)* | `bg-zinc-500/15` | `text-zinc-400` | `border-zinc-500` | Gray |

## Adding a New Provider

1. Add an entry to `PROVIDER_COLORS` in `providerColors.ts`:
   ```typescript
   newprovider: { bg: 'bg-rose-500/15', text: 'text-rose-400', border: 'border-rose-500' },
   ```
2. The lookup is case-insensitive (`provider.toLowerCase()`)
3. Unknown providers automatically fall back to neutral gray
4. Ensure the chosen Tailwind color class is included in the safelist or used elsewhere (Tailwind JIT will pick it up from this file)
