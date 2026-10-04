CREATE TABLE `ip_article_tags` (
	`article_seq` integer NOT NULL,
	`ip_id` text NOT NULL,
	`version` integer NOT NULL,
	`evidence` text NOT NULL,
	PRIMARY KEY(`article_seq`, `ip_id`),
	FOREIGN KEY (`article_seq`) REFERENCES `ip_articles`(`seq`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`ip_id`) REFERENCES `ip_registry`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ip_tags_ip_article` ON `ip_article_tags` (`ip_id`,`article_seq`);--> statement-breakpoint
CREATE TABLE `ip_articles` (
	`seq` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`id` text NOT NULL,
	`document` text NOT NULL,
	`body` text DEFAULT '' NOT NULL,
	`body_status` text DEFAULT 'pending' NOT NULL,
	`content_hash` text NOT NULL,
	`published_at` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ip_articles_id` ON `ip_articles` (`id`);--> statement-breakpoint
CREATE INDEX `idx_ip_articles_published` ON `ip_articles` (`published_at`);--> statement-breakpoint
CREATE TABLE `ip_candidate_mentions` (
	`candidate_key` text NOT NULL,
	`article_seq` integer NOT NULL,
	`published_at` integer NOT NULL,
	`source_id` text NOT NULL,
	PRIMARY KEY(`candidate_key`, `article_seq`),
	FOREIGN KEY (`candidate_key`) REFERENCES `ip_candidates`(`key`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`article_seq`) REFERENCES `ip_articles`(`seq`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ip_mentions_window` ON `ip_candidate_mentions` (`published_at`,`candidate_key`);--> statement-breakpoint
CREATE TABLE `ip_candidates` (
	`key` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`language` text NOT NULL,
	`entity_id` text,
	`evidence` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`first_seen` integer NOT NULL,
	`last_seen` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ip_candidates_entity` ON `ip_candidates` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_ip_candidates_status` ON `ip_candidates` (`status`,`last_seen`);--> statement-breakpoint
CREATE TABLE `ip_engine_state` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `ip_jobs` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`target` text NOT NULL,
	`version` integer DEFAULT 0 NOT NULL,
	`cursor` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'pending' NOT NULL,
	`owner` text,
	`lease_until` integer DEFAULT 0 NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`available_at` integer NOT NULL,
	`error` text,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_ip_jobs_ready` ON `ip_jobs` (`state`,`available_at`);--> statement-breakpoint
CREATE INDEX `idx_ip_jobs_lease` ON `ip_jobs` (`state`,`lease_until`);--> statement-breakpoint
CREATE TABLE `ip_registry` (
	`id` text PRIMARY KEY NOT NULL,
	`entity_id` text,
	`document` text NOT NULL,
	`version` integer NOT NULL,
	`promoted_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_ip_registry_entity` ON `ip_registry` (`entity_id`);--> statement-breakpoint
CREATE INDEX `idx_ip_subscriptions_ip` ON `ip_subscriptions` (`ip_id`);