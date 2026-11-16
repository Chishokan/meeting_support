import json, sys, os
from PIL import Image, ImageDraw, ImageFont
raw, out = sys.argv[1], sys.argv[2]
boxes = json.load(open(os.path.join(raw, 'boxes.json')))
S = 2; RED = (224, 38, 47)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
for name, v in boxes.items():
    im = Image.open(os.path.join(raw, name + '.png')).convert('RGB'); d = ImageDraw.Draw(im)
    oy = v['clip']['y'] if v['clip'] else 0
    for m in v['marks']:
        x, y, w, h = m['x'] * S, (m['y'] - oy) * S, m['w'] * S, m['h'] * S
        d.rounded_rectangle([x, y, x + w, y + h], radius=10, outline=RED, width=5)
        r = 24; cx, cy = max(r + 2, x - 6), max(r + 2, y - 6)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED)
        t = str(m['n']); d.text((cx - d.textlength(t, font=font) / 2, cy - 18), t, fill='white', font=font)
    im.save(os.path.join(out, name + '.png'), optimize=True)
def crop(name, top, bottom):
    im = Image.open(os.path.join(out, name + '.png')); im.crop((0, top * S, im.size[0], bottom * S)).save(os.path.join(out, name + '.png'), optimize=True)
def stitch(name, parts):
    im = Image.open(os.path.join(out, name + '.png')); pieces = [im.crop((0, a * S, im.size[0], b * S)) for a, b in parts]; gap = 16
    o = Image.new('RGB', (im.size[0], sum(p.size[1] for p in pieces) + gap * (len(pieces) - 1)), (255, 255, 255)); y = 0; dr = ImageDraw.Draw(o)
    for i, p in enumerate(pieces):
        o.paste(p, (0, y)); y += p.size[1]
        if i < len(pieces) - 1: dr.line([(0, y + gap // 2), (im.size[0], y + gap // 2)], fill=(200, 205, 212), width=2); y += gap
    o.save(os.path.join(out, name + '.png'), optimize=True)
crop('ai_01_menu', 0, 560)
crop('ai_02_top', 0, 1180)
crop('ai_03_answer', 0, 800)
crop('ai_05_ask', 0, 600)
stitch('ai_06_made', [(0, 1210), (1735, 1815)])
# 見比べる小窓だけを切り出す
b = boxes['ai_11_diff']['marks']; crop('ai_11_diff', max(0, min(m['y'] for m in b) - 120), max(m['y'] + m['h'] for m in b) + 30)
for name in ('ai_07_report', 'ai_08_request'):
    b = boxes[name]['marks']; bottom = max(m['y'] + m['h'] for m in b) + 40; top = max(0, min(m['y'] for m in b) - 110)
    crop(name, top, bottom)
