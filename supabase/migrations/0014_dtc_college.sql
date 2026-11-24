-- Seed Delhi Technical Campus (DTC) in colleges
insert into public.colleges (short_name, name, domain, lat, lng)
values ('DTC', 'Delhi Technical Campus', 'delhitechnicalcampus.ac.in', 28.4744, 77.492)
on conflict (short_name) do update
  set name = excluded.name,
      domain = excluded.domain,
      lat = excluded.lat,
      lng = excluded.lng;
