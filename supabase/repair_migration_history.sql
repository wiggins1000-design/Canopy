-- Canopy — Repair migration history
--
-- Run this ONCE in the Supabase SQL editor.
-- It creates the CLI migration-tracking table and marks every migration
-- that was already applied manually (001–033) as complete.
-- After running this, `supabase db push --linked` will only apply 034+.

CREATE SCHEMA IF NOT EXISTS supabase_migrations;

CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
  version   text NOT NULL PRIMARY KEY,
  statements text[],
  name      text
);

INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES
  ('001_initial_schema',            'initial_schema'),
  ('002_notice_tags',               'notice_tags'),
  ('003_notice_attachments_bucket', 'notice_attachments_bucket'),
  ('004_phone_number',              'phone_number'),
  ('005_family_events',             'family_events'),
  ('006_notice_post_author',        'notice_post_author'),
  ('007_admin',                     'admin'),
  ('008_additional_emails',         'additional_emails'),
  ('009_notice_post_nullable_author','notice_post_nullable_author'),
  ('010_schedule_pattern_types',    'schedule_pattern_types'),
  ('011_fror_times',                'fror_times'),
  ('012_events_update_policy',      'events_update_policy'),
  ('013_info_bank',                 'info_bank'),
  ('014_vault',                     'vault'),
  ('015_events_replica_identity',   'events_replica_identity'),
  ('016_notification_tag',          'notification_tag'),
  ('017_get_user_by_email',         'get_user_by_email'),
  ('018_school_calendars',          'school_calendars'),
  ('019_features',                  'features'),
  ('020_admin_family_detail',       'admin_family_detail'),
  ('021_school_calendars_contact',  'school_calendars_contact'),
  ('022_child_accounts',            'child_accounts'),
  ('023_encrypt_usernames',         'encrypt_usernames'),
  ('023_family_name_optional',      'family_name_optional'),
  ('024_event_improvements',        'event_improvements'),
  ('025_messages',                  'messages'),
  ('026_schedule_proposal',         'schedule_proposal'),
  ('027_expenses',                  'expenses'),
  ('028_subscription',              'subscription'),
  ('029_remove_email_key',          'remove_email_key'),
  ('030_two_fa',                    'two_fa'),
  ('031_gdpr',                      'gdpr'),
  ('032_gdpr_delete_cleanup',       'gdpr_delete_cleanup'),
  ('033_child_event_tags',          'child_event_tags')
ON CONFLICT (version) DO NOTHING;
