/*!
 * ArtistryC embed: put your shop on ANY website with one line (or one Google Tag Manager tag).
 *
 *   <script src="https://shop.artistryc.in/embed.js" data-seller="V-XXXXXX" async></script>
 *
 * Adds, inside a sealed "shadow" box that cannot clash with the host website's styles:
 *   - a round "Shop" button in a corner that opens a panel with the newest designs (each links to its own page)
 *   - optionally a trust badge ("Approved seller since ...") placed where the script tag sits: data-badge="inline"
 * Options (data- attributes on the script tag):
 *   data-seller    seller code, for example V-AB12CD. Leave out to show the whole marketplace.
 *   data-position  "right" (default) or "left"
 *   data-label     text on the button, default "Shop"
 *   data-color     button colour as #RRGGBB, default #111111
 *   data-count     how many designs to show, default 12 (max 24)
 *   data-badge     "inline" to show the trust badge; data-button="off" to show only the badge
 *   data-target    CSS selector of the element to put the badge in (needed with Google Tag Manager), for example "#trust-slot"
 * It sets no cookies, uses no browser storage and sends nothing anywhere except to ask this website for the design list.
 * Honest limits: the designs it draws are not read by Google as part of the host page (your own product pages are for that),
 * and it adds a little JavaScript to the host page, so keep it to this one line.
 */
