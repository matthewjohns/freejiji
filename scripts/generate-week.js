#!/usr/bin/env node
/**
 * Freejiji Weekly Content Generator
 * ===================================
 * Fetches listings from Kijiji's public search pages (SSR HTML)
 * and extracts the listings from the embedded __NEXT_DATA__ JSON.
 *
 * Usage:
 *   node generate-week.js            # Full run — writes to Firestore
 *   node generate-week.js --dry-run  # Test run — no Firestore writes
 *
 * Requirements:
 *   1. npm install  (in this scripts/ directory)
 *   2. scripts/service-account.json  (from Firebase Console → Service Accounts)
 */

'use strict';

const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const FIREBASE_PROJECT_ID = 'freejiji-4e401';
const ITEMS_PER_DAY = 10;
const DAYS_TO_GENERATE = 7;
const POOL_TARGET_PER_TYPE = 80;

// Kijiji category IDs
const CATEGORY_FREE_STUFF = 17220001;
const CATEGORY_BUY_SELL = 10;

// Category IDs to exclude from paid results (tickets=104, garage sales=272, free stuff=17220001)
const EXCLUDED_PAID_CATEGORY_IDS = new Set([104, 272, 17220001]);

const BANNED_KEYWORDS = ['pickup', 'pick up', 'pick-up', 'scrap', 'service', 'services'];

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
  'Accept-Language': 'en-CA,en-US;q=0.9,en;q=0.8',
  'Cache-Control': 'max-age=0',
  'Referer': 'https://www.kijiji.ca/',
  'sec-ch-ua': '"Not)A;Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
  'sec-ch-ua-mobile': '?0',
  'sec-ch-ua-platform': '"macOS"',
  'sec-fetch-dest': 'document',
  'sec-fetch-mode': 'navigate',
  'sec-fetch-site': 'same-origin',
  'Upgrade-Insecure-Requests': '1',
};

// ─── Image proxy (wsrv.nl) ────────────────────────────────────────────────────

function proxyImageUrl(originalUrl) {
  if (!originalUrl) return null;
  let cleanUrl = originalUrl;
  if (cleanUrl.includes('media.kijiji.ca')) {
    cleanUrl = cleanUrl.split('?')[0];
  } else {
    cleanUrl = cleanUrl.replace(/\/s-l\d+(\.\w+)$/, '/s-l1200$1').split('?')[0];
  }
  return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&w=800&h=600&fit=cover&output=webp&q=80`;
}

// ─── Filtering ─────────────────────────────────────────────────────────────────

function isWithinTwoWeeks(dateStr) {
  if (!dateStr) return false;
  const d = new Date(dateStr);
  if (isNaN(d)) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  return d >= cutoff;
}

// Check for banned keywords
function hasBannedKeyword(title = '', description = '') {
  const combined = `${title} ${description}`.toLowerCase();
  return BANNED_KEYWORDS.some(kw => combined.includes(kw));
}

// ─── Scrape a pool of items ────────────────────────────────────────────────────

async function fetchSearchPage(baseUrl, page) {
  let url;
  if (page > 1) {
    const parts = baseUrl.split('/c');
    const categoryPart = 'c' + parts.pop();
    const prefix = parts.join('/c');
    url = `${prefix}/page-${page}/${categoryPart}?sort=dateDesc`;
  } else {
    url = `${baseUrl}?sort=dateDesc`;
  }
  console.log(`  📡 GET ${url}`);

  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} — ${res.statusText}`);
  }

  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) {
    // Save debug page
    fs.writeFileSync(path.join(__dirname, `debug-page-error.html`), html);
    throw new Error('No __NEXT_DATA__ script block found in HTML (saved debug-page-error.html)');
  }

  const nextData = JSON.parse(match[1]);
  const pageProps = nextData.props?.pageProps;
  if (!pageProps) {
    throw new Error('No pageProps found in __NEXT_DATA__');
  }

  return pageProps.__APOLLO_STATE__ || {};
}

