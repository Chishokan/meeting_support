"""就業規則・各種規程（LibreOffice で .docx にしたもの）を、智翔館AI のナレッジ用 Markdown にする。

- 本文の段落と表を、出てくる順に取り出す（表は Markdown の表にする）
- 章は「## 第N章 …」、条は「### 第N条（…）」の見出しにする
- 目次・ページ番号・「複写・複製を厳に禁止します」などの残りかすを消す
- Word の自動番号（①②…）は、文字として取れないので数えて振る
- 取り消し線の文字は落とす（改定で削った文）。残りが「削除」だけなら、何を削ったかを（ ）で添える
- 本文中の確認の書き込み（「←…」「→…？」）は「〔確認中：…〕」にする。青字（00B0F0）の文も確認の書き込みとして印を付ける
  （赤字は改定で足した文なので、そのまま本文にする）
出力：out/<名前>.txt（本文だけ。front matter はあとで付ける）
"""
import re
import sys
import unicodedata
from pathlib import Path

import docx
from docx.table import Table
from docx.oxml.ns import qn
from docx.text.paragraph import Paragraph

SRC = Path(sys.argv[1])
OUT = Path(sys.argv[2])
OUT.mkdir(parents=True, exist_ok=True)

JUNK = re.compile(r"^(PAGE.*|.*MERGEFORMAT.*|複写・複製を厳に禁止します|株式会社智翔館|[0-9０-９\s]+)$")


def W(tag: str) -> str:
    return qn("w:" + tag)


BLUE = "00B0F0"  # 原本で確認の書き込みに使われている色


def _on(rpr, tag: str) -> bool:
    e = rpr.find(W(tag)) if rpr is not None else None
    return e is not None and e.get(W("val")) not in ("false", "0")


CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳"
KANA = "アイウエオカキクケコサシスセソタチツテトナニヌネノ"


def fmt_num(fmt: str, n: int) -> str | None:
    if fmt == "decimalEnclosedCircle":
        return CIRCLED[n - 1] if 1 <= n <= 20 else f"({n})"
    if fmt in ("decimal", "decimalHalfWidth"):
        return str(n)
    if fmt == "decimalFullWidth":
        return str(n).translate(str.maketrans("0123456789", "０１２３４５６７８９"))
    if fmt in ("aiueoFullWidth", "aiueo"):
        return KANA[n - 1] if 1 <= n <= len(KANA) else str(n)
    if fmt == "lowerLetter":
        return chr(96 + n) if n <= 26 else str(n)
    if fmt == "upperLetter":
        return chr(64 + n) if n <= 26 else str(n)
    if fmt == "bullet":
        return "・"
    return None


class Numbering:
    """Word の自動番号（w:numPr）を数える。numId と段（ilvl）ごとに数え、上の段が進んだら下の段を戻す。"""

    def __init__(self, d):
        self.lvls: dict[str, dict[str, tuple[str, str, int]]] = {}
        self.count: dict[tuple[str, int], int] = {}
        try:
            num = d.part.numbering_part.element
        except Exception:
            return
        abstract = {}
        for an in num.iter(W("abstractNum")):
            lv = {}
            for lvl in an.iter(W("lvl")):
                f, t, st = lvl.find(W("numFmt")), lvl.find(W("lvlText")), lvl.find(W("start"))
                lv[lvl.get(W("ilvl"))] = (
                    f.get(W("val")) if f is not None else "",
                    t.get(W("val")) if t is not None else "%1",
                    int(st.get(W("val"))) if st is not None else 1,
                )
            abstract[an.get(W("abstractNumId"))] = lv
        for n in num.iter(W("num")):
            a = n.find(W("abstractNumId"))
            lv = dict(abstract.get(a.get(W("val")) if a is not None else "", {}))
            for o in n.iter(W("lvlOverride")):
                so = o.find(W("startOverride"))
                il = o.get(W("ilvl"))
                if so is not None and il in lv:
                    f, t, _ = lv[il]
                    lv[il] = (f, t, int(so.get(W("val"))))
            self.lvls[n.get(W("numId"))] = lv

    def label(self, p_el) -> str:
        np_ = p_el.find(W("pPr") + "/" + W("numPr"))
        if np_ is None:
            return ""
        nid_el, il_el = np_.find(W("numId")), np_.find(W("ilvl"))
        nid = nid_el.get(W("val")) if nid_el is not None else ""
        il = int(il_el.get(W("val"))) if il_el is not None else 0
        lv = self.lvls.get(nid, {})
        if str(il) not in lv:
            return ""
        fmt, text, start = lv[str(il)]
        n = self.count.get((nid, il), start - 1) + 1
        self.count[(nid, il)] = n
        for k in [k for k in self.count if k[0] == nid and k[1] > il]:
            del self.count[k]
        out = text
        for lev in range(il + 1):
            f2, _, st2 = lv.get(str(lev), (fmt, "", 1))
            v = fmt_num(f2, self.count.get((nid, lev), st2))
            if v is None:
                return ""
            out = out.replace(f"%{lev + 1}", v)
        return out + "　"


