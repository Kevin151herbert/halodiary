-- Busy sample days: one-off visits start at 12:30, 75 minutes apart, so they never overlap the regular 10:00 visits.
-- Applied to the live function by replacing the start time and spacing inside load_sample_clients().
do $do$
declare def text;
begin
  select pg_get_functiondef(p.oid) into def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where p.proname = 'load_sample_clients' and n.nspname = 'public';
  def := replace(def, '(d + time ''08:00'')', '(d + time ''12:30'')');
  def := replace(def, '(j - 1) * interval ''100 minutes''', '(j - 1) * interval ''75 minutes''');
  execute def;
end
$do$;
