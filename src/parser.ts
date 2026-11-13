import type {
  CardConfig,
  CardDirection,
  Diagnostic,
  ImportNode,
  ParseResult,
  RemSemanticType,
} from './types';

interface ParsedContent {
  markdown: string;
  cluster: boolean;
  hasCloze: boolean;
  card?: CardConfig;
  diagnostics: Diagnostic[];
}

interface MarkerDefinition {
  marker: string;
  kind: 'multiline' | 'list' | 'multiple-choice' | 'inline';
  direction: CardDirection;
  semanticType: RemSemanticType;
}

const SUFFIX_MARKERS = ([
  { marker: ';>>A)', kind: 'multiple-choice', direction: 'forward', semanticType: 'concept' },
  { marker: ';;>A)', kind: 'multiple-choice', direction: 'forward', semanticType: 'descriptor' },
  { marker: ':-A)', kind: 'multiple-choice', direction: 'none', semanticType: 'concept' },
  { marker: ';-A)', kind: 'multiple-choice', direction: 'none', semanticType: 'descriptor' },
  { marker: '>>A)', kind: 'multiple-choice', direction: 'forward', semanticType: 'default' },
  { marker: '>-A)', kind: 'multiple-choice', direction: 'none', semanticType: 'default' },
  { marker: ';>>1.', kind: 'list', direction: 'forward', semanticType: 'concept' },
  { marker: ':<<1.', kind: 'list', direction: 'backward', semanticType: 'concept' },
  { marker: '::1.', kind: 'list', direction: 'both', semanticType: 'concept' },
  { marker: ':-1.', kind: 'list', direction: 'none', semanticType: 'concept' },
  { marker: ';;>1.', kind: 'list', direction: 'forward', semanticType: 'descriptor' },
  { marker: ';<<1.', kind: 'list', direction: 'backward', semanticType: 'descriptor' },
  { marker: ';;<1.', kind: 'list', direction: 'both', semanticType: 'descriptor' },
  { marker: ';-1.', kind: 'list', direction: 'none', semanticType: 'descriptor' },
  { marker: '>>1.', kind: 'list', direction: 'forward', semanticType: 'default' },
  { marker: '<<1.', kind: 'list', direction: 'backward', semanticType: 'default' },
  { marker: '<>1.', kind: 'list', direction: 'both', semanticType: 'default' },
  { marker: '>-1.', kind: 'list', direction: 'none', semanticType: 'default' },
  { marker: ';>>', kind: 'multiline', direction: 'forward', semanticType: 'concept' },
  { marker: ':<<', kind: 'multiline', direction: 'backward', semanticType: 'concept' },
  { marker: ';;>', kind: 'multiline', direction: 'forward', semanticType: 'descriptor' },
  { marker: ';<<', kind: 'multiline', direction: 'backward', semanticType: 'descriptor' },
  { marker: '>>>', kind: 'multiline', direction: 'forward', semanticType: 'default' },
  { marker: '<<<', kind: 'multiline', direction: 'backward', semanticType: 'default' },
  { marker: '<><', kind: 'multiline', direction: 'both', semanticType: 'default' },
] satisfies MarkerDefinition[]).sort((a, b) => b.marker.length - a.marker.length);

