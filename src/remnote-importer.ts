import {
  BuiltInPowerupCodes,
  SetRemType,
  type PluginRem,
  type RNPlugin,
  type RichTextInterface,
} from '@remnote/plugin-sdk';
import { sha256 } from './hash';
import { parseMarkdown } from './parser';
import { findRecord, saveRecord } from './registry';
import { performSafeReplacement } from './replacement';
import type {
  CardConfig,
  ImportNode,
  ImportRecordV1,
  ImportResult,
  SourceInput,
} from './types';

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function groupedClozes(richText: RichTextInterface, clozeId: string): RichTextInterface {
  return richText.map((element) => {
    if (typeof element === 'string') return element;
    const record = element as unknown as Record<string, unknown>;
    if (!('cId' in record)) return element;
    return { ...record, cId: clozeId } as typeof element;
  });
}

async function markdownToRichText(
  plugin: RNPlugin,
  markdown: string,
  clozeId?: string,
): Promise<RichTextInterface> {
  const parsed = await plugin.richText.parseFromMarkdown(markdown);
  return clozeId ? groupedClozes(parsed, clozeId) : parsed;
}

async function setSemanticType(rem: PluginRem, card?: CardConfig): Promise<void> {
  if (card?.semanticType === 'concept') {
    await rem.setType(SetRemType.CONCEPT);
  } else if (card?.semanticType === 'descriptor') {
    await rem.setType(SetRemType.DESCRIPTOR);
  }
}

async function configureCard(
  plugin: RNPlugin,
  rem: PluginRem,
  node: ImportNode,
  clozeId?: string,
): Promise<void> {
  const card = node.card;
  if (!card) return;

  await setSemanticType(rem, card);

  if (card.kind === 'basic') {
    await rem.setBackText(
      await markdownToRichText(plugin, card.backMarkdown ?? '', clozeId),
    );
    await rem.setPracticeDirection(card.direction);
    return;
  }

  if (card.kind === 'multiline' || card.kind === 'list') {
    await rem.addPowerup(BuiltInPowerupCodes.MultiLineCard);
    await rem.setPracticeDirection(card.direction);
    return;
  }

  if (card.kind === 'multiple-choice') {
    await rem.addPowerup(BuiltInPowerupCodes.MultipleChoice);
    await rem.setPracticeDirection(card.direction);
  }
}

async function createImportNode(
  plugin: RNPlugin,
  node: ImportNode,
  parent: PluginRem,
  position: number,
  clusterPowerup: PluginRem | undefined,
  parentCard?: CardConfig,
  created?: PluginRem[],
): Promise<PluginRem> {
  const rem = await plugin.rem.createRem();
  if (!rem) throw new Error(`RemNote did not create the Rem for source line ${node.sourceLine}.`);
  created?.push(rem);

  await rem.setParent(parent, position);
  const clozeId = node.hasCloze ? `ofi-${crypto.randomUUID()}` : undefined;
  // RemNote exposes only H1-H3. Keep deeper Markdown levels visible in text.
  const displayMarkdown = node.headingLevel && node.headingLevel > 3
    ? `**${node.markdown}**`
    : node.markdown;
  await rem.setText(await markdownToRichText(plugin, displayMarkdown, clozeId));

  if (node.headingLevel) {
    if (node.headingLevel <= 3) {
      const size = node.headingLevel === 1 ? 'H1' : node.headingLevel === 2 ? 'H2' : 'H3';
      await rem.setFontSize(size);
    }
  }

  if (node.ordered) await rem.setIsListItem(true);
  if (parentCard && ['multiline', 'list', 'multiple-choice'].includes(parentCard.kind)) {
    await rem.setIsCardItem(true);
    if (parentCard.kind === 'list') await rem.setIsListItem(true);
  }

  await configureCard(plugin, rem, node, clozeId);
  if (node.cluster) {
    if (!clusterPowerup) {
      throw new Error(`Card Cluster power-up was not available for source line ${node.sourceLine}.`);
    }
    await rem.addTag(clusterPowerup);
  }

  for (let index = 0; index < node.children.length; index += 1) {
    await createImportNode(
      plugin,
      node.children[index],
      rem,
      index,
      clusterPowerup,
      node.card,
      created,
    );
  }
  return rem;
}

interface Addition { node: ImportNode; parent: PluginRem; position: number; parentCard?: CardConfig }

function displayMarkdown(node: ImportNode): string {
  return node.headingLevel && node.headingLevel > 3 ? `**${node.markdown}**` : node.markdown;
}

