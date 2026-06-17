#!/usr/bin/env node
/**
 * Freejiji Weekly Content Generator
 * ===================================
 * Scrapes Kijiji for 7 days of game content and saves to Firestore as drafts.
 *
 * Usage:
 *   node generate-week.js            # Full run, writes to Firestore
 *   node generate-week.js --dry-run  # Test run, no Firestore writes
 *
 * Requirements:
 *   1. Run `npm install` in this scripts/ directory
 *   2. Place your Firebase service account key at scripts/service-account.json
 *      (Download from Firebase Console → Project Settings → Service Accounts)
 */

const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { load } = require('cheerio');
const admin = require('firebase-admin');
const path = require('path');
const fs = require('fs');

puppeteer.use(StealthPlugin());

// ─── Config ───────────────────────────────────────────────────────────────────

const DRY_RUN = process.argv.includes('--dry-run');
const FIREBASE_PROJECT_ID = 'freejiji-4e401';
const ITEMS_PER_DAY = 10;
const DAYS_TO_GENERATE = 7;
const POOL_TARGET_PER_TYPE = 80; // How many free + paid items to scrape for the pool

// Keywords that disqualify a listing (checked in title + description)
const BANNED_KEYWORDS = [
  'pickup', 'pick up', 'pick-up',
  'scrap',
  'service', 'services',
];

// URL fragments that disqualify paid listings (tickets, garage/yard sales, free stuff)
const EXCLUDED_PAID_URL_FRAGMENTS = [
  '/b-tickets', '/v-tickets',
  'garage-sale', 'yard-sale',
  'free-stuff', 'c17410',
];

// ─── Toronto timezone helpers ──────────────────────────────────────────────────

/**
 * Returns "YYYY-MM-DD" for a date `daysFromNow` in the future, in Toronto time.
 */
function getTorontoDateString(daysFromNow = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

// ─── Date parsing ─────────────────────────────────────────────────────────────

/**
 * Converts Kijiji's various date formats into a JS Date, or null.
 * Formats seen: "< 1 minute ago", "1 hour ago", "yesterday", "10/06/2024"
 */
function parseKijijiDate(raw) {
  if (!raw) return null;
  const s = raw.trim().toLowerCase();
  const now = new Date();

  if (s.includes('just') || s.includes('minute') || s.includes('hour') || s.includes('second')) {
    return now;
  }
  if (s === 'yesterday') {
    const d = new Date(now);
    d.setDate(d.getDate() - 1);
    return d;
  }
  // DD/MM/YYYY
  const dmyMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmyMatch) {
    return new Date(
      parseInt(dmyMatch[3]),
      parseInt(dmyMatch[2]) - 1,
      parseInt(dmyMatch[1])
    );
  }
  const parsed = new Date(raw);
  return isNaN(parsed) ? null : parsed;
}

function isWithinTwoWeeks(date) {
  if (!date) return false;
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);
  return date >= cutoff;
}

// ─── Filtering ────────────────────────────────────────────────────────────────

function hasBannedKeyword(title = '', description = '') {
  const combined = `${title} ${description}`.toLowerCase();
  return BANNED_KEYWORDS.some((kw) => combined.includes(kw));
}

function isExcludedPaidUrl(url = '') {
  const u = url.toLowerCase();
  return EXCLUDED_PAID_URL_FRAGMENTS.some((frag) => u.includes(frag));
}

// ─── Image proxy ──────────────────────────────────────────────────────────────

/**
 * Wraps a Kijiji image URL through wsrv.nl to bypass hotlink protection.
 * wsrv.nl is open-source and free: https://github.com/weserv/images
 */
function proxyImageUrl(originalUrl) {
  if (!originalUrl || originalUrl.includes('placeholder')) return null;
  // Kijiji uses eBay CDN. Upgrade thumbnail to a larger size.
  const bigUrl = originalUrl
    .replace(/\/s-l\d+(\.\w+)$/, '/s-l1200$1')
    .split('?')[0];
  return `https://wsrv.nl/?url=${encodeURIComponent(bigUrl)}&w=800&h=600&fit=cover&output=webp&q=80`;
}

// ─── Firebase Admin ───────────────────────────────────────────────────────────