(function () {
  if (window.__artistrycEmbed) return; window.__artistrycEmbed = true;
  var tag = document.currentScript || document.querySelector('script[src*="/embed.js"][data-seller],script[src*="shop.artistryc.in/embed.js"]');
  var BASE = ((tag && tag.src || '').match(/^(https:\/\/[^\/]+)\//) || [])[1] || 'https://shop.artistryc.in';
  var attr = function (n, d) { return (tag && tag.getAttribute('data-' + n)) || d; };
  var seller = /^[A-Za-z0-9-]{1,20}$/.test(attr('seller', '')) ? attr('seller', '') : '';
  var pos = attr('position', 'right') === 'left' ? 'left' : 'right', label = attr('label', 'Shop').slice(0, 20), color = /^#[0-9a-f]{6}$/i.test(attr('color', '')) ? attr('color', '') : '#111111';
  var count = Math.max(1, Math.min(24, parseInt(attr('count', '12'), 10) || 12)), wantBadge = attr('badge', '') === 'inline', wantButton = attr('button', 'on') !== 'off';
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var okUrl = function (u) { return /^https:\/\//.test(u) ? u : '#'; };
  var BASECSS = ':host{all:initial}*{box-sizing:border-box}.f{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#111}';
  function host(css, html, where, before) {
    var h = document.createElement('div'); h.setAttribute('data-artistryc', ''); var root = h.attachShadow ? h.attachShadow({ mode: 'open' }) : h;
    root.innerHTML = '<style>' + css + '</style>' + html; if (before && where) where.insertBefore(h, before); else (where || document.body).appendChild(h); return root;
  }
  var cache = null;
  function data() { if (!cache) cache = fetch(BASE + '/embed/' + (seller || 'all') + '.json').then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }); return cache; }

  function badge() {
    data().then(function (d) {
      if (!d.badges || !d.badges.length) return;
      var target = attr('target', ''), slot = null; try { slot = target ? document.querySelector(target) : null; } catch (e) { slot = null; }
      var inBody = tag && tag.parentNode && tag.parentNode !== document.head && document.body.contains(tag);
      var where = slot || (inBody ? tag.parentNode : document.body), before = slot ? null : (inBody ? tag.nextSibling : null);
      host(BASECSS + '.b{display:inline-flex;align-items:center;flex-wrap:wrap;gap:6px 10px;border:1px solid #2e9e5b;background:#eefaf2;color:#176b3a;border-radius:14px;padding:8px 14px;text-decoration:none;font-weight:700;font-size:13px}.b u{font-weight:400}',
        '<a class="f b" href="' + esc(okUrl(d.url)) + '" target="_blank" rel="noopener">&#10003; ' + d.badges.map(esc).join(' &middot; ') + ' <u>Seller page</u></a>', where, before);
    }).catch(function () { /* the badge is optional: stay silent */ });
  }

  function shop() {
    var root = host(BASECSS + '.btn{position:fixed;' + pos + ':16px;bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483000;min-height:52px;padding:0 22px;border-radius:999px;border:0;background:' + color + ';color:#fff;font:700 15px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 6px 20px rgba(0,0,0,.3);cursor:pointer}'
      + '.ov{position:fixed;inset:0;z-index:2147483001;background:rgba(0,0,0,.5);display:none}.ov.on{display:block}'
      + '.pn{position:absolute;' + pos + ':0;top:0;bottom:0;width:min(440px,100%);background:#fff;overflow:auto;padding:16px;box-shadow:0 0 30px rgba(0,0,0,.25)}'
      + '.hd{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}.hd b{font-size:18px}.x{background:none;border:0;font-size:30px;line-height:1;cursor:pointer;padding:4px 10px}'
      + '.g{display:grid;grid-template-columns:repeat(2,1fr);gap:12px}.c{display:block;text-decoration:none;color:#111}.im{aspect-ratio:3/4;background:#f2f2f2;border-radius:12px;overflow:hidden}.c img{width:100%;height:100%;object-fit:cover;display:block}.n{font-size:12px;font-weight:700;margin:6px 2px 0;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}.p{font-size:13px;font-weight:800;margin:2px}'
      + '.ft{margin:16px 0 4px;display:flex;gap:10px;flex-wrap:wrap}.ft a{flex:1 1 140px;text-align:center;padding:13px;border-radius:999px;text-decoration:none;font-weight:800;font-size:14px;background:#111;color:#fff}.ft a.w{background:#25d366}',
      '<button class="btn" type="button" aria-haspopup="dialog">' + esc(label) + '</button><div class="ov" role="dialog" aria-modal="true" aria-label="Shop"><div class="pn f"><div class="hd"><b>New designs</b><button class="x" type="button" aria-label="Close">&times;</button></div><div class="g"><p>Loading&hellip;</p></div><div class="ft"></div></div></div>');
    var btn = root.querySelector('.btn'), ov = root.querySelector('.ov'), grid = root.querySelector('.g'), ft = root.querySelector('.ft'), x = root.querySelector('.x'), loaded = false;
    function close() { ov.classList.remove('on'); btn.focus(); }
    function load() {
      if (loaded) return; loaded = true;
      data().then(function (d) {
        var items = (d.items || []).slice(0, count);
        grid.innerHTML = items.length ? items.map(function (it) { return '<a class="c" href="' + esc(okUrl(it.u)) + '" target="_blank" rel="noopener"><div class="im"><img src="' + esc(okUrl(it.i)) + '" alt="' + esc(it.t) + '" loading="lazy" width="474" height="632"></div><div class="n">' + esc(it.t) + '</div>' + (it.p > 0 ? '<div class="p">&#8377;' + Number(it.p).toLocaleString('en-IN') + '</div>' : '') + '</a>'; }).join('') : '<p>Open the shop to see all designs.</p>';
        ft.innerHTML = '<a href="' + esc(okUrl(d.url)) + '" target="_blank" rel="noopener">Open ' + esc(d.name || 'the shop') + '</a>' + (d.wa ? '<a class="w" href="https://wa.me/' + esc(String(d.wa).replace(/\D/g, '')) + '" target="_blank" rel="noopener">WhatsApp</a>' : '');
      }).catch(function () { grid.innerHTML = '<p>Could not load designs right now. Please try again later.</p>'; });
    }
    btn.addEventListener('click', function () { ov.classList.add('on'); load(); x.focus(); });
    x.addEventListener('click', close); ov.addEventListener('click', function (e) { if (e.target === ov) close(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && ov.classList.contains('on')) close(); });
  }
  function init() { if (wantBadge) badge(); if (wantButton) shop(); }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
})();
