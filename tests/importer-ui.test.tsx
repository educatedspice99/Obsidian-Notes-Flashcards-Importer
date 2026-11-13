// @vitest-environment jsdom

import ReactDOM from 'react-dom';
import { act, Simulate } from 'react-dom/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImportRegistryV1, ImportResult } from '../src/types';

const mocks = vi.hoisted(() => ({
  importSources: vi.fn(),
  loadRegistry: vi.fn(),
  renderWidget: vi.fn(),
  usePlugin: vi.fn(),
}));

vi.mock('@remnote/plugin-sdk', () => ({
  renderWidget: mocks.renderWidget,
  usePlugin: mocks.usePlugin,
}));

vi.mock('../src/remnote-importer', () => ({ importSources: mocks.importSources }));
vi.mock('../src/registry', () => ({ loadRegistry: mocks.loadRegistry }));

import { ImporterWidget } from '../src/widgets/importer';

const emptyRegistry = (): ImportRegistryV1 => ({ version: 1, records: {} });

function result(status: ImportResult['status'] = 'created'): ImportResult {
  return {
    sourceKey: 'paste:pasted-note',
    title: 'Pasted note',
    status,
    diagnostics: [],
  };
}

function makePlugin() {
  return {
    focus: { getFocusedRem: vi.fn(async () => undefined) },
    richText: {
      toString: vi.fn(async (value: unknown) => Array.isArray(value) ? value.join('') : String(value ?? '')),
    },
    search: {
      search: vi.fn(async (): Promise<Array<{ _id: string; text: string[] }>> => []),
    },
    storage: { getSynced: vi.fn(), setSynced: vi.fn() },
    widget: { closePopup: vi.fn(async () => undefined) },
  };
}

let container: HTMLDivElement;
let plugin: ReturnType<typeof makePlugin>;
let uuid = 0;

async function settle() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderImporter() {
  await act(async () => {
    ReactDOM.render(<ImporterWidget />, container);
  });
  await settle();
}

function clickButton(label: string) {
  const button = [...container.querySelectorAll('button')]
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!button) throw new Error(`Button not found: ${label}`);
  Simulate.click(button);
  return button;
}

function change(element: Element, target: Record<string, unknown>) {
  Simulate.change(element, { target } as any);
}

function fakeFile(name: string, text: string): File {
  const file = new File([text], name, { type: 'text/markdown' });
  Object.defineProperty(file, 'text', { value: async () => text });
  return file;
}

async function chooseFiles(files: File[]) {
  const input = container.querySelector('input[type="file"]') as HTMLInputElement;
  await act(async () => {
    change(input, { files });
    await Promise.resolve();
  });
  await settle();
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.appendChild(container);
  plugin = makePlugin();
  mocks.usePlugin.mockReturnValue(plugin);
  mocks.loadRegistry.mockResolvedValue(emptyRegistry());
  mocks.importSources.mockResolvedValue([result()]);
  vi.stubGlobal('crypto', { randomUUID: () => `test-${++uuid}` });
});

afterEach(() => {
  ReactDOM.unmountComponentAtNode(container);
  container.remove();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe('importer popup', () => {
  it('keeps overflowing importer content inside a dedicated scroll region', async () => {
    await renderImporter();

    const shell = container.querySelector('.importer-shell');
    const scrollRegion = container.querySelector('.importer-scroll-region');
    expect(shell?.firstElementChild?.classList.contains('topbar')).toBe(true);
    expect(shell?.lastElementChild?.classList.contains('import-actions')).toBe(true);
    expect(scrollRegion?.contains(container.querySelector('.workspace-grid'))).toBe(true);
  });

  it('accepts pasted text, previews the outline, and selects a searched destination', async () => {
    plugin.search.search.mockResolvedValue([{ _id: 'parent-1', text: ['Study'] }]);
    await renderImporter();

    await act(async () => { clickButton('Paste text'); });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      change(textarea, { value: '## Section\n- Question >> Answer' });
    });

    expect(container.textContent).toContain('Section');
    expect(container.textContent).toContain('Question');
    expect(container.textContent).toContain('2 Rems');
    expect(container.textContent).toContain('1 card Rems');

    const search = container.querySelector('input[placeholder="Search RemNote…"]') as HTMLInputElement;
    await act(async () => {
      change(search, { value: 'Stu' });
      await new Promise((resolve) => window.setTimeout(resolve, 230));
    });
    await settle();
    await act(async () => { clickButton('Study'); });
    expect(container.textContent).toContain('Selected: Study');
  });

  it('accepts multiple files and blocks duplicate source keys', async () => {
    await renderImporter();
    await chooseFiles([
      fakeFile('same.md', '- One >> Answer'),
      fakeFile('same.md', '- Two >> Answer'),
    ]);

    expect(container.textContent).toContain('This source key occurs more than once in the batch.');
    expect(container.querySelectorAll('.source')).toHaveLength(2);
    expect((container.querySelector('button.primary') as HTMLButtonElement).disabled).toBe(true);
  });

  it('requires explicit confirmation before replacing a tracked source', async () => {
    mocks.loadRegistry.mockResolvedValue({
      version: 1,
      records: {
        'file:tracked.md': {
          sourceKey: 'file:tracked.md',
          documentId: 'old-document',
          parentId: null,
          title: 'Tracked',
          contentHash: 'old-hash',
        },
      },
    });
    await renderImporter();
    await chooseFiles([fakeFile('tracked.md', '- New >> Answer')]);

    const importButton = container.querySelector('button.primary') as HTMLButtonElement;
    expect(container.textContent).toContain('Re-import 1 tracked document');
    expect(importButton.disabled).toBe(false);

    const mode = container.querySelector('.danger-panel select') as HTMLSelectElement;
    await act(async () => { change(mode, { value: 'replace' }); });
    expect([...mode.options].map(option => option.textContent)).toEqual(['Automatically update changes', 'Create new document']);
    expect(importButton.disabled).toBe(false);
    await act(async () => { Simulate.click(importButton); });
    expect(mocks.importSources.mock.calls[0][1][0].key).toContain(':copy:');
  });

  it('shows batch progress and results, then permits a failed source to be retried', async () => {
    let finish: ((value: ImportResult[]) => void) | undefined;
    mocks.importSources.mockImplementationOnce(async (_plugin, _sources, onResult) =>
      new Promise<ImportResult[]>((resolve) => {
        onResult?.(result('failed'), 1, 1);
        finish = resolve;
      }));

    await renderImporter();
    await act(async () => { clickButton('Paste text'); });
    const textarea = container.querySelector('textarea') as HTMLTextAreaElement;
    await act(async () => {
      change(textarea, { value: '- Question >> Answer' });
    });

    await act(async () => {
      clickButton('Import 1 source');
      await Promise.resolve();
    });
    expect(container.querySelector('button.primary')?.textContent).toContain('Imported 1 of 1');

    await act(async () => {
      finish?.([{ ...result('failed'), message: 'Temporary failure' }]);
      await Promise.resolve();
    });
    expect(container.textContent).toContain('failed — Temporary failure');

    mocks.importSources.mockResolvedValueOnce([result('created')]);
    await act(async () => {
      clickButton('Import 1 source');
      await Promise.resolve();
    });
    expect(mocks.importSources).toHaveBeenCalledTimes(2);
    expect(container.textContent).toContain('created');
  });
});