async function syncNodes(
  plugin: RNPlugin, parent: PluginRem, nodes: ImportNode[],
  clusterPowerup: PluginRem | undefined, parentCard?: CardConfig,
): Promise<{ added: number; updated: number }> {
  const existing = await parent.getChildrenRem();
  let added = 0;
  let updated = 0;
  const oldTexts = await Promise.all(existing.map(rem => plugin.richText.toString(rem.text ?? [])));
  const newTexts = await Promise.all(nodes.map(async node => plugin.richText.toString(await markdownToRichText(plugin, displayMarkdown(node)))));
  const costs = Array.from({length: existing.length + 1}, () => new Array<number>(nodes.length + 1).fill(0));
  for (let i = existing.length; i >= 0; i -= 1) for (let j = nodes.length; j >= 0; j -= 1) {
    if (i === existing.length) costs[i][j] = nodes.length - j;
    else if (j === nodes.length) costs[i][j] = existing.length - i;
    else costs[i][j] = Math.min(costs[i + 1][j + 1] + (oldTexts[i] === newTexts[j] ? 0 : 1), 1 + costs[i + 1][j], 1 + costs[i][j + 1]);
  }
  let existingIndex = 0;
  for (let index = 0; index < nodes.length; index += 1) {
    const node = nodes[index];
    while (existingIndex < existing.length && oldTexts[existingIndex] !== newTexts[index] &&
      costs[existingIndex][index] === 1 + costs[existingIndex + 1][index] &&
      costs[existingIndex][index] < 1 + costs[existingIndex + 1][index + 1]) {
      await existing[existingIndex++].remove();
    }
    const rem = existing[existingIndex];
    const insert = rem && oldTexts[existingIndex] !== newTexts[index] &&
      costs[existingIndex][index] === 1 + costs[existingIndex][index + 1] &&
      costs[existingIndex][index] < 1 + costs[existingIndex + 1][index + 1];
    if (!rem || insert) {
      await createImportNode(plugin, node, parent, index, clusterPowerup, parentCard);
      added += 1;
      continue;
    }
    existingIndex += 1;
    if (node.headingLevel && node.headingLevel > 3) await rem.setFontSize(undefined);
    const expected = await markdownToRichText(plugin, displayMarkdown(node));
    const actualText = await plugin.richText.toString(rem.text ?? []);
    const expectedText = await plugin.richText.toString(expected);
    if (actualText !== expectedText) {
      // Reuse cloze IDs so an edited cloze keeps its card identity.
      const oldCloze = (rem.text ?? []).find((part) => typeof part !== 'string' && 'cId' in part);
      const clozeId = oldCloze && typeof oldCloze !== 'string' && 'cId' in oldCloze
        ? String(oldCloze.cId) : node.hasCloze ? `ofi-${crypto.randomUUID()}` : undefined;
      await rem.setText(await markdownToRichText(plugin, displayMarkdown(node), clozeId));
      updated += 1;
    }
    if (node.card?.kind === 'basic') {
      const back = await markdownToRichText(plugin, node.card.backMarkdown ?? '');
      if (await plugin.richText.toString(rem.backText ?? []) !== await plugin.richText.toString(back)) {
        await rem.setBackText(back);
        updated += 1;
      }
    }
    const nested = await syncNodes(plugin, rem, node.children, clusterPowerup, node.card);
    added += nested.added;
    updated += nested.updated;
  }
  for (const leftover of existing.slice(existingIndex)) await leftover.remove();
  return { added, updated };
}

async function updateSource(
  plugin: RNPlugin, source: SourceInput, parsed: ReturnType<typeof parseMarkdown>,
  previous: ImportRecordV1, document: PluginRem, contentHash: string,
): Promise<ImportResult> {
  if (source.title !== previous.title || source.parentId !== previous.parentId) {
    throw new Error('Update in place requires the same document title and destination.');
  }
  const clusterPowerup = parsed.stats.clusters ? await resolveClusterPowerup(plugin) : undefined;
  if (parsed.stats.clusters && !clusterPowerup) throw new Error('Card Cluster power-up is unavailable.');
  const counts = await syncNodes(plugin, document, parsed.nodes, clusterPowerup);
  await saveRecord(plugin, { ...previous, contentHash, renderingVersion: 3 });
  return { sourceKey: source.key, title: source.title, status: 'updated',
    documentId: document._id, diagnostics: parsed.diagnostics, stats: parsed.stats,
    message: `Added ${counts.added} Rems; updated ${counts.updated} fields in existing Rems.` };
}

