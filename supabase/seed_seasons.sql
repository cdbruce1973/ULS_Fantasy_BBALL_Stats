-- Seasons and Yahoo league keys (Yahoo labels seasons by START year). 2004 has no Yahoo data (sheet only).
insert into seasons (start_year, yahoo_league_key, source, is_current) values
 (2004,null,'sheet',false),(2005,'131.l.183172','yahoo',false),(2006,'165.l.31254','yahoo',false),(2007,'187.l.21168','yahoo',false),
 (2008,'211.l.29149','yahoo',false),(2009,'234.l.99288','yahoo',false),(2010,'249.l.9571','yahoo',false),(2011,'265.l.18490','yahoo',false),
 (2012,'304.l.40521','yahoo',false),(2013,'322.l.10961','yahoo',false),(2014,'342.l.62374','yahoo',false),(2015,'353.l.57391','yahoo',false),
 (2016,'364.l.105158','yahoo',false),(2017,'375.l.81492','yahoo',false),(2018,'385.l.96077','yahoo',false),(2019,'395.l.81479','yahoo',false),
 (2020,'402.l.59298','yahoo',false),(2021,'410.l.99003','yahoo',false),(2022,'418.l.73657','yahoo',false),(2023,'428.l.91358','yahoo',false),
 (2024,'454.l.71386','yahoo',false),(2025,'466.l.56455','yahoo',false),(2026,'478.l.72617','yahoo',true)
on conflict (start_year) do nothing;

-- Owners (display names). Yahoo display names from the owner's Yahoo profile; yahoo_guid is filled from the first sync.
insert into owners (name, yahoo_display_name, member_since) values
 ('Smy','ronsmeagol',null),('Geoff','Geoff',null),('Scotty','Scott',null),('Aaron','Aaron T',null),('Drewber','Drew',null),
 ('AK','Alex K',null),('Brendan','Brendan',2008),('Klink','John K',null),('Cowan','Chris',null),('Evan','Evan',null),
 ('Craig','CraigB',null),('BP','Brendan',2025),('Pete',null,null),('Nate',null,null),('Owen',null,null),('Erik',null,null),
 ('Brice',null,null),('Will',null,null)
on conflict (name) do nothing;
insert into owner_aliases (alias, owner_id) select 'G.A.', id from owners where name='Geoff' on conflict do nothing;
insert into owner_aliases (alias, owner_id) select 'B.Patnode', id from owners where name='BP' on conflict do nothing;
