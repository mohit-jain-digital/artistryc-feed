"""Turns detected attributes into a description and styling tips. Only says what was detected; never invents fabric, size or price."""
CATEGORY_NOUN = {'Sarees': 'saree', 'Lehenga Choli': 'lehenga choli', 'Salwar Suits': 'salwar suit', 'Kurtis': 'kurti', 'Ladies Tops': 'top', 'Women Shirts': 'shirt',
                 'Blouse': 'blouse', 'Ladies Bottom': 'bottom wear', 'Co-ord Sets': 'co-ord set', 'Gowns': 'gown', 'Dress': 'dress', 'Shrugs': 'shrug', 'Winter Outfits': 'winter outfit',
                 'Dupattas': 'dupatta', 'Mens Wear': 'menswear outfit', 'Kidswear': 'kidswear outfit', 'Navratri Outfits': 'Navratri outfit', 'Accessories': 'accessory'}
TIPS = {
    'Sarees': ['Pair it with a contrast blouse to make the colour stand out.', 'Keep jewellery simple if the saree has heavy work, and go bolder if it is plain.'],
    'Lehenga Choli': ['Choose a dupatta drape that shows the border: pinned over one shoulder works well.', 'Pick heels or flats you can dance in; the hem should just skim the floor.'],
    'Salwar Suits': ['Match the dupatta to the bottom or the border for a finished look.', 'Add juttis and small earrings for the day, a statement pair for the evening.'],
    'Kurtis': ['Wear with leggings or palazzos for everyday, or straight pants for work.', 'A light dupatta or jacket changes the look for an evening out.'],
    'Gowns': ['Check the length against your heels before the event.', 'Let the gown be the focus: one statement piece of jewellery is enough.'],
    'Mens Wear': ['Pair with simple footwear such as mojaris or loafers.', 'Add a stole or jacket for a more formal occasion.'],
    'Kidswear': ['Choose comfortable footwear so the child can move freely.', 'Keep accessories light and easy to remove.'],
}
GENERIC_TIPS = ['Check the size and delivery time with the seller on WhatsApp before you order.', 'Follow the care label and dry clean heavily worked pieces.']
OCCASION_USE = {'wedding': 'weddings', 'festive': 'festivals', 'party': 'parties', 'daily wear': 'everyday wear', 'office': 'office wear', 'haldi or mehendi': 'haldi and mehendi functions'}

def join_and(items):
    items = [i for i in items if i]
    return items[0] if len(items) == 1 else (', '.join(items[:-1]) + ' and ' + items[-1] if items else '')

def build(product, attrs):
    """product: dict with title/category. attrs: dict with colors, work, occasion, style (lists of strings). Returns {'d': str, 't': [str]}."""
    cat = product.get('category') or ''
    noun = CATEGORY_NOUN.get(cat, 'outfit')
    colors, work, occ, style = (attrs.get(k) or [] for k in ('colors', 'work', 'occasion', 'style'))
    parts = []
    rest = (join_and(colors[:2]) + ' ' if colors else '') + noun
    lead = ('An ' if rest[0].lower() in 'aeiou' else 'A ') + rest
    if work and work != ['solid']:
        w = [x for x in work if x != 'solid']
        lead += ' with ' + join_and(w[:2])
    elif work == ['solid']:
        lead += ' in a plain solid finish'
    parts.append(lead + '.')
    if style:
        parts.append('The style is ' + join_and(style[:2]) + '.')
    if occ:
        parts.append('It suits ' + join_and([OCCASION_USE.get(o, o) for o in occ[:3]]) + '.')
    parts.append('Colour and style notes are taken from the product photo; ask the seller for fabric, size and delivery details.')
    return {'d': ' '.join(parts), 't': (TIPS.get(cat, []) + GENERIC_TIPS)[:3]}
