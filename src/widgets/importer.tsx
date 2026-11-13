import { renderWidget, usePlugin, type PluginRem } from '@remnote/plugin-sdk';
import { useEffect, useMemo, useRef, useState } from 'react';
import { importSources } from '../remnote-importer';
import { normalizeSourceKey, parseMarkdown, titleFromFilename } from '../parser';
import { loadRegistry } from '../registry';
import type {
  ImportNode,
  ImportRegistryV1,
  ImportResult,
  ParseResult,
  SourceInput,
  SourceKind,
} from '../types';
import '../styles.css';

interface SourceDraft {
  id: string;
  kind: SourceKind;
  title: string;
  key: string;
  text: string;
  parsed: ParseResult;
}

interface ParentChoice {
  id: string | null;
  label: string;
}

const emptyPaste = (): SourceDraft => ({
  id: crypto.randomUUID(),
  kind: 'paste',
  title: 'Pasted note',
  key: 'paste:pasted-note',
  text: '',
  parsed: parseMarkdown(''),
});

function PreviewTree({ nodes }: { nodes: ImportNode[] }) {
  if (!nodes.length) return <p className="muted">Nothing to preview yet.</p>;
  return (
    <ul className="preview-tree">
      {nodes.map((node) => (
        <li key={node.id}>
          <span className={node.headingLevel ? node.headingLevel > 3 ? 'heading-preview' : `heading-preview h${node.headingLevel}` : ''}>
            {node.ordered ? '1. ' : ''}{node.markdown || '(empty)'}
          </span>
          <span className="badges">
            {node.card && <span className="badge card">{node.card.marker}</span>}
            {node.hasCloze && <span className="badge cloze">cloze group</span>}
            {node.cluster && <span className="badge cluster">cluster</span>}
          </span>
          {node.children.length > 0 && <PreviewTree nodes={node.children} />}
        </li>
      ))}
    </ul>
  );
}