function initFirebase() {
  const serviceAccountPath = path.join(__dirname, 'service-account.json');
  if (!fs.existsSync(serviceAccountPath)) {
    console.error('\n❌ Missing service-account.json\n');
    console.error('  1. Go to: https://console.firebase.google.com/project/freejiji-4e401/settings/serviceaccounts/adminsdk');
    console.error('  2. Click "Generate new private key"');
    console.error('  3. Save the downloaded file as: scripts/service-account.json\n');
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.cert(require(serviceAccountPath)),
    projectId: FIREBASE_PROJECT_ID,
  });
  return admin.firestore();
}

// ─── Scraper core ─────────────────────────────────────────────────────────────

/**
 * Extracts the text from the first matching selector from a Cheerio element.
 */
function extractText(el, ...selectors) {
  for (const sel of selectors) {
    const text = el.find(sel).first().text().trim();
    if (text) return text;
  }
  return '';
}

/**
 * Extracts an attribute value from the first matching selector.
 */
function extractAttr(el, attr, ...selectors) {
  for (const sel of selectors) {
    const val = el.find(sel).first().attr(attr);
    if (val) return val;
  }
  return '';
}

/**
 * Scrapes a Kijiji search page and returns an array of candidate items.
 * @param {Object} browser - Puppeteer browser instance
 * @param {string} baseUrl - Kijiji search URL (without sort param)
 * @param {'free'|'paid'} type
 * @param {number} targetCount - Stop paginating when we have this many valid items
 */
