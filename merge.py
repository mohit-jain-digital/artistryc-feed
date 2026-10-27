#!/usr/bin/env python3
"""Combines the shard results with what was already known, drops products that no longer exist, and writes data/enrichment.json."""
import glob, json, os, sys
def main(existing_path, parts_glob, products_path, out_path):
    existing = json.load(open(existing_path, encoding='utf-8')) if os.path.exists(existing_path) else {}
    for f in sorted(glob.glob(parts_glob)):
        existing.update(json.load(open(f, encoding='utf-8')))
    ids = set()
    for i, p in enumerate(json.load(open(products_path, encoding='utf-8'))): ids.add(p.get('id') or 'row-%s' % p.get('_row', i))
    kept = {k: v for k, v in existing.items() if k in ids}
    os.makedirs(os.path.dirname(out_path) or '.', exist_ok=True)
    json.dump(kept, open(out_path, 'w', encoding='utf-8'), ensure_ascii=False, separators=(',', ':'), sort_keys=True)
    print('enrichment: %d products (%d removed because the product is gone)' % (len(kept), len(existing) - len(kept)))
if __name__ == '__main__':
    main(*sys.argv[1:5])
