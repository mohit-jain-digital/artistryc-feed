#!/usr/bin/env python3
"""Reads each product photo and writes colours, work, occasion, style, a short description, styling tips and a tiny colour mosaic.

  colours + mosaic : measured from the pixels (no AI needed, always reliable)
  work/occasion/style : zero-shot FashionCLIP (patrickjohncyh/fashion-clip, MIT licence), with a confidence threshold
Incremental: a product is only analysed again when its photo link or this script's version changes.

  python enrich/enrich.py --products products.json --existing data/enrichment.json --out part.json [--shard 0 --of 6] [--limit 20] [--no-model]
"""
import argparse, hashlib, io, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import textgen

VERSION = 'fclip-1'
PALETTE = json.load(open(os.path.join(HERE, 'palette.json')))
LABELS = json.load(open(os.path.join(HERE, 'labels.json')))
GRID_W, GRID_H = 4, 3


def thumb_url(u):
    import re
    return re.sub(r'/(originals|\d+x)/', '/474x/', u or '')


def photo_hash(u):
    return hashlib.sha1((u or '').encode()).hexdigest()[:10]


def nearest_color(rgb):
    best, bd = None, 1e18
    for name, p in PALETTE.items():
        d = sum((a - b) ** 2 * w for a, b, w in zip(rgb, p, (0.30, 0.59, 0.11)))   # eyes notice green most
        if d < bd: best, bd = name, d
    return best


def analyse_pixels(img):
    """-> {'colors': [...], 'lq': 'ratio|hex...', 'ar': float}. Colours come from the middle of the photo (the garment), not the background edges."""
    from PIL import Image
    import numpy as np
    img = img.convert('RGB'); w, h = img.size
    small = img.resize((48, max(1, round(48 * h / w))))
    arr = np.asarray(small, dtype='float32'); H, W, _ = arr.shape
    core = arr[int(H * .2):int(H * .85), int(W * .2):int(W * .8)].reshape(-1, 3)
    # drop near-white / near-black pixels that are usually background or shadow unless they are most of the picture
    lum = core @ [0.30, 0.59, 0.11]; keep = core[(lum > 28) & (lum < 242)]
    use = keep if len(keep) > len(core) * 0.2 else core
    counts = {}
    for px in use[::2]:
        n = nearest_color(px); counts[n] = counts.get(n, 0) + 1
    total = sum(counts.values()) or 1
    ranked = sorted(counts.items(), key=lambda kv: -kv[1])
    colors = [n for n, c in ranked if c / total >= 0.18][:2] or [ranked[0][0]]
    mini = img.resize((GRID_W, GRID_H), Image.BILINEAR)
    cells = ''.join('%x%x%x' % tuple(v >> 4 for v in mini.getpixel((x, y))) for y in range(GRID_H) for x in range(GRID_W))
    return {'colors': colors, 'lq': '%d:%d|%s' % (w, h, cells), 'ar': round(w / h, 3)}


class FashionClip:
    def __init__(self):
        import torch
        from transformers import CLIPModel, CLIPProcessor
        self.torch = torch
        self.model = CLIPModel.from_pretrained('patrickjohncyh/fashion-clip').eval()
        self.proc = CLIPProcessor.from_pretrained('patrickjohncyh/fashion-clip')
        self.groups = {}
        with torch.no_grad():
            for g, labels in LABELS.items():
                names = list(labels); prompts = ['a photo of ' + labels[n] for n in names]
                t = self.proc(text=prompts, return_tensors='pt', padding=True)
                f = self.model.get_text_features(**t); f = f / f.norm(dim=-1, keepdim=True)
                self.groups[g] = (names, f)

    def classify(self, images):
        """images: list of PIL -> list of {'work': [...], 'occasion': [...], 'style': [...]} using softmax within each group."""
        torch = self.torch
        with torch.no_grad():
            pix = self.proc(images=images, return_tensors='pt')
            f = self.model.get_image_features(**pix); f = f / f.norm(dim=-1, keepdim=True)
            out = [dict() for _ in images]
            for g, (names, tf) in self.groups.items():
                probs = (100.0 * f @ tf.T).softmax(dim=-1)
                for i in range(len(images)):
                    out[i][g] = pick(names, probs[i].tolist())
        return out