async function scrapeListings(browser, baseUrl, type, targetCount) {
  const items = [];
  let page = 1;

  while (items.length < targetCount && page <= 10) {
    const url = `${baseUrl}?sort=dateDesc${page > 1 ? `&page=${page}` : ''}`;
    console.log(`  📄 Page ${page}: ${url}`);

    const tab = await browser.newPage();
    await tab.setViewport({ width: 1280, height: 900 });

    try {
      await tab.goto(url, { waitUntil: 'networkidle2', timeout: 45000 });

      // Human-like random pause
      await new Promise((r) => setTimeout(r, 1500 + Math.random() * 2000));

      const html = await tab.content();
      const $ = load(html);

      // ── Find listing cards ──
      // Kijiji uses several different structures. Try each selector in order.
      const CARD_SELECTORS = [
        '[data-listing-id]',
        '[data-testid="listing-card"]',
        'li.regular-ad',
        'article.regular-ad',
        '.search-item.regular-ad',
        'div[class*="itemCard"]',
      ];

      let cards = [];
      let foundSel = null;
      for (const sel of CARD_SELECTORS) {
        const found = $(sel);
        if (found.length > 0) {
          found.each((_, el) => cards.push($(el)));
          foundSel = sel;
          break;
        }
      }

      if (cards.length === 0) {
        const debugPath = path.join(__dirname, `debug-page-${type}-p${page}.html`);
        fs.writeFileSync(debugPath, html);
        console.warn(`  ⚠️  No listing cards found! Saved HTML → ${debugPath}`);
        console.warn('      Update CARD_SELECTORS in generate-week.js to match Kijiji\'s current HTML.');
        break;
      }

      console.log(`  Found ${cards.length} cards (selector: "${foundSel}")`);

      for (const card of cards) {
        // ── Skip sponsored / featured posts ──
        const cardHtml = card.html() || '';
        const cardText = card.text().toLowerCase();
        const isSponsored =
          card.attr('data-sponsored') === 'true' ||
          card.find('[data-testid="listing-sponsored-label"]').length > 0 ||
          card.find('.top-feature, .priority-listing, .third-party-banner').length > 0 ||
          cardText.includes('sponsored') ||
          cardText.includes('top ad') ||
          cardText.includes('feature ad');
        if (isSponsored) continue;

        // ── Extract fields ──
        const id =
          card.attr('data-listing-id') ||
          card.attr('id') ||
          `${Date.now()}-${Math.random().toString(36).slice(2)}`;

        const title = extractText(
          card,
          '[data-testid="listing-title"]',
          'a.title',
          '.title',
          'h2 > a',
          'h3 > a',
          'h2',
          'h3'
        );

        const description = extractText(
          card,
          '[data-testid="listing-description"]',
          'p.description',
          '.description',
          'div[class*="description"]'
        );

        const priceRaw = extractText(
          card,
          '[data-testid="listing-price"]',
          '.price',
          'span[class*="price"]',
          '[class*="Price"]'
        ).toLowerCase();

        const isFree = type === 'free' || priceRaw === 'free' || priceRaw === '$0.00' || priceRaw === '$0';
        const priceMatch = priceRaw.match(/[\d,]+(\.\d{1,2})?/);
        const actualPrice = isFree ? 0 : (priceMatch ? parseFloat(priceMatch[0].replace(/,/g, '')) : 0);

        // Image — Kijiji uses lazy loading; check multiple attributes
        const imgEl = card.find('img').first();
        const rawImg =
          imgEl.attr('src') ||
          imgEl.attr('data-src') ||
          imgEl.attr('data-lazy-src') ||
          imgEl.attr('data-original') ||
          // Also try picture source
          card.find('source').first().attr('srcset') ||
          '';
        const imageUrl = proxyImageUrl(rawImg.split(',')[0].trim().split(' ')[0]);

        // Listing URL
        const linkHref =
          extractAttr(card, 'href', 'a[href*="/v-"]', 'a[href*="kijiji"]', 'a') || '';
        const listingUrl = linkHref.startsWith('http')
          ? linkHref
          : `https://www.kijiji.ca${linkHref}`;

        const location = extractText(
          card,
          '[data-testid="listing-location"]',
          '.location',
          'span[class*="location"]',
          '[class*="Location"]'
        );

        const dateText = extractText(
          card,
          '[data-testid="listing-date-posted"]',
          '.date-posted',
          'span[class*="datePosted"]',
          '[class*="date"]'
        );
        const postedDate = parseKijijiDate(dateText);

        // ── Validate ──
        if (!title || title.length < 5) continue;
        if (!imageUrl) continue;
        if (!listingUrl.includes('kijiji.ca')) continue;
        if (!isWithinTwoWeeks(postedDate)) continue;
        if (hasBannedKeyword(title, description)) continue;
        if (type === 'paid' && isExcludedPaidUrl(listingUrl)) continue;

        items.push({
          id: `kijiji-${id}`,
          title,
          description: description || title,
          image: imageUrl,
          actualPrice,
          isFree,
          listingUrl,
          location: location || 'Canada',
        });
      }

      console.log(`  Pool size so far: ${items.length}`);

      // Check for next page button
      const hasNext =
        $('[data-testid="pagination-next-link"]').length > 0 ||
        $('a[title="Next results"]').length > 0 ||
        $('button[aria-label="Next page"]').length > 0 ||
        $('a[rel="next"]').length > 0;

      if (!hasNext) {
        console.log('  No next page found — done paginating.');
        break;
      }

      page++;

    } catch (err) {
      console.error(`  ❌ Error on page ${page}: ${err.message}`);
      break;
    } finally {
      await tab.close();
    }
  }

  return items;
}

// ─── Day generation ───────────────────────────────────────────────────────────

