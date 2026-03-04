-- Add model_config column to projects table
ALTER TABLE projects ADD COLUMN model_config TEXT DEFAULT '{}';
