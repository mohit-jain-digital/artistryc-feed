import json, os, sys, tempfile, unittest
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from PIL import Image, ImageDraw
import enrich, textgen, merge

def img(center, bg=(245, 245, 245), size=(120, 160)):
    im = Image.new('RGB', size, bg); d = ImageDraw.Draw(im); w, h = size
    d.rectangle([int(w * .15), int(h * .12), int(w * .85), int(h * .9)], fill=center); return im

PICS = {'https://i.pinimg.com/474x/aa/red.jpg': img((200, 30, 40)), 'https://i.pinimg.com/474x/aa/navy.jpg': img((25, 35, 90)), 'https://i.pinimg.com/474x/aa/green.jpg': img((40, 140, 70), bg=(20, 20, 20)),
        'https://i.pinimg.com/474x/aa/two.jpg': None}
two = Image.new('RGB', (120, 160), (245, 245, 245)); d = ImageDraw.Draw(two); d.rectangle([18, 20, 60, 140], fill=(225, 40, 130)); d.rectangle([60, 20, 102, 140], fill=(215, 170, 40)); PICS['https://i.pinimg.com/474x/aa/two.jpg'] = two

class Stub:
    calls = 0
    def classify(self, images):
        Stub.calls += len(images); return [{'work': ['embroidery', 'zari'], 'occasion': ['wedding'], 'style': ['traditional']} for _ in images]

def fetcher(url):
    if url not in PICS: raise RuntimeError('HTTP 404')
    return PICS[url]

PRODUCTS = [{'id': 'p-red', 'title': 'Red saree', 'category': 'Sarees', 'img': 'https://i.pinimg.com/originals/aa/red.jpg'},
            {'id': 'p-navy', 'title': 'Navy kurti', 'category': 'Kurtis', 'img': 'https://i.pinimg.com/736x/aa/navy.jpg'},
            {'id': 'p-green', 'title': 'Green gown', 'category': 'Gowns', 'img': 'https://i.pinimg.com/474x/aa/green.jpg'},
            {'id': 'p-two', 'title': 'Two tone', 'category': 'Lehenga Choli', 'img': 'https://i.pinimg.com/474x/aa/two.jpg'},
            {'id': 'p-broken', 'title': 'Broken', 'category': 'Sarees', 'img': 'https://i.pinimg.com/474x/aa/missing.jpg'},
            {'title': 'No id', '_row': 7, 'category': 'Sarees', 'img': 'https://i.pinimg.com/474x/aa/red.jpg'},
            {'id': 'p-http', 'title': 'Insecure', 'category': 'Sarees', 'img': 'http://insecure.example/x.jpg'}]

