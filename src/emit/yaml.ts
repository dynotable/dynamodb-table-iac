import {yamlString} from '../escape';

// A deliberately small YAML writer for the CloudFormation template: block
// style, two-space indent, scalars only where CloudFormation puts them. Every
// user-derived string is a `Quoted` and rendered double-quoted (YAML 1.1-safe
// via `yamlString`); a bare string is one of OUR tokens (a property name, an
// enum value, a region) and must match PLAIN_SAFE or rendering throws — that
// guard is what keeps a user string from ever reaching the plain-scalar path.

export class Quoted {
  constructor(readonly value: string) {}
}

export type YamlNode = Quoted | string | number | boolean | YamlNode[] | YamlMap;
export type YamlMap = {[key: string]: YamlNode};

const PLAIN_SAFE = /^[A-Za-z][A-Za-z0-9_:.-]*$/;
const YAML_WORDS = new Set([
  'y', 'n', 'yes', 'no', 'on', 'off', 'true', 'false', 'null', '~'
]);

export function quoted(value: string): Quoted {
  return new Quoted(value);
}

function isScalar(node: YamlNode): node is Quoted | string | number | boolean {
  return !Array.isArray(node) && !(typeof node === 'object' && !(node instanceof Quoted));
}

function scalar(node: Quoted | string | number | boolean): string {
  if (node instanceof Quoted) return yamlString(node.value);
  if (typeof node === 'string') {
    if (!PLAIN_SAFE.test(node) || YAML_WORDS.has(node.toLowerCase())) {
      throw new Error(`YAML token ${JSON.stringify(node)} is not a plain-safe scalar; wrap user strings in Quoted`);
    }
    return node;
  }
  return String(node);
}

function key(name: string, quoteKeys: ReadonlySet<string>): string {
  return quoteKeys.has(name) ? yamlString(name) : scalar(name);
}

function renderMap(map: YamlMap, indent: number, quoteKeys: ReadonlySet<string>, out: string[]): void {
  const pad = ' '.repeat(indent);
  for (const [k, v] of Object.entries(map)) {
    if (isScalar(v)) out.push(`${pad}${key(k, quoteKeys)}: ${scalar(v)}`);
    else {
      out.push(`${pad}${key(k, quoteKeys)}:`);
      renderNode(v, indent + 2, quoteKeys, out);
    }
  }
}

function renderSeq(items: YamlNode[], indent: number, quoteKeys: ReadonlySet<string>, out: string[]): void {
  const pad = ' '.repeat(indent);
  for (const item of items) {
    if (isScalar(item)) {
      out.push(`${pad}- ${scalar(item)}`);
      continue;
    }
    if (Array.isArray(item)) throw new Error('nested sequences are not used in CloudFormation templates');
    // A mapping item starts on the `- ` line and continues two columns in.
    const entries = Object.entries(item);
    const [first, ...rest] = entries;
    if (first === undefined) throw new Error('empty mapping in a sequence');
    const [fk, fv] = first;
    if (isScalar(fv)) out.push(`${pad}- ${key(fk, quoteKeys)}: ${scalar(fv)}`);
    else {
      out.push(`${pad}- ${key(fk, quoteKeys)}:`);
      renderNode(fv, indent + 4, quoteKeys, out);
    }
    renderMap(Object.fromEntries(rest), indent + 2, quoteKeys, out);
  }
}

function renderNode(node: YamlNode, indent: number, quoteKeys: ReadonlySet<string>, out: string[]): void {
  if (Array.isArray(node)) renderSeq(node, indent, quoteKeys, out);
  else if (isScalar(node)) out.push(`${' '.repeat(indent)}${scalar(node)}`);
  else renderMap(node, indent, quoteKeys, out);
}

/** Render a document (a top-level mapping). `quoteKeys` names keys to double-quote (the logical id). */
export function renderYaml(doc: YamlMap, quoteKeys: ReadonlySet<string> = new Set()): string {
  const out: string[] = [];
  renderMap(doc, 0, quoteKeys, out);
  return out.join('\n') + '\n';
}

/** The same tree as plain JSON data (Quoted unwrapped), for `JSON.stringify`. */
export function toJsonValue(node: YamlNode): unknown {
  if (node instanceof Quoted) return node.value;
  if (Array.isArray(node)) return node.map(toJsonValue);
  if (typeof node === 'object') {
    return Object.fromEntries(Object.entries(node).map(([k, v]) => [k, toJsonValue(v)]));
  }
  return node;
}