const INLINE_MARKERS = ([
  { marker: ';;<', kind: 'inline', direction: 'both', semanticType: 'descriptor' },
  { marker: ':>', kind: 'inline', direction: 'forward', semanticType: 'concept' },
  { marker: ':<', kind: 'inline', direction: 'backward', semanticType: 'concept' },
  { marker: '::', kind: 'inline', direction: 'both', semanticType: 'concept' },
  { marker: ':-', kind: 'inline', direction: 'none', semanticType: 'concept' },
  { marker: ';;', kind: 'inline', direction: 'forward', semanticType: 'descriptor' },
  { marker: ';<', kind: 'inline', direction: 'backward', semanticType: 'descriptor' },
  { marker: ';-', kind: 'inline', direction: 'none', semanticType: 'descriptor' },
  { marker: '>>', kind: 'inline', direction: 'forward', semanticType: 'default' },
  { marker: '<<', kind: 'inline', direction: 'backward', semanticType: 'default' },
  { marker: '<>', kind: 'inline', direction: 'both', semanticType: 'default' },
  { marker: '>-', kind: 'inline', direction: 'none', semanticType: 'default' },
  { marker: '→', kind: 'inline', direction: 'forward', semanticType: 'default' },
  { marker: '←', kind: 'inline', direction: 'backward', semanticType: 'default' },
  { marker: '↔', kind: 'inline', direction: 'both', semanticType: 'default' },
  { marker: '==', kind: 'inline', direction: 'forward', semanticType: 'default' },
] satisfies MarkerDefinition[]).sort((a, b) => b.marker.length - a.marker.length);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function outsideCodeTransform(
  value: string,
  transform: (segment: string) => string,
): string {
  let result = '';
  let cursor = 0;
  let code = false;
  let segmentStart = 0;

  while (cursor < value.length) {
    if (value[cursor] === '\\') {
      cursor += 2;
      continue;
    }
    if (value[cursor] === '`') {
      const segment = value.slice(segmentStart, cursor);
      result += code ? segment : transform(segment);
      result += '`';
      code = !code;
      cursor += 1;
      segmentStart = cursor;
      continue;
    }
    cursor += 1;
  }

  const tail = value.slice(segmentStart);
  result += code ? tail : transform(tail);
  return result;
}

function normalizeObsidianSyntax(
  raw: string,
  line: number,
): { text: string; cluster: boolean; highlighted: boolean; diagnostics: Diagnostic[] } {
  const diagnostics: Diagnostic[] = [];
  let cluster = false;
  let highlighted = false;

  let text = outsideCodeTransform(raw, (segment) =>
    segment.replace(/(^|\s)#cluster(?=\s|$)/gi, (match, prefix: string) => {
      cluster = true;
      return prefix;
    }),
  );

  text = outsideCodeTransform(text, (segment) =>
    segment.replace(/!\[\[([^\]]+)\]\]/g, (_match, target: string) => {
      diagnostics.push({
        line,
        severity: 'warning',
        code: 'unsupported-embed',
        message: `Obsidian embed "${target}" was imported as readable text.`,
      });
      return `[Embedded: ${target}]`;
    }),
  );

  text = outsideCodeTransform(text, (segment) =>
    segment.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_match, target: string, alias?: string) => {
      diagnostics.push({
        line,
        severity: 'warning',
        code: 'unsupported-wikilink',
        message: `Obsidian link "${target}" was imported without resolving its target.`,
      });
      return alias?.trim() || target.trim();
    }),
  );

  text = outsideCodeTransform(text, (segment) =>
    segment.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (_match, alt: string, target: string) => {
      diagnostics.push({
        line,
        severity: 'warning',
        code: 'unsupported-image',
        message: `Image "${target}" was imported as readable text; files are not uploaded in this beta.`,
      });
      return `${alt || 'Image'} (image: ${target})`;
    }),
  );

  text = outsideCodeTransform(text, (segment) => {
    let output = '';
    let cursor = 0;
    while (cursor < segment.length) {
      const open = segment.indexOf('==', cursor);
      if (open < 0) {
        output += segment.slice(cursor);
        break;
      }
      const close = segment.indexOf('==', open + 2);
      if (close < 0 || close === open + 2) {
        output += segment.slice(cursor);
        break;
      }
      output += segment.slice(cursor, open);
      output += `{{${segment.slice(open + 2, close)}}}`;
      highlighted = true;
      cursor = close + 2;
    }
    return output;
  });

  return { text: text.trim(), cluster, highlighted, diagnostics };
}

