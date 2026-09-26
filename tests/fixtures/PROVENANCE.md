# Fixture provenance

Every `*.describe.json` is the `{"Table": …}` envelope `aws dynamodb describe-table`
prints; every `*.ttl.json` is the `{"TimeToLiveDescription": …}` envelope of
`describe-time-to-live`. None was produced by the code under test.

Two sources:

- **Local capture** — created on DynamoDB Local 3.x and described through the
  SDK, Dates serialized as ISO strings the way the CLI prints them. Local's
  `TableArn` region is the literal `ddblocal`; Local omits `BillingModeSummary`
  on provisioned tables; Local refuses `DeleteTable` while deletion protection
  is on.
- **Authored** — written by hand in `author.py` from the shapes in the
  DynamoDB API reference (`TableDescription`, `ReplicaDescription`,
  `VectorIndexDescription`, `SSEDescription`, …) for facts Local cannot produce.
  Re-run `python3 tests/fixtures/author.py` after editing it.

| Fixture | Source | Exercises | Golden `input.region` |
|---|---|---|---|
| `a-core` | Local capture | on-demand, sort key, GSI `ALL` + GSI `INCLUDE`, TTL `ENABLED` (`a-core.ttl.json`), deletion protection | `us-east-1` |
| `b-provisioned` | Local capture | provisioned table + per-GSI capacity, GSI `KEYS_ONLY`, LSI, NO `BillingModeSummary`, `ddblocal` ARN | `us-east-1` |
| `b-hash-only` | Local capture | provisioned, hash key only | `us-east-1` |
| `c-stream` | Local capture | stream `NEW_AND_OLD_IMAGES` | `us-east-1` |
| `c-extras-aws` | authored | SSE `KMS` with key ARN, `STANDARD_INFREQUENT_ACCESS`, `OnDemandThroughput` with write side `-1`, `WarmThroughput` present | from `TableArn` (`eu-west-1`) |
| `d-vector` | authored | vector index with `HASH` + `INLINE_FILTER` search schema; a second index `CREATING` without `Dimensions`/`DistanceFunction`/`Projection` | from `TableArn` |
| `e-multikey-gsi` | authored | GSI with two `HASH` + two `RANGE` keys | from `TableArn` |
| `f-hostile` | authored | table name `yes`; attribute names with `"`, `${`, `%{`, `\`, newline, `*/`, U+2028, U+0085, a C1 char, `__proto__`, `constructor`, and two valid-code payloads | from `TableArn` |
| `h1-eventual-ondemand` | authored | EVENTUAL on-demand global table: one replica with table-class + on-demand-read + GSI overrides, one `UPDATING`, one `DELETING`, one in another account | from `TableArn` (`us-east-1`) |
| `h2-eventual-provisioned` | authored | EVENTUAL provisioned global table, deletion protection, per-replica read override + GSI read override | from `TableArn` |
| `h3-strong-cross-continent` | authored | STRONG, three regions across continents (CDK refuses) | from `TableArn` |
| `h4-strong-witness` | authored | STRONG, home + one replica + a witness inside one CDK region group | from `TableArn` |
| `g-real-arn` | authored | refusal: a real `TableArn` region with a DIFFERENT `input.region` | `us-east-1` (mismatch) |
| `g-replicas-without-region` | authored | refusal: replicas present, no `TableArn`, no `input.region` | none |
| `g-strong-with-deleting` | authored | refusal: STRONG with a `DELETING` member | — |
| `g-no-summary-rcu0` | authored | refusal: no `BillingModeSummary` and RCU 0 | — |
| `g-provisioned-without-throughput` | authored | refusal: `PROVISIONED` without throughput | — |
| `g-invalid-table-name` | authored | refusal: table name outside `[A-Za-z0-9_.-]{3,255}` | — |
| `g-key-without-definition` | authored | refusal: key attribute with no `AttributeDefinitions` entry | — |
| `g-conflicting-definitions` | authored | refusal: duplicate definitions with conflicting types | — |
| `g-range-first` | authored | refusal: `RANGE` before `HASH` | — |
| `g-lsi-foreign-hash` | authored | refusal: LSI whose `HASH` differs from the table's | — |
| `g-stream-without-view-type` | authored | refusal: stream enabled without a view type | — |

**Region-less golden (i)**: `b-provisioned` emitted WITHOUT `input.region` — its
`ddblocal` ARN yields no home region, so Terraform declares no provider region,
CDK no `env.region`, and CloudFormation a sole `{Ref: "AWS::Region"}` replica.
Goldens for it are named `i-regionless.*`.
