# Freejiji Scripts

Weekly content generation tools for the Freejiji daily game.

## Automatic weekly updates

The GitHub Actions workflow at `.github/workflows/generate-content.yml` runs every
Tuesday at 09:00 UTC (4am EST / 5am EDT). It generates and publishes the seven
games from Wednesday through Tuesday, so the next week is ready a day early.

One-time GitHub setup:

1. Open the repository's **Settings → Secrets and variables → Actions** page.
2. Create a repository secret named **`FIREBASE_SERVICE_ACCOUNT`**.
3. Paste the complete contents of the Firebase service-account JSON file as its value.

The workflow can also be run from **Actions → Weekly Content Generation → Run
workflow**. Keep the offset at `0` to fill the next seven days immediately. Scheduled
runs use an offset of `1` automatically.

The generator is idempotent: ready days are never replaced unless `--force` is
explicitly supplied. It also rejects incomplete weeks and avoids reusing listings
from recent or already-scheduled games.

## Setup (one time)

```bash
cd scripts
npm install
```

Then download your Firebase service account key:
1. Go to [Firebase Console → Project Settings → Service Accounts](https://console.firebase.google.com/project/freejiji-4e401/settings/serviceaccounts/adminsdk)
2. Click **"Generate new private key"**
3. Save the file as **`scripts/service-account.json`** (already git-ignored)

---

## Weekly workflow

### Step 1 — Generate content

```bash
cd scripts
node generate-week.js
```

This scrapes Kijiji for the next 7 days of content and saves it to Firestore as **drafts**.

Want to test without writing to Firestore?
```bash
node generate-week.js --dry-run
```

To test the scraper even when all seven target days are already ready:
```bash
node generate-week.js --dry-run --force
```

> ⚠️ If you see "No __NEXT_DATA__ script block found" errors, Kijiji may have
> updated its page data. Inspect the saved `debug-page-error.html` file and update
> `fetchSearchPage()` in `generate-week.js`.

---

### Step 2 — Preview & curate

Open the preview tool in your browser:
```bash
open scripts/preview-tool.html
# or on Linux: xdg-open scripts/preview-tool.html
```

For each day:
- 📸 Review images and text
- 🔄 Click **Swap** on any item you don't like to replace it with a random pool item
- ✅ Click **Approve Day** when you're happy with that day's lineup

---

### Step 3 — Deploy Firestore rules (if changed)

```bash
cd ..
npx -y firebase-tools@latest deploy --only firestore:rules
```

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| "No listing cards found" | Kijiji updated their HTML. Open `debug-page-*.html` and inspect the listing card structure. Update `CARD_SELECTORS` in `generate-week.js`. |
| Images not loading in preview tool | wsrv.nl may be rate-limiting. Try refreshing or check the original Kijiji URL via the "View ↗" button. |
| Firebase permission denied | Make sure `service-account.json` is present and belongs to the `freejiji-4e401` project. |
