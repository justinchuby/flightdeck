import { EventEmitter } from 'events';

export interface BusMessage {
  id: string;
  from: string;
  to: string | '*';
  type: 'request' | 'response' | 'broadcast' | 'spawn_request';
  content: string;
  timestamp: string;
}

export class MessageBus extends EventEmitter {
  private history: BusMessage[] = [];

  send(msg: Omit<BusMessage, 'id' | 'timestamp'>): BusMessage {
    const full: BusMessage = {
      ...msg,
      id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
    };
    this.history.push(full);
    if (this.history.length > 10000) {
      this.history = this.history.slice(-5000);
    }
    this.emit('message', full);
    return full;
  }

  getHistory(agentId?: string): BusMessage[] {
    if (!agentId) return this.history;
    return this.history.filter((m) => m.from === agentId || m.to === agentId || m.to === '*');
  }
}
