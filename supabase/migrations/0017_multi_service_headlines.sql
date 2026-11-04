-- Demo providers that offer two services get a headline that covers both, so a card shown under
-- either service reads true (applied live on 2026-11-04).
update public.providers p set headline = v.h from (values
  ('Chidi P.', 'Bilingual tutor and language lessons for children'),
  ('Fatima N.', 'Dog walks and grooming, photos after each'),
  ('Yusuf R.', 'Dog walks and grooming, GPS photos after each'),
  ('Tomás G.', 'Weekly cleans and sofa refreshes for busy families'),
  ('Jordi C.', 'Home and upholstery cleaning with eco products'),
  ('Zainab B.', 'Pool care and garden upkeep in one visit'),
  ('Mateo P.', 'Pool chemistry checks and garden tidy-ups'),
  ('Clara M.', 'Pool and garden care, chemistry checks included'),
  ('Kwame S.', 'Maths, science and language tutor, ages 8 to 16'),
  ('Marta R.', 'Bilingual tutor and conversation lessons'),
  ('Elena J.', 'Maths and science tutor, plus language lessons'),
  ('Pablo G.', 'Mobile mechanic and car valet at your door'),
  ('Kofi K.', 'Servicing and hand wash at your door'),
  ('Laia L.', 'Security checks and generator servicing'),
  ('Emeka Z.', 'Alarm and lock checks, generator servicing')
) as v(n, h)
where p.display_name = v.n and p.is_demo and (select count(*) from public.provider_services ps where ps.provider_id = p.id) > 1;