async function planAdditions(
  plugin: RNPlugin,
  parent: PluginRem,
  nodes: ImportNode[],
  additions: Addition[],
  parentCard?: CardConfig,
): Promise<void> {
  const existing = await parent.getChildrenRem();
  if (existing.length > nodes.length) {
    throw new Error('The RemNote document has extra lines or the source removed lines. Add-only import stopped without changes.');
  }
  for (let index = 0; index < existing.length; index += 1) {
    const rem = existing[index];
    const node = nodes[index];
    const display = node.headingLevel && node.headingLevel > 3
      ? `**${node.markdown}**` : node.markdown;
    const expected = (await plugin.richText.toString(await markdownToRichText(plugin, display))).trim();
    const actual = (await plugin.richText.toString(rem.text ?? [])).trim();
    const legacyHeading = node.headingLevel && node.headingLevel > 3
      ? (await plugin.richText.toString(await markdownToRichText(plugin, node.markdown))).trim() : undefined;
    if (actual !== expected && actual !== legacyHeading) {
      throw new Error(`RemNote line ${index + 1} under an existing parent differs from the source. Add-only import stopped without changes.`);
    }
    if (node.card?.kind === 'basic') {
      const expectedBack = (await plugin.richText.toString(await markdownToRichText(plugin, node.card.backMarkdown ?? ''))).trim();
      const actualBack = (await plugin.richText.toString(rem.backText ?? [])).trim();
      if (actualBack !== expectedBack) {
        throw new Error(`A card answer differs on source line ${node.sourceLine}. Add-only import stopped without changes.`);
      }
    }
    await planAdditions(plugin, rem, node.children, additions, node.card);
  }
  for (let index = existing.length; index < nodes.length; index += 1) {
    additions.push({ node: nodes[index], parent, position: index, parentCard });
  }
}

async function appendSource(
  plugin: RNPlugin,
  source: SourceInput,
  parsed: ReturnType<typeof parseMarkdown>,
  previous: ImportRecordV1,
  document: PluginRem,
  contentHash: string,
): Promise<ImportResult> {
  if (source.title !== previous.title || source.parentId !== previous.parentId) {
    throw new Error('Add-only mode requires the same document title and destination.');
  }
  const additions: Addition[] = [];
  await planAdditions(plugin, document, parsed.nodes, additions);
  if (!additions.length) {
    throw new Error('No new importable lines were found.');
  }
  const clusterPowerup = additions.some(({ node }) => node.cluster) ? await resolveClusterPowerup(plugin) : undefined;
  if (additions.some(({ node }) => node.cluster) && !clusterPowerup) {
    throw new Error('Card Cluster power-up is unavailable. No content was changed.');
  }
  const created: PluginRem[] = [];
  try {
    for (const { node, parent, position, parentCard } of additions) {
      await createImportNode(plugin, node, parent, position, clusterPowerup, parentCard, created);
    }
    await saveRecord(plugin, { ...previous, contentHash });
  } catch (error) {
    for (const rem of created.reverse()) {
      try { await rem.remove(); } catch { /* retain original error */ }
    }
    throw error;
  }
  return {
    sourceKey: source.key, title: source.title, status: 'appended',
    documentId: document._id, diagnostics: parsed.diagnostics, stats: parsed.stats,
    message: `Added ${additions.length} new Rem${additions.length === 1 ? '' : 's'}; existing Rems were kept.`,
  };
}

async function resolveClusterPowerup(plugin: RNPlugin): Promise<PluginRem | undefined> {
  const results = await plugin.search.search(['Card Cluster'], undefined, { numResults: 25 });
  for (const result of results) {
    const name = (await plugin.richText.toString(result.text ?? [])).trim();
    if (name.localeCompare('Card Cluster', undefined, { sensitivity: 'accent' }) !== 0) continue;
    if (await result.isPowerup()) return result;
  }
  return undefined;
}

async function createTemporaryDocument(
  plugin: RNPlugin,
  source: SourceInput,
): Promise<PluginRem> {
  const document = await plugin.rem.createRem();
  if (!document) throw new Error('RemNote did not create a staging document.');
  await document.setText(await markdownToRichText(plugin, `[Importing] ${source.title}`));
  await document.setIsDocument(true);

  const parent = source.parentId ? await plugin.rem.findOne(source.parentId) : null;
  if (source.parentId && !parent) {
    await document.remove();
    throw new Error('The selected destination no longer exists or is not accessible.');
  }
  await document.setParent(parent ?? null);
  return document;
}

