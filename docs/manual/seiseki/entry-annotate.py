# 成績管理「成績入力」マニュアルの写真に赤枠と番号を付ける（entry-shots.js が撮った写真と boxes.json から）。
#   python3 docs/manual/seiseki/entry-annotate.py 撮った写真のフォルダ docs/manual/images
# 写真は撮るときに切り取ってある（boxes.json の clip）ので、ここでは枠と番号だけを付ける。
import json, sys, os
from PIL import Image, ImageDraw, ImageFont
raw, out = sys.argv[1], sys.argv[2]
boxes = json.load(open(os.path.join(raw, 'boxes.json')))
S = 2; RED = (224, 38, 47)
font = ImageFont.truetype('/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf', 30)
for name, v in boxes.items():
    im = Image.open(os.path.join(raw, name + '.png')).convert('RGB'); d = ImageDraw.Draw(im)
    ox = v['clip']['x'] if v['clip'] else 0
    oy = v['clip']['y'] if v['clip'] else 0
    for m in v['marks']:
        x, y, w, h = (m['x'] - ox) * S, (m['y'] - oy) * S, m['w'] * S, m['h'] * S
        d.rounded_rectangle([x, y, x + w, y + h], radius=10, outline=RED, width=5)
        r = 24; cx, cy = max(r + 2, x - 6), max(r + 2, y - 6)
        d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=RED)
        t = str(m['n']); d.text((cx - d.textlength(t, font=font) / 2, cy - 18), t, fill='white', font=font)
    im.save(os.path.join(out, name + '.png'), optimize=True)
