import { logger } from '../utils/logger.js';

export interface Message {
  role: 'system' | 'user' | 'assistant';
  content: string;
  timestamp?: number;
}

export interface CompressionResult {
  originalCount: number;
  compressedCount: number;
  originalTokens: number;
  compressedTokens: number;
  savedTokens: number;
}

export class ContextCompressor {
  /** Rough token estimation (4 chars ≈ 1 token) */
  static estimateTokens(text: string): number {
    return Math.ceil(text.length / 4);
  }

  /** Estimate tokens for a message array */
  static estimateMessageTokens(messages: Message[]): number {
    return messages.reduce((sum, m) => sum + ContextCompressor.estimateTokens(m.content) + 4, 0);
  }

  /**
   * Compress older messages by collapsing verbose tool outputs and repeated patterns.
   * Keeps system prompt, recent N messages, and important messages intact.
   *
   * @param messages    The full message array
   * @param keepRecent  Number of recent messages to preserve verbatim
   * @param contextLimit Max tokens target
   */
  static compress(
    messages: Message[],
    keepRecent: number = 20,
    contextLimit: number = 100_000,
  ): { messages: Message[]; result: CompressionResult } {
    const originalTokens = ContextCompressor.estimateMessageTokens(messages);

    if (originalTokens < contextLimit * 0.7 || messages.length <= keepRecent + 2) {
      return {
        messages,
        result: {
          originalCount: messages.length,
          compressedCount: messages.length,
          originalTokens,
          compressedTokens: originalTokens,
          savedTokens: 0,
        },
      };
    }

    // Split: system prompt + compressible middle + recent tail
    const systemMsgs = messages.filter((m) => m.role === 'system');
    const nonSystem = messages.filter((m) => m.role !== 'system');
    const recentStart = Math.max(0, nonSystem.length - keepRecent);
    const oldMessages = nonSystem.slice(0, recentStart);
    const recentMessages = nonSystem.slice(recentStart);

    // Compress old messages into summary batches
    const compressed = ContextCompressor.compressOldMessages(oldMessages);

    const result: Message[] = [...systemMsgs, ...compressed, ...recentMessages];
    const compressedTokens = ContextCompressor.estimateMessageTokens(result);

    const compressionResult: CompressionResult = {
      originalCount: messages.length,
      compressedCount: result.length,
      originalTokens,
      compressedTokens,
      savedTokens: originalTokens - compressedTokens,
    };

    logger.info(
      'context-compressor',
      `Compressed ${compressionResult.originalCount} → ${compressionResult.compressedCount} messages, saved ~${compressionResult.savedTokens} tokens`,
    );

    return { messages: result, result: compressionResult };
  }

  /** Compress a batch of old messages into summary messages */
  private static compressOldMessages(messages: Message[]): Message[] {
    if (messages.length === 0) return [];

    const result: Message[] = [];
    const BATCH_SIZE = 10;

    for (let i = 0; i < messages.length; i += BATCH_SIZE) {
      const batch = messages.slice(i, i + BATCH_SIZE);
      const summary = ContextCompressor.summarizeBatch(batch);
      result.push({
        role: 'user',
        content: `[Context Summary — ${batch.length} messages compressed]\n${summary}`,
        timestamp: batch[0].timestamp,
      });
    }

    return result;
  }

  /** Create a text summary of a batch of messages */
  static summarizeBatch(batch: Message[]): string {
    const lines: string[] = [];

    for (const msg of batch) {
      const content = msg.content;

      // Detect and compress common patterns
      if (content.includes('[System]')) {
        // System messages: keep the key info
        const firstLine = content.split('\n')[0].slice(0, 150);
        lines.push(`• ${msg.role}: ${firstLine}`);
      } else if (
        content.includes('tool_call') ||
        content.includes('editFile') ||
        content.includes('readFile')
      ) {
        // Tool calls: collapse to one line
        const toolMatch = content.match(
          /(?:tool_call|editFile|readFile|bash|grep|glob)\s*[:(]?\s*([^\n]{0,80})/,
        );
        lines.push(`• ${msg.role}: [tool] ${toolMatch ? toolMatch[1].trim() : 'operation'}`);
      } else if (content.length > 500) {
        // Long messages: truncate
        lines.push(`• ${msg.role}: ${content.slice(0, 200)}...`);
      } else {
        // Short messages: keep as-is
        lines.push(`• ${msg.role}: ${content.slice(0, 200)}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Check if compression is recommended based on estimated token usage.
   */
  static shouldCompress(messages: Message[], contextLimit: number = 100_000): boolean {
    const estimated = ContextCompressor.estimateMessageTokens(messages);
    return estimated > contextLimit * 0.8;
  }

  /**
   * Identify "important" messages that should never be compressed.
   * Returns indices of important messages.
   */
  static findImportantMessages(messages: Message[]): number[] {
    const important: number[] = [];
    for (let i = 0; i < messages.length; i++) {
      const content = messages[i].content;
      if (
        content.includes('[System] ✅') ||
        content.includes('[System] ❌') ||
        content.includes('DECISION') ||
        content.includes('PROGRESS') ||
        content.includes('build failed') ||
        content.includes('test failed') ||
        /\[\[\[.*?\]\]\]/.test(content) // Any ACP command
      ) {
        important.push(i);
      }
    }
    return important;
  }
}