export async function importSource(
  plugin: RNPlugin,
  source: SourceInput,
): Promise<ImportResult> {
  const parsed = parseMarkdown(source.text);
  if (!source.key.trim() || !source.title.trim()) {
    parsed.diagnostics.push({
      line: 0,
      severity: 'error',
      code: 'missing-source-metadata',
      message: 'Both a document title and a source key are required.',
    });
  }
  const blocking = parsed.diagnostics.filter((diagnostic) => diagnostic.severity === 'error');
  if (blocking.length) {
    return {
      sourceKey: source.key,
      title: source.title,
      status: 'failed',
      diagnostics: parsed.diagnostics,
      stats: parsed.stats,
      message: 'Parsing found errors. No RemNote content was changed.',
    };
  }

  const contentHash = await sha256(source.text);
  const previous = await findRecord(plugin, source.key);
  const previousDocument = previous ? await plugin.rem.findOne(previous.documentId) : undefined;

  if (
    previous &&
    previousDocument &&
    previous.contentHash === contentHash &&
    previous.renderingVersion === 3 &&
    previous.parentId === source.parentId &&
    previous.title === source.title
  ) {
    return {
      sourceKey: source.key,
      title: source.title,
      status: 'unchanged',
      documentId: previous.documentId,
      stats: parsed.stats,
      diagnostics: parsed.diagnostics,
      message: 'The source, title, and destination are unchanged.',
    };
  }

  if (previousDocument && source.reimportMode === 'append') {
    try {
      return await appendSource(plugin, source, parsed, previous!, previousDocument, contentHash);
    } catch (error) {
      return { sourceKey: source.key, title: source.title, status: 'failed',
        diagnostics: parsed.diagnostics, stats: parsed.stats, message: errorMessage(error) };
    }
  }
  if (previousDocument && source.reimportMode === 'sync') {
    try {
      return await updateSource(plugin, source, parsed, previous!, previousDocument, contentHash);
    } catch (error) {
      return { sourceKey: source.key, title: source.title, status: 'failed',
        diagnostics: parsed.diagnostics, stats: parsed.stats, message: errorMessage(error) };
    }
  }
  if (previous && source.reimportMode === 'append') {
    return { sourceKey: source.key, title: source.title, status: 'failed',
      diagnostics: parsed.diagnostics, stats: parsed.stats,
      message: 'The tracked document is missing. Add-only mode cannot recreate it.' };
  }

  const clusterPowerup = parsed.stats.clusters > 0 ? await resolveClusterPowerup(plugin) : undefined;
  if (parsed.stats.clusters > 0 && !clusterPowerup) {
    return {
      sourceKey: source.key,
      title: source.title,
      status: 'failed',
      diagnostics: [
        ...parsed.diagnostics,
        {
          line: 0,
          severity: 'error',
          code: 'missing-card-cluster-powerup',
          message: 'The built-in Card Cluster power-up could not be resolved. No content was changed.',
        },
      ],
      stats: parsed.stats,
      message: 'Card Cluster power-up is unavailable.',
    };
  }

  const replaced = Boolean(previousDocument);
  try {
    const outcome = await performSafeReplacement({
      createTemporary: () => createTemporaryDocument(plugin, source),
      populate: async (temporary) => {
        for (let index = 0; index < parsed.nodes.length; index += 1) {
          await createImportNode(
            plugin,
            parsed.nodes[index],
            temporary,
            index,
            clusterPowerup,
          );
        }
      },
      swap: async (temporary) => {
        const oldPosition = previousDocument && previous?.parentId === source.parentId
          ? await previousDocument.positionAmongstSiblings()
          : undefined;
        const parent = source.parentId ? await plugin.rem.findOne(source.parentId) : null;
        if (source.parentId && !parent) throw new Error('The selected destination disappeared during import.');

        // Finalize the staging title before the destructive transaction. Apart
        // from avoiding a stale "[Importing]" title, this keeps the previous
        // document intact if RemNote rejects the final title update.
        await temporary.setText(await markdownToRichText(plugin, source.title));
        await plugin.app.transaction(async () => {
          if (previousDocument) await previousDocument.remove();
          await temporary.setParent(parent ?? null, oldPosition);
        });
        return temporary;
      },
      cleanup: async (temporary) => {
        await temporary.remove();
      },
      persist: async (committed) => {
        const record: ImportRecordV1 = {
          sourceKey: source.key,
          documentId: committed._id,
          parentId: source.parentId,
          title: source.title,
          contentHash,
          renderingVersion: 3,
        };
        await saveRecord(plugin, record);
      },
    });

    return {
      sourceKey: source.key,
      title: source.title,
      status: replaced ? 'replaced' : 'created',
      documentId: outcome.committed._id,
      stats: parsed.stats,
      diagnostics: parsed.diagnostics,
      message: previous && !previousDocument
        ? 'The previous tracked document was missing, so it was recreated.'
        : undefined,
    };
  } catch (error) {
    return {
      sourceKey: source.key,
      title: source.title,
      status: 'failed',
      stats: parsed.stats,
      diagnostics: parsed.diagnostics,
      message: errorMessage(error),
    };
  }
}

export async function importSources(
  plugin: RNPlugin,
  sources: SourceInput[],
  onResult?: (result: ImportResult, completed: number, total: number) => void,
): Promise<ImportResult[]> {
  const results: ImportResult[] = [];
  for (const source of sources) {
    const result = await importSource(plugin, source);
    results.push(result);
    onResult?.(result, results.length, sources.length);
  }
  return results;
}
