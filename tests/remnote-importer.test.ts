import type { RNPlugin } from '@remnote/plugin-sdk';
import { describe, expect, it, vi } from 'vitest';
import { sha256 } from '../src/hash';
import { importSource, importSources } from '../src/remnote-importer';
import { REGISTRY_STORAGE_KEY } from '../src/registry';
import type { ImportRecordV1, ImportRegistryV1, SourceInput } from '../src/types';

vi.mock('@remnote/plugin-sdk', () => ({
  BuiltInPowerupCodes: { MultiLineCard: 'w', MultipleChoice: 'mc' },
  SetRemType: { CONCEPT: 'concept', DESCRIPTOR: 'descriptor' },
}));

class FakeRem {
  _id: string;
  removed = false;
  parent: FakeRem | null = null;
  children: FakeRem[] = [];
  text: unknown = [];
  textWrites: Array<{ value: unknown; inTransaction: boolean }> = [];
  backText: unknown = [];
  position = 0;

  constructor(
    id: string,
    private readonly events: string[],
    private readonly isInTransaction: () => boolean = () => false,
  ) {
    this._id = id;
  }

  async setText(value: unknown) {
    this.text = value;
    this.textWrites.push({ value, inTransaction: this.isInTransaction() });
  }
  async setBackText(value: unknown) { this.backText = value; }
  async setIsDocument() { return undefined; }
  async setPracticeDirection() { return undefined; }
  async setType() { return undefined; }
  async setFontSize() { return undefined; }
  async setIsListItem() { return undefined; }
  async setIsCardItem() { return undefined; }
  async addPowerup() { return undefined; }
  async addTag() { return undefined; }

  async setParent(parent: FakeRem | null, position?: number) {
    if (this.parent) this.parent.children = this.parent.children.filter((child) => child !== this);
    this.parent = parent;
    if (position !== undefined) this.position = position;
    if (parent) parent.children.splice(position ?? parent.children.length, 0, this);
  }

  async getChildrenRem() { return this.children.filter((child) => !child.removed); }

  async remove() {
    this.removed = true;
    this.events.push(`remove:${this._id}`);
  }

  async positionAmongstSiblings() { return this.position; }
  async isPowerup() { return false; }
}

interface FakePluginOptions {
  registry?: ImportRegistryV1;
  existing?: FakeRem[];
  failAtCreate?: number;
  parseFromMarkdown?: (markdown: string) => Promise<unknown[]>;
}

function makePlugin(options: FakePluginOptions = {}) {
  const events: string[] = [];
  const rems = new Map<string, FakeRem>();
  options.existing?.forEach((rem) => rems.set(rem._id, rem));
  let registry: ImportRegistryV1 = structuredClone(
    options.registry ?? { version: 1, records: {} },
  );
  let createCount = 0;
  let inTransaction = false;

  const setSynced = vi.fn(async (_key: string, value: ImportRegistryV1) => {
    events.push('persist');
    registry = structuredClone(value);
  });

  const plugin = {
    app: {
      transaction: async (callback: () => Promise<void>) => {
        inTransaction = true;
        try {
          return await callback();
        } finally {
          inTransaction = false;
        }
      },
    },
    rem: {
      createRem: vi.fn(async () => {
        createCount += 1;
        if (options.failAtCreate === createCount) return undefined;
        const rem = new FakeRem(`new-${createCount}`, events, () => inTransaction);
        rems.set(rem._id, rem);
        return rem;
      }),
      findOne: vi.fn(async (id: string) => {
        const rem = rems.get(id);
        return rem && !rem.removed ? rem : undefined;
      }),
    },
    richText: {
      parseFromMarkdown: vi.fn(options.parseFromMarkdown ?? (async (markdown: string) => [markdown])),
      toString: vi.fn(async (value: unknown[]) => value.join('')),
    },
    search: { search: vi.fn(async () => []) },
    storage: {
      getSynced: vi.fn(async (key: string) =>
        key === REGISTRY_STORAGE_KEY ? structuredClone(registry) : undefined),
      setSynced,
    },
  } as unknown as RNPlugin;

  return {
    plugin,
    events,
    rems,
    setSynced,
    registry: () => registry,
    createCount: () => createCount,
  };
}

const source = (text = '- Front >> Back'): SourceInput => ({
  key: 'file:note.md',
  title: 'Note',
  kind: 'file',
  text,
  parentId: null,
});

function record(contentHash: string): ImportRecordV1 {
  return {
    sourceKey: 'file:note.md',
    documentId: 'old-document',
    parentId: null,
    title: 'Note',
    contentHash,
    renderingVersion: 3,
  };
}

