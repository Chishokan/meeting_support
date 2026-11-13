"""就業規則・各種規程（LibreOffice で .docx にしたもの）を、智翔館AI のナレッジ用 Markdown にする。

- 本文の段落と表を、出てくる順に取り出す（表は Markdown の表にする）
- 章は「## 第N章 …」、条は「### 第N条（…）」の見出しにする
- 目次・ページ番号・「複写・複製を厳に禁止します」などの残りかすを消す
- 本文中の確認の書き込み（「←…？」）は「〔確認中：…〕」にする
出力：out/<名前>.txt（本文だけ。front matter はあとで付ける）
"""
import re
import sys
import unicodedata
from pathlib import Path

import docx
from docx.table import Table
from docx.text.paragraph import Paragraph

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

JUNK = re.compile(r"^(PAGE.*|.*MERGEFORMAT.*|複写・複製を厳に禁止します|株式会社智翔館|[0-9０-９\s]+)$")


def cell_text(c) -> str:
    return re.sub(r"\s+", " ", c.text.replace("\n", " ")).strip().replace("|", "／")


def table_md(t: Table) -> list[str]:
    rows = []
    for r in t.rows:
        # 横に結合したセルは同じセル（_tc）が続くので1つにまとめる（文字が同じだけのセルはまとめない）
        dedup = []
        prev = None
        for c in r.cells:
            if prev is not None and c._tc is prev:
                continue
            dedup.append(cell_text(c))
            prev = c._tc
        rows.append(dedup)
    if not rows:
        return []
    width = max(len(r) for r in rows)
    rows = [r + [""] * (width - len(r)) for r in rows]
    # すべての行で空の列は消す
    keep = [i for i in range(width) if any(r[i] for r in rows)]
    rows = [[r[i] for i in keep] for r in rows]
    width = len(keep)
    # 同じ行が続いたら1つにする（縦に結合したセルの名残）
    uniq = []
    for r in rows:
        if uniq and uniq[-1] == r:
            continue
        uniq.append(r)
    rows = [r for r in uniq if any(r)]
    out = ["| " + " | ".join(rows[0]) + " |", "|" + "---|" * width]
    out += ["| " + " | ".join(r) + " |" for r in rows[1:]]
    return ["", *out, *leave_notes(rows), ""]


def leave_notes(rows: list[list[str]]) -> list[str]:
    """年次有給休暇の表（上下2段の見出しで「1年6ヶ月」を表す）に、読み方の注を付ける。"""
    if len(rows) < 3:
        return []
    top, sub = rows[0], rows[1]
    if not any("１年" in c or "1年" in c for c in top) or not any(re.search(r"[6６]\s*[ヶｶ]月", c) for c in sub):
        return []
    labels = []
    for a, b in zip(top, sub):
        lab = z2h(a + b).replace(" ", "").replace("カ月", "ヶ月").replace("ｶ月", "ヶ月")
        labels.append(lab)
    # 期間の列（「6ヶ月」を含む列）だけを使う
    cols = [i for i, l in enumerate(labels) if re.search(r"6ヶ月", l)]
    notes = []
    for r in rows[2:]:
        head = [z2h(c).replace(" ", "") for i, c in enumerate(r) if i not in cols and c]
        vals = [f"{labels[i]}で{z2h(r[i]).strip()}日" for i in cols if r[i]]
        if not vals:
            continue
        who = "・".join(head)
        if re.match(r"^[1-4１-４]日", who):
            m = re.match(r"^(\d)日・?(.*)$", who)
            who = f"週{m.group(1)}日（年{m.group(2)}日）" if m else who
        notes.append(f"- {who}：" + "、".join(vals))
        if who.startswith("週3日") and "3年6ヶ月で7日" in "、".join(vals):
            notes.append("  〔取り込み時の注：労働基準法施行規則の比例付与の表では、週3日・勤続3年6ヶ月は8日。規程の7日と食い違うため、総務に確認すること〕")
    return ["", "（表の読み方。取り込み時に表から書き出した）", *notes] if notes else []


def blocks(d: docx.document.Document):
    for el in d.element.body.iterchildren():
        tag = el.tag.split("}")[-1]
        if tag == "p":
            yield "p", Paragraph(el, d)
        elif tag == "tbl":
            yield "t", Table(el, d)


CHAPTER = re.compile(r"^\s*第\s*([0-9０-９]+)\s*章\s*(.*)$")
ARTICLE = re.compile(r"^\s*(第\s*[0-9０-９]+\s*条(?:の[0-9０-９]+)?)\s*([（(].*?[)）])\s*(.*)$")


def z2h(s: str) -> str:
    return unicodedata.normalize("NFKC", s)


def convert(path: Path) -> str:
    d = docx.Document(str(path))
    lines: list[str] = []
    for kind, b in blocks(d):
        if kind == "t":
            lines += table_md(b)
            continue
        text = b.text.replace("　　", "　").rstrip()
        if not text.strip():
            lines.append("")
            continue
        if JUNK.match(text.strip()):
            continue
        # 確認の書き込み
        text = re.sub(r"\s*[←⇐]\s*(.+?)\s*$", lambda m: f"　〔確認中：{m.group(1)}〕", text)
        m = CHAPTER.match(text)
        if m and len(text) < 40:
            title = re.sub(r"\s+", "", m.group(2))
            lines += ["", f"## 第{z2h(m.group(1))}章　{title}", ""]
            continue
        m = ARTICLE.match(text)
        # 「第42条（…）の規程にかかわらず」のように、行の頭にある条の参照は見出しにしない
        if m and m.group(3) and not re.match(r"^[\s　]", text[m.end(2):]):
            m = None
        if m and len(m.group(1)) < 12:
            head = re.sub(r"\s+", "", z2h(m.group(1)))
            paren = re.sub(r"\s+", "", m.group(2))
            lines += ["", f"### {head}{paren}"]
            rest = m.group(3).strip()
            if rest:
                lines.append(rest)
            continue
        lines.append(text)
    body = "\n".join(lines)
    body = re.sub(r"\n{3,}", "\n\n", body).strip() + "\n"
    return body


def strip_toc(body: str) -> str:
    """先頭の目次（見出しの並び）を落とす：2回目に出てくる最初の章見出しから本文とする。"""
    heads = [m.start() for m in re.finditer(r"^## 第1章", body, re.M)]
    if len(heads) >= 2:
        # 目次のあとの表題・前文は残す（「（前　文）」から本文とする）
        pre = re.search(r"^.*\n*（前\s*文）", body[heads[0]:heads[1]], re.M)
        if pre:
            return body[heads[0] + body[heads[0]:heads[1]].index("（前"):]
        return body[heads[1]:]
    return body


seen = set()
for p in sorted(SRC.glob("*.docx")):
    key = unicodedata.normalize("NFC", p.name)
    if key in seen:
        continue
    seen.add(key)
    b = strip_toc(convert(p))
    name = re.sub(r"^\d+[^（(]*?(?=[^\d①-⑳修正回目]{2,})", "", unicodedata.normalize("NFC", p.stem))
    (OUT / f"{key.replace('.docx', '')}.txt").write_text(b, encoding="utf-8")
    print(f"{len(b):6d}  {key}")
