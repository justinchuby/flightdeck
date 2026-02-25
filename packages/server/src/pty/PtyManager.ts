import { EventEmitter } from 'events';
import * as pty from 'node-pty';

export interface PtyOptions {
  command: string;
  args: string[];
  cwd?: string;
  env?: Record<string, string>;
  cols?: number;
  rows?: number;
}

export class PtyManager extends EventEmitter {
  private process: pty.IPty | null = null;
  private outputBuffer: string[] = [];
  private _exitCode: number | null = null;

  get pid(): number | undefined {
    return this.process?.pid;
  }

  get exitCode(): number | null {
    return this._exitCode;
  }

  get isRunning(): boolean {
    return this.process !== null && this._exitCode === null;
  }

  spawn(opts: PtyOptions): void {
    if (this.process) {
      throw new Error('PTY already running');
    }

    this.process = pty.spawn(opts.command, opts.args, {
      name: 'xterm-256color',
      cols: opts.cols || 120,
      rows: opts.rows || 30,
      cwd: opts.cwd || process.cwd(),
      env: { ...process.env, ...opts.env } as Record<string, string>,
    });

    this.process.onData((data: string) => {
      this.outputBuffer.push(data);
      // Keep buffer bounded
      if (this.outputBuffer.length > 10000) {
        this.outputBuffer = this.outputBuffer.slice(-5000);
      }
      this.emit('data', data);
    });

    this.process.onExit(({ exitCode }) => {
      this._exitCode = exitCode;
      this.emit('exit', exitCode);
      this.process = null;
    });
  }

  write(data: string): void {
    if (!this.process) throw new Error('PTY not running');
    this.process.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.process) {
      this.process.resize(cols, rows);
    }
  }

  kill(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }

  getBufferedOutput(): string {
    return this.outputBuffer.join('');
  }

  clearBuffer(): void {
    this.outputBuffer = [];
  }
}
