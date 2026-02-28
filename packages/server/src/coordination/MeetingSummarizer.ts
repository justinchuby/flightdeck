export interface MeetingSummary {
  id: string;
  groupName: string;
  startTime: number;
  endTime: number;
  participants: string[];
  messageCount: number;
  decisions: string[];
  actionItems: string[];
  topics: string[];
  summary: string;
}

export interface MeetingMessage {
  from: string;
  content: string;
  timestamp: number;
}

export class MeetingSummarizer {
  private summaries: MeetingSummary[] = [];

  summarize(groupName: string, messages: MeetingMessage[]): MeetingSummary {
    if (messages.length === 0) throw new Error('No messages to summarize');

    const participants = [...new Set(messages.map(m => m.from))];
    const decisions = this.extractDecisions(messages);
    const actionItems = this.extractActionItems(messages);
    const topics = this.extractTopics(messages);
    const summary = this.generateSummary(groupName, participants, decisions, actionItems, messages.length);

    const result: MeetingSummary = {
      id: `meeting-${Date.now().toString(36)}`,
      groupName,
      startTime: messages[0].timestamp,
      endTime: messages[messages.length - 1].timestamp,
      participants,
      messageCount: messages.length,
      decisions,
      actionItems,
      topics,
      summary,
    };

    this.summaries.push(result);
    return result;
  }

  private extractDecisions(messages: Array<{ content: string }>): string[] {
    const decisionPatterns = [
      /decided?\s+(?:to\s+)?(.+)/i,
      /agreed?\s+(?:to\s+|on\s+)?(.+)/i,
      /conclusion:\s*(.+)/i,
      /resolved?:\s*(.+)/i,
      /will\s+(?:go with|use|adopt)\s+(.+)/i,
    ];
    const decisions: string[] = [];
    for (const msg of messages) {
      for (const pattern of decisionPatterns) {
        const match = msg.content.match(pattern);
        if (match) decisions.push(match[1].trim().slice(0, 200));
      }
    }
    return [...new Set(decisions)];
  }

  private extractActionItems(messages: Array<{ content: string }>): string[] {
    const actionPatterns = [
      /(?:TODO|action item|next step|will do|need to|should):\s*(.+)/i,
      /I'll\s+(.+)/i,
      /(?:assigned?|delegated?)\s+(?:to\s+)?(?:\w+):\s*(.+)/i,
    ];
    const items: string[] = [];
    for (const msg of messages) {
      for (const pattern of actionPatterns) {
        const match = msg.content.match(pattern);
        if (match) items.push((match[1] || match[2] || '').trim().slice(0, 200));
      }
    }
    return items.filter(Boolean).slice(0, 20);
  }

  private extractTopics(messages: Array<{ content: string }>): string[] {
    // Simple keyword extraction — find most common non-trivial words/phrases
    const words = new Map<string, number>();
    const stopWords = new Set([
      'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been',
      'to', 'of', 'and', 'in', 'that', 'it', 'for', 'with', 'on', 'at',
      'by', 'this', 'from', 'or', 'but', 'not', 'we', 'i', 'you', 'they',
      'he', 'she', 'my', 'your', 'our', 'can', 'will', 'do', 'did', 'has',
      'have', 'had',
    ]);
    for (const msg of messages) {
      for (const word of msg.content.toLowerCase().split(/\W+/)) {
        if (word.length > 3 && !stopWords.has(word)) {
          words.set(word, (words.get(word) ?? 0) + 1);
        }
      }
    }
    return [...words.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([w]) => w);
  }

  private generateSummary(
    groupName: string,
    participants: string[],
    decisions: string[],
    actionItems: string[],
    msgCount: number,
  ): string {
    let summary = `Group "${groupName}": ${participants.length} participants, ${msgCount} messages.`;
    if (decisions.length > 0) summary += ` ${decisions.length} decision(s) made.`;
    if (actionItems.length > 0) summary += ` ${actionItems.length} action item(s) identified.`;
    return summary;
  }

  getSummaries(): MeetingSummary[] {
    return [...this.summaries];
  }

  getSummary(id: string): MeetingSummary | undefined {
    return this.summaries.find(s => s.id === id);
  }

  getByGroup(groupName: string): MeetingSummary[] {
    return this.summaries.filter(s => s.groupName === groupName);
  }
}
