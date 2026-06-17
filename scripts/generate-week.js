#!/usr/bin/env node
/**
 * Freejiji Weekly Content Generator
 * ===================================
 * Uses plain HTTP fetch (not headless Chrome) to get Kijiji's server-side rendered HTML,
 * then extracts structured listing data from the embedded __NEXT_DATA__ JSON.
 *
 * Usage:
 *   node generate-week.js            # Full run — writes to Firestore
 *   node generate-week.js --dry-run  # Test run — prints results, no Firestore writes
 *
 * Requirements:
 *   1. npm install  (in this scripts/ directory)
 *   2. scripts/service-account.json  (from Firebase Console → Service Accounts)
 */

'use strict';

const { load } = require('cheerio');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

// ─── Config ────────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const FIREBASE_PROJECT_ID = 'freejiji-4e401';
const ITEMS_PER_DAY = 10;
const DAYS_TO_GENERATE = 7;
const POOL_TARGET_PER_TYPE = 80;

const BANNED_KEYWORDS = ['pickup', 'pick up', 'pick-up', 'scrap', 'service', 'services'];
const EXCLUDED_PAID_URL_FRAGMENTS = ['/b-tickets', '/v-tickets', 'garage-sale', 'yard-sale', 'free-stuff', 'c17410'];

// Kijiji browse URLs (no sort param — browse pages default to newest)
const FREE_URL  = 'https://www.kijiji.ca/b-free-stuff/canada/c17410l0';
const PAID_URL  = 'https://www.kijiji.ca/b-buy-sell/canada/c10l0';

// ─── Request headers ───────────────────────────────────────────────────────────

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

// ─── Fetch helper ──────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return res.text();
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ─── Next.js data extraction ───────────────────────────────────────────────────

/**
 * Pulls the __NEXT_DATA__ JSON from Kijiji's SSR'd HTML.
 * Kijiji is a Next.js app — every page includes this script tag with all page data.
 */
function extractNextData(html) {
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">([\s\S]*?)<\/script>/);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch (e) {
    return null;
  }
}

/**
 * Navigates the pageProps object to find the listings array.
 * Kijiji's structure has changed over time; we try multiple paths.
 */
function findListingsArray(pageProps) {
  if (!pageProps) return [];

  const candidates = [
    pageProps.listings,
    pageProps.ads,
    pageProps.searchResults,
    pageProps.searchResults?.results,
    pageProps.listingResponse?.listings,
    pageProps.pageData?.ads,
    pageProps.srp?.listings,
    pageProps.initialState?.srp?.listings,
  ];

  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c;
  }

  // Debug: log available keys so we can update paths if needed
  console.log('  [debug] pageProps keys:', Object.keys(pageProps));
  return [];
}

// ─── Image proxy ───────────────────────────────────────────────────────────────

/**
 * Routes an image through wsrv.nl (open-source image proxy) to bypass
 * Kijiji's hotlink protection without re-hosting copyrighted images.
 */
function proxyImageUrl(originalUrl) {
  if (!originalUrl) return null;
  // Upgrade thumbnail to larger size (Kijiji uses eBay CDN)
  const bigUrl = originalUrl
    .replace(/\/s-l\d+(\.\w+)$/, '/s-l1200$1')
    .split('?')[0];
  return `https://wsrv.nl/?url=${encodeURIComponent(bigUrl)}&w=800&h=600&fit=cover&output=webp&q=80`;
}

// ─── Date helpers ──────────────────────────────────────────────────────────────

function isWithinTwoWeeks(dateVal) {
  if (!dateVal) return false;
  const d = new Date(dateVal);
  if (isNaN(d)) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  return d >= cutoff;
}

