-- Split the single shared push_token column into one slot per platform, so a
-- parent using both an iPhone and an Android device (or switching devices)
-- doesn't have one silently overwrite the other's registration.

alter table family_members
  add column push_token_ios text,
  add column push_token_android text,
  add column push_token_web text;

update family_members
set push_token_ios = substring(push_token from 6)
where push_token like 'apns:%';

update family_members
set push_token_android = substring(push_token from 5)
where push_token like 'fcm:%';

update family_members
set push_token_web = push_token
where push_token is not null
  and push_token not like 'apns:%'
  and push_token not like 'fcm:%';

alter table family_members drop column push_token;