function findInlineMarker(text: string): { definition: MarkerDefinition; index: number } | undefined {
  const isOutsideCode = (index: number) => {
    let code = false;
    for (let cursor = 0; cursor < index; cursor += 1) {
      if (text[cursor] === '\\') {
        cursor += 1;
      } else if (text[cursor] === '`') {
        code = !code;
      }
    }
    return !code;
  };

  for (const definition of INLINE_MARKERS) {
    const escaped = escapeRegExp(definition.marker);
    const expression = new RegExp(`\\s${escaped}\\s`, 'g');
    let match: RegExpExecArray | null;
    while ((match = expression.exec(text))) {
      const index = match.index + 1;
      if (isOutsideCode(index) && text[index - 1] !== '\\') {
        return { definition, index };
      }
    }
  }
  return undefined;
}

function parseContent(raw: string, line: number): ParsedContent {
  const normalized = normalizeObsidianSyntax(raw, line);
  const diagnostics = [...normalized.diagnostics];
  let markdown = normalized.text;
  let card: CardConfig | undefined;

  for (const definition of SUFFIX_MARKERS) {
    const expression = new RegExp(`(?:^|\\s)${escapeRegExp(definition.marker)}\\s*$`);
    const match = expression.exec(markdown);
    if (!match) continue;
    const front = markdown.slice(0, match.index).trim();
    if (!front) {
      diagnostics.push({
        line,
        severity: 'error',
        code: 'empty-card-front',
        message: `Card marker "${definition.marker}" requires text before it.`,
      });
    }
    markdown = front;
    card = {
      kind: definition.kind,
      direction: definition.direction,
      semanticType: definition.semanticType,
      marker: definition.marker,
    };
    break;
  }

  if (!card) {
    const inline = findInlineMarker(markdown);
    if (inline) {
      const front = markdown.slice(0, inline.index).trim();
      const back = markdown.slice(inline.index + inline.definition.marker.length).trim();
      if (!front || !back) {
        diagnostics.push({
          line,
          severity: 'error',
          code: 'incomplete-inline-card',
          message: `Card marker "${inline.definition.marker}" requires content on both sides.`,
        });
      } else {
        markdown = front;
        card = {
          kind: 'basic',
          direction: inline.definition.direction,
          semanticType: inline.definition.semanticType,
          backMarkdown: back,
          marker: inline.definition.marker,
        };
      }
    }
  }

  const hasCloze = normalized.highlighted || /\{\{[^{}]+\}\}/.test(markdown) ||
    (card?.backMarkdown ? /\{\{[^{}]+\}\}/.test(card.backMarkdown) : false);

  if ((markdown.includes('{{') && !markdown.includes('}}')) ||
      (card?.backMarkdown?.includes('{{') && !card.backMarkdown.includes('}}'))) {
    diagnostics.push({
      line,
      severity: 'warning',
      code: 'unclosed-cloze',
      message: 'An opening cloze marker has no closing marker and will remain literal text.',
    });
  }

  if (!card && hasCloze) {
    card = {
      kind: 'cloze',
      direction: 'forward',
      semanticType: 'default',
      marker: normalized.highlighted ? '==...==' : '{{...}}',
    };
  }

  return {
    markdown,
    cluster: normalized.cluster,
    hasCloze,
    card,
    diagnostics,
  };
}

function indentationColumns(whitespace: string): number {
  let columns = 0;
  for (const character of whitespace) {
    columns += character === '\t' ? 4 : 1;
  }
  return columns;
}

function collectStats(nodes: ImportNode[]) {
  const stats = { rems: 0, cards: 0, clozeRems: 0, clusters: 0 };
  const visit = (node: ImportNode) => {
    stats.rems += 1;
    if (node.card) stats.cards += 1;
    if (node.hasCloze) stats.clozeRems += 1;
    if (node.cluster) stats.clusters += 1;
    node.children.forEach(visit);
  };
  nodes.forEach(visit);
  return stats;
}