function pickRandom(pool, usedIds) {
  const available = pool.filter((item) => !usedIds.has(item.id));
  if (available.length === 0) return null;
  return available[Math.floor(Math.random() * available.length)];
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n🎮  Freejiji Weekly Content Generator');
  console.log(`📅  Generating ${DAYS_TO_GENERATE} days (tomorrow through tomorrow+${DAYS_TO_GENERATE - 1}, Toronto time)`);
  if (DRY_RUN) console.log('🧪  DRY RUN — nothing will be written to Firestore\n');

  // ── Firebase init ──
  let db;
  if (!DRY_RUN) {
    db = initFirebase();
    console.log('✅  Firebase connected\n');
  }

  // ── Launch browser ──
  console.log('🌐  Launching headless browser...\n');
  const browser = await puppeteer.launch({
    headless: 'new',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--lang=en-CA,en',
      '--disable-blink-features=AutomationControlled',
    ],
  });

  try {
    // ── Scrape FREE items ──
    console.log('🆓  Scraping FREE items from Kijiji Free Stuff (Canada-wide)...');
    const freePool = await scrapeListings(
      browser,
      'https://www.kijiji.ca/b-free-stuff/canada/c17410l0',
      'free',
      POOL_TARGET_PER_TYPE
    );
    console.log(`✅  Free pool: ${freePool.length} items\n`);

    // ── Scrape PAID items ──
    console.log('💰  Scraping PAID items from Kijiji Buy & Sell (Canada-wide)...');
    const paidPool = await scrapeListings(
      browser,
      'https://www.kijiji.ca/b-buy-sell/canada/c10l0',
      'paid',
      POOL_TARGET_PER_TYPE
    );
    console.log(`✅  Paid pool: ${paidPool.length} items\n`);

    // ── Sanity check ──
    if (freePool.length < 15) {
      console.error('❌  Too few free items scraped. Check debug HTML files and update selectors.');
      process.exit(1);
    }
    if (paidPool.length < 15) {
      console.error('❌  Too few paid items scraped. Check debug HTML files and update selectors.');
      process.exit(1);
    }

    // ── Generate 7 days ──
    const usedFreeIds = new Set();
    const usedPaidIds = new Set();
    const generatedDays = [];

    console.log('📅  Building daily item sets...\n');

    for (let d = 1; d <= DAYS_TO_GENERATE; d++) {
      const dateStr = getTorontoDateString(d);
      const dayItems = [];

      for (let slot = 0; slot < ITEMS_PER_DAY; slot++) {
        // Each slot independently has a 50% chance of being free or paid
        const wantFree = Math.random() < 0.5;

        let item = pickRandom(wantFree ? freePool : paidPool, wantFree ? usedFreeIds : usedPaidIds);

        // If preferred type is exhausted, fall back to the other
        if (!item) {
          const fallbackFree = !wantFree;
          item = pickRandom(fallbackFree ? freePool : paidPool, fallbackFree ? usedFreeIds : usedPaidIds);
        }

        if (!item) continue; // Both pools exhausted (shouldn't happen with enough scraping)

        const idsSet = item.isFree ? usedFreeIds : usedPaidIds;
        idsSet.add(item.id);
        dayItems.push({ ...item, id: `${dateStr}-slot${slot + 1}` });
      }

      const freeCount = dayItems.filter((i) => i.isFree).length;
      const paidCount = dayItems.filter((i) => !i.isFree).length;
      console.log(`  ${dateStr}: ${dayItems.length} items  (${freeCount} free / ${paidCount} paid)`);
      generatedDays.push({ date: dateStr, items: dayItems });
    }

    // ── Save unused pool items for the preview tool swap feature ──
    const unusedFree = freePool.filter((i) => !usedFreeIds.has(i.id));
    const unusedPaid = paidPool.filter((i) => !usedPaidIds.has(i.id));
    console.log(`\n  Swap pool: ${unusedFree.length} free + ${unusedPaid.length} paid items available`);

    // ── Dry run: print sample ──
    if (DRY_RUN) {
      console.log('\n🧪  DRY RUN — sample output for day 1:');
      console.log(JSON.stringify(generatedDays[0], null, 2));
      console.log('\n✅  Dry run complete. No data was written to Firestore.\n');
      return;
    }

    // ── Write to Firestore ──
    console.log('\n💾  Writing to Firestore...');

    // Write each day as a batch
    const BATCH_SIZE = 500; // Firestore batch limit
    const batch = db.batch();

    for (const day of generatedDays) {
      const ref = db.collection('daily_games').doc(day.date);
      batch.set(ref, {
        date: day.date,
        items: day.items,
        status: 'draft',
        generatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }

    // Write swap pool
    const poolRef = db.collection('item_pool').doc('latest');
    batch.set(poolRef, {
      freeItems: unusedFree,
      paidItems: unusedPaid,
      generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    await batch.commit();

    console.log(`\n✅  ${generatedDays.length} days written to Firestore as "draft"`);
    console.log('✅  Swap pool saved to item_pool/latest\n');
    console.log('🎨  Next step: Open scripts/preview-tool.html in your browser to review and approve!\n');

  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('\n💥  Fatal error:', err);
  process.exit(1);
});
