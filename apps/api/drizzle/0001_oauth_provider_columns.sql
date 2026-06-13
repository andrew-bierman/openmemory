ALTER TABLE `oauth_client` ADD `require_pkce` integer;
--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `reference_id` text;
--> statement-breakpoint
ALTER TABLE `oauth_client` ADD `metadata` text;
--> statement-breakpoint
ALTER TABLE `oauth_access_token` ADD `reference_id` text;
--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `reference_id` text;
--> statement-breakpoint
ALTER TABLE `oauth_refresh_token` ADD `auth_time` integer;
--> statement-breakpoint
ALTER TABLE `oauth_consent` ADD `reference_id` text;
