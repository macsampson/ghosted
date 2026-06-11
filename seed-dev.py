#!/usr/bin/env python3
"""Seed local DynamoDB with 100 realistic mock applications for dev/screenshot use."""
import uuid
import random
import time
from datetime import datetime, timedelta, timezone
import boto3

TABLE = "JobTracker"
DEV_SUB = "dev-user-local-123"

RESUMES = [
    ("46dfa364-b233-45ce-a0d4-4186051d2085", "TA_general"),
    ("6e8adee3-bb7f-42f5-b03e-826c7b20874c", "Fullstack w/ Apparition"),
    ("f4e3297e-8a72-4f83-b414-5e883badfff2", "Fullstack Resume w/ Ghosted"),
]

# (company, role, salary_min, salary_max, resume_label)
JOBS = [
    # Fullstack / Backend
    ("Shopify", "Software Engineer", 110000, 145000, "Fullstack Resume w/ Ghosted"),
    ("Stripe", "Backend Engineer", 130000, 170000, "Fullstack w/ Apparition"),
    ("Vercel", "Full Stack Engineer", 120000, 155000, "Fullstack Resume w/ Ghosted"),
    ("Linear", "Software Engineer", 125000, 160000, "Fullstack w/ Apparition"),
    ("Railway", "Backend Developer", 100000, 135000, "Fullstack Resume w/ Ghosted"),
    ("PlanetScale", "Software Engineer", 115000, 150000, "Fullstack w/ Apparition"),
    ("Supabase", "Full Stack Engineer", 110000, 140000, "Fullstack Resume w/ Ghosted"),
    ("Loom", "Software Engineer", 120000, 155000, "Fullstack w/ Apparition"),
    ("Notion", "Software Engineer", 130000, 165000, "Fullstack Resume w/ Ghosted"),
    ("Figma", "Software Engineer", 135000, 170000, "Fullstack w/ Apparition"),
    ("Retool", "Full Stack Developer", 115000, 150000, "Fullstack Resume w/ Ghosted"),
    ("PostHog", "Software Engineer", 105000, 140000, "Fullstack w/ Apparition"),
    ("Descript", "Backend Engineer", 110000, 145000, "Fullstack Resume w/ Ghosted"),
    ("Coda", "Software Engineer", 120000, 155000, "Fullstack w/ Apparition"),
    ("Pitch", "Full Stack Developer", 100000, 130000, "Fullstack Resume w/ Ghosted"),
    ("Brex", "Software Engineer", 125000, 160000, "Fullstack w/ Apparition"),
    ("Ramp", "Backend Engineer", 130000, 165000, "Fullstack Resume w/ Ghosted"),
    ("Mercury", "Software Engineer", 115000, 145000, "Fullstack w/ Apparition"),
    ("Clerk", "Full Stack Engineer", 100000, 130000, "Fullstack Resume w/ Ghosted"),
    ("Neon", "Software Engineer", 105000, 135000, "Fullstack w/ Apparition"),
    ("Turso", "Backend Developer", 95000, 125000, "Fullstack Resume w/ Ghosted"),
    ("Resend", "Software Engineer", 100000, 130000, "Fullstack w/ Apparition"),
    ("Cal.com", "Full Stack Developer", 90000, 120000, "Fullstack Resume w/ Ghosted"),
    ("Trigger.dev", "Software Engineer", 95000, 125000, "Fullstack w/ Apparition"),
    ("Inngest", "Backend Engineer", 100000, 130000, "Fullstack Resume w/ Ghosted"),
    ("Prisma", "Software Engineer", 110000, 145000, "Fullstack w/ Apparition"),
    ("tRPC", "Full Stack Developer", 85000, 115000, "Fullstack Resume w/ Ghosted"),
    ("Planetscale", "Software Engineer II", 120000, 155000, "Fullstack w/ Apparition"),
    ("Temporal", "Backend Engineer", 125000, 160000, "Fullstack Resume w/ Ghosted"),
    ("Fly.io", "Software Engineer", 115000, 150000, "Fullstack w/ Apparition"),
    ("Render", "Full Stack Engineer", 100000, 135000, "Fullstack Resume w/ Ghosted"),
    ("Cloudflare", "Software Engineer", 130000, 165000, "Fullstack w/ Apparition"),
    ("Twitch", "Software Engineer I", 110000, 160000, "Fullstack Resume w/ Ghosted"),
    ("Salesforce", "Junior Software Engineer", 90000, 120000, "Fullstack w/ Apparition"),
    ("HubSpot", "Software Engineer", 105000, 140000, "Fullstack Resume w/ Ghosted"),
    # Technical Art / Game Dev
    ("Electronic Arts", "Associate Technical Artist", 74000, 102000, "TA_general"),
    ("Ubisoft", "Technical Artist", 80000, 110000, "TA_general"),
    ("Riot Games", "Technical Artist I", 95000, 125000, "TA_general"),
    ("Bungie", "Associate Technical Artist", 85000, 115000, "TA_general"),
    ("Insomniac Games", "Technical Artist", 90000, 120000, "TA_general"),
    ("Naughty Dog", "Technical Artist", 95000, 130000, "TA_general"),
    ("Respawn Entertainment", "Associate TA", 80000, 110000, "TA_general"),
    ("DICE", "Technical Artist", 85000, 115000, "TA_general"),
    ("Rockstar Games", "Associate Technical Artist", 90000, 120000, "TA_general"),
    ("CD Projekt Red", "Technical Artist", 75000, 100000, "TA_general"),
    ("Guerrilla Games", "Technical Artist", 80000, 110000, "TA_general"),
    ("Playground Games", "Associate TA", 75000, 105000, "TA_general"),
    ("Scopely", "Technical Artist – Monopoly GO!", 91000, 140000, "TA_general"),
    ("Blackbird Interactive", "Technical Artist (12-month contract)", 85000, 115000, "TA_general"),
    ("Visual Concepts", "Associate Programmer", 80000, 110000, "TA_general"),
    ("2K Games", "Technical Artist", 85000, 115000, "TA_general"),
    ("Activision", "Associate Technical Artist", 80000, 110000, "TA_general"),
    ("Blizzard Entertainment", "Technical Artist I", 90000, 125000, "TA_general"),
    ("Epic Games", "Associate Technical Artist", 95000, 130000, "TA_general"),
    ("Unity Technologies", "Developer Relations Engineer", 100000, 135000, "TA_general"),
    ("Autodesk", "Technical Artist – Maya", 90000, 120000, "TA_general"),
    ("Side Effects Software", "Developer Advocate", 85000, 115000, "TA_general"),
    ("Roblox", "Technical Artist", 100000, 140000, "TA_general"),
    ("Niantic", "Technical Artist", 95000, 130000, "TA_general"),
    ("Zynga", "Technical Artist", 85000, 115000, "TA_general"),
    # Mixed / Other
    ("Figma", "Technical Artist – Design Tools", 110000, 145000, "TA_general"),
    ("Adobe", "Software Engineer", 120000, 155000, "Fullstack Resume w/ Ghosted"),
    ("Apple", "Software Engineer", 140000, 180000, "Fullstack w/ Apparition"),
    ("Tailscale", "Software Engineer", 115000, 150000, "Fullstack Resume w/ Ghosted"),
    ("Warp", "Software Engineer", 110000, 145000, "Fullstack w/ Apparition"),
    ("Zed", "Software Engineer", 100000, 135000, "Fullstack Resume w/ Ghosted"),
    ("Arc", "Software Engineer", 105000, 140000, "Fullstack w/ Apparition"),
    ("Liveblocks", "Full Stack Engineer", 95000, 125000, "Fullstack Resume w/ Ghosted"),
    ("Sanity", "Software Engineer", 100000, 135000, "Fullstack w/ Apparition"),
    ("Contentful", "Software Engineer", 105000, 140000, "Fullstack Resume w/ Ghosted"),
    ("Webflow", "Software Engineer", 115000, 150000, "Fullstack w/ Apparition"),
    ("Framer", "Software Engineer", 110000, 145000, "Fullstack Resume w/ Ghosted"),
    ("Stytch", "Backend Engineer", 110000, 145000, "Fullstack w/ Apparition"),
    ("Workos", "Software Engineer", 115000, 150000, "Fullstack Resume w/ Ghosted"),
    ("Descope", "Backend Engineer", 100000, 135000, "Fullstack w/ Apparition"),
    ("Lucia Auth", "Full Stack Developer", 85000, 115000, "Fullstack Resume w/ Ghosted"),
    ("Sentry", "Software Engineer", 115000, 150000, "Fullstack w/ Apparition"),
    ("Datadog", "Software Engineer", 125000, 165000, "Fullstack Resume w/ Ghosted"),
    ("Grafana Labs", "Software Engineer", 115000, 150000, "Fullstack w/ Apparition"),
    ("PagerDuty", "Software Engineer", 110000, 145000, "Fullstack Resume w/ Ghosted"),
    ("Incident.io", "Backend Engineer", 100000, 135000, "Fullstack w/ Apparition"),
    ("Atlassian", "Software Engineer", 115000, 150000, "Fullstack Resume w/ Ghosted"),
    ("Loom", "Full Stack Engineer", 110000, 145000, "Fullstack w/ Apparition"),
    ("Miro", "Software Engineer", 115000, 150000, "Fullstack Resume w/ Ghosted"),
    ("Monday.com", "Software Engineer", 110000, 145000, "Fullstack w/ Apparition"),
    ("Airtable", "Software Engineer", 120000, 160000, "Fullstack Resume w/ Ghosted"),
    ("Basecamp", "Software Developer", 95000, 125000, "Fullstack w/ Apparition"),
    ("Tradable Bits", "Software Engineer (Full Stack)", 85000, 100000, "Fullstack Resume w/ Ghosted"),
    ("Trulioo", "Junior Software Engineer", 80000, 90000, "Fullstack Resume w/ Ghosted"),
    ("Fix Network", "Junior Back-End Developer", 78000, 78000, "Fullstack Resume w/ Ghosted"),
    ("Saltworks Technologies", "Full Stack Developer", 85000, 110000, "Fullstack w/ Apparition"),
    ("Emercom Technologies", "Full Stack Developer", 80000, 100000, "Fullstack Resume w/ Ghosted"),
    ("Modo", "Software Developer", 58000, 65000, "Fullstack w/ Apparition"),
]

