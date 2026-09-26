import {describe, expect, it} from 'vitest';
import * as api from '../src/index';

// Scaffold guard: the public entry point must load and export something a
// consumer can import. Real emitter tests live beside each emitter.
describe('public entry point', () => {
  it('loads and exposes the package name', () => {
    expect(api.PACKAGE_NAME).toBe('dynamodb-table-iac');
  });
});
