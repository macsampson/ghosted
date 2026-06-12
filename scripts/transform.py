import json
import time
import boto3

TABLE_NAME = "JobTracker"
ENDPOINT = "http://localhost:8000"
PROD_SUB = "fc2ed416-c021-70df-f143-550891b8fac8"
DEV_SUB = "dev-user-local-123"

def remap(v):
    """Recursively replace the prod sub with the dev sub in all string values."""
    if isinstance(v, dict):
        return {k: remap(val) for k, val in v.items()}
    if isinstance(v, list):
        return [remap(x) for x in v]
    if isinstance(v, str):
        return v.replace(PROD_SUB, DEV_SUB)
    return v

with open("prod-june10.json") as f:
    all_items = json.load(f)["Items"]

items = [remap(it) for it in all_items if it.get("PK", {}).get("S") != "OAUTH_STATE"]
print(f"Loaded {len(all_items)} items, skipping {len(all_items) - len(items)} OAUTH_STATE entries → {len(items)} to write (sub remapped to {DEV_SUB})")

client = boto3.client(
    "dynamodb",
    endpoint_url=ENDPOINT,
    region_name="us-east-1",
    aws_access_key_id="local",
    aws_secret_access_key="local",
)

def batch_write(requests):
    remaining = {TABLE_NAME: requests}
    attempts = 0
    while remaining:
        attempts += 1
        resp = client.batch_write_item(RequestItems=remaining)
        remaining = resp.get("UnprocessedItems", {})
        if remaining:
            print(f"  {sum(len(v) for v in remaining.values())} unprocessed items, retrying (attempt {attempts})…")
            time.sleep(0.5 * attempts)

chunks = [items[i:i+25] for i in range(0, len(items), 25)]
for i, chunk in enumerate(chunks):
    requests = [{"PutRequest": {"Item": item}} for item in chunk]
    batch_write(requests)
    print(f"  chunk {i+1}/{len(chunks)} written ({len(chunk)} items)")

print(f"Done — {len(items)} items written to {TABLE_NAME} at {ENDPOINT}")
