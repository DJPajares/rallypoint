-- Synthetic groups only. scripts/local.mjs creates managed Auth identities and roles.
insert into app.groups(id, name) values
  ('11111111-1111-4111-8111-111111111111', 'Sunday Social Club'),
  ('22222222-2222-4222-8222-222222222222', 'Eastside Rallies')
on conflict (id) do nothing;