# Status distribution: realistic for a job hunt (mostly applied, some further along, some rejected)
STATUS_WEIGHTS = [
    ("applied", 38),
    ("rejected", 28),
    ("ghosted", 12),
    ("screening", 8),
    ("phone_interview", 6),
    ("technical_interview", 4),
    ("onsite", 2),
    ("offer", 1),
    ("withdrawn", 1),
]
STATUSES, WEIGHTS = zip(*STATUS_WEIGHTS)
PIPELINE_ORDER = ["applied", "screening", "phone_interview", "technical_interview", "onsite", "offer", "accepted"]
TERMINAL = {"rejected", "withdrawn", "ghosted", "accepted"}

def resume_id_for_label(label):
    for vid, lbl in RESUMES:
        if lbl == label:
            return vid
    return RESUMES[0][0]

def now_utc():
    return datetime.now(timezone.utc)

def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%S.000Z")

def build_status_history(final_status, applied_at, created_at):
    history = []
    if final_status in TERMINAL:
        # Walk through some pipeline stages before terminal
        if final_status == "ghosted":
            stages = ["applied"]
        elif final_status == "rejected":
            stages = random.choice([
                ["applied"],
                ["applied", "screening"],
                ["applied", "screening", "phone_interview"],
            ])
            stages.append("rejected")
        elif final_status == "withdrawn":
            stages = ["applied", "withdrawn"]
        else:
            stages = ["applied"]
    else:
        idx = PIPELINE_ORDER.index(final_status)
        stages = PIPELINE_ORDER[:idx + 1]

    t = applied_at
    for i, s in enumerate(stages):
        source = "created" if i == 0 else random.choice(["manual", "email_auto", "email_confirmed"])
        history.append({"status": {"S": s}, "at": {"S": iso(t)}, "source": {"S": source}})
        t += timedelta(days=random.randint(1, 7))

    return history