def pick(names, probs, top=0.35, second=0.25, limit=2):
    """Keep the best label only when the model is reasonably sure, plus a clear runner-up. Unsure = say nothing."""
    order = sorted(range(len(names)), key=lambda i: -probs[i]); res = []
    if probs[order[0]] >= top:
        res.append(names[order[0]])
        if len(order) > 1 and probs[order[1]] >= second and limit > 1: res.append(names[order[1]])
    return res


def fetch(url, tries=3):
    import requests
    from PIL import Image
    last = None
    for k in range(tries):
        try:
            r = requests.get(url, timeout=20, headers={'User-Agent': 'Mozilla/5.0 (compatible; ArtistryC-enrich/1.0)'})
            if r.status_code == 200 and len(r.content) > 500:
                im = Image.open(io.BytesIO(r.content)); im.load(); return im
            last = 'HTTP %s' % r.status_code
        except Exception as e:  # network or a broken image: try again, then give up on this product only
            last = str(e)[:80]
        time.sleep(1.5 * (k + 1))
    raise RuntimeError(last or 'failed')


def main(argv=None, classifier=None, fetcher=fetch):
    ap = argparse.ArgumentParser()
    ap.add_argument('--products', default='products.json'); ap.add_argument('--existing', default='data/enrichment.json'); ap.add_argument('--out', required=True)
    ap.add_argument('--shard', type=int, default=0); ap.add_argument('--of', type=int, default=1); ap.add_argument('--limit', type=int, default=0)
    ap.add_argument('--no-model', action='store_true', help='colours and mosaic only (no AI model)'); ap.add_argument('--batch', type=int, default=16)
    a = ap.parse_args(argv)
    products = json.load(open(a.products, encoding='utf-8'))
    for i, p in enumerate(products):
        if not p.get('id'): p['id'] = 'row-%s' % p.get('_row', i)
    existing = {}
    if os.path.exists(a.existing):
        try: existing = json.load(open(a.existing, encoding='utf-8'))
        except Exception: existing = {}
    model_tag = VERSION + ('-nomodel' if a.no_model and classifier is None else '')
    todo = []
    for p in products:
        if int(hashlib.md5(str(p['id']).encode()).hexdigest(), 16) % a.of != a.shard: continue
        e = existing.get(p['id'])
        if e and e.get('h') == photo_hash(p.get('img')) and (e.get('m') == model_tag or (e.get('m') == VERSION and a.no_model)): continue
        if not (p.get('img') or '').startswith('https://'): continue
        todo.append(p)
    if a.limit: todo = todo[:a.limit]
    print('shard %d/%d: %d products to analyse (%d already done)' % (a.shard, a.of, len(todo), len(products) - len(todo)))
    clf = classifier
    if clf is None and not a.no_model: clf = FashionClip()
    result, failed = {}, 0
    with ThreadPoolExecutor(max_workers=8) as ex:
        for s in range(0, len(todo), a.batch):
            chunk = todo[s:s + a.batch]
            imgs = list(ex.map(lambda p: _try(fetcher, thumb_url(p['img'])), chunk))
            ok_idx = [i for i, im in enumerate(imgs) if not isinstance(im, Exception)]
            cls = clf.classify([imgs[i] for i in ok_idx]) if (clf and ok_idx) else []
            for j, i in enumerate(ok_idx):
                p, im = chunk[i], imgs[i]
                px = analyse_pixels(im); c = cls[j] if cls else {}
                attrs = {'colors': px['colors'], 'work': c.get('work', []), 'occasion': c.get('occasion', []), 'style': c.get('style', [])}
                t = textgen.build(p, attrs)
                result[p['id']] = {'h': photo_hash(p['img']), 'm': model_tag, 'c': attrs['colors'], 'w': attrs['work'], 'o': attrs['occasion'], 's': attrs['style'], 'd': t['d'], 't': t['t'], 'lq': px['lq'], 'ar': px['ar']}
            for i, im in enumerate(imgs):
                if isinstance(im, Exception): failed += 1; print('  skipped %s: %s' % (chunk[i]['id'], im))
            print('  %d/%d' % (min(s + a.batch, len(todo)), len(todo)), flush=True)
    json.dump(result, open(a.out, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'))
    print('wrote %d, skipped %d' % (len(result), failed))
    return result


def _try(fetcher, url):
    try: return fetcher(url)
    except Exception as e: return e


if __name__ == '__main__':
    main()
