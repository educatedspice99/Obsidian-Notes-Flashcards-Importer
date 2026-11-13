import type { RNPlugin } from '@remnote/plugin-sdk';
import type { ImportRecordV1, ImportRegistryV1 } from './types';

export const REGISTRY_STORAGE_KEY = 'obsidian-flashcard-importer.registry.v1';

export function emptyRegistry(): ImportRegistryV1 {
  return { version: 1, records: {} };
}

export async function loadRegistry(plugin: RNPlugin): Promise<ImportRegistryV1> {
  const stored = await plugin.storage.getSynced<ImportRegistryV1>(REGISTRY_STORAGE_KEY);
  if (!stored || stored.version !== 1 || !stored.records) return emptyRegistry();
  return stored;
}

export async function saveRecord(
  plugin: RNPlugin,
  record: ImportRecordV1,
): Promise<void> {
  const registry = await loadRegistry(plugin);
  registry.records[record.sourceKey] = record;
  await plugin.storage.setSynced(REGISTRY_STORAGE_KEY, registry);
}

export async function findRecord(
  plugin: RNPlugin,
  sourceKey: string,
): Promise<ImportRecordV1 | undefined> {
  const registry = await loadRegistry(plugin);
  return registry.records[sourceKey];
}