function parseListing(raw, type) {
  const id = raw.id || '';
  const title = (raw.title || '').trim();
  const description = (raw.description || '').trim();

  // Price
  const priceObj = raw.price || {};
  const priceAmount = (priceObj.amount || 0) / 100;
  const isFree = type === 'free' || !raw.price || priceAmount === 0;
  const actualPrice = isFree ? 0 : priceAmount;

  // Image
  const images = raw.imageUrls || [];
  const image = proxyImageUrl(images[0]);

  // URL
  const listingUrl = raw.url || '';

  // Location
  const location = raw.location?.name || 'Canada';

  // Date
  const dateStr = raw.activationDate || raw.sortingDate || '';

  // Promotion/Source info
  const adSource = raw.adSource || 'ORGANIC';

  // Category ID
  const categoryId = raw.categoryId || 0;

  return { id, title, description, image, actualPrice, isFree, listingUrl, location, dateStr, adSource, categoryId };
}

async function scrapePool(baseUrl, type, targetCount) {
  const items = [];
  const seenIds = new Set();
  let page = 1;

  while (items.length < targetCount && page <= 15) {
    let apollo;
    try {
      apollo = await fetchSearchPage(baseUrl, page);
    } catch (err) {
      console.error(`  ❌ Error fetching page ${page}: ${err.message}`);
      break;
    }

    // Extract all StandardListing objects from Apollo cache
    const rawListings = Object.values(apollo).filter(v => v.__typename === 'StandardListing');
    console.log(`  Found ${rawListings.length} raw listings on page ${page}`);

    if (rawListings.length === 0) {
      // Save debug file
      const debugPath = path.join(__dirname, `debug-apollo-${type}-p${page}.json`);
      fs.writeFileSync(debugPath, JSON.stringify(apollo, null, 2));
      console.warn(`  ⚠️  No StandardListings found in Apollo cache. Saved response → ${debugPath}`);
      break;
    }

    for (const raw of rawListings) {
      const listing = parseListing(raw, type);

      // Dedup
      if (seenIds.has(listing.id)) continue;

      // Validate basic fields
      if (!listing.id || !listing.title || listing.title.length < 5) continue;
      if (!listing.image) continue;
      if (!listing.listingUrl.includes('kijiji.ca')) continue;

      // Exclude promoted/sponsored ads if adSource is not ORGANIC
      if (listing.adSource !== 'ORGANIC') continue;

      // Date check (last 1-2 weeks)
      if (!isWithinTwoWeeks(listing.dateStr)) continue;

      // Banned keywords check
      if (hasBannedKeyword(listing.title, listing.description)) continue;

      // Category exclusions for paid items
      if (type === 'paid') {
        if (EXCLUDED_PAID_CATEGORY_IDS.has(listing.categoryId)) continue;
        if (listing.actualPrice <= 0) continue; // paid items must have positive price
      }

      seenIds.add(listing.id);
      
      // Remove internal fields before adding to pool
      const { dateStr, adSource, categoryId, ...cleanListing } = listing;
      items.push(cleanListing);
    }

    console.log(`  Pool so far: ${items.length} valid items`);
    if (items.length >= targetCount) break;

    page++;
    await new Promise(r => setTimeout(r, 1000 + Math.random() * 1000)); // Polite delay
  }

  return items;
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function getTorontoDateString(daysFromNow = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// ─── Firebase Admin ────────────────────────────────────────────────────────────

function initFirebase() {
  const svcPath = path.join(__dirname, 'service-account.json');
  if (!fs.existsSync(svcPath)) {
    console.error('\n❌ Missing service-account.json');
    console.error('  Download: https://console.firebase.google.com/project/freejiji-4e401/settings/serviceaccounts/adminsdk');
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(svcPath)),
    projectId: FIREBASE_PROJECT_ID,
  });
  return admin.firestore();
}

// ─── Day building ──────────────────────────────────────────────────────────────

