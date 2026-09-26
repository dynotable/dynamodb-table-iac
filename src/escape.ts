// Per-target string escaping. One helper per output context, applied to EVERY
// interpolated value — including comment lines — so an attribute name can
// never close a string, end a comment or open a template expression in the
// generated file. Attribute names are arbitrary UTF-8 by DynamoDB's rules.

const LINE_TERMINATORS = /[\u2028\u2029]/g;
// Characters YAML 1.1 parsers (PyYAML, SnakeYAML) treat as line breaks or as
// non-printable inside a double-quoted scalar, which JSON.stringify leaves raw.
const YAML_UNSAFE = /[\u0085\u2028\u2029\ufeff\u007F\u0080-\u009F]/g;

function unicodeEscape(ch: string): string {
  return `\\u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
}

/** A double-quoted HCL string literal (Terraform), including the quotes. */
export function hclString(value: string): string {
  let out = '"';
  for (const ch of value) {
    const code = ch.codePointAt(0) as number;
    if (ch === '\\') out += '\\\\';
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else if (code < 0x20 || code === 0x7f || (code >= 0x80 && code <= 0x9f)) {
      out += unicodeEscape(ch);
    } else if (code === 0x2028 || code === 0x2029 || code === 0xfeff) out += unicodeEscape(ch);
    else out += ch;
  }
  // `${` and `%{` open template interpolation / directives; doubling the
  // sigil is HCL's own escape for a literal one.
  // Function replacers: in a string replacement `$$` is itself an escape.
  return out.replaceAll('${', () => '$${').replaceAll('%{', () => '%%{') + '"';
}

/** A JavaScript/TypeScript string literal, including the quotes. */
export function tsString(value: string): string {
  return JSON.stringify(value).replace(LINE_TERMINATORS, unicodeEscape);
}

/** A YAML double-quoted scalar safe for YAML 1.1 AND 1.2 parsers. */
export function yamlString(value: string): string {
  return JSON.stringify(value).replace(YAML_UNSAFE, unicodeEscape);
}

/**
 * A value quoted for a `#` or `//` comment line: JSON-quoted with every
 * character any target reads as a line break escaped, so no value can end the
 * comment early and start code.
 */
export function quoteForComment(value: string): string {
  return JSON.stringify(value).replace(/[\u0085\u2028\u2029]/g, unicodeEscape);
}