class T(unittest.TestCase):
    def setUp(self):
        self.d = tempfile.mkdtemp(); self.pj = os.path.join(self.d, 'products.json'); json.dump(PRODUCTS, open(self.pj, 'w'))
        self.run_args = lambda out, *extra: ['--products', self.pj, '--existing', os.path.join(self.d, 'none.json'), '--out', os.path.join(self.d, out)] + list(extra)

    def test_colours_come_from_the_garment_not_the_white_background(self):
        r = enrich.main(self.run_args('o.json'), classifier=Stub(), fetcher=fetcher)
        self.assertEqual(r['p-red']['c'], ['red']); self.assertEqual(r['p-navy']['c'], ['navy']); self.assertEqual(r['p-green']['c'], ['green'])
        self.assertEqual(sorted(r['p-two']['c']), sorted(['hot pink', 'mustard']))

    def test_mosaic_format(self):
        r = enrich.main(self.run_args('o.json'), classifier=Stub(), fetcher=fetcher)
        ratio, cells = r['p-red']['lq'].split('|'); self.assertEqual(ratio, '120:160'); self.assertEqual(len(cells), 36)
        self.assertTrue(all(ch in '0123456789abcdef' for ch in cells)); self.assertAlmostEqual(r['p-red']['ar'], 0.75, 2)

    def test_failures_and_bad_links_are_skipped_without_stopping(self):
        r = enrich.main(self.run_args('o.json'), classifier=Stub(), fetcher=fetcher)
        self.assertNotIn('p-broken', r); self.assertNotIn('p-http', r); self.assertIn('row-7', r)       # product with no id gets row-N like the page builder

    def test_resumes_without_redoing_work(self):
        out1 = os.path.join(self.d, 'e.json'); enrich.main(self.run_args('o1.json'), classifier=Stub(), fetcher=fetcher)
        json.dump(json.load(open(os.path.join(self.d, 'o1.json'))), open(out1, 'w')); Stub.calls = 0
        r = enrich.main(['--products', self.pj, '--existing', out1, '--out', os.path.join(self.d, 'o2.json')], classifier=Stub(), fetcher=fetcher)
        self.assertEqual(Stub.calls, 0); self.assertEqual(r, {})
        P2 = [dict(p) for p in PRODUCTS]; P2[0]['img'] = 'https://i.pinimg.com/originals/aa/navy.jpg'; json.dump(P2, open(self.pj, 'w'))     # a changed photo is analysed again
        r = enrich.main(['--products', self.pj, '--existing', out1, '--out', os.path.join(self.d, 'o3.json')], classifier=Stub(), fetcher=fetcher)
        self.assertEqual(list(r), ['p-red']); self.assertEqual(r['p-red']['c'], ['navy'])

    def test_shards_cover_everything_exactly_once(self):
        seen = []
        for s in range(3): seen += list(enrich.main(self.run_args('s%d.json' % s, '--shard', str(s), '--of', '3'), classifier=Stub(), fetcher=fetcher))
        whole = list(enrich.main(self.run_args('w.json'), classifier=Stub(), fetcher=fetcher))
        self.assertEqual(sorted(seen), sorted(whole)); self.assertEqual(len(seen), len(set(seen)))

    def test_no_model_mode_gives_colours_only_and_is_upgraded_later(self):
        r = enrich.main(self.run_args('n.json', '--no-model'), fetcher=fetcher)
        self.assertEqual(r['p-red']['w'], []); self.assertEqual(r['p-red']['c'], ['red']); self.assertIn('red', r['p-red']['d']); self.assertNotIn('embroidery', r['p-red']['d'])
        self.assertTrue(r['p-red']['m'].endswith('-nomodel'))
        json.dump(r, open(os.path.join(self.d, 'prev.json'), 'w')); r2 = enrich.main(['--products', self.pj, '--existing', os.path.join(self.d, 'prev.json'), '--out', os.path.join(self.d, 'up.json')], classifier=Stub(), fetcher=fetcher)
        self.assertIn('p-red', r2)     # a colours-only result is redone once the model is available

    def test_limit_for_a_dry_run(self):
        self.assertEqual(len(enrich.main(self.run_args('l.json', '--limit', '2'), classifier=Stub(), fetcher=fetcher)), 2)

    def test_pick_only_speaks_when_sure(self):
        names = ['a', 'b', 'c']
        self.assertEqual(enrich.pick(names, [0.34, 0.33, 0.33]), [])                 # unsure: nothing
        self.assertEqual(enrich.pick(names, [0.7, 0.2, 0.1]), ['a'])
        self.assertEqual(enrich.pick(names, [0.5, 0.3, 0.2]), ['a', 'b'])            # clear runner-up kept
        self.assertEqual(enrich.pick(names, [0.5, 0.3, 0.2], limit=1), ['a'])

    def test_text_is_honest(self):
        t = textgen.build({'category': 'Sarees'}, {'colors': ['red', 'gold'], 'work': ['zari', 'embroidery'], 'occasion': ['wedding', 'festive'], 'style': ['traditional']})
        self.assertIn('red and gold saree with zari and embroidery', t['d']); self.assertIn('weddings and festivals', t['d']); self.assertIn('taken from the product photo', t['d'])
        for bad in ['silk', 'cotton', 'pure', 'handloom', 'sizes:', '₹', 'pure ']: self.assertNotIn(bad, t['d'].lower())
        self.assertTrue(1 <= len(t['t']) <= 3)
        e = textgen.build({'category': 'Unknown thing'}, {}); self.assertTrue(e['d'].startswith('An outfit'))

    def test_merge_keeps_old_adds_new_and_drops_gone(self):
        ex = os.path.join(self.d, 'old.json'); json.dump({'p-red': {'h': 'x'}, 'gone-1': {'h': 'y'}}, open(ex, 'w')); json.dump({'p-navy': {'h': 'z'}, 'p-red': {'h': 'new'}}, open(os.path.join(self.d, 'part-1.json'), 'w'))
        out = os.path.join(self.d, 'data', 'enrichment.json'); merge.main(ex, os.path.join(self.d, 'part-*.json'), self.pj, out); m = json.load(open(out))
        self.assertEqual(sorted(m), ['p-navy', 'p-red']); self.assertEqual(m['p-red']['h'], 'new')

if __name__ == '__main__': unittest.main(verbosity=1)
