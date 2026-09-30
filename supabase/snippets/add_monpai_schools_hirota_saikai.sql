-- 門配の学校マスタに、広田エリア4校と西海東小を追加する（dev・本番の両方）
-- 生徒数は「MP広告計画」タブの見出し（通常生徒数）から。あとで学校マスタの画面で直せる。
-- 同じ名前の学校がすでにあれば何もしない（何度実行しても大丈夫）。

insert into chishokan_dev.monpai_schools (name, district, kind, students, sort_order, note) values
  ('広田中', '広田', '中', 470, 5, '広田エリア'), ('早岐中', '広田', '中', 635, 6, '広田エリア'),
  ('東明中', '広田', '中', 188, 7, '広田エリア'), ('広田小', '広田', '小', 427, 8, '広田エリア'),
  ('西海東小', '西海大島', '小', 128, 10, '')
on conflict (name) do nothing;

insert into chishokan_prod.monpai_schools (name, district, kind, students, sort_order, note) values
  ('広田中', '広田', '中', 470, 5, '広田エリア'), ('早岐中', '広田', '中', 635, 6, '広田エリア'),
  ('東明中', '広田', '中', 188, 7, '広田エリア'), ('広田小', '広田', '小', 427, 8, '広田エリア'),
  ('西海東小', '西海大島', '小', 128, 10, '')
on conflict (name) do nothing;

select district as 地区, name as 学校, kind as 区分, students as 生徒数
from chishokan_dev.monpai_schools where district in ('広田', '西海大島') order by district, sort_order;