describe('RemNote replacement integration', () => {
  it('removes a middle line while retaining the following Rem identity', async () => {
    const harness = makePlugin();
    await importSource(harness.plugin, source('- First\n- Removed\n- Last'));
    const last = harness.rems.get('new-4');
    const result = await importSource(harness.plugin, {...source('- First\n- Last'), reimportMode: 'sync'});
    expect(result.status).toBe('updated');
    expect(harness.rems.get('new-3')?.removed).toBe(true);
    expect(last?.removed).toBe(false);
    expect(last?.text).toEqual(['Last']);
  });
  it('updates an existing card and inserts a line before an unchanged sibling', async () => {
    const harness = makePlugin();
    await importSource(harness.plugin, source('- Question >> Old\n- Keep'));
    const card = harness.rems.get('new-2');
    const sibling = harness.rems.get('new-3');
    const result = await importSource(harness.plugin, {
      ...source('- Question >> New\n- Inserted\n- Keep'), reimportMode: 'sync',
    });
    expect(result.status).toBe('updated');
    expect(card?.backText).toEqual(['New']);
    expect(sibling?.removed).toBe(false);
    expect(harness.rems.get('new-4')?.text).toEqual(['Inserted']);
  });
  it('adds appended lines under an existing Rem without replacing it', async () => {
    const harness = makePlugin();
    const first = await importSource(harness.plugin, source('- Parent'));
    const originalChild = harness.rems.get('new-2');
    expect(first.status).toBe('created');
    const second = await importSource(harness.plugin, {
      ...source('- Parent\n  - New >> Answer'), reimportMode: 'append',
    });
    expect(second.status).toBe('appended');
    expect(second.documentId).toBe(first.documentId);
    expect(originalChild?.removed).toBe(false);
    expect(harness.rems.get('new-3')?.parent).toBe(originalChild);
    expect(harness.registry().records['file:note.md'].documentId).toBe(first.documentId);
  });

  it('rejects changes to earlier lines in add-only mode', async () => {
    const harness = makePlugin();
    await importSource(harness.plugin, source('- Original'));
    const count = harness.createCount();
    const result = await importSource(harness.plugin, {
      ...source('- Changed\n- New'), reimportMode: 'append',
    });
    expect(result.status).toBe('failed');
    expect(result.message).toContain('differs from the source');
    expect(harness.createCount()).toBe(count);
    expect(harness.rems.get('new-1')?.removed).toBe(false);
  });

  it('keeps heading levels 4 to 6 visible in imported text', async () => {
    const harness = makePlugin();
    const result = await importSource(harness.plugin, source('#### Four\n##### Five\n###### Six'));
    expect(result.status).toBe('created');
    expect(harness.rems.get('new-2')?.text).toEqual(['**Four**']);
    expect(harness.rems.get('new-3')?.text).toEqual(['**Five**']);
    expect(harness.rems.get('new-4')?.text).toEqual(['**Six**']);
  });

  it('returns unchanged without creating anything for an identical tracked source', async () => {
    const input = source();
    const old = new FakeRem('old-document', []);
    const previous = record(await sha256(input.text));
    const harness = makePlugin({
      existing: [old],
      registry: { version: 1, records: { [previous.sourceKey]: previous } },
    });

    const imported = await importSource(harness.plugin, input);

    expect(imported.status).toBe('unchanged');
    expect(harness.createCount()).toBe(0);
    expect(old.removed).toBe(false);
    expect(harness.setSynced).not.toHaveBeenCalled();
  });

  it('removes the old document and persists the new record only after a successful build', async () => {
    const oldEvents: string[] = [];
    const old = new FakeRem('old-document', oldEvents);
    const previous = record('old-hash');
    const harness = makePlugin({
      existing: [old],
      registry: { version: 1, records: { [previous.sourceKey]: previous } },
    });
    // Keep all lifecycle events in one ordered array.
    (old as unknown as { events: string[] }).events = harness.events;

    const imported = await importSource(harness.plugin, source());

    expect(imported.status).toBe('replaced');
    expect(old.removed).toBe(true);
    expect(harness.events).toEqual(['remove:old-document', 'persist']);
    expect(harness.registry().records['file:note.md'].documentId).toBe(imported.documentId);
    const committed = harness.rems.get(imported.documentId!);
    expect(committed?.text).toEqual(['Note']);
    expect(committed?.textWrites.at(-1)).toEqual({ value: ['Note'], inTransaction: false });
  });

  it('preserves the old document and registry when construction fails', async () => {
    const old = new FakeRem('old-document', []);
    const previous = record('old-hash');
    const harness = makePlugin({
      existing: [old],
      registry: { version: 1, records: { [previous.sourceKey]: previous } },
      failAtCreate: 2,
    });

    const imported = await importSource(harness.plugin, source());

    expect(imported.status).toBe('failed');
    expect(old.removed).toBe(false);
    expect(harness.events).toContain('remove:new-1');
    expect(harness.setSynced).not.toHaveBeenCalled();
    expect(harness.registry().records['file:note.md']).toEqual(previous);
  });

  it('isolates batch failures and continues with later sources', async () => {
    const harness = makePlugin();
    const results = await importSources(harness.plugin, [
      { ...source('- Missing children >>>'), key: 'file:bad.md', title: 'Bad' },
      { ...source('- Good >> Answer'), key: 'file:good.md', title: 'Good' },
    ]);

    expect(results.map((item) => item.status)).toEqual(['failed', 'created']);
    expect(harness.registry().records['file:good.md']).toBeDefined();
    expect(harness.registry().records['file:bad.md']).toBeUndefined();
  });

  it('assigns one shared cloze ID to every cloze on the same Rem', async () => {
    const harness = makePlugin({
      parseFromMarkdown: async (markdown) => markdown.includes('{{one}}')
        ? [
          { i: 'm', text: 'one', cId: 'original-1' },
          ' and ',
          { i: 'm', text: 'two', cId: 'original-2' },
        ]
        : [markdown],
    });

    const imported = await importSource(harness.plugin, source('- {{one}} and {{two}}'));
    const clozeText = harness.rems.get('new-2')?.text as Array<string | { cId?: string }>;
    const ids = clozeText
      .filter((element): element is { cId?: string } => typeof element !== 'string')
      .map((element) => element.cId);

    expect(imported.status).toBe('created');
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(1);
  });
});
