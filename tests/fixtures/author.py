#!/usr/bin/env python3
"""Author the DescribeTable fixtures DynamoDB Local cannot produce.

Hand-authored from the AWS API reference shapes (see PROVENANCE.md); the
emitters under test never touch this script. Run from the package root:
    python3 tests/fixtures/author.py
"""
import json
from pathlib import Path

OUT = Path(__file__).parent
ACCOUNT = "123456789012"
OTHER_ACCOUNT = "999999999999"
ISO = "2026-09-20T09:15:00.000Z"


def S(n):
    return {"AttributeName": n, "AttributeType": "S"}


def N(n):
    return {"AttributeName": n, "AttributeType": "N"}


def HASH(n):
    return {"AttributeName": n, "KeyType": "HASH"}


def RANGE(n):
    return {"AttributeName": n, "KeyType": "RANGE"}


def arn(region, name, account=ACCOUNT):
    return f"arn:aws:dynamodb:{region}:{account}:table/{name}"


def base(name, region, keys, defs, on_demand=True, rcu=0, wcu=0):
    t = {
        "AttributeDefinitions": defs,
        "TableName": name,
        "KeySchema": keys,
        "TableStatus": "ACTIVE",
        "CreationDateTime": ISO,
        "ProvisionedThroughput": {
            "NumberOfDecreasesToday": 0,
            "ReadCapacityUnits": rcu,
            "WriteCapacityUnits": wcu,
        },
        "TableSizeBytes": 4096,
        "ItemCount": 12,
        "TableArn": arn(region, name),
        "TableId": "0f8d4b2a-1111-4c3d-9e7f-abcdef012345",
        "DeletionProtectionEnabled": False,
        "WarmThroughput": {
            "ReadUnitsPerSecond": 12000,
            "WriteUnitsPerSecond": 4000,
            "Status": "ACTIVE",
        },
    }
    if on_demand:
        t["BillingModeSummary"] = {
            "BillingMode": "PAY_PER_REQUEST",
            "LastUpdateToPayPerRequestDateTime": ISO,
        }
    return t


def write(name, table, ttl=None):
    (OUT / f"{name}.describe.json").write_text(json.dumps({"Table": table}, indent=2) + "\n")
    if ttl is not None:
        (OUT / f"{name}.ttl.json").write_text(
            json.dumps({"TimeToLiveDescription": ttl}, indent=2) + "\n"
        )


# (c) extras Local cannot express: SSE KMS, STANDARD_INFREQUENT_ACCESS,
# on-demand max throughput with the write side unset (-1), WarmThroughput.
c = base("audit-log", "eu-west-1", [HASH("pk")], [S("pk")])
c["SSEDescription"] = {
    "Status": "ENABLED",
    "SSEType": "KMS",
    "KMSMasterKeyArn": f"arn:aws:kms:eu-west-1:{ACCOUNT}:key/1b2c3d4e-5f60-4718-8a9b-0c1d2e3f4a5b",
}
c["TableClassSummary"] = {"TableClass": "STANDARD_INFREQUENT_ACCESS", "LastUpdateDateTime": ISO}
c["OnDemandThroughput"] = {"MaxReadRequestUnits": 2000, "MaxWriteRequestUnits": -1}
write("c-extras-aws", c)

