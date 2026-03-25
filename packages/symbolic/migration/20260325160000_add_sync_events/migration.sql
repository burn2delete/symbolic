CREATE TABLE `event_sequence` (
  `aggregate_id` text PRIMARY KEY NOT NULL,
  `seq` integer NOT NULL
);

CREATE TABLE `event` (
  `id` text PRIMARY KEY NOT NULL,
  `aggregate_id` text NOT NULL REFERENCES `event_sequence`(`aggregate_id`) ON DELETE CASCADE,
  `seq` integer NOT NULL,
  `type` text NOT NULL,
  `data` text NOT NULL
);
