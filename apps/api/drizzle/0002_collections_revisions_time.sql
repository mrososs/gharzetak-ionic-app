-- Additive only (CREATE TABLE / ADD COLUMN). No existing row is copied, rebuilt or dropped. Reviewed by hand: see docs/pattern-collections/architecture.md.
CREATE TABLE `pattern_collections` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`name` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`level` text DEFAULT 'beginner' NOT NULL,
	`terms` text DEFAULT 'us' NOT NULL,
	`cover_data` text,
	`content_rev` integer DEFAULT 1 NOT NULL,
	`suggested_minutes` integer DEFAULT 0 NOT NULL,
	`source_text` text DEFAULT '' NOT NULL,
	`client_updated_at` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`deleted_at` integer,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pattern_collections_name_len" CHECK(length(name) between 1 and 120),
	CONSTRAINT "pattern_collections_desc_len" CHECK(length(description) <= 2000),
	CONSTRAINT "pattern_collections_level" CHECK(level in ('beginner','intermediate','advanced')),
	CONSTRAINT "pattern_collections_terms" CHECK(terms in ('us','uk')),
	CONSTRAINT "pattern_collections_content_rev" CHECK(content_rev >= 1),
	CONSTRAINT "pattern_collections_minutes" CHECK(suggested_minutes >= 0)
);
--> statement-breakpoint
CREATE INDEX `pattern_collections_owner_idx` ON `pattern_collections` (`owner_id`);--> statement-breakpoint
CREATE TABLE `pattern_parts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`collection_id` text NOT NULL,
	`part_id` text NOT NULL,
	`position` integer NOT NULL,
	`name` text NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`raw_text` text DEFAULT '' NOT NULL,
	`assembly_notes` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`collection_id`) REFERENCES `pattern_collections`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pattern_parts_position" CHECK(position >= 0),
	CONSTRAINT "pattern_parts_name_len" CHECK(length(name) between 1 and 80),
	CONSTRAINT "pattern_parts_quantity" CHECK(quantity between 1 and 30)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pattern_parts_part_unique` ON `pattern_parts` (`collection_id`,`part_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `pattern_parts_position_unique` ON `pattern_parts` (`collection_id`,`position`);--> statement-breakpoint
CREATE TABLE `pattern_revisions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`owner_id` text NOT NULL,
	`entity_kind` text NOT NULL,
	`entity_id` text NOT NULL,
	`rev` integer NOT NULL,
	`name` text NOT NULL,
	`snapshot` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`owner_id`) REFERENCES `user`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "pattern_revisions_kind" CHECK(entity_kind in ('pattern','collection')),
	CONSTRAINT "pattern_revisions_rev" CHECK(rev >= 1),
	CONSTRAINT "pattern_revisions_snapshot_len" CHECK(length(snapshot) <= 600000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `pattern_revisions_unique` ON `pattern_revisions` (`owner_id`,`entity_kind`,`entity_id`,`rev`);--> statement-breakpoint
CREATE INDEX `pattern_revisions_entity_idx` ON `pattern_revisions` (`entity_id`);--> statement-breakpoint
ALTER TABLE `patterns` ADD `content_rev` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `patterns` ADD `suggested_minutes` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `project_progress` ADD `multi_state` text;--> statement-breakpoint
ALTER TABLE `project_progress` ADD `pattern_snapshot` text;--> statement-breakpoint
ALTER TABLE `projects` ADD `collection_id` text REFERENCES pattern_collections(id) ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE `work_sessions` ADD `part_instance_id` text;