export type DiagnosticSeverity = 'warning' | 'error';

export interface Diagnostic {
  line: number;
  column?: number;
  severity: DiagnosticSeverity;
  code: string;
  message: string;
}

export type CardDirection = 'forward' | 'backward' | 'both' | 'none';
export type CardKind = 'basic' | 'multiline' | 'list' | 'multiple-choice' | 'cloze';
export type RemSemanticType = 'default' | 'concept' | 'descriptor';

export interface CardConfig {
  kind: CardKind;
  direction: CardDirection;
  semanticType: RemSemanticType;
  backMarkdown?: string;
  marker: string;
}

export interface ImportNode {
  id: string;
  sourceLine: number;
  markdown: string;
  headingLevel?: number;
  ordered: boolean;
  cluster: boolean;
  hasCloze: boolean;
  card?: CardConfig;
  children: ImportNode[];
}

export interface ParseStats {
  rems: number;
  cards: number;
  clozeRems: number;
  clusters: number;
}

export interface ParseResult {
  nodes: ImportNode[];
  diagnostics: Diagnostic[];
  stats: ParseStats;
}

export type SourceKind = 'file' | 'paste';

export interface SourceInput {
  key: string;
  title: string;
  kind: SourceKind;
  text: string;
  parentId: string | null;
  reimportMode?: 'sync' | 'append' | 'replace';
}

export interface ImportRecordV1 {
  sourceKey: string;
  documentId: string;
  parentId: string | null;
  title: string;
  contentHash: string;
  renderingVersion?: number;
}

export interface ImportRegistryV1 {
  version: 1;
  records: Record<string, ImportRecordV1>;
}

export type ImportStatus = 'created' | 'replaced' | 'appended' | 'updated' | 'unchanged' | 'failed';

export interface ImportResult {
  sourceKey: string;
  title: string;
  status: ImportStatus;
  documentId?: string;
  stats?: ParseStats;
  diagnostics: Diagnostic[];
  message?: string;
}