export function parseMarkdown(text: string): ParseResult {
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n').split('\n');
  const roots: ImportNode[] = [];
  const diagnostics: Diagnostic[] = [];
  const headingStack: Array<{ level: number; node: ImportNode }> = [];
  let contentStack: Array<{ indent: number; node: ImportNode }> = [];
  let sequence = 0;

  const currentHeading = () => headingStack[headingStack.length - 1]?.node;

  lines.forEach((sourceLine, zeroBasedLine) => {
    const lineNumber = zeroBasedLine + 1;
    if (!sourceLine.trim()) return;

    const headingMatch = /^\s{0,3}(#{1,6})\s+(.+?)\s*$/.exec(sourceLine);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const parsed = parseContent(headingMatch[2], lineNumber);
      diagnostics.push(...parsed.diagnostics);
      const node: ImportNode = {
        id: `line-${lineNumber}-${sequence++}`,
        sourceLine: lineNumber,
        markdown: parsed.markdown,
        headingLevel: level,
        ordered: false,
        cluster: parsed.cluster,
        hasCloze: parsed.hasCloze,
        card: parsed.card,
        children: [],
      };

      while (headingStack.length && headingStack[headingStack.length - 1].level >= level) {
        headingStack.pop();
      }
      const parent = currentHeading();
      (parent ? parent.children : roots).push(node);
      headingStack.push({ level, node });
      contentStack = [];
      return;
    }

    const listMatch = /^(\s*)(?:(\d+)[.)]|([-*+]))\s+(.+?)\s*$/.exec(sourceLine);
    const plainMatch = /^(\s*)(.*?)\s*$/.exec(sourceLine);
    if (!plainMatch) return;

    const leading = listMatch?.[1] ?? plainMatch[1];
    let rawContent = listMatch?.[4] ?? plainMatch[2];
    const indent = indentationColumns(leading);
    const ordered = Boolean(listMatch?.[2]);
    const embeddedHeading = /^(#{1,6})\s+(.+)$/.exec(rawContent);
    const embeddedHeadingLevel = embeddedHeading?.[1].length;
    if (embeddedHeading) rawContent = embeddedHeading[2];
    const parsed = parseContent(rawContent, lineNumber);
    diagnostics.push(...parsed.diagnostics);

    if (!parsed.markdown && !parsed.card) {
      diagnostics.push({
        line: lineNumber,
        severity: 'warning',
        code: 'empty-rem',
        message: 'This line does not contain importable text and was skipped.',
      });
      return;
    }

    const node: ImportNode = {
      id: `line-${lineNumber}-${sequence++}`,
      sourceLine: lineNumber,
      markdown: parsed.markdown,
      headingLevel: embeddedHeadingLevel,
      ordered,
      cluster: parsed.cluster,
      hasCloze: parsed.hasCloze,
      card: parsed.card,
      children: [],
    };

    while (contentStack.length && indent <= contentStack[contentStack.length - 1].indent) {
      contentStack.pop();
    }

    const parent = contentStack[contentStack.length - 1]?.node ?? currentHeading();
    if (indent > 0 && !contentStack.length) {
      diagnostics.push({
        line: lineNumber,
        severity: 'warning',
        code: 'orphan-indentation',
        message: 'Indented line has no preceding outline item at a shallower indentation; it was attached to the current section.',
      });
    }
    (parent ? parent.children : roots).push(node);
    contentStack.push({ indent, node });
  });

  const validate = (node: ImportNode) => {
    if (node.card && ['multiline', 'list', 'multiple-choice'].includes(node.card.kind) && node.children.length === 0) {
      diagnostics.push({
        line: node.sourceLine,
        severity: 'error',
        code: 'card-without-items',
        message: `Card marker "${node.card.marker}" requires at least one indented child.`,
      });
    }
    if (node.cluster && node.children.length === 0) {
      diagnostics.push({
        line: node.sourceLine,
        severity: 'warning',
        code: 'empty-cluster',
        message: 'A Card Cluster marker has no descendants.',
      });
    }
    node.children.forEach(validate);
  };
  roots.forEach(validate);

  if (roots.length === 0) {
    diagnostics.push({
      line: 0,
      severity: 'error',
      code: 'empty-source',
      message: 'The source does not contain any importable nonblank lines.',
    });
  }

  return { nodes: roots, diagnostics, stats: collectStats(roots) };
}

export function normalizeSourceKey(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, '-');
}

export function titleFromFilename(filename: string): string {
  return filename.replace(/\.(?:md|markdown|txt)$/i, '').trim() || 'Imported note';
}
