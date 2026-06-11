#!/usr/bin/env python3
"""Upsert prod DynamoDB data into local DDB with sub remapped to dev user.

Usage:
  python3 sync-prod.py              # scan live prod (once deployed)
  python3 sync-prod.py dump.json    # load from a prior aws dynamodb scan export
"""
import json
import sys
import time
import boto3

TABLE = "JobTracker"
PROD_REGION = "ca-west-1"
PROD_SUB = "fc2ed416-c021-70df-f143-550891b8fac8"
DEV_SUB = "dev-user-local-123"

local = boto3.client("dynamodb", endpoint_url="http://localhost:8000", region_name="us-east-1",
                     aws_access_key_id="local", aws_secret_access_key="local")

def remap(v):
    if isinstance(v, dict):
        return {k: remap(val) for k, val in v.items()}
    if isinstance(v, list):
        return [remap(x) for x in v]
    if isinstance(v, str):
        return v.replace(PROD_SUB, DEV_SUB)
    return v

def scan_prod():
    prod = boto3.client("dynamodb", region_name=PROD_REGION)
    items, resp = [], prod.scan(TableName=TABLE)
    items.extend(resp["Items"])
    while "LastEvaluatedKey" in resp:
        resp = prod.scan(TableName=TABLE, ExclusiveStartKey=resp["LastEvaluatedKey"])
        items.extend(resp["Items"])
    return items

def batch_write(items):
    remaining = {TABLE: [{"PutRequest": {"Item": it}} for it in items]}
    attempts = 0
    while remaining:
        attempts += 1
        resp = local.batch_write_item(RequestItems=remaining)
        remaining = resp.get("UnprocessedItems", {})
        if remaining:
            time.sleep(0.5 * attempts)

if len(sys.argv) > 1:
    with open(sys.argv[1]) as f:
        raw = json.load(f)
    all_items = raw.get("Items", raw) if isinstance(raw, dict) else raw
    print(f"Loaded {len(all_items)} items from {sys.argv[1]}")
else:
    print(f"Scanning prod ({PROD_REGION})…")
    all_items = scan_prod()
    print(f"  {len(all_items)} items fetched")

items = [remap(it) for it in all_items if it.get("PK", {}).get("S") != "OAUTH_STATE"]
skipped = len(all_items) - len(items)
print(f"  {skipped} OAUTH_STATE skipped → {len(items)} to upsert")

for i in range(0, len(items), 25):
    batch_write(items[i:i+25])
print(f"Done — {len(items)} items upserted into local {TABLE}")
