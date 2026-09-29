import type { GameRoom, RoomStore } from './types.ts';

/**
 * In-memory implementation of RoomStore.
 * Provides fast, synchronous room persistence for testing and standalone execution.
 */
export class InMemoryRoomStore implements RoomStore {
  private readonly rooms = new Map<string, GameRoom>();

  get(code: string): GameRoom | undefined {
    return this.rooms.get(code);
  }

  set(code: string, room: GameRoom): void {
    this.rooms.set(code, room);
  }

  has(code: string): boolean {
    return this.rooms.has(code);
  }

  delete(code: string): boolean {
    return this.rooms.delete(code);
  }

  list(): GameRoom[] {
    return Array.from(this.rooms.values());
  }

  clear(): void {
    this.rooms.clear();
  }
}
