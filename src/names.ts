// Stable identifiers derived from the table name, so re-exporting the same
// table always produces the same resource address / logical id / construct id.

const FALLBACK = 'Table';

function prefixLeadingDigit(id: string): string {
  return /^[0-9]/.test(id) ? `T${id}` : id;
}

/** Terraform resource name: `orders-v2.prod` → `orders_v2_prod`. */
export function terraformId(tableName: string): string {
  const id = tableName.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '');
  return id.length === 0 ? FALLBACK : prefixLeadingDigit(id);
}

/** CloudFormation logical id / CDK construct id: `orders-v2.prod` → `OrdersV2Prod`. */
export function pascalId(tableName: string): string {
  const id = tableName
    .split(/[^A-Za-z0-9]+/)
    .filter((part) => part.length > 0)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
  return id.length === 0 ? FALLBACK : prefixLeadingDigit(id);
}