# (d) vector index with a HASH + INLINE_FILTER search schema, plus a second
# index still CREATING that lacks Dimensions/DistanceFunction/Projection, a
# third index DELETING, and a DELETING GSI — both left out with a note.
d = base("articles", "us-east-1", [HASH("pk"), RANGE("sk")], [S("pk"), S("sk"), S("tenant"), S("category")])
d["GlobalSecondaryIndexes"] = [
    {
        "IndexName": "old-by-category",
        "KeySchema": [HASH("category")],
        "Projection": {"ProjectionType": "KEYS_ONLY"},
        "IndexStatus": "DELETING",
        "ProvisionedThroughput": {"NumberOfDecreasesToday": 0, "ReadCapacityUnits": 0, "WriteCapacityUnits": 0},
        "IndexSizeBytes": 0,
        "ItemCount": 0,
        "IndexArn": arn("us-east-1", "articles") + "/index/old-by-category",
    }
]
d["VectorIndexes"] = [
    {
        "IndexName": "by-embedding",
        "VectorAttribute": {"AttributeName": "embedding"},
        "Dimensions": 1024,
        "DistanceFunction": "COSINE",
        "Projection": {"ProjectionType": "ALL"},
        "SearchSchema": [
            {"AttributeName": "tenant", "SearchSchemaElementType": "HASH"},
            {"AttributeName": "category", "SearchSchemaElementType": "INLINE_FILTER"},
        ],
        "IndexStatus": "ACTIVE",
        "Backfilling": False,
        "IndexSizeBytes": 0,
        "ItemCount": 0,
        "IndexArn": arn("us-east-1", "articles") + "/index/by-embedding",
    },
    {
        "IndexName": "by-title-embedding",
        "VectorAttribute": {"AttributeName": "titleEmbedding"},
        "IndexStatus": "CREATING",
        "Backfilling": True,
    },
    {
        "IndexName": "old-embedding",
        "VectorAttribute": {"AttributeName": "oldEmbedding"},
        "Dimensions": 256,
        "DistanceFunction": "EUCLIDEAN",
        "Projection": {"ProjectionType": "ALL"},
        "IndexStatus": "DELETING",
        "Backfilling": False,
        "IndexSizeBytes": 0,
        "ItemCount": 0,
        "IndexArn": arn("us-east-1", "articles") + "/index/old-embedding",
    },
]
write("d-vector", d)

# (e) multi-attribute GSI key: two HASH and two RANGE attributes.
e = base(
    "events",
    "us-east-1",
    [HASH("pk"), RANGE("sk")],
    [S("pk"), S("sk"), S("tenant"), S("kind"), N("ts"), S("actor")],
)
e["GlobalSecondaryIndexes"] = [
    {
        "IndexName": "by-tenant-kind",
        "KeySchema": [HASH("tenant"), HASH("kind"), RANGE("ts"), RANGE("actor")],
        "Projection": {"ProjectionType": "KEYS_ONLY"},
        "IndexStatus": "ACTIVE",
        "ProvisionedThroughput": {"NumberOfDecreasesToday": 0, "ReadCapacityUnits": 0, "WriteCapacityUnits": 0},
        "IndexSizeBytes": 0,
        "ItemCount": 0,
        "IndexArn": arn("us-east-1", "events") + "/index/by-tenant-kind",
    }
]
write("e-multikey-gsi", e)

# (f) hostile names: table name `yes` (a YAML 1.1 boolean once PascalCased),
# attribute names carrying every escape hazard per target, and two payloads
# that are VALID code if they escape their string.
HOSTILE = [
    'pk"quote',
    "sk${interp}",
    "%{directive}",
    "back\\slash",
    "new\nline",
    "close*/comment",
    "line sep",
    "nel\u0085char",
    "c1\u009fchar",
    "__proto__",
    "constructor",
    '\nresource "terraform_data" "x" {}',
    '"}); new CfnOutput(this,"x",{value:"y"}); ({"',
]
f = base("yes", "us-east-1", [HASH(HOSTILE[0]), RANGE(HOSTILE[1])], [S(HOSTILE[0]), S(HOSTILE[1]), S(HOSTILE[2]), S(HOSTILE[3]), N(HOSTILE[4])])
f["GlobalSecondaryIndexes"] = [
    {
        "IndexName": "hostile-gsi",
        "KeySchema": [HASH(HOSTILE[2]), RANGE(HOSTILE[3])],
        "Projection": {"ProjectionType": "INCLUDE", "NonKeyAttributes": HOSTILE[5:]},
        "IndexStatus": "ACTIVE",
        "ProvisionedThroughput": {"NumberOfDecreasesToday": 0, "ReadCapacityUnits": 0, "WriteCapacityUnits": 0},
        "IndexSizeBytes": 0,
        "ItemCount": 0,
        "IndexArn": arn("us-east-1", "yes") + "/index/hostile-gsi",
    }
]
f["LocalSecondaryIndexes"] = [
    {
        "IndexName": "hostile-lsi",
        "KeySchema": [HASH(HOSTILE[0]), RANGE(HOSTILE[4])],
        "Projection": {"ProjectionType": "ALL"},
        "IndexSizeBytes": 0,
        "ItemCount": 0,
        "IndexArn": arn("us-east-1", "yes") + "/index/hostile-lsi",
    }
]
write("f-hostile", f)


