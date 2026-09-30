-- dev（chishokan_dev）で整えた学校マスタと月別設定を、本番（chishokan_prod）に写す。
-- Supabase の SQL Editor に貼り付けて Run する。門配の記録・配布物は写さない（dev のテストデータのため）。
-- 本番に同じ学校名があれば dev の内容で上書きする。本番にだけある学校は消さない。

insert into chishokan_prod.monpai_schools (name, district, kind, students, sort_order, note)
select name, district, kind, students, sort_order, note from chishokan_dev.monpai_schools
on conflict (name) do update
  set district = excluded.district, kind = excluded.kind, students = excluded.students,
      sort_order = excluded.sort_order, note = excluded.note;

insert into chishokan_prod.monpai_month_settings (month, school, rate, recruit)
select month, school, rate, recruit from chishokan_dev.monpai_month_settings
on conflict (month, school) do update
  set rate = excluded.rate, recruit = excluded.recruit;

-- 確認：地区ごとの学校数
select district, count(*) from chishokan_prod.monpai_schools group by district order by district;
