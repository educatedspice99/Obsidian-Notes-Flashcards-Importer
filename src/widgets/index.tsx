import { declareIndexPlugin, WidgetLocation, type ReactRNPlugin } from '@remnote/plugin-sdk';

async function onActivate(plugin: ReactRNPlugin) {
  await plugin.app.registerWidget('importer', WidgetLocation.Popup, {
    dimensions: { width: 920, height: 560 },
  });
  await plugin.app.registerCommand({
    id: 'open-obsidian-flashcard-importer',
    name: 'Import Obsidian Notes & Flashcards',
    action: async () => {
      await plugin.widget.openPopup('importer', {}, true);
    },
  });
}

async function onDeactivate() {
  // RemNote disposes registered commands and widgets with the plugin lifecycle.
}

declareIndexPlugin(onActivate, onDeactivate);
