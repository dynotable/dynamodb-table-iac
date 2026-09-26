import {describe, expect, it} from 'vitest';
import {pascalId, terraformId} from '../src/names';

describe('terraformId', () => {
  it.each([
    ['orders', 'orders'],
    ['orders-v2.prod', 'orders_v2_prod'],
    ['Orders_Table', 'Orders_Table'],
    ['2026-events', 'T2026_events'],
    ['___', 'Table'],
    ['-.-', 'Table'],
    ['yes', 'yes']
  ])('%s → %s', (input, expected) => {
    expect(terraformId(input)).toBe(expected);
  });
});

describe('pascalId', () => {
  it.each([
    ['orders', 'Orders'],
    ['orders-v2.prod', 'OrdersV2Prod'],
    ['Orders_Table', 'OrdersTable'],
    ['2026-events', 'T2026Events'],
    ['___', 'Table'],
    ['-.-', 'Table'],
    ['yes', 'Yes']
  ])('%s → %s', (input, expected) => {
    expect(pascalId(input)).toBe(expected);
  });
});
