import {describe, expect, it} from 'vitest';
import {hclString, quoteForComment, tsString, yamlString} from '../src/escape';

// Each expected literal is written from the target language's own escape
// rules (HCL string templates, ECMAScript string literals, YAML 1.1
// double-quoted scalars), not derived from the helper.

const HOSTILE = [
  'pk"quote',
  'sk${interp}',
  '%{directive}',
  'back\\slash',
  'new\nline',
  'close*/comment',
  'line\u2028sep',
  'nel\u0085char',
  'c1\u009fchar',
  '\nresource "terraform_data" "x" {}',
  '"}); new CfnOutput(this,"x",{value:"y"}); ({"'
];

describe('hclString', () => {
  it.each([
    ['plain', '"plain"'],
    ['pk"quote', '"pk\\"quote"'],
    ['sk${interp}', '"sk$${interp}"'],
    ['%{directive}', '"%%{directive}"'],
    ['back\\slash', '"back\\\\slash"'],
    ['new\nline', '"new\\nline"'],
    ['tab\there', '"tab\\there"'],
    ['line\u2028sep', '"line\\u2028sep"'],
    ['nel\u0085char', '"nel\\u0085char"'],
    ['c1\u009fchar', '"c1\\u009fchar"'],
    ['del\u007fchar', '"del\\u007fchar"']
  ])('%j → %s', (input, expected) => {
    expect(hclString(input)).toBe(expected);
  });

  it('never leaves an interpolation opener or a raw line break inside the literal', () => {
    for (const value of HOSTILE) {
      const out = hclString(value);
      expect(out).not.toMatch(/(^|[^$])\$\{/);
      expect(out).not.toMatch(/(^|[^%])%\{/);
      expect(out).not.toMatch(/[\n\r\u2028\u2029\u0085]/);
    }
  });
});

describe('tsString', () => {
  it('is a JSON literal with the two ECMAScript line terminators JSON leaves raw escaped', () => {
    expect(tsString('line\u2028sep\u2029end')).toBe('"line\\u2028sep\\u2029end"');
    expect(tsString('"}); new CfnOutput(this,"x",{value:"y"}); ({"')).toBe(
      '"\\"}); new CfnOutput(this,\\"x\\",{value:\\"y\\"}); ({\\""'
    );
  });

  it('never contains a raw line terminator', () => {
    for (const value of HOSTILE) expect(tsString(value)).not.toMatch(/[\n\r\u2028\u2029]/);
  });
});

describe('yamlString', () => {
  it('escapes what YAML 1.1 parsers read as line breaks or non-printables', () => {
    expect(yamlString('nel\u0085char')).toBe('"nel\\u0085char"');
    expect(yamlString('line\u2028sep')).toBe('"line\\u2028sep"');
    expect(yamlString('bom\ufeffchar')).toBe('"bom\\ufeffchar"');
    expect(yamlString('c1\u009fchar')).toBe('"c1\\u009fchar"');
    expect(yamlString('del\u007fchar')).toBe('"del\\u007fchar"');
  });

  it('quotes the YAML 1.1 booleans and nulls so they stay strings', () => {
    for (const word of ['yes', 'Yes', 'no', 'off', 'on', 'null', '~', 'true']) {
      expect(yamlString(word)).toBe(`"${word}"`);
    }
  });

  it('never contains a raw character outside YAML\'s printable set', () => {
    for (const value of HOSTILE) {
      // oxlint-disable-next-line no-control-regex -- the control range IS what must be absent
      expect(yamlString(value)).not.toMatch(/[\u0000-\u001f\u007f\u0080-\u009f\u2028\u2029\ufeff]/);
    }
  });
});

describe('quoteForComment', () => {
  it('can never end a # or // comment line', () => {
    for (const value of HOSTILE) {
      const out = quoteForComment(value);
      expect(out).not.toMatch(/[\n\r\u2028\u2029\u0085]/);
      expect(out.startsWith('"') && out.endsWith('"')).toBe(true);
    }
  });
});
