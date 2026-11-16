-- Additive, non-destructive: one nullable column. Existing rows keep avatar_id = NULL (clients show their default avatar).
-- Hand-written instead of drizzle-kit's table rebuild so no existing profile row is ever copied, dropped or re-created.
ALTER TABLE `profiles` ADD `avatar_id` text CONSTRAINT "profiles_avatar_id" CHECK(avatar_id is null or avatar_id in ('bunny','cat','bear','sheep','flower','yarn'));