export function ImporterWidget() {
  const plugin = usePlugin();
  const scrollRegion = useRef<HTMLDivElement>(null);
  const [tab, setTab] = useState<SourceKind>('file');
  const [files, setFiles] = useState<SourceDraft[]>([]);
  const [paste, setPaste] = useState<SourceDraft>(emptyPaste);
  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [parent, setParent] = useState<ParentChoice>({ id: null, label: 'Top level' });
  const [parentQuery, setParentQuery] = useState('');
  const [parentResults, setParentResults] = useState<ParentChoice[]>([]);
  const [registry, setRegistry] = useState<ImportRegistryV1>({ version: 1, records: {} });
  const [reimportMode, setReimportMode] = useState<'sync' | 'replace'>('sync');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [results, setResults] = useState<ImportResult[]>([]);

  const sources = useMemo(
    () => tab === 'file' ? files : paste.text.trim() ? [paste] : [],
    [files, paste, tab],
  );
  const selected = sources.find((source) => source.id === selectedSourceId) ?? sources[0];

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const loaded = await loadRegistry(plugin);
      const focused = await plugin.focus.getFocusedRem();
      if (cancelled) return;
      setRegistry(loaded);
      if (focused) {
        const label = (await plugin.richText.toString(focused.text ?? [])).trim();
        if (!cancelled) setParent({ id: focused._id, label: label || 'Focused Rem' });
      }
    })();
    return () => { cancelled = true; };
  }, [plugin]);

  useEffect(() => {
    if (!parentQuery.trim()) {
      setParentResults([]);
      return;
    }
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void (async () => {
        const matches = await plugin.search.search([parentQuery.trim()], undefined, { numResults: 12 });
        const choices = await Promise.all(matches.map(async (rem: PluginRem) => ({
          id: rem._id,
          label: (await plugin.richText.toString(rem.text ?? [])).trim() || '(Untitled Rem)',
        })));
        if (!cancelled) setParentResults(choices);
      })();
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [parentQuery, plugin]);

  const duplicateKeys = useMemo(() => {
    const counts = new Map<string, number>();
    sources.forEach((source) => counts.set(source.key, (counts.get(source.key) ?? 0) + 1));
    return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  }, [sources]);

  const replacements = sources.filter((source) => Boolean(registry.records[source.key]));
  const invalidMetadata = sources.some((source) => !source.key.trim() || !source.title.trim());
  const hasErrors = sources.some((source) =>
    source.parsed.diagnostics.some((diagnostic) => diagnostic.severity === 'error'));
  const canImport = sources.length > 0 && duplicateKeys.size === 0 && !invalidMetadata && !hasErrors &&
    !running;

  async function addFiles(fileList: FileList | null) {
    if (!fileList) return;
    const accepted = [...fileList].filter((file) => /\.(?:md|markdown|txt)$/i.test(file.name));
    const drafts = await Promise.all(accepted.map(async (file) => {
      const title = titleFromFilename(file.name);
      const text = await file.text();
      return {
        id: crypto.randomUUID(),
        kind: 'file' as const,
        title,
        key: `file:${normalizeSourceKey(file.name)}`,
        text,
        parsed: parseMarkdown(text),
      };
    }));
    scrollRegion.current?.scrollTo?.({ top: 0 });
    setFiles(drafts);
    setSelectedSourceId(drafts[0]?.id ?? null);
    setResults([]);
  }

  function updateDraft(id: string, update: Partial<Pick<SourceDraft, 'title' | 'key'>>) {
    if (tab === 'file') {
      setFiles((current) => current.map((source) => source.id === id ? { ...source, ...update } : source));
    } else {
      setPaste((current) => ({ ...current, ...update }));
    }
  }

  function updatePasteText(text: string) {
    setPaste((current) => ({ ...current, text, parsed: parseMarkdown(text) }));
    setSelectedSourceId(paste.id);
    setResults([]);
  }

  async function runImport() {
    if (!canImport) return;
    setRunning(true);
    setResults([]);
    const inputs: SourceInput[] = sources.map((source) => ({
      key: reimportMode === 'replace' ? `${source.key}:copy:${crypto.randomUUID()}` : source.key,
      title: source.title,
      kind: source.kind,
      text: source.text,
      parentId: reimportMode === 'sync' && registry.records[source.key] ? registry.records[source.key].parentId : parent.id,
      reimportMode,
    }));
    const imported = await importSources(plugin, inputs, (_result, completed, total) => {
      setProgress(`Imported ${completed} of ${total}…`);
    });
    setResults(imported);
    scrollRegion.current?.scrollTo?.({ top: 0, behavior: 'smooth' });
    setProgress('');
    setRunning(false);
    setRegistry(await loadRegistry(plugin));
  }

  return (
    <main className="importer-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">0.2.6 beta · Independent community plugin</p>
          <h1>Obsidian Notes &amp; Flashcards Importer</h1>
          <p className="subtitle">Import Markdown notes, outlines, and flashcards into RemNote. Select files or paste text each time.</p>
        </div>
        <button className="icon-button" onClick={() => void plugin.widget.closePopup()} aria-label="Close">×</button>
      </header>

      <div className="importer-scroll-region" ref={scrollRegion}>
      <details className="syntax-help">
        <summary>About this beta · Privacy and limitations</summary>
        <p>Independent community plugin; not affiliated with or endorsed by Obsidian or RemNote.</p>
        <p>Reads only the files you select or text you paste. No live vault sync, attachment upload, or vault-wide link resolution. Some Markdown and Obsidian formatting is simplified or unsupported; review the preview and imported result.</p>
        <p>Parsing happens in this plugin. Content is written to RemNote; imported notes and tracking metadata follow RemNote synchronization. This plugin adds no third-party note-processing service, analytics, or AI API.</p>
        <p>Requires knowledge-base read, create, modify, and delete access to find destinations and manage imported notes. Updating a tracked source can overwrite edits and delete Rems absent from the source. Matching reuses Rem identities where possible; review history is not guaranteed for removed, recreated, or substantially changed cards.</p>
      </details>
      <section className="import-summary" aria-label="Import overview">
          {results.length > 0 && (
            <div className="result-panel" role="status" aria-live="polite">
              <h2>Import results</h2>
              {results.map((result) => (
                <p key={result.sourceKey} className={result.status === 'failed' ? 'error' : 'success'}>
                  <strong>{result.title}:</strong> {result.status}{result.message ? ` — ${result.message}` : ''}
                </p>
              ))}
            </div>
          )}
          {replacements.length > 0 && (
            <div className="danger-panel update-panel">
              <strong>Re-import {replacements.length} tracked document{replacements.length === 1 ? '' : 's'}</strong>
              <label className="field"><span>Import action</span>
                <select value={reimportMode} onChange={(event) => { setReimportMode(event.target.value as 'sync' | 'replace'); }}>
                  <option value="sync">Automatically update changes</option>
                  
                  <option value="replace">Create new document</option>
                </select>
              </label>
              {reimportMode === 'sync' ? (
                <p>On Import, apply added, edited, and removed lines at the saved location. This can overwrite RemNote edits and delete Rems absent from the source. Matched Rems are reused where possible; removed or recreated cards lose their history. The document title must stay the same.</p>
) : (<p>Create a separate document from this source.</p>
              )}
            </div>
          )}          {selected && (
            <div className="metadata-card">
              <label className="field">
                <span>Document title</span>
                <input value={selected.title} onChange={(event) => updateDraft(selected.id, { title: event.target.value })} />
              </label>
              <label className="field">
                <span>Source key</span><small className="field-help">Keep this the same when importing changes to this note.</small>
                <input value={selected.key} onChange={(event) => updateDraft(selected.id, { key: normalizeSourceKey(event.target.value) })} />
              </label>
              {duplicateKeys.has(selected.key) && <p className="error-text">This source key occurs more than once in the batch.</p>}
              {(!selected.title.trim() || !selected.key.trim()) && <p className="error-text">Document title and source key are required.</p>}
            </div>
          )}


      </section>
        <section className="tabs" aria-label="Import source">
          <button className={tab === 'file' ? 'active' : ''} onClick={() => { setTab('file'); setResults([]); }}>Files</button>
          <button className={tab === 'paste' ? 'active' : ''} onClick={() => { setTab('paste'); setSelectedSourceId(paste.id); setResults([]); }}>Paste text</button>
        </section>

        <section className="workspace-grid">
        <div className="controls-column">
          <h2 className="section-title">1 · Choose your source</h2>
          {tab === 'file' ? (
            <label className="dropzone">
              <strong>Select Markdown or text files</strong>
              <span>Multiple .md, .markdown, and .txt files are supported.</span>
              <input type="file" multiple accept=".md,.markdown,.txt,text/markdown,text/plain" onChange={(event) => void addFiles(event.target.files)} />
            </label>
          ) : (
            <label className="field">
              <span>Markdown or plain text</span>
              <textarea rows={11} value={paste.text} onChange={(event) => updatePasteText(event.target.value)} placeholder="## Heading\n- Question >>>\n  - Answer" />
            </label>
          )}

          {sources.length > 0 && (
            <div className="source-list">
              {sources.map((source) => (
                <button key={source.id} className={selected?.id === source.id ? 'source active' : 'source'} onClick={() => setSelectedSourceId(source.id)}>
                  <span>{source.title}</span>
                  <small>{registry.records[source.key] ? 'Previously imported · ' : 'New document · '}{source.parsed.stats.rems} Rems · {source.parsed.stats.cards} card Rems</small>
                </button>
              ))}
            </div>
          )}

          {(reimportMode === 'replace' || sources.length !== replacements.length || !sources.length) && <div className="metadata-card">
            <label className="field">
              <span>Destination for new sources</span>
              <input value={parentQuery} onChange={(event) => setParentQuery(event.target.value)} placeholder="Search RemNote…" />
            </label>
            <div className="selected-parent">Selected: <strong>{parent.label}</strong></div>
            {replacements.length > 0 && <p className="muted">Tracked sources keep their saved destination automatically.</p>}
            {parentResults.length > 0 && (
              <div className="search-results">
                <button onClick={() => { setParent({ id: null, label: 'Top level' }); setParentQuery(''); }}>Top level</button>
                {parentResults.map((choice) => (
                  <button key={choice.id} onClick={() => { setParent(choice); setParentQuery(''); }}>{choice.label}</button>
                ))}
              </div>
            )}
          </div>}




        </div>

        <div className="preview-column">
          <h2 className="section-title">2 · Review the outline</h2>
          {selected ? (
            <>
              <div className="stats-row">
                <span>{selected.parsed.stats.rems} Rems</span>
                <span>{selected.parsed.stats.cards} card Rems</span>
                <span>{selected.parsed.stats.clozeRems} cloze groups</span>
                <span>{selected.parsed.stats.clusters} clusters</span>
              </div>
              {selected.parsed.diagnostics.length > 0 && (
                <div className="diagnostics">
                  {selected.parsed.diagnostics.map((diagnostic, index) => (
                    <p key={`${diagnostic.code}-${diagnostic.line}-${index}`} className={diagnostic.severity}>
                      <strong>{diagnostic.severity === 'error' ? 'Error' : 'Warning'} · line {diagnostic.line || 'general'}:</strong> {diagnostic.message}
                    </p>
                  ))}
                </div>
              )}
              <div className="preview-panel"><PreviewTree nodes={selected.parsed.nodes} /></div>
            </>
          ) : (
            <div className="empty-state"><h2>Choose a source</h2><p>Your parsed RemNote outline will appear here before anything is written.</p></div>
          )}


          <details className="syntax-help">
            <summary>Quick syntax reference</summary>
            <table>
              <tbody>
                <tr><td>Forward</td><td><code>front &gt;&gt; back</code> or <code>front → back</code></td></tr>
                <tr><td>Backward</td><td><code>back &lt;&lt; front</code> or <code>back ← front</code></td></tr>
                <tr><td>Concept</td><td><code>concept :: definition</code></td></tr>
                <tr><td>Multiline</td><td><code>question &gt;&gt;&gt;</code> with indented children</td></tr>
                <tr><td>List answer</td><td><code>question &gt;&gt;1.</code> with indented children</td></tr>
                <tr><td>Cloze group</td><td><code>Text ==hidden== and ==also hidden==</code></td></tr>
                <tr><td>Cluster</td><td>Add <code>#cluster</code> to the common parent</td></tr>
              </tbody>
            </table>
          </details>
        </div>
        </section>
      </div>
      <footer className="import-actions"><p className="footer-hint">{!sources.length ? 'Choose files or paste text to get started.' : hasErrors ? 'Resolve the errors in the preview to continue.' : duplicateKeys.size ? 'Give each source a unique key to continue.' : invalidMetadata ? 'Add a title and source key to continue.' : `${sources.length} source${sources.length === 1 ? '' : 's'} ready · ${replacements.length && reimportMode === 'sync' ? 'Saved locations will be used' : parent.label}`}</p>          <button className="primary" disabled={!canImport} onClick={() => void runImport()}>
            {running ? progress || 'Importing…' : `Import ${sources.length || ''} source${sources.length === 1 ? '' : 's'}`}
          </button></footer>
    </main>
  );
}

renderWidget(ImporterWidget);

