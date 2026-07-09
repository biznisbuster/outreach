-- ============================================================================
-- 0001_attachments.sql — email attachments (3 nove tabele)
-- ----------------------------------------------------------------------------
-- Primenjuje se kroz `npm run db:migrate-attachments` (NE kroz drizzle-kit
-- migrate, jer nema migration istorije — baza je inicijalno popunjena kroz
-- `drizzle-kit push`).
--
-- Idempotentan: koristi IF NOT EXISTS, može se pokrenuti više puta.
-- ============================================================================

CREATE TABLE IF NOT EXISTS `attachments` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `filename` text NOT NULL,
  `original_name` text NOT NULL,
  `mime_type` text NOT NULL,
  `size` integer NOT NULL,
  `sha256` text NOT NULL UNIQUE,
  `uploaded_at` integer DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS `template_attachments` (
  `template_id` integer NOT NULL REFERENCES prompt_templates(id) ON DELETE CASCADE,
  `attachment_id` integer NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  `sort_order` integer DEFAULT 0 NOT NULL,
  UNIQUE(template_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS `template_attachments_template_idx` ON `template_attachments` (`template_id`);

CREATE TABLE IF NOT EXISTS `email_send_attachments` (
  `email_send_id` integer NOT NULL REFERENCES email_sends(id) ON DELETE CASCADE,
  `attachment_id` integer NOT NULL REFERENCES attachments(id) ON DELETE CASCADE,
  UNIQUE(email_send_id, attachment_id)
);
CREATE INDEX IF NOT EXISTS `email_send_attachments_send_idx` ON `email_send_attachments` (`email_send_id`);