CREATE TABLE `knowledge` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`project_id` text NOT NULL,
	`category` text NOT NULL,
	`key` text NOT NULL,
	`content` text NOT NULL,
	`metadata` text,
	`created_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
	`updated_at` text NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_knowledge_project_cat_key` ON `knowledge` (`project_id`, `category`, `key`);
--> statement-breakpoint
CREATE INDEX `idx_knowledge_project_category` ON `knowledge` (`project_id`, `category`);
--> statement-breakpoint
CREATE VIRTUAL TABLE IF NOT EXISTS `knowledge_fts` USING fts5(
	`key`, `content`, `category`,
	content=`knowledge`, content_rowid=`id`
);
--> statement-breakpoint
CREATE TRIGGER knowledge_ai AFTER INSERT ON knowledge BEGIN
	INSERT INTO knowledge_fts(rowid, key, content, category) VALUES (new.id, new.key, new.content, new.category);
END;
--> statement-breakpoint
CREATE TRIGGER knowledge_ad AFTER DELETE ON knowledge BEGIN
	INSERT INTO knowledge_fts(knowledge_fts, rowid, key, content, category) VALUES ('delete', old.id, old.key, old.content, old.category);
END;
--> statement-breakpoint
CREATE TRIGGER knowledge_au AFTER UPDATE ON knowledge BEGIN
	INSERT INTO knowledge_fts(knowledge_fts, rowid, key, content, category) VALUES ('delete', old.id, old.key, old.content, old.category);
	INSERT INTO knowledge_fts(rowid, key, content, category) VALUES (new.id, new.key, new.content, new.category);
END;
