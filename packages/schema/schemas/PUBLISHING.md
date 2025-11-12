# Quick Start: Publishing to GHCR

## Prerequisites

1. **GitHub Personal Access Token** with `packages:write` permission
   - Go to GitHub Settings → Developer settings → Personal access tokens
   - Generate new token (classic) with `write:packages` scope

2. **Docker installed** and running on your machine

## Step 1: Set Environment Variables

```bash
export GITHUB_TOKEN=<your-token>
export GITHUB_ACTOR=<your-github-username>
export GITHUB_REPOSITORY_OWNER=openintent  # or your org name
```

## Step 2: Publish the Schema

### Option A: Using the Script (Recommended)

```bash
cd /Users/crystal/Developer/oiml/packages/schema
./scripts/publish-schema.sh oiml.intent 0.1.0
```

### Option B: Using Docker Directly

```bash
cd /Users/crystal/Developer/oiml/packages/schema/schemas/oiml.intent/0.1.0

# Build
docker build -t ghcr.io/openintent/schemas/oiml.intent:0.1.0 .
docker tag ghcr.io/openintent/schemas/oiml.intent:0.1.0 ghcr.io/openintent/schemas/oiml.intent:latest

# Login
echo $GITHUB_TOKEN | docker login ghcr.io -u $GITHUB_ACTOR --password-stdin

# Push
docker push ghcr.io/openintent/schemas/oiml.intent:0.1.0
docker push ghcr.io/openintent/schemas/oiml.intent:latest
```

## Step 3: Verify the Push

Visit: `https://github.com/orgs/openintent/packages?repo_name=oiml`

Or pull the image:

```bash
docker pull ghcr.io/openintent/schemas/oiml.intent:0.1.0
```

## Step 4: Make Package Public (First Time Only)

1. Go to the package page on GitHub
2. Click "Package settings"
3. Scroll to "Danger Zone"
4. Click "Change visibility" → Make public

## Troubleshooting

### Permission Denied

- Ensure your token has `write:packages` permission
- Make sure you're logged in: `docker login ghcr.io`

### Image Already Exists

If you need to republish the same version:

```bash
# Delete from GitHub first, then republish
# Or use a new version number
```

### Repository Not Found

Make sure `GITHUB_REPOSITORY_OWNER` matches your GitHub org/username:

```bash
export GITHUB_REPOSITORY_OWNER=openintent
```

## Automated Publishing (GitHub Actions)

Once you push to `main`, schemas are automatically published via GitHub Actions:

```bash
git add .
git commit -m "Update schema"
git push origin main
```

The workflow will:
1. Detect changed schemas
2. Build Docker images
3. Push to GHCR automatically

## Quick Commands

```bash
# Publish current version
cd /Users/crystal/Developer/oiml/packages/schema
export GITHUB_TOKEN=<token>
export GITHUB_ACTOR=<username>
./scripts/publish-schema.sh oiml.intent 0.1.0

# View published packages
open "https://github.com/orgs/openintent/packages"

# Pull published schema
docker pull ghcr.io/openintent/schemas/oiml.intent:0.1.0

# Extract files
docker create --name temp ghcr.io/openintent/schemas/oiml.intent:0.1.0
docker cp temp:/schema.json ./schema.json
docker cp temp:/schema.zod.js ./schema.zod.js
docker cp temp:/metadata.json ./metadata.json
docker rm temp
```















