#!/usr/bin/env node
/* ArtistryC: Google pages builder
   ------------------------------------------------------------------
   Reads products.json and writes, into the output folder:
     /p/<name>-<id>/index.html     one real, fast page for EVERY product (what Google can index)
     /category/<name>/...          browse pages with plain links (how Google finds the products)
     /index.html                   a simple home page for this address
     /sitemap.xml + sitemap-*.xml  the list of pages for Google Search Console
     /merchant-feed.xml            the product list for Google Merchant Center (Google Shopping)
     /products-first.json          the newest products only: lets the store show its first screen fast
     /robots.txt, /CNAME, /seo-report.txt
   You never run this by hand: the GitHub Action (.github/workflows/seo-build.yml) runs it.
   Settings live in seo/site.config.json. No packages are needed (plain Node 20). */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// <<SHARED-BEGIN>> (this block is copied word-for-word into the storefront pages so both always make the same web address)
function slugify(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function cleanTitle(t) {
  var s = String(t || '');
  s = s.replace(/https?:\/\/\S+/g, ' ');
  s = s.replace(/[#@][\p{L}\p{N}_]+/gu, ' ');                                   // #hashtags and @mentions
  s = s.replace(/\p{Extended_Pictographic}|[\uFE0F\u200D]/gu, ' ');              // emoji
  s = s.replace(/\b(?:0?[1-9]|[12]\d|3[01])[-\/.](?:0?[1-9]|1[0-2])[-\/.](?:\d{4}|\d{2})\b/g, ' '); // dates such as 23-12-25
  s = s.replace(/\(?\s*(?:\u20B9|rs\.?|inr)\s*[\d,]+(?:\.\d+)?\s*\)?/gi, ' ');     // prices typed into the title
  s = s.replace(/\b(?:whats\s?app|call|dm|msg|message)\b[\s:.\-]*(?:us\s*)?(?:on|at|no\.?|number)?[\s:.\-]*(?:\+?91[\s-]?)?\d{10}\b/gi, ' ');
  s = s.replace(/(?:\+?91[\s-]?)?\b\d{10}\b/g, ' ');                           // phone numbers
  s = s.replace(/\bwhats\s?app\b/gi, ' ').replace(/\bartistryc(?:\.in)?\b/gi, ' ');
  s = s.replace(/\b(?:free shipping|free delivery|best price)\b/gi, ' ');
  s = s.replace(/!+/g, ' ');
  s = s.replace(/\s+(?:for\s+)?order\s*$/i, ' ');
  s = s.replace(/\s+/g, ' ').trim().replace(/^[\s\-\u2013\u2014|,.:;]+|[\s\-\u2013\u2014|,.:;]+$/g, '');
  if (!s) s = 'Designer ethnic wear';
  var letters = s.replace(/[^A-Za-z]/g, '');
  if (letters.length > 8 && letters.replace(/[^A-Z]/g, '').length / letters.length > 0.7) {
    s = s.toLowerCase().replace(/(^|[\s(\-\/])([a-z])/g, function (m, a, b) { return a + b.toUpperCase(); });
  }
  s = s.replace(/(\w)'S\b/g, "$1's");
  if (s.length > 150) { s = s.slice(0, 150).replace(/\s+\S*$/, ''); }
  return s;
}
function lqSvgUri(lq) { // a tiny blurred colour mosaic (12 cells) drawn as an SVG: shows instantly, before the real photo arrives
  var cells = String(lq || '').split('|')[1];
  if (!cells || cells.length !== 36) return '';
  var r = '', i;
  for (i = 0; i < 12; i++) r += '<rect x="' + (i % 4) + '" y="' + Math.floor(i / 4) + '" width="1" height="1" fill="#' + cells.substr(i * 3, 3) + '"/>';
  var svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 4 3" preserveAspectRatio="none"><filter id="b" x="0" y="0" width="100%" height="100%"><feGaussianBlur stdDeviation=".55"/></filter><g filter="url(#b)">' + r + '</g></svg>';
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}
function productSlug(item) {
  var t = slugify(cleanTitle(item.title)).slice(0, 60).replace(/-+$/, '');
  var k = String(item.id).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10);
  return (t ? t + '-' : '') + k;
}
// <<SHARED-END>>

const HERE = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.resolve(process.argv[2] || '.');
const outDir = path.resolve(process.argv[3] || '_site');

// ---------- settings ----------
const DEFAULTS = {
  siteUrl: 'https://shop.artistryc.in',
  storeUrl: 'https://artistryc.in',
  brandName: 'ArtistryC',
  tagline: 'Indian ethnic wear boutique marketplace',
  whatsappNumber: '919619659727',
  currency: 'INR',
  productsFile: 'products.json',
  ga4MeasurementId: 'G-4QRB1X9WMF',
  categoryPageSize: 60,
  sitemapChunk: 2000,
  firstPageCount: 24,
  askAndOrderAvailability: 'in_stock',   // in_stock | out_of_stock | backorder
  returnPolicyUrl: '', shippingPolicyUrl: '', privacyPolicyUrl: '', contactUrl: '',
  googleSiteVerification: [],
  categoryMap: {},
  directoryFile: 'platform/directory.json',
  enrichmentFile: 'data/enrichment.json',
  platformApiUrl: '',            // your Apps Script web app address (used by the privacy-request form)
  turnstileSiteKey: '',          // only if you switched Cloudflare Turnstile on in the platform
  legal: { reviewedByOwner: false, legalName: '', address: '', email: '', phone: '', grievanceOfficerName: '', grievanceOfficerEmail: '', grievanceOfficerPhone: '', responseDays: 7, returnsNote: '', shippingNote: '' }
};
let userCfg = {};
try { userCfg = JSON.parse(fs.readFileSync(path.join(repoDir, 'seo', 'site.config.json'), 'utf8')); }
catch (e) { console.warn('No readable seo/site.config.json, using built-in settings (' + e.message + ')'); }
const cfg = Object.assign({}, DEFAULTS, userCfg);
cfg.legal = Object.assign({}, DEFAULTS.legal, userCfg.legal || {});
cfg.siteUrl = String(cfg.siteUrl).replace(/\/+$/, '');
cfg.storeUrl = String(cfg.storeUrl).replace(/\/+$/, '');

const legalMissing = ['legalName', 'address', 'email', 'grievanceOfficerName', 'grievanceOfficerEmail'].filter(k => !String(cfg.legal[k] || '').trim());
const policyEnabled = cfg.legal.reviewedByOwner === true && !legalMissing.length;
if (policyEnabled) for (const [k, slug] of Object.entries({ returnPolicyUrl: 'returns', shippingPolicyUrl: 'shipping', privacyPolicyUrl: 'privacy', contactUrl: 'contact' })) if (!cfg[k]) cfg[k] = cfg.siteUrl + '/' + slug + '/';

const GOOGLE_CATEGORY = Object.assign({
  'Sarees': 'Apparel & Accessories > Clothing > Traditional & Ceremonial Clothing > Saris & Lehengas',
  'Lehenga Choli': 'Apparel & Accessories > Clothing > Traditional & Ceremonial Clothing > Saris & Lehengas',
  'Salwar Suits': 'Apparel & Accessories > Clothing > Traditional & Ceremonial Clothing',
  'Kurtis': 'Apparel & Accessories > Clothing > Shirts & Tops',
  'Ladies Tops': 'Apparel & Accessories > Clothing > Shirts & Tops',
  'Women Shirts': 'Apparel & Accessories > Clothing > Shirts & Tops',
  'Blouse': 'Apparel & Accessories > Clothing > Shirts & Tops',
  'Ladies Bottom': 'Apparel & Accessories > Clothing > Pants',
  'Co-ord Sets': 'Apparel & Accessories > Clothing > Outfit Sets',
  'Gowns': 'Apparel & Accessories > Clothing > Dresses',
  'Dress': 'Apparel & Accessories > Clothing > Dresses',
  'Shrugs': 'Apparel & Accessories > Clothing > Outerwear',
  'Winter Outfits': 'Apparel & Accessories > Clothing > Outerwear',
  'Dupattas': 'Apparel & Accessories > Clothing Accessories > Scarves & Shawls',
  'Mens Wear': 'Apparel & Accessories > Clothing > Traditional & Ceremonial Clothing',
  'Kidswear': 'Apparel & Accessories > Clothing > Traditional & Ceremonial Clothing',
  'Navratri Outfits': 'Apparel & Accessories > Clothing > Traditional & Ceremonial Clothing'
}, cfg.categoryMap || {});
const JEWELLERY_WORDS = /(necklace|earring|jhumk|bangle|bracelet|choker|pendant|maang|tikka|nath|anklet|payal|ring\b|jewel|haar|kada|brooch)/i;
function googleCategory(it) {
  if (it.category === 'Accessories') return JEWELLERY_WORDS.test(it.title) ? 'Apparel & Accessories > Jewelry' : 'Apparel & Accessories > Clothing Accessories';
  return GOOGLE_CATEGORY[it.category] || 'Apparel & Accessories > Clothing > Traditional & Ceremonial Clothing';
}
function genderOf(it) { return it.category === 'Mens Wear' ? 'male' : 'female'; }
function ageOf(it) { return it.category === 'Kidswear' ? 'kids' : 'adult'; }

// ---------- helpers ----------
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const xesc = s => String(s == null ? '' : s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
const ldJson = o => JSON.stringify(o).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const write = (rel, text) => { const f = path.join(outDir, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
const money = n => Number(n).toLocaleString('en-IN');
const isHttps = u => /^https:\/\/[^\s]+$/i.test(String(u || ''));
const thumb = u => String(u || '').replace(/\/(originals|\d+x)\//, '/474x/');
const mid = u => String(u || '').replace(/\/(originals|\d+x)\//, '/736x/');
// if the smaller picture does not exist, the browser falls back to the original
const fallbackAttr = (small, orig) => small === orig ? '' : ` onerror="this.onerror=null;this.src='${esc(orig)}'"`;
const plain = s => String(s || '').replace(/<[^>]*>/g, ' ').replace(/[\u0000-\u001F]/g, ' ').replace(/\s+/g, ' ').trim();
const tagList = it => String(it.tags || '').split(/[,\n]/).map(x => x.trim()).filter(x => x && x.length < 60 && !/^(women|men|kids) ?wear$/i.test(x));
const FILLER = new Set();   // descriptions repeated across the catalogue carry no information
function buildDescription(it, forFeed) {
  const real = plain(it.desc);
  if (real.length >= 60 && !FILLER.has(real)) return real.slice(0, 4900);
  const en = ENR[it.id];
  if (en && en.d) {   // written from what the photo shows (see enrich/textgen.py); the feed gets it without the "ask the seller" sentence
    let d = en.d; if (forFeed) d = d.replace(/\s*Colour and style notes are taken from[^]*$/, '');
    const tg = tagList(it).slice(0, 5); if (tg.length) d += ' Tags: ' + tg.join(', ') + '.';
    return (cleanTitle(it.title) + '. ' + d).slice(0, 4900);
  }
  const t = cleanTitle(it.title), tags = tagList(it).slice(0, 6);
  let d = t + '. ' + (it.category ? it.category + ' from ' : 'From ') + cfg.brandName + '.';
  if (tags.length) d += ' Style: ' + tags.join(', ') + '.';
  if (real && real.length < 60 && !FILLER.has(real)) d += ' ' + real.replace(/[.\s]*$/, '') + '.';
  if (!forFeed) d += ' Ask on WhatsApp for size, colour options and delivery.';
  return d.slice(0, 4900);
}
const colorsOf = it => { const own = (Array.isArray(it.colors) ? it.colors : []).map(x => String(x).trim()).filter(Boolean); if (own.length) return own; const en = ENR[it.id]; return en && en.c ? en.c.map(c => c.replace(/\b[a-z]/g, m => m.toUpperCase())) : []; };
const sizesOf = it => (Array.isArray(it.sizes) ? it.sizes : []).map(x => String(x).trim()).filter(Boolean);
function availabilityOf(it) {
  if (it.stock === 'Out of Stock') return 'out_of_stock';
  if (it.stock === 'Pre-Order') return 'backorder';
  if (it.stock === 'In Stock') return 'in_stock';
  return cfg.askAndOrderAvailability;
}
const SCHEMA_AVAIL = { in_stock: 'https://schema.org/InStock', out_of_stock: 'https://schema.org/OutOfStock', backorder: 'https://schema.org/BackOrder', preorder: 'https://schema.org/PreOrder' };
const lastmodOf = it => { const m = /^(\d{4}-\d{2}-\d{2})/.exec(String(it.dateAdded || '')); return m ? m[1] : new Date().toISOString().slice(0, 10); };

// ---------- read the products ----------
function readProducts() {
  const candidates = [cfg.productsFile, 'products.json', 'platform/products.json'];
  for (const rel of candidates) {
    const f = path.join(repoDir, rel);
    if (fs.existsSync(f)) {
      const data = JSON.parse(fs.readFileSync(f, 'utf8'));
      if (!Array.isArray(data) || !data.length) throw new Error(rel + ' is empty or not a product list');
      console.log('Reading ' + rel + ': ' + data.length + ' products');
      return data;
    }
  }
  throw new Error('Cannot find products.json in the repository. Run "publish feeds" in your Google Sheet first.');
}

const report = [];
const warn = m => { report.push(m); console.warn('WARN ' + m); };

const raw = readProducts();
const missingIds = raw.filter(x => !x.id).length;
raw.forEach((x, i) => { if (x._row === undefined) x._row = i; if (!x.id) x.id = 'row-' + x._row; });
if (missingIds) warn(missingIds + ' products have no ID in the sheet. They still get a page, but their web address is built from the row number, so it changes if rows are inserted or sorted. Fill the ID column to keep addresses stable.');
{ // descriptions that appear on many products are filler
  const counts = new Map();
  raw.forEach(x => { const d = plain(x.desc); if (d) counts.set(d, (counts.get(d) || 0) + 1); });
  counts.forEach((n, d) => { if (n >= 15) FILLER.add(d); });
}
const items = raw.filter(x => isHttps(x.img) && String(x.title || '').trim());
if (items.length !== raw.length) warn((raw.length - items.length) + ' products skipped: no https image or no title');
items.sort((a, b) => b._row - a._row);   // newest first: the same order the store uses

// what the photo analysis found (colours, style, occasion, a description and tips), if it has run
let ENR = {};
try { ENR = JSON.parse(fs.readFileSync(path.join(repoDir, cfg.enrichmentFile), 'utf8')); console.log('Photo analysis: ' + Object.keys(ENR).length + ' products'); } catch (e) { /* not run yet: pages are built without it */ }
let DIRECTORY = [];
try { DIRECTORY = JSON.parse(fs.readFileSync(path.join(repoDir, cfg.directoryFile), 'utf8')); if (!Array.isArray(DIRECTORY)) DIRECTORY = []; } catch (e) { /* no vendor directory yet */ }

// unique web addresses, or stop (a clash would make two products share one page)
const slugOf = new Map(), seen = new Map();
for (const it of items) {
  const s = productSlug(it);
  if (seen.has(s)) throw new Error('Two products would share the web address "' + s + '" (ids ' + seen.get(s) + ' and ' + it.id + ')');
  seen.set(s, it.id); slugOf.set(it, s);
}
const urlOf = it => cfg.siteUrl + '/p/' + slugOf.get(it) + '/';

const cats = new Map();
for (const it of items) { const c = it.category || 'Other'; if (!cats.has(c)) cats.set(c, []); cats.get(c).push(it); }
const catSlugs = new Map([...cats.keys()].map(c => [c, slugify(c) || 'other']));
const catUrl = (c, page) => cfg.siteUrl + '/category/' + catSlugs.get(c) + '/' + (page > 1 ? 'page/' + page + '/' : '');

// ---------- page building blocks ----------
const CSS = `*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;font:16px/1.55 system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#111;background:#fff}
a{color:inherit}header.top{border-bottom:1px solid #eee;padding:12px 16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
header.top .brand{font-weight:900;letter-spacing:-.02em;font-size:20px;text-decoration:none}header.top nav{display:flex;gap:14px;font-size:14px;flex-wrap:wrap}
header.top nav a{text-decoration:none;color:#444}.wrap{max-width:1100px;margin:0 auto;padding:16px}
.crumbs{font-size:13px;color:#666;margin:0 0 12px}.crumbs a{color:#666}
h1{font-size:22px;line-height:1.25;margin:0 0 8px}h2{font-size:15px;text-transform:uppercase;letter-spacing:.06em;color:#555;margin:28px 0 12px}
.prod{display:grid;gap:20px}@media(min-width:760px){.prod{grid-template-columns:minmax(0,1fr) minmax(0,1fr);align-items:start}}
.ph{aspect-ratio:3/4;background:#f2f2f2;border-radius:14px;overflow:hidden;width:100%;max-width:560px}.ph img{width:100%;height:100%;object-fit:contain;display:block}
.thumbs{display:flex;gap:8px;margin-top:8px;flex-wrap:wrap}.thumbs .t{width:72px;aspect-ratio:3/4;background:#f2f2f2;border-radius:8px;overflow:hidden}.thumbs img{width:100%;height:100%;object-fit:cover;display:block}
.price{font-size:26px;font-weight:900;margin:6px 0}.muted{color:#666;font-size:14px}.btns{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 22px;border-radius:999px;font-weight:800;text-decoration:none;font-size:15px}
.btn.wa{background:#25d366;color:#fff}.btn.alt{background:#111;color:#fff}.tips{margin:4px 0 0;padding-left:20px;font-size:14px;color:#333}h3{font-size:14px;margin:16px 0 6px}.tags{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0 0;padding:0;list-style:none}.tags li{font-size:12px;border:1px solid #ddd;border-radius:999px;padding:3px 10px;color:#444}
.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}@media(min-width:700px){.grid{grid-template-columns:repeat(4,minmax(0,1fr))}}@media(min-width:1000px){.grid{grid-template-columns:repeat(5,minmax(0,1fr))}}
.card{text-decoration:none;display:block}.card .im{aspect-ratio:3/4;background:#f2f2f2;border-radius:12px;overflow:hidden}.card img{width:100%;height:100%;object-fit:cover;display:block}
.card .nm{font-size:12px;font-weight:700;margin:6px 2px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.card .pr{font-size:13px;font-weight:800;margin:2px 2px 0}
.pager{display:flex;gap:8px;flex-wrap:wrap;margin:24px 0}.pager a,.pager span{min-width:40px;height:40px;display:inline-flex;align-items:center;justify-content:center;border:1px solid #ddd;border-radius:10px;text-decoration:none;font-size:14px;padding:0 10px}.pager .on{background:#111;color:#fff;border-color:#111}
.chips{display:flex;gap:8px;flex-wrap:wrap;margin:10px 0 0;padding:0;list-style:none}.chips a{display:inline-block;padding:8px 14px;border:1px solid #d1d5db;border-radius:999px;font-size:13px;text-decoration:none}
footer{border-top:1px solid #eee;margin-top:36px;padding:20px 16px;font-size:13px;color:#666}footer a{margin-right:14px}`;

function analyticsSnippet() {
  if (!cfg.ga4MeasurementId) return '';
  const id = cfg.ga4MeasurementId;
  // Loaded only after the page has settled (first touch, or 4 seconds), so it can never slow the first screen
  return `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${esc(id)}');(function(){var d=0;function go(){if(d)return;d=1;var s=document.createElement('script');s.async=1;s.src='https://www.googletagmanager.com/gtag/js?id=${esc(id)}';document.head.appendChild(s)}['scroll','touchstart','click','keydown'].forEach(function(e){addEventListener(e,go,{once:true,passive:true})});addEventListener('load',function(){setTimeout(go,4000)})})();</script>`;
}
function head({ title, description, canonical, image, ogType, ld, robots }) {
  const verify = (cfg.googleSiteVerification || []).map(t => `<meta name="google-site-verification" content="${esc(t)}">`).join('');
  return `<!doctype html><html lang="en-IN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}"><meta name="robots" content="${robots || 'index,follow,max-image-preview:large'}">${verify}
<meta property="og:site_name" content="${esc(cfg.brandName)}"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(description)}"><meta property="og:url" content="${esc(canonical)}"><meta property="og:type" content="${ogType || 'website'}">${image ? `<meta property="og:image" content="${esc(image)}"><meta name="twitter:card" content="summary_large_image"><link rel="preconnect" href="https://i.pinimg.com" crossorigin>` : ''}
<style>${CSS}</style>${(ld || []).map(o => `<script type="application/ld+json">${ldJson(o)}</script>`).join('')}</head><body>`;
}
function pageTop() {
  return `<header class="top"><a class="brand" href="${esc(cfg.siteUrl)}/">${esc(cfg.brandName.toUpperCase())}</a><nav aria-label="Main"><a href="${esc(cfg.siteUrl)}/">All designs</a>${DIRECTORY.length ? `<a href="${esc(cfg.siteUrl)}/vendors/">Sellers</a>` : ''}<a href="${esc(cfg.storeUrl)}/">Open the shop</a></nav></header>`;
}
function pageBottom() {
  const links = [['Returns', cfg.returnPolicyUrl], ['Shipping', cfg.shippingPolicyUrl], ['Privacy', cfg.privacyPolicyUrl], ['Privacy request', policyEnabled ? cfg.siteUrl + '/privacy-request/' : ''], ['Terms', policyEnabled ? cfg.siteUrl + '/terms/' : ''], ['Contact', cfg.contactUrl]].filter(x => x[1]).map(x => `<a href="${esc(x[1])}">${x[0]}</a>`).join('');
  return `<footer>${links}<span>&copy; ${new Date().getFullYear()} ${esc(cfg.brandName)}. Order on WhatsApp, we reply with price, size and delivery details.</span></footer>${analyticsSnippet()}</body></html>`;
}
const lqStyle = it => { const e = ENR[it.id], u = e && lqSvgUri(e.lq); return u ? ` style="background:url('${u}') center/cover"` : ''; };
function cardHtml(it, eager) {
  return `<a class="card" href="${esc(urlOf(it))}"><div class="im"${lqStyle(it)}><img src="${esc(thumb(it.img))}" alt="${esc(cleanTitle(it.title))}" width="474" height="632" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async"${fallbackAttr(thumb(it.img), it.img)}></div><div class="nm">${esc(cleanTitle(it.title))}</div>${it.price > 0 ? `<div class="pr">&#8377;${money(it.price)}</div>` : ''}</a>`;
}

// ---------- product pages ----------
let nProductPages = 0;
// seller trust pages (made from platform/directory.json)
const vendorSlugs = new Map(); const dirByCode = new Map(DIRECTORY.map(v => [v.vendorCode, v]));
DIRECTORY.forEach(v => { let s = slugify(v.slug || v.vendorName) || slugify(v.vendorCode); if ([...vendorSlugs.values()].includes(s)) s = s + '-' + slugify(v.vendorCode); vendorSlugs.set(v.vendorCode, s); });
const vendorUrl = code => vendorSlugs.has(code) ? cfg.siteUrl + '/vendor/' + vendorSlugs.get(code) + '/' : '';
const vendorLink = it => vendorUrl(it.vendorCode) ? `<a href="${esc(vendorUrl(it.vendorCode))}">${esc(it.vendor || cfg.brandName)}</a>` : esc(it.vendor || cfg.brandName);
const catIndex = new Map();   // item -> [list, position]
for (const [c, list] of cats) list.forEach((it, i) => catIndex.set(it, [list, i]));

function productPage(it) {
  const title = cleanTitle(it.title), url = urlOf(it), cat = it.category || 'Other';
  const priced = Number(it.price) > 0, avail = availabilityOf(it);
  const desc = buildDescription(it, false);
  const metaDesc = (title + ' | ' + cat + ' at ' + cfg.brandName + '. ' + (priced ? 'Price \u20B9' + money(it.price) + '.' : 'Ask for the price on WhatsApp.')).slice(0, 158);
  const images = [it.img].concat(Array.isArray(it.additionalImages) ? it.additionalImages : []).filter(isHttps).slice(0, 6);
  const product = {
    '@context': 'https://schema.org', '@type': 'Product', '@id': url + '#product', name: title, url,
    image: images, description: desc, sku: String(it.id), category: cat,
    brand: { '@type': 'Brand', name: it.vendor || cfg.brandName }
  };
  if (priced) product.offers = {
    '@type': 'Offer', url, priceCurrency: cfg.currency, price: Number(it.price).toFixed(2),
    availability: SCHEMA_AVAIL[avail], itemCondition: 'https://schema.org/NewCondition',
    seller: { '@type': 'Organization', name: cfg.brandName }
  };
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: cfg.siteUrl + '/' },
    { '@type': 'ListItem', position: 2, name: cat, item: catUrl(cat, 1) },
    { '@type': 'ListItem', position: 3, name: title, item: url }] };
  const waText = 'Hi, I am interested in "' + title + '" ' + url;
  const wa = 'https://wa.me/' + String(cfg.whatsappNumber).replace(/\D/g, '') + '?text=' + encodeURIComponent(waText);
  const [list, pos] = catIndex.get(it);
  const related = [];
  for (let d = 1; related.length < 8 && d < list.length; d++) { if (list[pos - d]) related.push(list[pos - d]); if (related.length < 8 && list[pos + d]) related.push(list[pos + d]); }
  const tags = tagList(it).slice(0, 10), cols = colorsOf(it), sizes = sizesOf(it);
  const stockLine = avail === 'out_of_stock' ? 'Currently out of stock.' : (avail === 'backorder' ? 'Pre-order: message us for the delivery date.' : 'Order on WhatsApp to confirm size, colour and delivery.');
  let h = head({ title: title + ' | ' + cfg.brandName, description: metaDesc, canonical: url, image: images[0], ogType: 'product', ld: [product, crumbs] });
  h += pageTop() + `<div class="wrap"><nav class="crumbs" aria-label="Breadcrumb"><a href="${esc(cfg.siteUrl)}/">Home</a> &rsaquo; <a href="${esc(catUrl(cat, 1))}">${esc(cat)}</a></nav>`;
  h += `<div class="prod"><div><div class="ph"${lqStyle(it)}><img src="${esc(mid(images[0]))}" alt="${esc(title)}" width="736" height="981" fetchpriority="high" decoding="async"${fallbackAttr(mid(images[0]), images[0])}></div>`;
  if (images.length > 1) h += '<div class="thumbs">' + images.slice(1).map(u => `<div class="t"><img src="${esc(thumb(u))}" alt="${esc(title)}" width="72" height="96" loading="lazy" decoding="async"${fallbackAttr(thumb(u), u)}></div>`).join('') + '</div>';
  h += `</div><div><h1>${esc(title)}</h1>`;
  h += priced ? `<p class="price">&#8377;${money(it.price)}</p>` : `<p class="price" style="font-size:18px">Price on request</p>`;
  h += `<p class="muted">${esc(stockLine)}</p>`;
  if (cols.length) h += `<p class="muted">Colours: ${esc(cols.join(', '))}</p>`;
  if (sizes.length) h += `<p class="muted">Sizes: ${esc(sizes.join(', '))}</p>`;
  h += `<div class="btns"><a class="btn wa" href="${esc(wa)}" rel="nofollow noopener">Order on WhatsApp</a><a class="btn alt" href="${esc(cfg.storeUrl + '/#pin=' + encodeURIComponent(it.id))}">Add to cart in the shop</a></div>`;
  h += `<p>${esc(desc)}</p>`;
  if (tags.length) h += '<ul class="tags">' + tags.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>';
  const en = ENR[it.id];
  if (en && ((en.o && en.o.length) || (en.t && en.t.length))) {
    if (en.o && en.o.length) h += '<h3>Good for</h3><ul class="tags">' + en.o.map(o => `<li>${esc(o)}</li>`).join('') + '</ul>';
    if (en.t && en.t.length) h += '<h3>How to style it</h3><ul class="tips">' + en.t.map(t => `<li>${esc(t)}</li>`).join('') + '</ul>';
  }
  h += `<p class="muted" style="margin-top:14px">Category: <a href="${esc(catUrl(cat, 1))}">${esc(cat)}</a> &middot; Sold by ${vendorLink(it)}</p></div></div>`;
  if (related.length) h += `<h2>More ${esc(cat)}</h2><div class="grid">` + related.map(r => cardHtml(r, false)).join('') + '</div>';
  h += '</div>' + pageBottom();
  return h;
}

// ---------- category pages + home ----------
function pagerHtml(c, page, pages) {
  if (pages < 2) return '';
  const nums = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2].filter(n => n >= 1 && n <= pages));
  let out = '<nav class="pager" aria-label="Pages">', last = 0;
  [...nums].sort((a, b) => a - b).forEach(n => { if (last && n > last + 1) out += '<span>&hellip;</span>'; out += n === page ? `<span class="on" aria-current="page">${n}</span>` : `<a href="${esc(catUrl(c, n))}">${n}</a>`; last = n; });
  return out + '</nav>';
}
function categoryPage(c, list, page, pages) {
  const slice = list.slice((page - 1) * cfg.categoryPageSize, page * cfg.categoryPageSize);
  const url = catUrl(c, page);
  const title = c + (page > 1 ? ' (page ' + page + ')' : '') + ' | ' + cfg.brandName;
  const description = ('Browse ' + list.length + ' ' + c + ' designs from ' + cfg.brandName + ' - ' + cfg.tagline + '. Order on WhatsApp.').slice(0, 158);
  const ld = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: c, url, description,
    mainEntity: { '@type': 'ItemList', itemListElement: slice.map((it, i) => ({ '@type': 'ListItem', position: (page - 1) * cfg.categoryPageSize + i + 1, url: urlOf(it) })) } },
  { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [
    { '@type': 'ListItem', position: 1, name: 'Home', item: cfg.siteUrl + '/' }, { '@type': 'ListItem', position: 2, name: c, item: catUrl(c, 1) }] }];
  let h = head({ title, description, canonical: url, ld });
  h = h.replace('</head>', (page > 1 ? `<link rel="prev" href="${esc(catUrl(c, page - 1))}">` : '') + (page < pages ? `<link rel="next" href="${esc(catUrl(c, page + 1))}">` : '') + '</head>');
  h += pageTop() + `<div class="wrap"><nav class="crumbs"><a href="${esc(cfg.siteUrl)}/">Home</a> &rsaquo; ${esc(c)}</nav><h1>${esc(c)}</h1><p class="muted">${list.length} designs. Tap a design for the price and to order on WhatsApp.</p><div class="grid" style="margin-top:14px">`;
  h += slice.map((it, i) => cardHtml(it, i < 2)).join('') + '</div>' + pagerHtml(c, page, pages) + '</div>' + pageBottom();
  return h;
}
function homePage() {
  const description = (cfg.brandName + ' - ' + cfg.tagline + '. Browse sarees, lehengas, suits, kurtis and more, then order on WhatsApp.').slice(0, 158);
  const ld = [{ '@context': 'https://schema.org', '@type': 'WebSite', name: cfg.brandName, url: cfg.siteUrl + '/' },
    { '@context': 'https://schema.org', '@type': 'Organization', name: cfg.brandName, url: cfg.storeUrl + '/' }];
  let h = head({ title: cfg.brandName + ' | ' + cfg.tagline, description, canonical: cfg.siteUrl + '/', ld });
  h += pageTop() + `<div class="wrap"><h1>${esc(cfg.brandName)}: ${esc(cfg.tagline)}</h1><p class="muted">Shop by category</p><ul class="chips">`;
  h += [...cats.entries()].sort((a, b) => b[1].length - a[1].length).map(([c, l]) => `<li><a href="${esc(catUrl(c, 1))}">${esc(c)} (${l.length})</a></li>`).join('');
  h += '</ul><h2>Newest designs</h2><div class="grid">' + items.slice(0, cfg.categoryPageSize).map((it, i) => cardHtml(it, i < 2)).join('') + '</div></div>' + pageBottom();
  return h;
}

// ---------- write everything ----------
fs.mkdirSync(outDir, { recursive: true });
for (const it of items) { write('p/' + slugOf.get(it) + '/index.html', productPage(it)); nProductPages++; }
const pageUrls = [cfg.siteUrl + '/'];
let nCatPages = 0;
for (const [c, list] of cats) {
  const pages = Math.max(1, Math.ceil(list.length / cfg.categoryPageSize));
  for (let p = 1; p <= pages; p++) {
    write('category/' + catSlugs.get(c) + '/' + (p > 1 ? 'page/' + p + '/' : '') + 'index.html', categoryPage(c, list, p, pages));
    pageUrls.push(catUrl(c, p)); nCatPages++;
  }
}
write('index.html', homePage());

// ---------- seller trust pages, policy pages ----------
const fmtMonth = iso => { const d = new Date(iso); return isNaN(d) ? '' : d.toLocaleDateString('en-IN', { month: 'long', year: 'numeric', timeZone: 'UTC' }); };
const waLink = (num, text) => 'https://wa.me/' + String(num || cfg.whatsappNumber).replace(/\D/g, '').replace(/^(\d{10})$/, '91$1') + (text ? '?text=' + encodeURIComponent(text) : '');
function badgeList(v) {
  const ver = (v.trust || {}).verified || {}, b = [];
  if (ver.approvedSince && fmtMonth(ver.approvedSince)) b.push('Approved ' + cfg.brandName + ' seller since ' + fmtMonth(ver.approvedSince));
  if (ver.businessDetailsOnFile) b.push('Business details on file with ' + cfg.brandName);
  if (ver.gstRegistered) b.push('GST registered');
  if (ver.hasStore) b.push('Has a physical store');
  return b;
}
let nVendorPages = 0;
function vendorPage(v) {
  const t = v.trust || {}, ver = t.verified || {}, url = vendorUrl(v.vendorCode), name = v.vendorName;
  const mine = items.filter(it => it.vendorCode === v.vendorCode);
  const badges = badgeList(v);
  const facts = [];
  if (t.foundedYear) facts.push(['In business since', String(t.foundedYear)]);
  if (t.languages && t.languages.length) facts.push(['Languages', t.languages.join(', ')]);
  if (t.returnDays !== null && t.returnDays !== undefined) facts.push(['Returns', t.returnDays > 0 ? t.returnDays + ' days' + (t.returnPolicy ? ': ' + t.returnPolicy : '') : 'No returns' + (t.returnPolicy ? ': ' + t.returnPolicy : '')]);
  else if (t.returnPolicy) facts.push(['Returns', t.returnPolicy]);
  if (t.shippingInfo) facts.push(['Shipping', t.shippingInfo]);
  if (t.deliveryDays) facts.push(['Delivery time', t.deliveryDays]);
  const pay = (t.paymentMethods || []).slice(); if (t.payOnline) pay.unshift('Pay online (UPI / cards)'); if (pay.length) facts.push(['Payment', pay.join(', ')]);
  const locs = v.locations || [];
  const org = { '@context': 'https://schema.org', '@type': 'Organization', '@id': url + '#org', name, url, description: v.description || t.about || undefined, logo: isHttps(v.logoUrl) ? v.logoUrl : undefined,
    foundingDate: t.foundedYear ? String(t.foundedYear) : undefined, sameAs: [t.instagram, t.facebook, t.googleMaps].filter(isHttps), parentOrganization: { '@type': 'Organization', name: cfg.brandName, url: cfg.storeUrl + '/' } };
  if (locs[0]) org.address = { '@type': 'PostalAddress', addressLocality: locs[0].city, addressRegion: locs[0].state, postalCode: locs[0].pincode, addressCountry: 'IN' };
  if (t.returnDays !== null && t.returnDays !== undefined) org.hasMerchantReturnPolicy = t.returnDays > 0
    ? { '@type': 'MerchantReturnPolicy', applicableCountry: 'IN', returnPolicyCategory: 'https://schema.org/MerchantReturnFiniteReturnWindow', merchantReturnDays: t.returnDays }
    : { '@type': 'MerchantReturnPolicy', applicableCountry: 'IN', returnPolicyCategory: 'https://schema.org/MerchantReturnNotPermitted' };
  const crumbs = { '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: [{ '@type': 'ListItem', position: 1, name: 'Home', item: cfg.siteUrl + '/' }, { '@type': 'ListItem', position: 2, name: 'Sellers', item: cfg.siteUrl + '/vendors/' }, { '@type': 'ListItem', position: 3, name, item: url }] };
  const desc = (name + ' on ' + cfg.brandName + ': ' + (t.about || v.description || 'seller profile, return policy, delivery details and products') + '').replace(/\s+/g, ' ').slice(0, 158);
  let h = head({ title: name + ' | Seller on ' + cfg.brandName, description: desc, canonical: url, image: isHttps(v.logoUrl) ? v.logoUrl : (mine[0] && mine[0].img), ld: [JSON.parse(JSON.stringify(org)), crumbs] });
  h += pageTop() + `<div class="wrap"><nav class="crumbs"><a href="${esc(cfg.siteUrl)}/">Home</a> &rsaquo; <a href="${esc(cfg.siteUrl)}/vendors/">Sellers</a> &rsaquo; ${esc(name)}</nav>`;
  h += `<div style="display:flex;gap:14px;align-items:center">${isHttps(v.logoUrl) ? `<img src="${esc(v.logoUrl)}" alt="${esc(name)} logo" width="72" height="72" style="border-radius:14px;object-fit:cover;background:#f2f2f2" loading="lazy">` : ''}<h1 style="margin:0">${esc(name)}</h1></div>`;
  if (badges.length) h += '<ul class="tags" style="margin-top:12px">' + badges.map(b => `<li style="border-color:#2e9e5b;color:#176b3a">&#10003; ${esc(b)}</li>`).join('') + '</ul><p class="muted" style="font-size:12px">These marks are checked by ' + esc(cfg.brandName) + ' from the seller\'s sign-up. Everything else on this page is written by the seller.</p>';
  if (t.about || v.description) h += `<p>${esc(t.about || v.description)}</p>`;
  if (facts.length) h += '<h2>Seller details</h2><dl style="margin:0">' + facts.map(f => `<div style="display:flex;gap:12px;padding:8px 0;border-bottom:1px solid #eee"><dt style="min-width:130px;font-weight:700">${esc(f[0])}</dt><dd style="margin:0">${esc(f[1])}</dd></div>`).join('') + '</dl>';
  if (locs.length) h += '<h2>Where to find them</h2>' + locs.map(l => `<p style="margin:6px 0"><b>${esc(l.label || 'Store')}</b>: ${esc([l.city, l.state, l.pincode].filter(Boolean).join(', '))}${l.opensForVisits ? ' &middot; open for visits' : ''}${l.pickup ? ' &middot; pickup available' : ''}</p>`).join('');
  h += `<div class="btns"><a class="btn wa" href="${esc(waLink(v.whatsapp, 'Hi ' + name + ', I found you on ' + cfg.brandName + ' ' + url))}" rel="nofollow noopener">Message on WhatsApp</a>${v.website ? `<a class="btn alt" href="${esc(v.website)}" rel="nofollow noopener">Visit their website</a>` : ''}${t.instagram ? `<a class="btn alt" href="${esc(t.instagram)}" rel="nofollow noopener">Instagram</a>` : ''}${t.googleMaps ? `<a class="btn alt" href="${esc(t.googleMaps)}" rel="nofollow noopener">Google Maps</a>` : ''}</div>`;
  const ph = (t.photos || []).filter(isHttps).slice(0, 6); if (ph.length) h += '<h2>Photos from the seller</h2><div class="thumbs">' + ph.map(u => `<div class="t" style="width:120px"><img src="${esc(u)}" alt="${esc(name)} photo" width="120" height="160" loading="lazy" decoding="async"></div>`).join('') + '</div>';
  if (mine.length) h += `<h2>Designs by ${esc(name)} (${mine.length})</h2><div class="grid">` + mine.slice(0, 40).map(it => cardHtml(it, false)).join('') + '</div>';
  h += '</div>' + pageBottom();
  return h;
}
function vendorsIndex() {
  const url = cfg.siteUrl + '/vendors/';
  let h = head({ title: 'Sellers on ' + cfg.brandName, description: ('Meet the sellers on ' + cfg.brandName + ': see their return policy, delivery details and designs.').slice(0, 158), canonical: url });
  h += pageTop() + `<div class="wrap"><nav class="crumbs"><a href="${esc(cfg.siteUrl)}/">Home</a> &rsaquo; Sellers</nav><h1>Sellers on ${esc(cfg.brandName)}</h1><p class="muted">Every seller below has signed up and been approved. Open a seller to see their details, policies and designs.</p><ul class="chips" style="margin-top:14px">`;
  h += DIRECTORY.slice().sort((a, b) => a.vendorName.localeCompare(b.vendorName)).map(v => `<li><a href="${esc(vendorUrl(v.vendorCode))}">${esc(v.vendorName)}</a></li>`).join('') + '</ul></div>' + pageBottom();
  return h;
}
if (DIRECTORY.length) {
  DIRECTORY.forEach(v => { write('vendor/' + vendorSlugs.get(v.vendorCode) + '/index.html', vendorPage(v)); pageUrls.push(vendorUrl(v.vendorCode)); nVendorPages++; });
  write('vendors/index.html', vendorsIndex()); pageUrls.push(cfg.siteUrl + '/vendors/');
}

// policy pages: only published when the owner confirms they have read and approved the wording (legal.reviewedByOwner = true)
const L = cfg.legal;
let nPolicyPages = 0;
function policyPage(slug, title, body) {
  const url = cfg.siteUrl + '/' + slug + '/';
  let h = head({ title: title + ' | ' + cfg.brandName, description: (title + ' of ' + cfg.brandName).slice(0, 158), canonical: url });
  h += pageTop() + `<div class="wrap" style="max-width:760px"><nav class="crumbs"><a href="${esc(cfg.siteUrl)}/">Home</a> &rsaquo; ${esc(title)}</nav><h1>${esc(title)}</h1>${body}<p class="muted" style="margin-top:28px">Last updated ${new Date().toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Kolkata' })}.</p></div>` + pageBottom();
  write(slug + '/index.html', h); pageUrls.push(url); nPolicyPages++;
}
const P = t => '<p>' + esc(t) + '</p>';
const UL = a => '<ul>' + a.map(x => '<li>' + esc(x) + '</li>').join('') + '</ul>';
const contactBlock = () => `<p><b>${esc(L.legalName)}</b><br>${esc(L.address)}<br>Email: <a href="mailto:${esc(L.email)}">${esc(L.email)}</a>${L.phone ? '<br>Phone / WhatsApp: ' + esc(L.phone) : ''}</p>`;
const griev = () => `<h2>Grievance officer</h2><p>${esc(L.grievanceOfficerName)}<br>Email: <a href="mailto:${esc(L.grievanceOfficerEmail)}">${esc(L.grievanceOfficerEmail)}</a>${L.grievanceOfficerPhone ? '<br>Phone: ' + esc(L.grievanceOfficerPhone) : ''}<br>We acknowledge complaints within 48 hours and aim to resolve them within ${esc(L.responseDays || 7)} days.</p>`;
if (policyEnabled) {
  policyPage('privacy', 'Privacy policy', `<p>This policy explains what personal information ${esc(cfg.brandName)} collects, why, and the choices you have. It is a plain-language summary; ${esc(L.legalName)} is responsible for your information.</p>
<h2>What we collect</h2>${UL(['When you order: your name, mobile number, delivery address and, if you give it, your email. We use it to process and deliver your order, to send the invoice and to contact you about it.', 'When you browse and say yes to analytics: anonymous information about how the site is used (pages and products viewed, whether an order was started). It does not include your name, phone number, address or email.', 'When you message us on WhatsApp: whatever you choose to send.'])}
<h2>Cookies and advertising</h2><p>With your permission we use Google Analytics to understand how the site is used, and Google AdSense to show ads. You choose when the notice first appears. Declining analytics means we do not load it. You can change your choice any time by clearing this site's data in your browser, and you can ask us to withdraw consent below.</p>
<h2>Who we share it with</h2>${UL(['The seller you order from, so they can pack and deliver your order.', 'Couriers and payment providers (for example Razorpay) only as needed to deliver and to take payment. We never see or store your card or UPI PIN details.', 'Authorities when the law requires it.'])}${P('We do not sell your personal information.')}
<h2>How long we keep it</h2><p>Invoices and order records are kept for as long as tax and accounting law requires. Anonymous analytics are deleted after about 45 days, with only totals kept. Other information is deleted when you ask us to, unless the law says we must keep it.</p>
<h2>Your rights</h2><p>You can ask us to show you what we hold about you, correct it, delete it, or stop using it. Use the <a href="${esc(cfg.siteUrl)}/privacy-request/">privacy request form</a> or write to us. We reply within ${esc(L.responseDays || 7)} days.</p>${griev()}<h2>Contact</h2>${contactBlock()}`);
  policyPage('terms', 'Terms of use', `<p>These terms apply when you use ${esc(cfg.storeUrl)} and ${esc(cfg.siteUrl)}, operated by ${esc(L.legalName)}.</p><h2>Who sells what</h2>${P(cfg.brandName + ' lists designs from independent sellers. Each design page and seller page shows who the seller is. Prices, availability, delivery time and return terms are set by the seller and shown on the seller page.')}
<h2>Orders</h2>${UL(['You place an order by paying online or by confirming it with the seller on WhatsApp. An order is accepted when the seller confirms it.', 'Photos are taken by the seller. Colours can look slightly different on different screens.', 'Check size and delivery time with the seller before you pay.'])}
<h2>Using the site</h2>${P('Do not misuse the site, try to break it, or copy it in bulk. Product photos and descriptions belong to the sellers and to ' + cfg.brandName + '.')}<h2>Complaints</h2>${P('Write to the grievance officer below.')}${griev()}<h2>Contact</h2>${contactBlock()}`);
  policyPage('returns', 'Returns and refunds', `${P('Every seller sets their own return window. You will find it on the seller page and in the seller details of each design. If a seller shows "No returns", the item cannot be returned unless it arrives damaged or is not what was described.')}${L.returnsNote ? P(L.returnsNote) : ''}
<h2>If something is wrong with your order</h2>${P('Message the seller on WhatsApp with clear photos as soon as you receive the parcel. If you cannot reach the seller, write to us and we will help.')}<h2>Refunds</h2>${P('Refunds for online payments go back to the original payment method once the seller approves the return.')}${griev()}`);
  policyPage('shipping', 'Shipping and delivery', `${P('Each seller ships their own orders. Dispatch time, delivery time and any shipping details are shown on the seller page and on each design.')}${L.shippingNote ? P(L.shippingNote) : ''}${P('When you order online, the price you pay is the listed price and delivery is included. When you order on WhatsApp, the seller confirms delivery cost and time before you pay.')}`);
  policyPage('contact', 'Contact us', `${contactBlock()}${griev()}`);
  const turn = cfg.turnstileSiteKey ? `<div class="cf-turnstile" data-sitekey="${esc(cfg.turnstileSiteKey)}"></div><script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>` : '';
  const api = cfg.platformApiUrl ? JSON.stringify(cfg.platformApiUrl) : 'null';
  policyPage('privacy-request', 'Privacy request', `${P('Use this form to ask us to show you your information, correct it, delete it, or stop using it. We reply within ' + (L.responseDays || 7) + ' days.')}
<form id="pr" style="display:grid;gap:12px;max-width:480px"><label>What would you like?<select name="kind" style="width:100%;padding:10px;font-size:16px"><option value="access">Show me what you hold about me</option><option value="correct">Correct my information</option><option value="delete">Delete my information</option><option value="withdraw_consent">Withdraw my consent</option></select></label>
<label>Your email or 10-digit mobile number<input name="contact" required style="width:100%;padding:10px;font-size:16px"></label><label>Anything we should know (optional)<textarea name="details" maxlength="1000" style="width:100%;padding:10px;font-size:16px;min-height:90px"></textarea></label>
<input name="website" tabindex="-1" autocomplete="off" style="position:absolute;left:-9999px" aria-hidden="true">${turn}<button class="btn alt" type="submit">Send request</button><p id="prm" class="muted" role="status"></p></form>
<script>(function(){var API=${api},f=document.getElementById('pr'),m=document.getElementById('prm');f.onsubmit=function(e){e.preventDefault();if(f.website.value)return;if(!API){m.textContent='This form is not switched on yet. Please email us instead.';return}
var tok=f.querySelector('[name="cf-turnstile-response"]');m.textContent='Sending...';fetch(API,{method:'POST',body:JSON.stringify({route:'privacyRequest',payload:{kind:f.kind.value,contact:f.contact.value,details:f.details.value,captchaToken:tok?tok.value:''}})}).then(function(r){return r.json()}).then(function(r){m.textContent=r.ok?r.data.message:(r.error&&r.error.message)||'Something went wrong.';if(r.ok)f.reset()}).catch(function(){m.textContent='Could not send. Please email us instead.'})}})();</script>`);
}

// sitemaps
const today = new Date().toISOString().slice(0, 10);
const sm = (ns, rows) => '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"' + (ns ? ' xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"' : '') + '>\n' + rows.join('\n') + '\n</urlset>\n';
const chunks = [];
for (let i = 0; i < items.length; i += cfg.sitemapChunk) chunks.push(items.slice(i, i + cfg.sitemapChunk));
chunks.forEach((chunk, i) => write('sitemap-products-' + (i + 1) + '.xml', sm(true, chunk.map(it =>
  `<url><loc>${xesc(urlOf(it))}</loc><lastmod>${lastmodOf(it)}</lastmod><image:image><image:loc>${xesc(it.img)}</image:loc><image:title>${xesc(cleanTitle(it.title))}</image:title></image:image></url>`))));
write('sitemap-pages.xml', sm(false, pageUrls.map(u => `<url><loc>${xesc(u)}</loc><lastmod>${today}</lastmod></url>`)));
write('sitemap.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
  ['sitemap-pages.xml'].concat(chunks.map((_, i) => 'sitemap-products-' + (i + 1) + '.xml')).map(f => `<sitemap><loc>${xesc(cfg.siteUrl + '/' + f)}</loc><lastmod>${today}</lastmod></sitemap>`).join('\n') + '\n</sitemapindex>\n');
write('robots.txt', 'User-agent: *\nAllow: /\n\nSitemap: ' + cfg.siteUrl + '/sitemap.xml\n');
try { write('CNAME', new URL(cfg.siteUrl).hostname + '\n'); } catch (e) { /* not a valid address: skip */ }

// Google Merchant Center feed (only products with a real price: Google refuses products without one)
const feedItems = [], skipped = { noPrice: 0, badImage: 0 };
for (const it of items) {
  if (!(Number(it.price) > 0)) { skipped.noPrice++; continue; }
  feedItems.push(it);
}
const feedRow = it => {
  const t = cleanTitle(it.title), imgs = (Array.isArray(it.additionalImages) ? it.additionalImages : []).filter(isHttps).slice(0, 10);
  const cols = colorsOf(it), sizes = sizesOf(it);
  return '<item>' +
    `<g:id>${xesc(String(it.id).slice(0, 50))}</g:id><g:title>${xesc(t)}</g:title><g:description>${xesc(buildDescription(it, true))}</g:description>` +
    `<g:link>${xesc(urlOf(it))}</g:link><g:image_link>${xesc(it.img)}</g:image_link>` + imgs.map(u => `<g:additional_image_link>${xesc(u)}</g:additional_image_link>`).join('') +
    `<g:availability>${availabilityOf(it)}</g:availability><g:price>${Number(it.price).toFixed(2)} ${xesc(cfg.currency)}</g:price>` +
    `<g:brand>${xesc(it.vendor || cfg.brandName)}</g:brand><g:condition>new</g:condition><g:identifier_exists>no</g:identifier_exists>` +
    `<g:google_product_category>${xesc(googleCategory(it))}</g:google_product_category><g:product_type>${xesc(it.category || 'Other')}</g:product_type>` +
    `<g:gender>${genderOf(it)}</g:gender><g:age_group>${ageOf(it)}</g:age_group>` +
    (cols.length ? `<g:color>${xesc(cols.slice(0, 3).join('/'))}</g:color>` : '') + (sizes.length ? `<g:size>${xesc(sizes[0])}</g:size>` : '') +
    '</item>';
};
write('merchant-feed.xml', '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0"><channel>\n' +
  `<title>${xesc(cfg.brandName)}</title><link>${xesc(cfg.storeUrl)}</link><description>${xesc(cfg.tagline)}</description>\n` +
  feedItems.map(feedRow).join('\n') + '\n</channel></rss>\n');


// Reusable feeds for other channels (same products, same clean titles/descriptions/prices as the Google feed)
const csvCell = v => { v = String(v == null ? '' : v).replace(/\r?\n/g, ' '); return /[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
const tsvCell = v => String(v == null ? '' : v).replace(/[\t\r\n]+/g, ' ').trim();
const META_AVAIL = { in_stock: 'in stock', out_of_stock: 'out of stock', backorder: 'available for order' };
const rowsFor = it => { const cols = colorsOf(it), sizes = sizesOf(it); return { id: String(it.id).slice(0, 100), title: cleanTitle(it.title).slice(0, 150), description: buildDescription(it, true), link: urlOf(it), image_link: it.img, price: Number(it.price).toFixed(2) + ' ' + cfg.currency, brand: it.vendor || cfg.brandName,
  condition: 'new', category: googleCategory(it), product_type: it.category || 'Other', color: cols.slice(0, 3).join('/'), size: sizes[0] || '', gender: genderOf(it), age_group: ageOf(it), avail: availabilityOf(it) }; };
const metaHead = ['id', 'title', 'description', 'availability', 'condition', 'price', 'link', 'image_link', 'brand', 'google_product_category', 'product_type', 'color', 'gender', 'age_group', 'size'];
write('feeds/meta-catalog.csv', '\uFEFF' + metaHead.join(',') + '\n' + feedItems.map(it => { const r = rowsFor(it); return [r.id, r.title, r.description, META_AVAIL[r.avail] || 'in stock', r.condition, r.price, r.link, r.image_link, r.brand, r.category, r.product_type, r.color, r.gender, r.age_group, r.size].map(csvCell).join(','); }).join('\n') + '\n');
const pinHead = ['id', 'title', 'description', 'link', 'image_link', 'price', 'availability', 'google_product_category', 'product_type', 'brand', 'color', 'gender', 'age_group', 'condition'];
write('feeds/pinterest.tsv', pinHead.join('\t') + '\n' + feedItems.map(it => { const r = rowsFor(it); return [r.id, r.title, r.description, r.link, r.image_link, r.price, r.avail === 'out_of_stock' ? 'out of stock' : 'in stock', r.category, r.product_type, r.brand, r.color, r.gender, r.age_group, r.condition].map(tsvCell).join('\t'); }).join('\n') + '\n');

// the store's fast first screen (newest products, exactly in the store's own order)
write('products-first.json', JSON.stringify(items.slice(0, cfg.firstPageCount).map(it => (ENR[it.id] && ENR[it.id].lq) ? Object.assign({}, it, { lq: ENR[it.id].lq }) : it)));
const lqAll = {}; for (const it of items) if (ENR[it.id] && ENR[it.id].lq) lqAll[it.id] = ENR[it.id].lq;
write('lqip.json', JSON.stringify(lqAll));   // tiny colour mosaics: the store draws an SVG placeholder from these while the real photo loads
try { fs.copyFileSync(path.join(repoDir, 'seo', 'embed.js'), path.join(outDir, 'embed.js')); } catch (e) { /* optional file */ }
// data for embed.js (the "put the shop on any website" script): newest designs per seller, plus the whole marketplace
const embedItems = list => list.slice(0, 24).map(it => ({ t: cleanTitle(it.title), u: urlOf(it), i: thumb(it.img), p: Number(it.price) > 0 ? Number(it.price) : 0 }));
write('embed/all.json', JSON.stringify({ name: cfg.brandName, url: cfg.storeUrl + '/', wa: cfg.whatsappNumber, badges: [], items: embedItems(items) }));
for (const v of DIRECTORY) if (/^[A-Za-z0-9-]{1,20}$/.test(v.vendorCode)) write('embed/' + v.vendorCode + '.json', JSON.stringify({ name: v.vendorName, url: vendorUrl(v.vendorCode), wa: v.whatsapp ? '91' + String(v.whatsapp).replace(/\D/g, '').slice(-10) : '', badges: badgeList(v), items: embedItems(items.filter(it => it.vendorCode === v.vendorCode)) }));

// report
const cleaned = items.filter(it => cleanTitle(it.title) !== String(it.title).trim()).length;
const lines = [
  'ArtistryC Google pages: build report (' + new Date().toISOString() + ')',
  '',
  'Products read:                       ' + raw.length,
  'Product pages built:                 ' + nProductPages,
  'Category pages built:                ' + nCatPages,
  'Pages listed in the sitemaps:        ' + (nProductPages + pageUrls.length),
  'In the Google Shopping feed:         ' + feedItems.length,
  'NOT in the Shopping feed (no price): ' + skipped.noPrice + '   <- add a price in your sheet and they join the feed automatically',
  'Titles tidied (hashtags/dates out):  ' + cleaned,
  'Seller trust pages built:            ' + nVendorPages + (DIRECTORY.length ? '' : '   <- none yet (platform/directory.json not found)'),
  'Photo analysis available for:        ' + items.filter(it => ENR[it.id]).length + ' of ' + items.length + ' products' + (Object.keys(ENR).length ? '' : '   <- run "Analyse product photos" in GitHub Actions'),
  'Policy pages (privacy, terms, ...):  ' + (policyEnabled ? nPolicyPages + ' published' : 'NOT published. ' + (cfg.legal.reviewedByOwner === true ? 'Fill in: ' + legalMissing.join(', ') : 'Fill in legal details in seo/site.config.json and set "reviewedByOwner": true after you have read them')),
  'Other channel feeds:                 feeds/meta-catalog.csv, feeds/pinterest.tsv (' + feedItems.length + ' products each)',
  'Shopping availability used for "Ask & Order" products: ' + cfg.askAndOrderAvailability,
  ''
].concat(report.length ? ['Warnings:'].concat(report.map(r => ' - ' + r)) : ['No warnings.']);
write('seo-report.txt', lines.join('\n') + '\n');
console.log(lines.join('\n'));
