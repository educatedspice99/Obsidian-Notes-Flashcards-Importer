# Obsidian Notes & Flashcards Importer

**Beta version: 0.2.6**

[Source code](https://github.com/educatedspice99/Obsidian-Notes-Flashcards-Importer) · [Support and bug reports](https://github.com/educatedspice99/Obsidian-Notes-Flashcards-Importer/issues) · [Changelog](#changelog)

Import Obsidian-style Markdown or pasted plain text into RemNote while preserving the outline and creating RemNote flashcards from familiar text markers.

Choose **Create new document** for a separate copy, or **Automatically update changes** to reconcile added, edited, and removed lines at the tracked destination. Existing matched Rems retain their identities.

Independent community plugin, not affiliated with or endorsed by Obsidian or RemNote. This beta is a manual text importer: select files or paste text and press Import each time. It does not watch your vault, synchronize changes in the background, or write changes back to Obsidian.

Markdown conversion is partial, not a full-fidelity vault migration. Review the preview and the resulting notes/cards, especially before updating important material.

## Features

- Import several `.md`, `.markdown`, or `.txt` files in one batch.
- Paste Markdown or plain text directly into the importer.
- Preview the resulting Rem hierarchy, cards, clozes, clusters, and diagnostics before writing.
- Convert Markdown headings and indented lists into RemNote outlining.
- Create basic, Concept, Descriptor, multiline, list-answer, multiple-choice, disabled, and cloze cards.
- Turn every `==highlight==` on one Rem into a single combined cloze card.
- Apply RemNote's Card Cluster power-up from an inline `#cluster` marker.
- Manually update a tracked import in place or create a separate copy.
- Reuse matched Rem identities where possible when manually re-importing.
- Parse selected files or pasted text in the plugin and write imports to RemNote; no separate third-party note-processing service.

## Install without localhost

This plugin is configured as **unlisted**. RemNote hosts the uploaded production build; it does not need a running local development server. Unlisted plugins still require approval by the RemNote team and a public GitHub repository for code review.

After approval, open https://www.remnote.com/plugins/obsidian-flashcard-importer in a browser and install it. Then open the Omnibar with `Ctrl/Cmd + K` and run **Import Obsidian Notes & Flashcards**.

The link is the intended installation address, not a claim that this plugin is already approved or available. Uploading a ZIP in the Build tab submits a plugin; it is not a documented immediate private installation method.

### Submit the unlisted beta

1. Ensure the latest source is pushed to the [public GitHub repository](https://github.com/educatedspice99/Obsidian-Notes-Flashcards-Importer) referenced by `repoUrl` in `public/manifest.json`.
2. Keep `unlisted: true` to leave it out of marketplace search.
3. Run `npm run build` and upload `obsidian-flashcard-importer-0.2.6-beta.zip` through **Settings → Plugins → Build → Upload plugin**.
4. Complete the RemNote review process. The README and source must describe working behavior and any limitations, and the plugin must meet the submission guidelines.
5. Once the hosted version is approved, switch from the localhost development version to the hosted installation. Keep the same plugin ID and knowledge base, then verify that tracked sources and their saved destinations are still available before re-importing.

Official instructions: [Unlisted Plugins](https://plugins.remnote.com/advanced/unlisted_plugins), [Submitting Plugins](https://plugins.remnote.com/advanced/submitting_plugins), and [Manifest](https://plugins.remnote.com/advanced/manifest).

## Using the importer

### Files

1. Run **Import Obsidian Notes & Flashcards** from the Omnibar.
2. Select one or more Markdown/text files.
3. Review the generated document title and source key for every file.
4. Search for and select a destination parent. The currently focused Rem is selected initially when available.
5. Inspect the preview and address any errors.
6. For a previously imported source, choose **Automatically update changes** or **Create new document**. Updates can overwrite RemNote edits and delete Rems absent from the source.
7. Select **Import**.

### Pasted text

1. Open the importer and select **Paste text**.
2. Paste the Markdown or plain text.
3. Choose the document title, source key, and destination.
4. Review the preview and import.

## Source keys and manual updates

The source key is the stable identity of an import:

- Files default to `file:<normalized-filename>`.
- Pasted text defaults to `paste:<document-title>`.
- Two files with the same name need different manually edited source keys.

Tracked sources default to **Automatically update changes**. The saved destination is reused, including top-level destinations. The source controls the imported outline, including removals. **Create new document** creates a separate copy.

Updates require the same document title and destination. Matching uses text and outline position rather than persistent Obsidian block IDs. Updates can overwrite edits made directly in RemNote and delete Rems, including descendants, that are absent from the selected source. New copies have new card identities and review history. Reusing a matched Rem helps retain existing history, but preservation is not guaranteed for removed, recreated, reordered, or substantially changed cards. Card-type, direction, and formatting changes on matched Rems are not fully reconciled by this beta; check the result or create a new copy when changing these structures.

The visible name has changed; the internal ID remains `obsidian-flashcard-importer` so existing installations and tracking storage retain the same identity. Older release ZIPs still contain their original names and behavior.

## Supported flashcard syntax

Surround delimiters with spaces as shown below.

| Card | Example |
| --- | --- |
| Forward | `front >> back`, `front → back`, or `front == back` |
| Backward | `back << front` or `back ← front` |
| Bidirectional | `front <> back` or `front ↔ back` |
| Disabled | `front >- back` |
| Concept, both directions | `Concept :: definition` |
| Concept, forward | `Concept :> definition` |
| Concept, backward | `Concept :< definition` |
| Descriptor, forward | `descriptor ;; value` |
| Descriptor, backward | `descriptor ;< value` |
| Native cloze | `The {{answer}} is hidden.` |
| Native cloze with hint | `The {{answer}}{({hint})} is hidden.` |
| Obsidian-highlight cloze | `The ==first== and ==second== answers hide together.` |
| Multiline | `Question >>>` followed by indented children |
| List-answer | `Question >>1.` followed by indented children |
| Multiple choice | `Question >>A)` followed by answers; the first is initially correct |
| Card Cluster | Add `#cluster` to the common parent |

Concept and Descriptor multiline/list variants documented by RemNote are also recognized, including `;>>`, `:<<`, `;;>`, `;<<`, `;>>1.`, `::1.`, and their disabled forms.

### Cloze grouping

All cloze spans on one Rem receive the same cloze ID. For example:

```markdown
- The ==atrium== receives blood and the ==ventricle== pumps it.
```

Both highlights are hidden together on one cloze card. `front == back` is still recognized as a basic card because it contains a single delimiter rather than a paired highlight.

### Multiline and list-answer cards

```markdown
- Cranial nerves >>>
  - Olfactory
  - Optic

- Diagnostic criteria >>1.
  1. First criterion
  2. Second criterion
```

Only direct children become card items. More deeply nested children remain supporting outline content.

### Card clusters

```markdown
- Closely related criteria #cluster
  - First ==criterion==
  - Second ==criterion==
```

The plugin removes `#cluster` from visible text and applies RemNote's built-in **Card Cluster** power-up to the parent. If that power-up cannot be identified, the source is blocked before any old document is replaced.

## Heading and outline behavior

- Markdown headings establish section ancestry.
- `#`, `##`, and `###` map to RemNote H1, H2, and H3 styling.
- Heading levels 4–6 keep their hierarchy and render as bold text. RemNote's plugin API supports native styling only through H3.
- Exported list items such as `- ### Heading` retain both their indentation and heading styling.
- Ordered list items remain numbered.
- Tabs count as four indentation columns; spaces use their literal indentation.

## Markdown and Obsidian compatibility

Supported where RemNote's Markdown parser supports them:

- Bold and italic text
- Inline code
- Unicode text
- External links
- Ordered and unordered lists
- Headings

Handled as readable text with warnings:

- `[[Obsidian wikilinks]]`
- `[[Target|Aliases]]`
- `![[Embeds]]`
- Local and remote Markdown images

Not supported in this beta:

- Attachment upload
- Vault-wide link resolution
- Embedded canvases or databases
- Folder import
- Mobile RemNote
- Live or two-way synchronization with an Obsidian vault
- Full-fidelity conversion of YAML properties, callouts, block quotes, dividers, tables, and arbitrary Obsidian plugin syntax
- Importing Obsidian spaced-repetition scheduling data
- Guaranteed review-history preservation across structural or card-type changes

## Permissions and privacy

The plugin requests knowledge-base read/create/modify/delete access because it must:

- Search for a destination and the built-in Card Cluster power-up.
- Create imported documents and descendants.
- Update tracked outlines, including deleting Rems removed from the source.

The plugin does not send note content to third-party services or APIs. Files are read in the plugin UI and passed to the RemNote plugin API. Imported notes and the import registry are stored in RemNote and are subject to RemNote's normal knowledge-base synchronization. The import registry uses the SDK's synced plugin storage. Hosting the plugin on RemNote does not add a separate note-processing service.

The plugin reads only explicitly selected files or pasted text; it has no background vault access. It adds no analytics, advertising, AI API, or separate processing backend. The registry stores source keys (which may include filenames or titles), document and parent IDs, titles, content hashes, and a rendering version. It does not store the original source text; the imported note content itself is stored in your RemNote knowledge base. Permissions apply across the knowledge base, rather than being restricted by RemNote to the selected destination. Import errors are displayed in the UI and are not sent by this plugin to a separate reporting service.

Card Cluster and other card formats use RemNote's existing APIs and built-in features. Availability and any applicable account requirements are controlled by RemNote; this plugin does not unlock paid features.

## Troubleshooting

### Import is disabled

Check the diagnostics in the preview. Blocking causes include malformed card markers, multiline/list cards without children, duplicate source keys, or an empty source.

### Two selected files have the same key

Edit one source key before importing. Browser file selection does not reliably expose full local paths, so the filename alone cannot distinguish same-named files from different folders.

### Card Cluster cannot be resolved

Confirm that the current RemNote client includes the built-in **Card Cluster** power-up. The plugin deliberately refuses to leave `#cluster` as a nonfunctional text tag.

### An update failed

Updates modify the existing outline in place and may leave partial changes if an operation fails. Inspect the affected document before retrying. Keep a backup of important notes and use **Create new document** when you want to review a separate copy first.

### An imported card looks wrong

Confirm the delimiter is surrounded by spaces and inspect the importer preview. Code spans are intentionally ignored when recognizing custom markers.

## Development

Requirements: Node.js and npm.

```shell
npm install
npm run check-types
npm test
npm run lint
npm run dev
```

With the development server running, open RemNote's plugin Build page and choose **Develop from localhost**, using `http://localhost:8080`.

Create the validated production ZIP with:

```shell
npm run build
```

The artifact is written to `obsidian-flashcard-importer-0.2.6-beta.zip`.

## Changelog

### 0.2.6 beta

- Renamed the visible plugin and Omnibar command to include both notes and flashcards; retained the internal plugin ID.
- Added in-app privacy, permissions, independence, and beta-limitations disclosures.
- Corrected documentation for current import actions, RemNote synchronization, and update/history limitations.
- Packaged as an unlisted submission; hosting remains subject to a public source repository and RemNote approval.

### 0.2.2 beta

- In-place updates for changed lines and card answers.
- New lines before unchanged siblings.
- Reuse saved destination for tracked sources.
- Popup scrolling and version consistency.

### 0.1.0 beta

- Initial beta importer UI.
- File and paste sources with preview and diagnostics.
- Markdown outline conversion.
- RemNote card, grouped cloze, and Card Cluster conversion.
- Staged full-document replacement using tracked source keys.