function pickRandom(pool, usedIds) {
  const available = pool.filter(i => !usedIds.has(i.id));
  return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : null;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎮  Freejiji Weekly Content Generator');
  console.log(`📅  Generating ${DAYS_TO_GENERATE} days starting tomorrow (Toronto time)`);
  if (DRY_RUN) console.log('🧪  DRY RUN — nothing written to Firestore\n');

  let db;
  if (!DRY_RUN) {
    db = initFirebase();
    console.log('✅  Firebase connected\n');
  }

  // ── Scrape FREE pool ──
  console.log('🆓  Scraping FREE items (Kijiji Free Stuff, Canada)...');
  const FREE_URL = 'https://www.kijiji.ca/b-free-stuff/canada/c17220001l0';
  const freePool = await scrapePool(FREE_URL, 'free', POOL_TARGET_PER_TYPE);
  console.log(`✅  Free pool: ${freePool.length} items\n`);

  // ── Scrape PAID pool ──
  console.log('💰  Scraping PAID items (Kijiji Buy & Sell, Canada)...');
  const PAID_URL = 'https://www.kijiji.ca/b-buy-sell/canada/c10l0';
  const paidPool = await scrapePool(PAID_URL, 'paid', POOL_TARGET_PER_TYPE);
  console.log(`✅  Paid pool: ${paidPool.length} items\n`);

  if (freePool.length < 10) { console.error('❌  Too few free items. Check debug files.'); process.exit(1); }
  if (paidPool.length < 10) { console.error('❌  Too few paid items. Check debug files.'); process.exit(1); }

  // ── Build 7 days ──
  const usedFreeIds = new Set();
  const usedPaidIds = new Set();
  const generatedDays = [];

  console.log('📅  Building daily item sets...\n');

  for (let d = 1; d <= DAYS_TO_GENERATE; d++) {
    const dateStr = getTorontoDateString(d);
    const dayItems = [];

    for (let slot = 0; slot < ITEMS_PER_DAY; slot++) {
      const wantFree = Math.random() < 0.5;
      let item = pickRandom(wantFree ? freePool : paidPool, wantFree ? usedFreeIds : usedPaidIds);
      if (!item) item = pickRandom(!wantFree ? freePool : paidPool, !wantFree ? usedFreeIds : usedPaidIds);
      if (!item) continue;

      (item.isFree ? usedFreeIds : usedPaidIds).add(item.id);
      dayItems.push({ ...item, id: `${dateStr}-slot${slot + 1}` });
    }

    const freeCount = dayItems.filter(i => i.isFree).length;
    const paidCount = dayItems.filter(i => !i.isFree).length;
    console.log(`  ${dateStr}: ${dayItems.length} items (${freeCount} free / ${paidCount} paid)`);
    generatedDays.push({ date: dateStr, items: dayItems });
  }

  const unusedFree = freePool.filter(i => !usedFreeIds.has(i.id));
  const unusedPaid = paidPool.filter(i => !usedPaidIds.has(i.id));
  console.log(`\n  Swap pool: ${unusedFree.length} free + ${unusedPaid.length} paid remaining`);

  if (DRY_RUN) {
    console.log('\n🧪  DRY RUN — sample day 1:');
    console.log(JSON.stringify(generatedDays[0], null, 2));
    console.log('\n✅  Done. Nothing was written to Firestore.\n');
    return;
  }

  // ── Write to Firestore ──
  console.log('\n💾  Writing to Firestore...');
  const batch = db.batch();

  for (const day of generatedDays) {
    batch.set(db.collection('daily_games').doc(day.date), {
      date: day.date,
      items: day.items,
      status: 'draft',
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  batch.set(db.collection('item_pool').doc('latest'), {
    freeItems: unusedFree,
    paidItems: unusedPaid,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  console.log(`\n✅  ${generatedDays.length} days written to Firestore as "draft"`);
  console.log('✅  Swap pool saved');
  console.log('\n🎨  Open scripts/preview-tool.html to review and approve!\n');
}

main().catch(err => {
  console.error('\n💥  Fatal error:', err);
  process.exit(1);
});
