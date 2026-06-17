# Freejiji Scripts

Weekly content generation tools for the Freejiji daily game.

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

> ⚠️ If you see "No listing cards found!" errors, Kijiji may have updated their HTML structure.
> Check the saved `debug-page-*.html` files and update the `CARD_SELECTORS` array in `generate-week.js`.

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