def build_app(company, role, sal_min, sal_max, resume_label, applied_at, status):
    app_id = str(uuid.uuid4())
    pk = f"USER#{DEV_SUB}"
    sk = f"APP#{app_id}"
    resume_version_id = resume_id_for_label(resume_label)

    now = now_utc()
    created_at = applied_at + timedelta(minutes=random.randint(5, 60))

    history = build_status_history(status, applied_at, created_at)
    last_history_time = datetime.fromisoformat(history[-1]["at"]["S"].replace("Z", "+00:00"))
    last_activity_at = last_history_time

    gsi1pk = f"USER#{DEV_SUB}"
    gsi1sk = f"STATUS#{status}#{iso(applied_at)}"
    gsi2pk = f"USER#{DEV_SUB}"
    gsi2sk = f"LAST_ACTIVITY#{iso(last_activity_at)}"

    item = {
        "PK": {"S": pk},
        "SK": {"S": sk},
        "appId": {"S": app_id},
        "company": {"S": company},
        "role": {"S": role},
        "status": {"S": status},
        "appliedAt": {"S": iso(applied_at)},
        "createdAt": {"S": iso(created_at)},
        "lastActivityAt": {"S": iso(last_activity_at)},
        "resumeVersionId": {"S": resume_version_id},
        "statusHistory": {"L": [{"M": h} for h in history]},
        "GSI1PK": {"S": gsi1pk},
        "GSI1SK": {"S": gsi1sk},
    }

    # Only non-ghosted apps get GSI2 keys (ghosted apps have them removed)
    if status != "ghosted":
        item["GSI2PK"] = {"S": gsi2pk}
        item["GSI2SK"] = {"S": gsi2sk}

    if sal_min and sal_max:
        item["salaryRange"] = {"M": {
            "min": {"N": str(sal_min)},
            "max": {"N": str(sal_max)},
            "currency": {"S": "USD"},
        }}

    if status == "ghosted":
        item["ghostedAt"] = {"S": iso(last_activity_at)}

    return item