def para_text(p_el, numbering: Numbering) -> str:
    """段落の文字。取り消し線の文字は落とし、自動番号を頭に付け、青字の書き込みに印を付ける。"""
    keep, struck, blue = [], [], []
    for r in p_el.iter(W("r")):
        rpr = r.find(W("rPr"))
        t = ""
        for e in r:
            if e.tag == W("t"):
                t += e.text or ""
            elif e.tag == W("tab"):
                t += "\t"
            elif e.tag in (W("br"), W("cr")):
                t += "\n"
        if not t:
            continue
        if _on(rpr, "strike") or _on(rpr, "dstrike"):
            struck.append(t)
            continue
        keep.append(t)
        c = rpr.find(W("color")) if rpr is not None else None
        if c is not None and (c.get(W("val")) or "").upper() == BLUE:
            blue.append(t)
    text = "".join(keep)
    if struck and re.sub(r"^[\s　①-⑳0-9０-９.．、()（）]+", "", text).strip() == "削除":
        text = text.rstrip() + f"（{''.join(struck).split()[0]}）"
    b = "".join(blue).strip()
    if b and not re.search(r"[←⇐→]", text):
        what = "この文" if b == text.strip() else f"「{b[:40]}」"
        text = text.rstrip() + f"　〔確認中：{what}は原本で青字の書き込み。確定した条文か、総務に確認〕"
    # 番号は文字の無い段落でも数える（Word は空の段落にも番号を出す。表の「号」の欄など）
    label = numbering.label(p_el)
    return label + text if text.strip() else label.strip() or text


def cell_text(c, numbering: Numbering) -> str:
    t = " ".join(para_text(p, numbering) for p in c._tc.findall(W("p")))
    return re.sub(r"\s+", " ", t.replace("\n", " ")).strip().replace("|", "／")


def table_md(t: Table, numbering: Numbering) -> list[str]:
    rows = []
    for r in t.rows:
        # 横に結合したセルは同じセル（_tc）が続くので1つにまとめる（文字が同じだけのセルはまとめない）
        dedup = []
        prev = None
        for c in r.cells:
            if prev is not None and c._tc is prev:
                continue
            dedup.append(cell_text(c, numbering))
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
    numbering = Numbering(d)
    lines: list[str] = []
    for kind, b in blocks(d):
        if kind == "t":
            lines += table_md(b, numbering)
            continue
        text = para_text(b._p, numbering).replace("　　", "　").rstrip()
        if not text.strip():
            lines.append("")
            continue
        if JUNK.match(text.strip()):
            continue
        # 確認の書き込み
        text = re.sub(r"\s*[←⇐]\s*(.+?)\s*$", lambda m: f"　〔確認中：{m.group(1)}〕", text)
        text = re.sub(r"\s*→\s*(.+?[？?])\s*$", lambda m: f"　〔確認中：{m.group(1)}〕", text)
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
