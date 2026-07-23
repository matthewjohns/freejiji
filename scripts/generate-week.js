#!/usr/bin/env node
/**
 * Freejiji Weekly Content Generator
 * ===================================
 * Fetches listings from Kijiji's public search pages (SSR HTML)
 * and extracts the listings from the embedded __NEXT_DATA__ JSON.
 *
 * Usage:
 *   node generate-week.js                 # Full run — writes to Firestore
 *   node generate-week.js --dry-run       # Test run — no Firestore writes
 *   node generate-week.js --force         # Regenerate ALL days, even approved ones
 *   node generate-week.js --auto-approve  # Auto-approve generated days (status: 'ready')
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

const DRY_RUN      = process.argv.includes('--dry-run');
const FORCE        = process.argv.includes('--force');
const AUTO_APPROVE = process.argv.includes('--auto-approve');
const offsetArg    = process.argv.find(a => a.startsWith('--offset='));
const OFFSET       = offsetArg ? Number(offsetArg.slice('--offset='.length)) : 0;

if (!Number.isInteger(OFFSET) || OFFSET < 0) {
  console.error('\n❌ --offset must be a non-negative whole number (for example, --offset=1).');
  process.exit(1);
}
const FIREBASE_PROJECT_ID = 'freejiji-4e401';
const ITEMS_PER_DAY = 10;
const DAYS_TO_GENERATE = 7;
const POOL_TARGET_PER_TYPE = 80;

// Kijiji category IDs
const CATEGORY_FREE_STUFF = 17220001;
const CATEGORY_BUY_SELL = 10;

// Category IDs to exclude from paid results (tickets=104, garage sales=272, free stuff=17220001)
const EXCLUDED_PAID_CATEGORY_IDS = new Set([104, 272, 17220001]);

// Common Kijiji posts that are not suitable game items. These are matched as
// complete words/phrases, so a blacklist term such as "rates" will not reject
// an unrelated word such as "crates".
const BANNED_KEYWORDS = [
  'pickup', 'pick up', 'pick-up',
  'scrap',
  'service', 'services', 'repair', 'repairs',
  'free setup', 'month free', 'months free', 'no credit check',
  'trial period', 'no obligation', 'customized survey', 'customized surveys', 'mudding',
  'looking for', 'in search of', 'in need of', 'iso', 'recherche',
  'puppy', 'puppies', 'kitten', 'kittens', 'golden retriever',
  'goldfish', 'minnow', 'minnows', 'rehome', 'rehoming',
];

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

function getCleanImageUrl(originalUrl) {
  if (!originalUrl) return null;
  let cleanUrl = originalUrl;
  if (cleanUrl.includes('media.kijiji.ca')) {
    const baseUrl = cleanUrl.split('?')[0];
    cleanUrl = `${baseUrl}?rule=kijijica-640-webp`;
  } else {
    cleanUrl = cleanUrl.replace(/\/s-l\d+(\.\w+)$/, '/s-l1200$1').split('?')[0];
  }
  return cleanUrl;
}

function proxyImageUrl(originalUrl) {
  const cleanUrl = getCleanImageUrl(originalUrl);
  if (!cleanUrl) return null;
  return `https://wsrv.nl/?url=${encodeURIComponent(cleanUrl)}&w=800&h=600&fit=inside&output=webp&q=80`;
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

// Check for banned keywords (both hardcoded and dynamic remote blacklist)
let remoteBannedKeywords = [];

function getBannedKeywordMatch(title = '', description = '') {
  const combined = `${title} ${description}`;
  const allBanned = [...BANNED_KEYWORDS, ...remoteBannedKeywords];
  return allBanned.find(keyword => {
    const trimmed = String(keyword).trim();
    if (!trimmed) return false;

    const escaped = trimmed.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const startsWithWord = /^[a-z0-9]/i.test(trimmed);
    const endsWithWord = /[a-z0-9]$/i.test(trimmed);
    const pattern = `${startsWithWord ? '\\b' : ''}${escaped}${endsWithWord ? '\\b' : ''}`;
    return new RegExp(pattern, 'i').test(combined);
  });
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
  const rawImage = getCleanImageUrl(images[0]);
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

  return { id, title, description, image, rawImage, actualPrice, isFree, listingUrl, location, dateStr, adSource, categoryId };
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
      const matchedKeyword = getBannedKeywordMatch(listing.title, listing.description);
      if (matchedKeyword) {
        console.log(`  🚫 Skipped "${listing.title}" due to blacklisted keyword "${matchedKeyword}"`);
        continue;
      }

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
  let serviceAccount;

  if (process.env.FIREBASE_SERVICE_ACCOUNT) {
    try {
      serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
    } catch (err) {
      throw new Error(`FIREBASE_SERVICE_ACCOUNT is not valid JSON: ${err.message}`);
    }
  } else if (fs.existsSync(svcPath)) {
    serviceAccount = JSON.parse(fs.readFileSync(svcPath, 'utf8'));
  } else {
    console.error('\n❌ Missing service-account.json');
    console.error('  Download: https://console.firebase.google.com/project/freejiji-4e401/settings/serviceaccounts/adminsdk');
    console.error('  For automation, set the FIREBASE_SERVICE_ACCOUNT environment variable instead.');
    process.exit(1);
  }

  if (serviceAccount.project_id && serviceAccount.project_id !== FIREBASE_PROJECT_ID) {
    throw new Error(
      `Firebase credential is for project "${serviceAccount.project_id}", expected "${FIREBASE_PROJECT_ID}".`
    );
  }

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
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
  console.log(`📅  Generating ${DAYS_TO_GENERATE} days starting from day ${OFFSET} (Toronto time)`);
  if (DRY_RUN)      console.log('🧪  DRY RUN — nothing written to Firestore\n');
  if (FORCE)        console.log('⚠️   FORCE mode — will overwrite approved days too\n');
  if (AUTO_APPROVE) console.log('✅  AUTO-APPROVE — generated days will be set to "ready" immediately\n');
  if (OFFSET)       console.log(`⏩   OFFSET mode — starting from day +${OFFSET}\n`);

  const db = initFirebase();
  console.log('✅  Firebase connected\n');

  // Load dynamic blacklist from Firestore
  try {
    const blacklistDoc = await db.collection('item_pool').doc('blacklist').get();
    if (blacklistDoc.exists) {
      remoteBannedKeywords = blacklistDoc.data().keywords || [];
      console.log(`Loaded ${remoteBannedKeywords.length} dynamic banned keywords from Firestore:`, remoteBannedKeywords);
    } else {
      console.log('No dynamic blacklist found in Firestore (will use defaults).');
    }
  } catch (err) {
    console.error('Failed to load blacklist from Firestore:', err.message);
  }

  // ── Pre-check Firestore: find which dates are already approved ──
  // Do this BEFORE scraping so we can skip expensive Kijiji requests if not needed.
  console.log('🔍  Checking existing Firestore content...');
  const allTargetDates = Array.from({ length: DAYS_TO_GENERATE }, (_, d) => getTorontoDateString(d + OFFSET));
  const approvedDays    = []; // already approved — will be left untouched
  const datesToGenerate = []; // need scraping/generation
  const usedListingUrls = new Set(); // dedup against recent, approved, and newly generated games

  // Read recent and future games once so listings are not repeated week-to-week.
  // If this read fails, abort rather than risk replacing approved content.
  const recentStart = getTorontoDateString(-14);
  const existingSnapshot = await db.collection('daily_games')
    .where('date', '>=', recentStart)
    .get();
  const existingByDate = new Map(existingSnapshot.docs.map(doc => [doc.id, doc.data()]));

  for (const data of existingByDate.values()) {
    (data.items || []).forEach(item => {
      if (item.listingUrl) usedListingUrls.add(item.listingUrl);
    });
  }

  for (const date of allTargetDates) {
    const data = existingByDate.get(date);
    if (data?.status === 'ready' && !FORCE) {
      console.log(`  ✅  ${date} already approved — skipping`);
      approvedDays.push(data);
    } else {
      if (data?.status === 'ready' && FORCE) {
        console.log(`  ⚠️   ${date} is approved but --force is set — will regenerate`);
      } else {
        console.log(`  📝  ${date} needs generation`);
      }
      datesToGenerate.push(date);
    }
  }

  if (datesToGenerate.length === 0) {
    console.log('\n✅  All 7 days are already approved. Nothing to generate.');
    console.log('    Run with --force to regenerate approved days anyway.\n');
    return;
  }

  console.log(`\n📋  Will generate ${datesToGenerate.length} of ${DAYS_TO_GENERATE} day(s). Scraping now...\n`);

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

  // ── Build days (only those that need generation) ──
  const usedFreeIds = new Set();
  const usedPaidIds = new Set();
  const generatedDays = [];

  // Also exclude IDs of any item already used in an approved day
  // (map listingUrl → id not available here; URL dedup is enough for pool filtering)
  const poolFreeFiltered = freePool.filter(i => !usedListingUrls.has(i.listingUrl));
  const poolPaidFiltered = paidPool.filter(i => !usedListingUrls.has(i.listingUrl));
  const itemsNeeded = datesToGenerate.length * ITEMS_PER_DAY;

  if (poolFreeFiltered.length + poolPaidFiltered.length < itemsNeeded) {
    throw new Error(
      `Only ${poolFreeFiltered.length + poolPaidFiltered.length} unique listings remain after deduplication; ` +
      `${itemsNeeded} are required. No content was written.`
    );
  }

  console.log(`📅  Building daily item sets (${datesToGenerate.length} days)...\n`);

  for (const dateStr of datesToGenerate) {
    const dayItems = [];

    for (let slot = 0; slot < ITEMS_PER_DAY; slot++) {
      const wantFree = Math.random() < 0.5;
      let item = pickRandom(wantFree ? poolFreeFiltered : poolPaidFiltered, wantFree ? usedFreeIds : usedPaidIds);
      if (!item) item = pickRandom(!wantFree ? poolFreeFiltered : poolPaidFiltered, !wantFree ? usedFreeIds : usedPaidIds);
      if (!item) continue;

      (item.isFree ? usedFreeIds : usedPaidIds).add(item.id);
      dayItems.push({ ...item, id: `${dateStr}-slot${slot + 1}` });
    }

    const freeCount = dayItems.filter(i => i.isFree).length;
    const paidCount = dayItems.filter(i => !i.isFree).length;
    console.log(`  ${dateStr}: ${dayItems.length} items (${freeCount} free / ${paidCount} paid)`);

    if (dayItems.length !== ITEMS_PER_DAY) {
      throw new Error(
        `${dateStr} received ${dayItems.length} items instead of ${ITEMS_PER_DAY}. No content was written.`
      );
    }

    generatedDays.push({ date: dateStr, items: dayItems });
  }

  const unusedFree = poolFreeFiltered.filter(i => !usedFreeIds.has(i.id));
  const unusedPaid = poolPaidFiltered.filter(i => !usedPaidIds.has(i.id));
  console.log(`\n  Swap pool: ${unusedFree.length} free + ${unusedPaid.length} paid remaining`);

  if (DRY_RUN) {
    console.log('\n🧪  DRY RUN — sample day 1:');
    console.log(JSON.stringify(generatedDays[0], null, 2));
    if (approvedDays.length > 0) {
      console.log(`\n  (${approvedDays.length} already-approved day(s) would be skipped)`);
    }
    console.log('\n✅  Done. Nothing was written to Firestore.\n');
    return;
  }

  // ── Write to Firestore (only newly generated days) ──
  console.log('\n💾  Writing to Firestore...');
  const batch = db.batch();

  const writeStatus = AUTO_APPROVE ? 'ready' : 'draft';
  for (const day of generatedDays) {
    batch.set(db.collection('daily_games').doc(day.date), {
      date: day.date,
      items: day.items,
      status: writeStatus,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
  }

  batch.set(db.collection('item_pool').doc('latest'), {
    freeItems: unusedFree,
    paidItems: unusedPaid,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  console.log(`\n✅  ${generatedDays.length} day(s) written to Firestore as "${writeStatus}"`);
  if (approvedDays.length > 0) {
    console.log(`✅  ${approvedDays.length} already-approved day(s) left untouched`);
  }
  console.log('✅  Swap pool saved');
  if (AUTO_APPROVE) {
    console.log('\n🚀  Generated content is live.\n');
  } else {
    console.log('\n🎨  Open scripts/preview-tool.html to review and approve!\n');
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('\n💥  Fatal error:', err);
    process.exit(1);
  });
}

module.exports = { getBannedKeywordMatch };