# (h) global tables — `Replicas` lists the OTHER regions only; the home region
# is the TableArn region.
def replica(region, status="ACTIVE", account=ACCOUNT, **extra):
    r = {
        "RegionName": region,
        "ReplicaStatus": status,
        "ReplicaArn": arn(region, extra.pop("_name"), account),
    }
    r.update(extra)
    return r


# h1: EVENTUAL on-demand, four replicas exercising every replica arm.
h1 = base("sessions", "us-east-1", [HASH("pk"), RANGE("sk")], [S("pk"), S("sk"), S("userId")])
h1["GlobalSecondaryIndexes"] = [
    {
        "IndexName": "by-user",
        "KeySchema": [HASH("userId")],
        "Projection": {"ProjectionType": "ALL"},
        "IndexStatus": "ACTIVE",
        "ProvisionedThroughput": {"NumberOfDecreasesToday": 0, "ReadCapacityUnits": 0, "WriteCapacityUnits": 0},
        "OnDemandThroughput": {"MaxReadRequestUnits": -1, "MaxWriteRequestUnits": -1},
        "IndexSizeBytes": 0,
        "ItemCount": 0,
        "IndexArn": arn("us-east-1", "sessions") + "/index/by-user",
    }
]
h1["StreamSpecification"] = {"StreamEnabled": True, "StreamViewType": "NEW_AND_OLD_IMAGES"}
h1["LatestStreamLabel"] = "2026-09-20T09:15:00.000"
h1["LatestStreamArn"] = arn("us-east-1", "sessions") + "/stream/2026-09-20T09:15:00.000"
h1["GlobalTableVersion"] = "2019.11.21"
h1["MultiRegionConsistency"] = "EVENTUAL"
h1["Replicas"] = [
    replica(
        "eu-west-1",
        _name="sessions",
        ReplicaTableClassSummary={"TableClass": "STANDARD_INFREQUENT_ACCESS"},
        OnDemandThroughputOverride={"MaxReadRequestUnits": 500},
        GlobalSecondaryIndexes=[{"IndexName": "by-user", "OnDemandThroughputOverride": {"MaxReadRequestUnits": 100}}],
    ),
    replica("ap-northeast-1", status="UPDATING", _name="sessions", ReplicaStatusDescription="Updating settings", ReplicaStatusPercentProgress="60"),
    replica("sa-east-1", status="DELETING", _name="sessions"),
    replica("eu-central-1", _name="sessions", account=OTHER_ACCOUNT),
]
write("h1-eventual-ondemand", h1, ttl={"TimeToLiveStatus": "DISABLED"})

# h2: EVENTUAL provisioned with deletion protection, per-replica read override
# and a GSI read override; the home table is STANDARD_INFREQUENT_ACCESS while
# the replica is STANDARD (a per-replica class that must not be inherited).
h2 = base("ledger", "us-east-1", [HASH("pk"), RANGE("sk")], [S("pk"), S("sk"), S("account")], on_demand=False, rcu=20, wcu=10)
h2["DeletionProtectionEnabled"] = True
h2["TableClassSummary"] = {"TableClass": "STANDARD_INFREQUENT_ACCESS", "LastUpdateDateTime": ISO}
h2["GlobalSecondaryIndexes"] = [
    {
        "IndexName": "by-account",
        "KeySchema": [HASH("account"), RANGE("sk")],
        "Projection": {"ProjectionType": "ALL"},
        "IndexStatus": "ACTIVE",
        "ProvisionedThroughput": {"NumberOfDecreasesToday": 0, "ReadCapacityUnits": 8, "WriteCapacityUnits": 4},
        "IndexSizeBytes": 0,
        "ItemCount": 0,
        "IndexArn": arn("us-east-1", "ledger") + "/index/by-account",
    }
]
h2["BillingModeSummary"] = {"BillingMode": "PROVISIONED"}
h2["StreamSpecification"] = {"StreamEnabled": True, "StreamViewType": "NEW_AND_OLD_IMAGES"}
h2["GlobalTableVersion"] = "2019.11.21"
h2["MultiRegionConsistency"] = "EVENTUAL"
h2["Replicas"] = [
    replica(
        "eu-west-1",
        _name="ledger",
        ReplicaTableClassSummary={"TableClass": "STANDARD"},
        ProvisionedThroughputOverride={"ReadCapacityUnits": 7},
        GlobalSecondaryIndexes=[{"IndexName": "by-account", "ProvisionedThroughputOverride": {"ReadCapacityUnits": 3}}],
    )
]
write("h2-eventual-provisioned", h2)

