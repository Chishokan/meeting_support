# 就業規則・規程の取り込み

総務の就業規則・付属規程（Word の .doc）を、`knowledge/60_規程・手続き/就業規則/` の Markdown にする。
2026-11-13 に、2026年4月1日改正施行の版（AI_agent_test リポジトリの `仮修正中就業規則/`）をこの手順で取り込んだ。原本が直ったら、同じ手順で作り直す。

必要なもの：LibreOffice（`soffice`）、Python 3 と python-docx（`pip install python-docx`）

```bash
mkdir -p work/docx work/out
soffice --headless --convert-to docx --outdir work/docx 原本のフォルダ/*.doc
python3 scripts/import-kisoku/convert.py work/docx work/out
python3 scripts/import-kisoku/build.py work/out "knowledge/60_規程・手続き/就業規則"
npm run index
```

- `convert.py`：段落と表を出てくる順に取り出し、章を `##`、条を `###` にする。目次・ページ番号・「複写・複製を厳に禁止します」の行を消す。
  Word の自動番号（①②…）を数えて振り、取り消し線の文字（改定で削った文）は落とす。
  原本の確認の書き込み（「←…」「→…？」、青字 00B0F0 の文）は〔確認中：…〕にする（赤字は改定で足した文なので本文のまま）。年次有給休暇の表に読み方を書き足す
- `build.py`：front matter を付け、長い規則を章で分けて書き出す。条番号の重複・欠番の注もここ。
  就業規則 第113条の表の「種類」は、原本の均等割り付け（EQ フィールド）が LibreOffice の変換で消えるので、ここで原本の語を戻す
- `00_使い方.md` は手で書いている（build.py は作らない）。作り直したら、条番号の表と「原本の注意点」を見直す
- 書き出したら、`〔取り込み時の注` と `〔確認中` を grep して、注がまだ当たっているかを確かめる
