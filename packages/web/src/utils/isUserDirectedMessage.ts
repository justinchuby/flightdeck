/**
 * Detect whether a lead agent message is directed at the human user
 * vs. internal coordination (agent commands, status updates, etc.).
 *
 * Used by the UI to visually highlight user-relevant messages.
 */

export interface MessageContext {
  /** Whether the immediately previous message was sent by the human user */
  prevSenderIsUser?: boolean;
}

// ── Definite positive patterns ────────────────────────────────────────

/** Explicit @user tag on its own line */
const AT_USER_TAG = /(?:^|\n)@user\s*(?:\n|$)/m;

/** Embedded user message marker (injected by the system when relaying user input) */
const USER_MESSAGE_MARKER = /\[USER MESSAGE/;

// ── Definite negative patterns (internal coordination) ────────────────

/** Crew command fences: ⟦ CMD ... ⟧  or  [[[ CMD ... ]]] */
const CREW_COMMAND_FENCE = /(?:⟦|\[\[\[)\s*[A-Z_]+/;

/** System-injected messages */
const SYSTEM_PREFIX = /^\[(?:System|Message from|Broadcast from|DAG Task|CREW_UPDATE)/m;

/** Crew status block */
const CREW_STATUS_BLOCK = /== (?:CURRENT CREW STATUS|AGENT BUDGET|RECENT ACTIVITY) ==/;

/** Agent coordination prefixes — e.g. "[Starting]", "[Done]", "[Blocked]" */
const AGENT_COORD_PREFIX = /^\[(?:Starting|Done|Blocked|Waiting|Update)\]/m;

/** Delegation/routing arrows: "Message → Developer (abc123)" */
const ROUTING_ARROW = /(?:Message|Delegation|Completion report|DM) →/;

/** Lines that are purely agent status changes, lock events, etc. */
const STATUS_EVENT_LINE = /^Agent [0-9a-f]{6,} \(/m;

/** Command-only messages (nothing but commands in the text) */
const COMMAND_ONLY = /^(?:\s*(?:⟦|\[\[\[)[\s\S]*?(?:⟧|\]\]\])\s*)+$/;

// ── Positive signal patterns ──────────────────────────────────────────

/** Lead explicitly addressing the user at the start of a line */
const USER_ADDRESS = /(?:^|\n)\s*(?:User:|To (?:the )?user:|Hi!|Hello!|Sure[,!]|Here(?:'s| is| are)|I(?:'ve|'ll| have| will| can)|Let me|Summary:|Progress:|Status report:|Update:)/im;

/** Acknowledgment language */
const ACKNOWLEDGMENT = /(?:acknowledged|as you (?:requested|asked)|per your (?:request|instructions)|you(?:'re| are) right|good (?:point|question|idea)|understood|will do|on it)/i;

// ── Main detection function ───────────────────────────────────────────

/**
 * Returns 'user-directed' | 'reply-to-user' | 'internal' to classify the message.
 *
 * - `user-directed`: Message is explicitly for the human user (accent highlight)
 * - `reply-to-user`: Message follows a user message (lighter blue highlight)
 * - `internal`: Internal coordination, no highlight
 */
export function classifyHighlight(
  text: string,
  context: MessageContext = {},
): 'user-directed' | 'reply-to-user' | 'internal' {
  // ── Definite positive: @user tag ──
  if (AT_USER_TAG.test(text)) return 'user-directed';

  // ── Definite negative: pure command messages ──
  if (COMMAND_ONLY.test(text)) return 'internal';

  // ── Definite negative: system/status blocks ──
  if (SYSTEM_PREFIX.test(text)) return 'internal';
  if (CREW_STATUS_BLOCK.test(text)) return 'internal';

  // ── Definite negative: agent coordination ──
  if (AGENT_COORD_PREFIX.test(text)) return 'internal';
  if (ROUTING_ARROW.test(text)) return 'internal';
  if (STATUS_EVENT_LINE.test(text) && !USER_ADDRESS.test(text)) return 'internal';

  // ── Strong positive: contains embedded user message ──
  if (USER_MESSAGE_MARKER.test(text)) return 'user-directed';

  // ── Mixed content: has crew commands but also user-directed language ──
  const hasCrewCommands = CREW_COMMAND_FENCE.test(text);

  // If the text has explicit user-addressing language, it's user-directed
  // even if it also contains some commands (lead might issue commands while talking to user)
  if (USER_ADDRESS.test(text) && !hasCrewCommands) return 'user-directed';
  if (ACKNOWLEDGMENT.test(text) && !hasCrewCommands) return 'user-directed';

  // ── Context-based: previous message was from user ──
  if (context.prevSenderIsUser && !hasCrewCommands) return 'reply-to-user';

  // ── Default: if it has crew commands, it's internal; otherwise borderline ──
  if (hasCrewCommands) return 'internal';

  // Short messages without clear signals: use context
  if (context.prevSenderIsUser) return 'reply-to-user';

  return 'internal';
}

/**
 * Simple boolean helper: is the message directed at the human user?
 * Returns true for both 'user-directed' and 'reply-to-user'.
 */
export function isUserDirected(text: string, context: MessageContext = {}): boolean {
  return classifyHighlight(text, context) !== 'internal';
}
