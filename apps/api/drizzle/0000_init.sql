CREATE TABLE `account` (
	`id` text PRIMARY KEY NOT NULL,
	`account_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`user_id` text NOT NULL,
	`access_token` text,
	`refresh_token` text,
	`id_token` text,
	`access_token_expires_at` integer,
	`refresh_token_expires_at` integer,
	`scope` text,
	`password` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `account_user_idx` ON `account` (`user_id`);--> statement-breakpoint
CREATE TABLE `favorites` (
	`user_id` text NOT NULL,
	`item_type` text NOT NULL,
	`item_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	PRIMARY KEY(`user_id`, `item_type`, `item_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "favorites_item_type" CHECK(item_type in ('tutorial','pattern')),
	CONSTRAINT "favorites_item_id_len" CHECK(length(item_id) <= 64)
);
--> statement-breakpoint
CREATE TABLE `media_objects` (
	`key` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`project_id` text,
	`pattern_id` text,
	`mime` text NOT NULL,
	`size` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pattern_id`) REFERENCES `patterns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "media_objects_kind" CHECK(kind in ('project-photo','project-cover','pattern-file'))
);
--> statement-breakpoint
CREATE INDEX `media_objects_user_idx` ON `media_objects` (`user_id`);--> statement-breakpoint
CREATE INDEX `media_objects_project_idx` ON `media_objects` (`project_id`);--> statement-breakpoint
CREATE INDEX `media_objects_pattern_idx` ON `media_objects` (`pattern_id`);--> statement-breakpoint
CREATE TABLE `pattern_rounds` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`pattern_id` text NOT NULL,
	`position` integer NOT NULL,
	`round_number` integer NOT NULL,
	`raw` text NOT NULL,
	`parsed_ok` integer NOT NULL,
	`consumed` integer DEFAULT 0 NOT NULL,
	`produced` integer DEFAULT 0 NOT NULL,
	`declared_total` integer,
	FOREIGN KEY (`pattern_id`) REFERENCES `patterns`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pattern_rounds_position" CHECK(position >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pattern_rounds_unique` ON `pattern_rounds` (`pattern_id`,`position`);--> statement-breakpoint
CREATE TABLE `patterns` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text,
	`is_sample` integer DEFAULT false NOT NULL,
	`name` text NOT NULL,
	`name_ar` text,
	`name_en` text,
	`level` text DEFAULT 'beginner' NOT NULL,
	`terms` text DEFAULT 'us' NOT NULL,
	`source_type` text DEFAULT 'text' NOT NULL,
	`source_url` text,
	`attribution` text,
	`raw_text` text DEFAULT '' NOT NULL,
	`file_path` text,
	`file_name` text,
	`file_size` integer,
	`file_mime` text,
	`reading_position` integer DEFAULT 0 NOT NULL,
	`client_updated_at` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "patterns_owner_or_sample" CHECK((is_sample = 1 and owner_id is null) or (is_sample = 0 and owner_id is not null)),
	CONSTRAINT "patterns_name_len" CHECK(length(name) between 1 and 120),
	CONSTRAINT "patterns_level" CHECK(level in ('beginner','intermediate','advanced')),
	CONSTRAINT "patterns_terms" CHECK(terms in ('us','uk')),
	CONSTRAINT "patterns_source_type" CHECK(source_type in ('sample','text','pdf','image','youtube')),
	CONSTRAINT "patterns_raw_text_len" CHECK(length(raw_text) <= 20000),
	CONSTRAINT "patterns_file_size" CHECK(file_size is null or file_size between 0 and 10485760),
	CONSTRAINT "patterns_reading_position" CHECK(reading_position >= 0)
);
--> statement-breakpoint
CREATE INDEX `patterns_owner_idx` ON `patterns` (`owner_id`);--> statement-breakpoint
CREATE TABLE `profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`display_name` text DEFAULT '' NOT NULL,
	`level` text DEFAULT 'beginner' NOT NULL,
	`terms` text DEFAULT 'us' NOT NULL,
	`locale` text DEFAULT 'ar' NOT NULL,
	`interests` text DEFAULT '[]' NOT NULL,
	`onboarded` integer DEFAULT false NOT NULL,
	`client_updated_at` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`tools_revision` integer DEFAULT 0 NOT NULL,
	`tools_client_updated_at` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profiles_display_name_len" CHECK(length(display_name) <= 80),
	CONSTRAINT "profiles_level" CHECK(level in ('beginner','intermediate','advanced')),
	CONSTRAINT "profiles_terms" CHECK(terms in ('us','uk')),
	CONSTRAINT "profiles_locale" CHECK(locale in ('ar','en'))
);
--> statement-breakpoint
CREATE TABLE `project_notes` (
	`project_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`client_updated_at` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_notes_body_len" CHECK(length(body) <= 10000)
);
--> statement-breakpoint
CREATE TABLE `project_parts` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`position` integer DEFAULT 0 NOT NULL,
	`pattern_id` text,
	`client_updated_at` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pattern_id`) REFERENCES `patterns`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "project_parts_name_len" CHECK(length(name) between 1 and 80)
);
--> statement-breakpoint
CREATE INDEX `project_parts_project_idx` ON `project_parts` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_photos` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`storage_path` text NOT NULL,
	`mime_type` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`width` integer,
	`height` integer,
	`is_cover` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "project_photos_mime" CHECK(mime_type in ('image/jpeg','image/png','image/webp')),
	CONSTRAINT "project_photos_size" CHECK(size_bytes between 1 and 8388608)
);
--> statement-breakpoint
CREATE INDEX `project_photos_project_idx` ON `project_photos` (`project_id`);--> statement-breakpoint
CREATE TABLE `project_progress` (
	`project_id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`mode` text DEFAULT 'simple' NOT NULL,
	`round` integer DEFAULT 1 NOT NULL,
	`target` integer DEFAULT 30 NOT NULL,
	`per_tap` integer DEFAULT 1 NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`total_rounds` integer DEFAULT 0 NOT NULL,
	`pattern_id` text,
	`pattern_round_index` integer DEFAULT 0 NOT NULL,
	`action_ptr` integer DEFAULT 0 NOT NULL,
	`count_mode` text DEFAULT 'action' NOT NULL,
	`history` text DEFAULT '[]' NOT NULL,
	`pattern_history` text DEFAULT '[]' NOT NULL,
	`client_updated_at` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pattern_id`) REFERENCES `patterns`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "project_progress_mode" CHECK(mode in ('simple','pattern')),
	CONSTRAINT "project_progress_round" CHECK(round >= 1),
	CONSTRAINT "project_progress_target" CHECK(target between 1 and 999),
	CONSTRAINT "project_progress_per_tap" CHECK(per_tap between 1 and 99),
	CONSTRAINT "project_progress_count" CHECK(count >= 0),
	CONSTRAINT "project_progress_total_rounds" CHECK(total_rounds >= 0),
	CONSTRAINT "project_progress_round_index" CHECK(pattern_round_index >= 0),
	CONSTRAINT "project_progress_action_ptr" CHECK(action_ptr >= 0),
	CONSTRAINT "project_progress_count_mode" CHECK(count_mode in ('action','group','round')),
	CONSTRAINT "project_progress_count_le_target" CHECK(count <= target)
);
--> statement-breakpoint
CREATE INDEX `project_progress_owner_idx` ON `project_progress` (`owner_id`);--> statement-breakpoint
CREATE TABLE `projects` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`category` text DEFAULT 'amigurumi' NOT NULL,
	`hook_size` text DEFAULT '3.0' NOT NULL,
	`yarn_type` text DEFAULT 'cotton' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`pattern_id` text,
	`cover_path` text,
	`estimated_hours` real DEFAULT 0 NOT NULL,
	`worked_seconds` integer DEFAULT 0 NOT NULL,
	`last_worked_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`client_updated_at` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`pattern_id`) REFERENCES `patterns`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "projects_name_len" CHECK(length(name) between 1 and 120),
	CONSTRAINT "projects_category" CHECK(category in ('amigurumi','clothes','accessories','home','gifts')),
	CONSTRAINT "projects_hook_len" CHECK(length(hook_size) <= 10),
	CONSTRAINT "projects_yarn" CHECK(yarn_type in ('cotton','acrylic','wool','velvet','blend','milk')),
	CONSTRAINT "projects_status" CHECK(status in ('active','paused','done')),
	CONSTRAINT "projects_hours" CHECK(estimated_hours >= 0),
	CONSTRAINT "projects_worked" CHECK(worked_seconds >= 0)
);
--> statement-breakpoint
CREATE INDEX `projects_owner_idx` ON `projects` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `rate_limit` (
	`id` text PRIMARY KEY NOT NULL,
	`key` text NOT NULL,
	`count` integer NOT NULL,
	`last_request` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `rate_limit_key_unique` ON `rate_limit` (`key`);--> statement-breakpoint
CREATE TABLE `session` (
	`id` text PRIMARY KEY NOT NULL,
	`expires_at` integer NOT NULL,
	`token` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`ip_address` text,
	`user_agent` text,
	`user_id` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `session_token_unique` ON `session` (`token`);--> statement-breakpoint
CREATE INDEX `session_user_idx` ON `session` (`user_id`);--> statement-breakpoint
CREATE TABLE `store_interest` (
	`user_id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `tutorial_bookmarks` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`tutorial_id` text NOT NULL,
	`youtube_url` text,
	`creator_name` text,
	`project_id` text,
	`notes` text DEFAULT '' NOT NULL,
	`client_updated_at` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "tutorial_bookmarks_tid_len" CHECK(length(tutorial_id) <= 64),
	CONSTRAINT "tutorial_bookmarks_notes_len" CHECK(length(notes) <= 10000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `tutorial_bookmarks_unique` ON `tutorial_bookmarks` (`user_id`,`tutorial_id`);--> statement-breakpoint
CREATE TABLE `tutorial_timestamps` (
	`id` text PRIMARY KEY NOT NULL,
	`bookmark_id` text NOT NULL,
	`user_id` text NOT NULL,
	`seconds` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`bookmark_id`) REFERENCES `tutorial_bookmarks`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "tutorial_timestamps_seconds" CHECK(seconds between 0 and 86400),
	CONSTRAINT "tutorial_timestamps_note_len" CHECK(length(note) <= 300)
);
--> statement-breakpoint
CREATE INDEX `tutorial_timestamps_bookmark_idx` ON `tutorial_timestamps` (`bookmark_id`);--> statement-breakpoint
CREATE TABLE `user` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`email_verified` integer DEFAULT false NOT NULL,
	`image` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_email_unique` ON `user` (`email`);--> statement-breakpoint
CREATE TABLE `user_tools` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`kind` text NOT NULL,
	`value` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "user_tools_kind" CHECK(kind in ('hook','yarn','accessory')),
	CONSTRAINT "user_tools_value_len" CHECK(length(value) between 1 and 40)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `user_tools_unique` ON `user_tools` (`user_id`,`kind`,`value`);--> statement-breakpoint
CREATE INDEX `user_tools_user_idx` ON `user_tools` (`user_id`);--> statement-breakpoint
CREATE TABLE `verification` (
	`id` text PRIMARY KEY NOT NULL,
	`identifier` text NOT NULL,
	`value` text NOT NULL,
	`expires_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `verification_identifier_idx` ON `verification` (`identifier`);--> statement-breakpoint
CREATE TABLE `work_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`project_id` text NOT NULL,
	`owner_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer NOT NULL,
	`seconds` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`project_id`) REFERENCES `projects`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "work_sessions_seconds" CHECK(seconds between 0 and 86400),
	CONSTRAINT "work_sessions_order" CHECK(ended_at >= started_at)
);
--> statement-breakpoint
CREATE INDEX `work_sessions_project_idx` ON `work_sessions` (`project_id`);