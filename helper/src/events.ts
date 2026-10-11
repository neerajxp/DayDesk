/**
 * Process-wide event bus.
 *
 * The sync engine publishes here; the WebSocket layer and the OS-notification
 * layer subscribe. Keeping this in the middle means sync has no idea whether a
 * panel is open, and the server has no idea how sync works.
 */

import { EventEmitter } from 'node:events';
import type { ServerEvent } from './types/mail.js';

class TypedBus {
  private readonly emitter = new EventEmitter({ captureRejections: true });

  constructor() {
    // A sync pass must not die because a listener threw.
    this.emitter.setMaxListeners(50);
  }

  publish(event: ServerEvent): void {
    this.emitter.emit('event', event);
  }

  subscribe(listener: (event: ServerEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  get listenerCount(): number {
    return this.emitter.listenerCount('event');
  }
}

export const bus = new TypedBus();
