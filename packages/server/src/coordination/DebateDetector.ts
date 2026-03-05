import type { ChatGroupRegistry, GroupMessage } from '../comms/ChatGroupRegistry.js';

// ── Types ─────────────────────────────────────────────────────────

export interface DebatePosition {
  agentId: string;
  agentRole: string;
  stance: string;       // Extracted position summary
  timestamp: string;
}

export interface Debate {
  id: string;
  topic: string;
  groupName: string;
  participants: string[];
  positions: DebatePosition[];
  status: 'active' | 'resolved';
  resolution?: string;
  startedAt: string;
  lastActivityAt: string;
  confidence: number;   // 0-100 how confident we are this is a real debate
}

// ── Disagreement patterns ─────────────────────────────────────────

// High-confidence indicators of disagreement (require word boundaries)
const STRONG_PATTERNS = [
  /\bi disagree\b/i,
  /\bi'd push back\b/i,
  /\bpush back\b/i,
  /\binstead,?\s+i(?:'d| would)\s+(?:suggest|recommend|propose)\b/i,
  /\bmy (?:concern|objection|reservation)\b/i,
  /\bthat(?:'s| is) (?:not|wrong|incorrect)\b/i,
  /\balternative(?:ly)?[,:]\b/i,
  /\bi (?:don't|do not) (?:think|agree|believe)\b/i,
  /\bhowever,?\s+i (?:think|believe|suggest)\b/i,
  /\bcontrary to\b/i,
  /\brespectfully,?\s+(?:i|that)\b/i,
];

// Moderate indicators — need additional context to confirm
const MODERATE_PATTERNS = [
  /\bbut (?:i think|consider|what about)\b/i,
  /\bhave you considered\b/i,
  /\bwhat if (?:we|instead)\b/i,
  /\bon the other hand\b/i,
  /\bi(?:'d| would) (?:prefer|rather|lean toward)\b/i,
  /\bnot sure (?:that|if|about)\b/i,
];

// Resolution indicators
const RESOLUTION_PATTERNS = [
  /\bagreed\b/i,
  /\bsounds good\b/i,
  /\blet(?:'s| us) go with\b/i,
  /\bi(?:'ll| will) defer\b/i,
  /\bfair point\b/i,
  /\byou(?:'re| are) right\b/i,
  /\bgood call\b/i,
  /\bconvinced\b/i,
  /\bconsensus\b/i,
];

const MIN_CONFIDENCE = 40; // Minimum confidence to report as debate

// ── DebateDetector ────────────────────────────────────────────────

export class DebateDetector {
  constructor(private chatGroupRegistry: ChatGroupRegistry) {}

  /** Scan group chat messages for debates */
  detectDebates(leadId: string, since?: string): Debate[] {
    // Single query for all messages across all groups (eliminates N+1)
    const allMessages = this.chatGroupRegistry.getMessagesByLead(leadId, 2000);

    // Filter by since timestamp if provided
    const filtered = since
      ? allMessages.filter(m => m.timestamp >= since)
      : allMessages;

    if (filtered.length < 2) return [];

    // Group messages by groupName
    const byGroup = new Map<string, GroupMessage[]>();
    for (const msg of filtered) {
      const list = byGroup.get(msg.groupName);
      if (list) list.push(msg);
      else byGroup.set(msg.groupName, [msg]);
    }

    const debates: Debate[] = [];
    for (const [groupName, messages] of byGroup) {
      if (messages.length < 2) continue;

      // Group messages into conversation threads by temporal proximity
      const threads = this.groupIntoThreads(messages);

      for (const thread of threads) {
        const debate = this.analyzeThread(thread, groupName);
        if (debate && debate.confidence >= MIN_CONFIDENCE) {
          debates.push(debate);
        }
      }
    }

    return debates.sort((a, b) => b.lastActivityAt.localeCompare(a.lastActivityAt));
  }

  /** Group sequential messages into threads based on temporal proximity */
  private groupIntoThreads(messages: GroupMessage[]): GroupMessage[][] {
    if (messages.length === 0) return [];

    const threads: GroupMessage[][] = [];
    let currentThread: GroupMessage[] = [messages[0]];

    for (let i = 1; i < messages.length; i++) {
      const prev = messages[i - 1];
      const curr = messages[i];

      // Start new thread if gap > 5 min
      const gap = new Date(curr.timestamp).getTime() - new Date(prev.timestamp).getTime();

      if (gap > 5 * 60_000) {
        if (currentThread.length >= 2) threads.push(currentThread);
        currentThread = [curr];
      } else {
        currentThread.push(curr);
      }
    }
    if (currentThread.length >= 2) threads.push(currentThread);

    return threads;
  }

  /** Analyze a message thread for debate signals */
  private analyzeThread(thread: GroupMessage[], groupName: string): Debate | null {
    if (thread.length < 2) return null;

    let strongHits = 0;
    let moderateHits = 0;
    const positions: DebatePosition[] = [];
    let resolved = false;
    let resolution: string | undefined;
    const participants = new Set<string>();

    for (const msg of thread) {
      const text = msg.content;
      participants.add(msg.fromAgentId);

      // Check for strong disagreement
      for (const pattern of STRONG_PATTERNS) {
        if (pattern.test(text)) {
          strongHits++;
          positions.push({
            agentId: msg.fromAgentId,
            agentRole: msg.fromRole,
            stance: text.slice(0, 200),
            timestamp: msg.timestamp,
          });
          break; // One hit per message is enough
        }
      }

      // Check for moderate disagreement
      if (strongHits === 0 || positions[positions.length - 1]?.timestamp !== msg.timestamp) {
        for (const pattern of MODERATE_PATTERNS) {
          if (pattern.test(text)) {
            moderateHits++;
            break;
          }
        }
      }

      // Check for resolution
      for (const pattern of RESOLUTION_PATTERNS) {
        if (pattern.test(text)) {
          resolved = true;
          resolution = text.slice(0, 200);
          break;
        }
      }
    }

    // Need at least 2 participants with disagreement signals
    if (participants.size < 2) return null;
    if (strongHits === 0 && moderateHits < 2) return null;

    // Compute confidence
    const confidence = Math.min(100,
      strongHits * 30 + moderateHits * 15 + (participants.size > 2 ? 10 : 0),
    );

    if (confidence < MIN_CONFIDENCE) return null;

    // Extract topic from first message
    const topic = thread[0].content.slice(0, 100);

    return {
      id: `debate-${thread[0].timestamp.replace(/[^0-9]/g, '').slice(0, 14)}`,
      topic,
      groupName,
      participants: [...participants],
      positions: positions.slice(0, 10), // Cap positions
      status: resolved ? 'resolved' : 'active',
      resolution,
      startedAt: thread[0].timestamp,
      lastActivityAt: thread[thread.length - 1].timestamp,
      confidence,
    };
  }
}