def batch_write(client, items):
    remaining = {TABLE: [{"PutRequest": {"Item": it}} for it in items]}
    attempts = 0
    while remaining:
        attempts += 1
        resp = client.batch_write_item(RequestItems=remaining)
        remaining = resp.get("UnprocessedItems", {})
        if remaining:
            time.sleep(0.5 * attempts)

client = boto3.client("dynamodb", endpoint_url="http://localhost:8000", region_name="us-east-1",
                      aws_access_key_id="local", aws_secret_access_key="local")

# Delete existing APP# items for the dev user first
print("Clearing existing applications…")
resp = client.query(TableName=TABLE,
    KeyConditionExpression="PK = :pk AND begins_with(SK, :prefix)",
    ExpressionAttributeValues={":pk": {"S": f"USER#{DEV_SUB}"}, ":prefix": {"S": "APP#"}})
existing = resp["Items"]
if existing:
    for i in range(0, len(existing), 25):
        chunk = existing[i:i+25]
        client.batch_write_item(RequestItems={TABLE: [
            {"DeleteRequest": {"Key": {"PK": it["PK"], "SK": it["SK"]}}} for it in chunk
        ]})
print(f"  Removed {len(existing)} existing applications")

# Generate 100 apps spread over the last ~6 weeks
random.seed(42)
jobs_sample = random.choices(JOBS, k=100)
statuses_sample = random.choices(STATUSES, weights=WEIGHTS, k=100)

now = now_utc()
apps = []
for i, ((company, role, sal_min, sal_max, resume_label), status) in enumerate(zip(jobs_sample, statuses_sample)):
    days_ago = random.randint(1, 42)
    applied_at = now - timedelta(days=days_ago, hours=random.randint(0, 23), minutes=random.randint(0, 59))
    apps.append(build_app(company, role, sal_min, sal_max, resume_label, applied_at, status))

# Write in chunks of 25
for i in range(0, len(apps), 25):
    batch_write(client, apps[i:i+25])

status_counts = {}
for a in apps:
    s = a["status"]["S"]
    status_counts[s] = status_counts.get(s, 0) + 1

print(f"Seeded {len(apps)} applications:")
for s, c in sorted(status_counts.items(), key=lambda x: -x[1]):
    print(f"  {s}: {c}")
