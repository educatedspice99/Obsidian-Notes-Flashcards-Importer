import { describe, expect, it, vi } from 'vitest';
import { performSafeReplacement } from '../src/replacement';

describe('performSafeReplacement', () => {
  it('populates, swaps, and then persists', async () => {
    const events: string[] = [];
    const outcome = await performSafeReplacement({
      createTemporary: async () => { events.push('create'); return 'temp'; },
      populate: async () => { events.push('populate'); },
      swap: async () => { events.push('swap'); return 'committed'; },
      cleanup: async () => { events.push('cleanup'); },
      persist: async () => { events.push('persist'); },
    });
    expect(outcome.committed).toBe('committed');
    expect(events).toEqual(['create', 'populate', 'swap', 'persist']);
  });

  it('cleans staging and never swaps when population fails', async () => {
    const swap = vi.fn();
    const cleanup = vi.fn(async () => undefined);
    await expect(performSafeReplacement({
      createTemporary: async () => 'temp',
      populate: async () => { throw new Error('population failed'); },
      swap,
      cleanup,
      persist: vi.fn(),
    })).rejects.toThrow('population failed');
    expect(swap).not.toHaveBeenCalled();
    expect(cleanup).toHaveBeenCalledWith('temp');
  });

  it('does not persist if the swap fails', async () => {
    const persist = vi.fn();
    await expect(performSafeReplacement({
      createTemporary: async () => 'temp',
      populate: async () => undefined,
      swap: async () => { throw new Error('swap failed'); },
      cleanup: async () => undefined,
      persist,
    })).rejects.toThrow('swap failed');
    expect(persist).not.toHaveBeenCalled();
  });

  it('does not remove a committed replacement if persistence fails', async () => {
    const cleanup = vi.fn();
    await expect(performSafeReplacement({
      createTemporary: async () => 'temp',
      populate: async () => undefined,
      swap: async () => 'committed',
      cleanup,
      persist: async () => { throw new Error('storage failed'); },
    })).rejects.toThrow('storage failed');
    expect(cleanup).not.toHaveBeenCalled();
  });
});
