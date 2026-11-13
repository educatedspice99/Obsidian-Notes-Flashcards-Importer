import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { normalizeSourceKey, parseMarkdown, titleFromFilename } from '../src/parser';
import type { ImportNode } from '../src/types';

const fixture = (name: string) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/${name}`, import.meta.url)), 'utf8');

function flatten(nodes: ImportNode[]): ImportNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)]);
}

describe('parseMarkdown', () => {
  it.each([
    ['front >> back', 'forward', 'default', '>>'],
    ['front → back', 'forward', 'default', '→'],
    ['back << front', 'backward', 'default', '<<'],
    ['back ← front', 'backward', 'default', '←'],
    ['front <> back', 'both', 'default', '<>'],
    ['front ↔ back', 'both', 'default', '↔'],
    ['concept :: definition', 'both', 'concept', '::'],
    ['concept :> definition', 'forward', 'concept', ':>'],
    ['definition :< concept', 'backward', 'concept', ':<'],
    ['concept :- definition', 'none', 'concept', ':-'],
    ['descriptor ;; value', 'forward', 'descriptor', ';;'],
    ['value ;< descriptor', 'backward', 'descriptor', ';<'],
    ['descriptor ;;< value', 'both', 'descriptor', ';;<'],
    ['descriptor ;- value', 'none', 'descriptor', ';-'],
    ['disabled >- value', 'none', 'default', '>-'],
  ] as const)('parses %s', (source, direction, semanticType, marker) => {
    const result = parseMarkdown(`- ${source}`);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.nodes[0].card).toMatchObject({ direction, semanticType, marker });
    expect(result.nodes[0].card?.backMarkdown).toBeTruthy();
  });

  it('distinguishes a basic == delimiter from paired Obsidian highlights', () => {
    const result = parseMarkdown('- Question == Answer\n- Text ==one== and ==two==');
    expect(result.nodes[0].card).toMatchObject({ kind: 'basic', marker: '==' });
    expect(result.nodes[0].card?.backMarkdown).toBe('Answer');
    expect(result.nodes[1].card).toMatchObject({ kind: 'cloze' });
    expect(result.nodes[1].markdown).toBe('Text {{one}} and {{two}}');
    expect(result.nodes[1].hasCloze).toBe(true);
  });

  it('does not recognize card markers inside inline code', () => {
    const result = parseMarkdown('- Use `front >> back` as an example');
    expect(result.nodes[0].card).toBeUndefined();
    expect(result.nodes[0].markdown).toContain('`front >> back`');
  });

  it('parses multiline, list-answer, and multiple-choice cards', () => {
    const result = parseMarkdown(fixture('simple-cards.md'));
    const nodes = flatten(result.nodes);
    expect(nodes.find((node) => node.markdown === 'Multiline')?.card?.kind).toBe('multiline');
    expect(nodes.find((node) => node.markdown === 'Ordered answer')?.card?.kind).toBe('list');
    expect(nodes.find((node) => node.markdown === 'Choice')?.card?.kind).toBe('multiple-choice');
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
  });

  it.each([
    ['Question >>>', 'multiline', 'forward', 'default'],
    ['Question <<<', 'multiline', 'backward', 'default'],
    ['Question <><', 'multiline', 'both', 'default'],
    ['Concept ;>>', 'multiline', 'forward', 'concept'],
    ['Concept :<<', 'multiline', 'backward', 'concept'],
    ['Descriptor ;;>', 'multiline', 'forward', 'descriptor'],
    ['Descriptor ;<<', 'multiline', 'backward', 'descriptor'],
    ['Question >>1.', 'list', 'forward', 'default'],
    ['Question <<1.', 'list', 'backward', 'default'],
    ['Question <>1.', 'list', 'both', 'default'],
    ['Question >-1.', 'list', 'none', 'default'],
    ['Concept ;>>1.', 'list', 'forward', 'concept'],
    ['Concept :<<1.', 'list', 'backward', 'concept'],
    ['Concept ::1.', 'list', 'both', 'concept'],
    ['Concept :-1.', 'list', 'none', 'concept'],
    ['Descriptor ;;>1.', 'list', 'forward', 'descriptor'],
    ['Descriptor ;<<1.', 'list', 'backward', 'descriptor'],
    ['Descriptor ;;<1.', 'list', 'both', 'descriptor'],
    ['Descriptor ;-1.', 'list', 'none', 'descriptor'],
    ['Choice >>A)', 'multiple-choice', 'forward', 'default'],
    ['Choice >-A)', 'multiple-choice', 'none', 'default'],
    ['Concept ;>>A)', 'multiple-choice', 'forward', 'concept'],
    ['Concept :-A)', 'multiple-choice', 'none', 'concept'],
    ['Descriptor ;;>A)', 'multiple-choice', 'forward', 'descriptor'],
    ['Descriptor ;-A)', 'multiple-choice', 'none', 'descriptor'],
  ] as const)('parses child-card marker %s', (line, kind, direction, semanticType) => {
    const result = parseMarkdown(`- ${line}\n  - Answer`);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.nodes[0].card).toMatchObject({ kind, direction, semanticType });
  });

  it('preserves native cloze hints and normalizes CRLF Unicode input', () => {
    const result = parseMarkdown('## Întrebări\r\n- Capitala este {{București}}{({oraș})}\r\n');
    expect(result.nodes[0].markdown).toBe('Întrebări');
    expect(result.nodes[0].children[0].markdown).toBe('Capitala este {{București}}{({oraș})}');
    expect(result.nodes[0].children[0].card?.kind).toBe('cloze');
  });

  it('uses headings and indentation to produce outline ancestry', () => {
    const result = parseMarkdown('## Parent\n- Child\n  - Grandchild\n## Sibling');
    expect(result.nodes).toHaveLength(2);
    expect(result.nodes[0].markdown).toBe('Parent');
    expect(result.nodes[0].children[0].markdown).toBe('Child');
    expect(result.nodes[0].children[0].children[0].markdown).toBe('Grandchild');
    expect(result.nodes[1].markdown).toBe('Sibling');
  });

  it('treats heading markup inside exported list items as heading styling', () => {
    const result = parseMarkdown('- Parent\n\t- ### Nested heading >>>\n\t\t- Answer');
    const nested = result.nodes[0].children[0];
    expect(nested.headingLevel).toBe(3);
    expect(nested.markdown).toBe('Nested heading');
    expect(nested.card?.kind).toBe('multiline');
  });

  it('covers nested Unicode notes and mixed card shapes with a synthetic fixture', () => {
    const result = parseMarkdown(fixture('nested-notes.md'));
    const nodes = flatten(result.nodes);
    expect(result.diagnostics.filter((item) => item.severity === 'error')).toEqual([]);
    expect(result.stats.clusters).toBe(2);
    expect(result.stats.clozeRems).toBe(2);
    expect(nodes.some((node) => node.card?.kind === 'multiline')).toBe(true);
    expect(nodes.some((node) => node.card?.kind === 'list')).toBe(true);
    expect(nodes.some((node) => node.headingLevel === 4)).toBe(true);
  });

  it('warns but keeps readable text for unsupported Obsidian constructs', () => {
    const result = parseMarkdown('- [[Target|Alias]] and ![[image.png]] and ![diagram](local.png)');
    expect(result.nodes[0].markdown).toContain('Alias');
    expect(result.nodes[0].markdown).toContain('[Embedded: image.png]');
    expect(result.nodes[0].markdown).toContain('diagram (image: local.png)');
    expect(result.diagnostics.map((item) => item.code)).toEqual(
      expect.arrayContaining(['unsupported-wikilink', 'unsupported-embed', 'unsupported-image']),
    );
  });

  it('reports structural card errors before import', () => {
    const result = parseMarkdown('- Empty multiline >>>');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'card-without-items',
    }));
  });

  it('blocks an empty source', () => {
    const result = parseMarkdown('  \n\t');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({
      severity: 'error',
      code: 'empty-source',
    }));
  });
});

describe('source naming helpers', () => {
  it('normalizes keys and derives titles', () => {
    expect(normalizeSourceKey('  My Note.MD  ')).toBe('my-note.md');
    expect(titleFromFilename('My Note.markdown')).toBe('My Note');
  });
});
