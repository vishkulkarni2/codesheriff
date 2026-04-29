# GitHub App Setup — CodeSheriff

**Time required: ~5 minutes**

## Step 1: Re-authenticate gh CLI

```bash
export PATH=/opt/homebrew/bin:/usr/local/bin:$PATH
gh auth login -h github.com
# Choose: GitHub.com → HTTPS → Paste authentication token
# Generate a new token at: https://github.com/settings/tokens
```

## Step 2: Create the GitHub App

Go to: **https://github.com/settings/apps/new**

Fill in these exact values:

| Field | Value |
|---|---|
| **GitHub App name** | `CodeSheriff` (if taken, try `CodeSheriff-dev`) |
| **Homepage URL** | `https://codesheriff-marketing.vercel.app` |
| **Callback URL** | `https://app.thecodesheriff.com/api/github/callback` |
| **Setup URL** (optional) | `https://app.thecodesheriff.com/onboarding` |
| **Webhook URL** | `https://api.thecodesheriff.com/webhooks/github` |
| **Webhook secret** | `2b8846142071f6bfaf1753a08174a7ea87ed2d96` |

### Permissions (Repository):
- **Contents**: Read-only
- **Pull requests**: Read & write
- **Checks**: Read & write

### Permissions (Organization):
- None needed

### Subscribe to events:
- [x] Pull request
- [x] Push

### Where can this GitHub App be installed?
- **Any account** (for beta, allows external users)

## Step 3: After creation

1. **Note the App ID** — shown at the top of the app settings page
2. **Generate a private key** — click "Generate a private key" button at the bottom
   - A `.pem` file will be downloaded
   - This goes into `GITHUB_APP_PRIVATE_KEY` env var
3. **Note the App slug** — visible in the URL: `github.com/apps/<slug>`

## Step 4: Update .env.production

```bash
cd ~/.openclaw/workspace/codesheriff

# Set the App ID
sed -i '' 's/PLACEHOLDER_GITHUB_APP_ID/<your-app-id>/' .env.production

# Set the slug
sed -i '' 's/codesheriff-dev/<your-app-slug>/' .env.production

# For the private key, run this (replace path to your downloaded .pem):
KEY=$(cat ~/Downloads/codesheriff*.pem | tr '\n' '\\' | sed 's/\\/\\n/g')
# Then manually paste into .env.production as:
# GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

## Step 5: Install the app on vishkulkarni2 account

1. Go to `https://github.com/apps/<your-slug>/installations/new`
2. Select the `vishkulkarni2` account
3. Choose "Only select repositories" → pick a test repo
4. Click Install
