CREATE TABLE `ai_rate` (
	`user_id` text NOT NULL,
	`window_start` integer NOT NULL,
	`units` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`user_id`, `window_start`)
);
--> statement-breakpoint
CREATE TABLE `ai_usage_daily` (
	`scope` text NOT NULL,
	`day` text NOT NULL,
	`chat` integer DEFAULT 0 NOT NULL,
	`image` integer DEFAULT 0 NOT NULL,
	`extract` integer DEFAULT 0 NOT NULL,
	`requests` integer DEFAULT 0 NOT NULL,
	`tokens_in` integer DEFAULT 0 NOT NULL,
	`tokens_out` integer DEFAULT 0 NOT NULL,
	`neurons_reserved` integer DEFAULT 0 NOT NULL,
	`neurons_used` integer DEFAULT 0 NOT NULL,
	PRIMARY KEY(`scope`, `day`)
);
--> statement-breakpoint
CREATE INDEX `ai_usage_daily_day_idx` ON `ai_usage_daily` (`day`);--> statement-breakpoint
CREATE TABLE `ai_user_state` (
	`user_id` text PRIMARY KEY NOT NULL,
	`consent_version` integer DEFAULT 0 NOT NULL,
	`consent_at` integer,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