function getTorontoDateString(daysFromNow = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

// ─── Filtering ─────────────────────────────────────────────────────────────────

function hasBannedKeyword(title = '', description = '') {
  const combined = `${title} ${description}`.toLowerCase();
  return BANNED_KEYWORDS.some((kw) => combined.includes(kw));
}

function isExcludedPaidUrl(url = '') {
  return EXCLUDED_PAID_URL_FRAGMENTS.some((f) => url.toLowerCase().includes(f));
}

// ─── Parse a single raw listing from __NEXT_DATA__ ────────────────────────────

function parseListing(raw, type) {
  // ID
  const id = String(raw.id || raw.adId || `${Date.now()}-${Math.random().toString(36).slice(2)}`);

  // Text
  const title = (raw.title || '').trim();
  const description = (raw.description || raw.shortDescription || '').trim();

  // Price
  const priceObj = raw.price || {};
  const priceType = (priceObj.type || priceObj.priceType || '').toUpperCase();
  const priceAmount = parseFloat(priceObj.amount ?? priceObj.value ?? 0) || 0;
  const isFree = type === 'free' || priceType === 'FREE' || priceAmount === 0;
  const actualPrice = isFree ? 0 : priceAmount;

  // Image — first image from the images array
  const images = raw.images || raw.imageUrls || [];
  const firstImg = Array.isArray(images) ? images[0] : null;
  const imgUri = (typeof firstImg === 'string' ? firstImg : firstImg?.uri || firstImg?.url || '');
  const image = proxyImageUrl(imgUri);

  // URL
  const seoUrl = raw.seoUrl || raw.url || raw.adUrl || '';
  const listingUrl = seoUrl.startsWith('http') ? seoUrl : `https://www.kijiji.ca${seoUrl}`;

  // Location
  const addr = raw.adAddress || raw.location || {};
  const location = [addr.city, addr.province].filter(Boolean).join(', ') || 'Canada';

  // Date
  const dateStr = raw.activationDate || raw.postingDate || raw.sortingDate || raw.postedDate || '';

  return { id, title, description, image, actualPrice, isFree, listingUrl, location, dateStr };
}

// ─── Scrape one page ───────────────────────────────────────────────────────────

async function scrapePage(baseUrl, pageNum, type) {
  const url = pageNum > 1 ? `${baseUrl}?page=${pageNum}` : baseUrl;
  console.log(`  📄 Page ${pageNum}: ${url}`);

  const html = await fetchPage(url);
  const nextData = extractNextData(html);

  if (!nextData) {
    // Save debug file so we can inspect
    const debugPath = path.join(__dirname, `debug-page-${type}-p${pageNum}.html`);
    fs.writeFileSync(debugPath, html);
    console.warn(`  ⚠️  No __NEXT_DATA__ found. Saved HTML → ${debugPath}`);
    console.warn('     This usually means Kijiji returned an error or CAPTCHA page.');
    return { items: [], hasNext: false };
  }

  const pp = nextData?.props?.pageProps;
  const rawListings = findListingsArray(pp);
  console.log(`  Found ${rawListings.length} raw listings in __NEXT_DATA__`);

  if (rawListings.length === 0) {
    // Log the full pageProps structure for debugging
    const debugPath = path.join(__dirname, `debug-nextdata-${type}-p${pageNum}.json`);
    fs.writeFileSync(debugPath, JSON.stringify(pp, null, 2));
    console.warn(`  ⚠️  Listings array empty. Saved pageProps → ${debugPath}`);
  }

  // Detect pagination
  const pagination = pp?.pagination || pp?.searchResults?.pagination || {};
  const currentPage = pagination.currentPage || pagination.current || pageNum;
  const totalPages = pagination.totalPages || pagination.total || 1;
  const hasNext = currentPage < totalPages;

  return { rawListings, hasNext };
}

// ─── Scrape full pool ──────────────────────────────────────────────────────────

async function scrapePool(baseUrl, type, targetCount) {
  const items = [];
  const seenIds = new Set();
  let page = 1;

  while (items.length < targetCount && page <= 10) {
    let rawListings, hasNext;

    try {
      ({ rawListings = [], hasNext = false } = await scrapePage(baseUrl, page, type));
    } catch (err) {
      console.error(`  ❌ Error fetching page ${page}: ${err.message}`);
      break;
    }

    for (const raw of rawListings) {
      const listing = parseListing(raw, type);

      // Dedup
      if (seenIds.has(listing.id)) continue;

      // Validate
      if (!listing.title || listing.title.length < 5) continue;
      if (!listing.image) continue;
      if (!listing.listingUrl.includes('kijiji.ca')) continue;
      if (!isWithinTwoWeeks(listing.dateStr)) continue;
      if (hasBannedKeyword(listing.title, listing.description)) continue;
      if (type === 'paid' && isExcludedPaidUrl(listing.listingUrl)) continue;

      seenIds.add(listing.id);
      items.push(listing);
    }

    console.log(`  Pool so far: ${items.length} valid items`);

    if (!hasNext) break;
    page++;

    // Polite delay between pages
    await sleep(1000 + Math.random() * 1500);
  }

  return items;
}

// ─── Firebase Admin ────────────────────────────────────────────────────────────

function initFirebase() {
  const svcPath = path.join(__dirname, 'service-account.json');
  if (!fs.existsSync(svcPath)) {
    console.error('\n❌ Missing service-account.json\n');
    console.error('  Download from: https://console.firebase.google.com/project/freejiji-4e401/settings/serviceaccounts/adminsdk');
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
  const available = pool.filter((i) => !usedIds.has(i.id));
  return available.length > 0 ? available[Math.floor(Math.random() * available.length)] : null;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎮  Freejiji Weekly Content Generator');
  console.log(`📅  Generating ${DAYS_TO_GENERATE} days (Toronto time)`);
  if (DRY_RUN) console.log('🧪  DRY RUN — nothing will be written to Firestore\n');

  let db;
  if (!DRY_RUN) {
    db = initFirebase();
    console.log('✅  Firebase connected\n');
  }

  // ── Scrape pools ──
  console.log('🆓  Scraping FREE items (Kijiji Free Stuff, Canada-wide)...');
  const freePool = await scrapePool(FREE_URL, 'free', POOL_TARGET_PER_TYPE);
  console.log(`✅  Free pool: ${freePool.length} items\n`);

  console.log('💰  Scraping PAID items (Kijiji Buy & Sell, Canada-wide)...');
  const paidPool = await scrapePool(PAID_URL, 'paid', POOL_TARGET_PER_TYPE);
  console.log(`✅  Paid pool: ${paidPool.length} items\n`);

  if (freePool.length < 10) {
    console.error('❌  Too few free items scraped. Check the debug files.');
    process.exit(1);
  }
  if (paidPool.length < 10) {
    console.error('❌  Too few paid items scraped. Check the debug files.');
    process.exit(1);
  }

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

      // Fallback to other type if pool is exhausted
      if (!item) {
        item = pickRandom(!wantFree ? freePool : paidPool, !wantFree ? usedFreeIds : usedPaidIds);
      }
      if (!item) continue;

      (item.isFree ? usedFreeIds : usedPaidIds).add(item.id);
      const { dateStr: _ds, ...cleanItem } = item; // Remove internal dateStr field
      dayItems.push({ ...cleanItem, id: `${dateStr}-slot${slot + 1}` });
    }

    const freeCount = dayItems.filter((i) => i.isFree).length;
    const paidCount = dayItems.filter((i) => !i.isFree).length;
    console.log(`  ${dateStr}: ${dayItems.length} items (${freeCount} free / ${paidCount} paid)`);
    generatedDays.push({ date: dateStr, items: dayItems });
  }

  const unusedFree = freePool.filter((i) => !usedFreeIds.has(i.id));
  const unusedPaid = paidPool.filter((i) => !usedPaidIds.has(i.id));
  console.log(`\n  Swap pool: ${unusedFree.length} free + ${unusedPaid.length} paid available`);

  // ── Dry run output ──
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
  console.log('\n🎨  Open scripts/preview-tool.html in your browser to review and approve!\n');
}

main().catch((err) => {
  console.error('\n💥  Fatal error:', err);
  process.exit(1);
});
