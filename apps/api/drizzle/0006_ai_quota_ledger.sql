CREATE TABLE `ai_request_ledger` (
	`user_id` text NOT NULL,
	`request_id` text NOT NULL,
	`day` text NOT NULL,
	`chat` integer NOT NULL,
	`image` integer NOT NULL,
	`state` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `request_id`),
	FOREIGN KEY (`user_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `ai_request_ledger_created_idx` ON `ai_request_ledger` (`created_at`);--> statement-breakpoint
ALTER TABLE `ai_usage_daily` ADD `refunds` integer DEFAULT 0 NOT NULL;