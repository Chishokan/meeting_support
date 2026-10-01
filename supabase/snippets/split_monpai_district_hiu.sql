-- 門配：広田地区から日宇地区を分ける（dev・本番の両方）
-- 日宇：日宇中・大塔小・黒髪小・日宇小／広田：それ以外（広田中・早岐中・東明中・広田小）
-- 学校マスタの地区と、これまでの記録（予定・実績）の地区を付け替える。何度実行しても同じ結果になる。

update chishokan_dev.monpai_schools set district = '日宇', note = ''
  where name in ('日宇中', '大塔小', '黒髪小', '日宇小');
update chishokan_dev.monpai_records set district = '日宇'
  where school in ('日宇中', '大塔小', '黒髪小', '日宇小') and district = '広田';
update chishokan_dev.monpai_schools set note = '', sort_order = case name
    when '広田中' then 1 when '早岐中' then 2 when '東明中' then 3 when '広田小' then 4 else sort_order end
  where district = '広田';

update chishokan_prod.monpai_schools set district = '日宇', note = ''
  where name in ('日宇中', '大塔小', '黒髪小', '日宇小');
update chishokan_prod.monpai_records set district = '日宇'
  where school in ('日宇中', '大塔小', '黒髪小', '日宇小') and district = '広田';
update chishokan_prod.monpai_schools set note = '', sort_order = case name
    when '広田中' then 1 when '早岐中' then 2 when '東明中' then 3 when '広田小' then 4 else sort_order end
  where district = '広田';

-- 確認：地区ごとの学校と記録の件数（dev・本番）
select 'dev' as 区画, s.district as 地区, s.name as 学校, count(r.id) as 記録
  from chishokan_dev.monpai_schools s left join chishokan_dev.monpai_records r on r.school = s.name and r.deleted_at is null
  where s.district in ('広田', '日宇') group by 1, 2, 3, s.sort_order
union all
select 'prod', s.district, s.name, count(r.id)
  from chishokan_prod.monpai_schools s left join chishokan_prod.monpai_records r on r.school = s.name and r.deleted_at is null
  where s.district in ('広田', '日宇') group by 1, 2, 3, s.sort_order
order by 1, 2, 3;
