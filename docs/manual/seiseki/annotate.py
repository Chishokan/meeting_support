# 成績管理「生徒の追加」マニュアルの写真に赤枠と番号を付け、余白を切る（shots.js が撮った写真と boxes.json から）。
#   python3 docs/manual/seiseki/annotate.py 撮った写真のフォルダ docs/manual/images
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
    im = Image.open(os.path.join(out, name + '.png')); im.crop((0, top * S, im.size[0], min(im.size[1], bottom * S))).save(os.path.join(out, name + '.png'), optimize=True)
# 受験票：見出しの下から、生徒の一覧と受験票のはじめまで
crop('seiseki_05_ticket', 92, 640)
# 成績入力：上の欄とボタン・名簿のはじめ（図2）、追加した行のまわり（図3）、保存の表示から追加した行まで（図4）
crop('seiseki_02_entry', 0, 420)
crop('seiseki_03_added', 236, 620)
crop('seiseki_04_filled', 92, 620)
