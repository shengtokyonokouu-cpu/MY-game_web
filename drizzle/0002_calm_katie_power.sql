CREATE TABLE `ip_notifications` (
	`user_id` text NOT NULL,
	`article_id` text NOT NULL,
	`article` text NOT NULL,
	`ip_ids` text NOT NULL,
	`reason` text NOT NULL,
	`created_at` integer NOT NULL,
	`read_at` integer,
	PRIMARY KEY(`user_id`, `article_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `idx_ip_notifications_user_created` ON `ip_notifications` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `ip_subscriptions` (
	`user_id` text NOT NULL,
	`ip_id` text NOT NULL,
	`created_at` integer NOT NULL,
	PRIMARY KEY(`user_id`, `ip_id`),
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE cascade
);