# h3: STRONG across three continents — Terraform + CloudFormation positive,
# CDK refuses (its region-group check is stricter than the service).
h3 = base("orders", "us-east-1", [HASH("pk"), RANGE("sk")], [S("pk"), S("sk")])
h3["GlobalTableVersion"] = "2019.11.21"
h3["MultiRegionConsistency"] = "STRONG"
h3["Replicas"] = [replica("eu-west-1", _name="orders"), replica("ap-northeast-1", _name="orders")]
write("h3-strong-cross-continent", h3)

# h4: STRONG inside one CDK region group, with a witness.
h4 = base("carts", "us-east-1", [HASH("pk")], [S("pk")])
h4["GlobalTableVersion"] = "2019.11.21"
h4["MultiRegionConsistency"] = "STRONG"
h4["Replicas"] = [replica("us-east-2", _name="carts")]
h4["GlobalTableWitnesses"] = [{"RegionName": "us-west-2", "WitnessStatus": "ACTIVE"}]
write("h4-strong-witness", h4)

# (g) refusals — each the smallest table that trips one rule.
g_real_arn = base("real-arn", "eu-west-1", [HASH("pk")], [S("pk")])
write("g-real-arn", g_real_arn)  # test passes input.region = us-east-1 → mismatch

g_no_region = base("no-region", "us-east-1", [HASH("pk")], [S("pk")])
del g_no_region["TableArn"]
g_no_region["Replicas"] = [replica("eu-west-1", _name="no-region")]
write("g-replicas-without-region", g_no_region)

g_strong_del = base("strong-del", "us-east-1", [HASH("pk")], [S("pk")])
g_strong_del["MultiRegionConsistency"] = "STRONG"
g_strong_del["Replicas"] = [replica("us-east-2", _name="strong-del"), replica("us-west-2", status="DELETING", _name="strong-del")]
write("g-strong-with-deleting", g_strong_del)

g_no_summary = base("no-summary", "us-east-1", [HASH("pk")], [S("pk")], on_demand=False)
write("g-no-summary-rcu0", g_no_summary)

g_prov_no_tp = base("prov-no-tp", "us-east-1", [HASH("pk")], [S("pk")], on_demand=False)
g_prov_no_tp["BillingModeSummary"] = {"BillingMode": "PROVISIONED"}
del g_prov_no_tp["ProvisionedThroughput"]
write("g-provisioned-without-throughput", g_prov_no_tp)

g_bad_name = base("bad name!", "us-east-1", [HASH("pk")], [S("pk")])
write("g-invalid-table-name", g_bad_name)

g_key_no_def = base("key-no-def", "us-east-1", [HASH("pk"), RANGE("sk")], [S("pk")])
write("g-key-without-definition", g_key_no_def)

g_conflict = base("conflict", "us-east-1", [HASH("pk")], [S("pk"), N("pk")])
write("g-conflicting-definitions", g_conflict)

g_range_first = base("range-first", "us-east-1", [RANGE("sk"), HASH("pk")], [S("pk"), S("sk")])
write("g-range-first", g_range_first)

g_lsi = base("lsi-foreign", "us-east-1", [HASH("pk"), RANGE("sk")], [S("pk"), S("sk"), S("other"), N("score")])
g_lsi["LocalSecondaryIndexes"] = [
    {"IndexName": "bad-lsi", "KeySchema": [HASH("other"), RANGE("score")], "Projection": {"ProjectionType": "ALL"}}
]
write("g-lsi-foreign-hash", g_lsi)

g_stream = base("stream-no-view", "us-east-1", [HASH("pk")], [S("pk")])
g_stream["StreamSpecification"] = {"StreamEnabled": True}
write("g-stream-without-view-type", g_stream)

print("authored fixtures into", OUT)
