ALTER TABLE tasks ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

UPDATE tasks
SET sort_order = (
    SELECT COUNT(*)
    FROM tasks AS ordered_tasks
    WHERE ordered_tasks.project_id = tasks.project_id
      AND ordered_tasks.created_at <= tasks.created_at
) * 1000;
