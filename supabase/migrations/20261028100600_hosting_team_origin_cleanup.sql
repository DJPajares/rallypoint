-- P-35: removing a group never blocks on the provenance note its sessions'
-- hosting teams keep.
alter table app.groups drop constraint groups_origin_group_id_fkey;
alter table app.groups add constraint groups_origin_group_id_fkey
  foreign key (origin_group_id) references app.groups(id) on delete set null;
