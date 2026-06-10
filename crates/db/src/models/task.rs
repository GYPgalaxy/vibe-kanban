use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool, Type};
use strum_macros::{Display, EnumString};
use ts_rs::TS;
use uuid::Uuid;

#[derive(
    Debug, Clone, Type, Serialize, Deserialize, PartialEq, TS, EnumString, Display, Default,
)]
#[sqlx(type_name = "task_status", rename_all = "lowercase")]
#[serde(rename_all = "lowercase")]
#[strum(serialize_all = "lowercase")]
pub enum TaskStatus {
    #[default]
    Todo,
    InProgress,
    InReview,
    Done,
    Cancelled,
}

#[derive(Debug, Clone, FromRow, Serialize, Deserialize, TS)]
pub struct Task {
    pub id: Uuid,
    pub project_id: Uuid, // Foreign key to Project
    pub title: String,
    pub description: Option<String>,
    pub status: TaskStatus,
    pub parent_workspace_id: Option<Uuid>, // Foreign key to parent Workspace
    pub sort_order: i32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize, TS)]
pub struct CreateTask {
    pub id: Option<Uuid>,
    pub title: String,
    pub description: Option<String>,
    pub status: Option<TaskStatus>,
    pub parent_workspace_id: Option<Uuid>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize, TS)]
pub struct UpdateTask {
    pub title: Option<String>,
    pub description: Option<Option<String>>,
    pub status: Option<TaskStatus>,
    pub parent_workspace_id: Option<Option<Uuid>>,
    pub sort_order: Option<i32>,
}

#[derive(Debug, Deserialize, TS)]
pub struct BulkUpdateTaskItem {
    pub id: Uuid,
    pub changes: UpdateTask,
}

impl Task {
    pub async fn find_all(pool: &SqlitePool) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            r#"SELECT id,
                      project_id,
                      title,
                      description,
                      status,
                      parent_workspace_id,
                      sort_order,
                      created_at,
                      updated_at
               FROM tasks
               ORDER BY created_at ASC"#,
        )
        .fetch_all(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: Uuid) -> Result<Option<Self>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            r#"SELECT id,
                      project_id,
                      title,
                      description,
                      status,
                      parent_workspace_id,
                      sort_order,
                      created_at,
                      updated_at
               FROM tasks
               WHERE id = $1"#,
        )
        .bind(id)
        .fetch_optional(pool)
        .await
    }

    pub async fn find_by_project_id(
        pool: &SqlitePool,
        project_id: Uuid,
    ) -> Result<Vec<Self>, sqlx::Error> {
        sqlx::query_as::<_, Task>(
            r#"SELECT id,
                      project_id,
                      title,
                      description,
                      status,
                      parent_workspace_id,
                      sort_order,
                      created_at,
                      updated_at
               FROM tasks
               WHERE project_id = $1
               ORDER BY sort_order ASC, created_at ASC"#,
        )
        .bind(project_id)
        .fetch_all(pool)
        .await
    }

    pub async fn create(
        pool: &SqlitePool,
        project_id: Uuid,
        data: &CreateTask,
    ) -> Result<Self, sqlx::Error> {
        let id = data.id.unwrap_or_else(Uuid::new_v4);
        let status = data.status.clone().unwrap_or_default();
        let sort_order = data.sort_order.unwrap_or(0);

        sqlx::query_as::<_, Task>(
            r#"INSERT INTO tasks (
                   id,
                   project_id,
                   title,
                   description,
                   status,
                   parent_workspace_id,
                   sort_order
               )
               VALUES ($1, $2, $3, $4, $5, $6, $7)
               RETURNING id,
                         project_id,
                         title,
                         description,
                         status,
                         parent_workspace_id,
                         sort_order,
                         created_at,
                         updated_at"#,
        )
        .bind(id)
        .bind(project_id)
        .bind(data.title.trim())
        .bind(&data.description)
        .bind(status)
        .bind(data.parent_workspace_id)
        .bind(sort_order)
        .fetch_one(pool)
        .await
    }

    pub async fn update(
        pool: &SqlitePool,
        id: Uuid,
        data: &UpdateTask,
    ) -> Result<Self, sqlx::Error> {
        let existing = Self::find_by_id(pool, id)
            .await?
            .ok_or(sqlx::Error::RowNotFound)?;
        let title = data.title.as_ref().unwrap_or(&existing.title);
        let description = data
            .description
            .clone()
            .unwrap_or_else(|| existing.description.clone());
        let status = data.status.clone().unwrap_or(existing.status);
        let parent_workspace_id = data
            .parent_workspace_id
            .unwrap_or(existing.parent_workspace_id);
        let sort_order = data.sort_order.unwrap_or(existing.sort_order);

        sqlx::query_as::<_, Task>(
            r#"UPDATE tasks
               SET title = $2,
                   description = $3,
                   status = $4,
                   parent_workspace_id = $5,
                   sort_order = $6,
                   updated_at = datetime('now', 'subsec')
               WHERE id = $1
               RETURNING id,
                         project_id,
                         title,
                         description,
                         status,
                         parent_workspace_id,
                         sort_order,
                         created_at,
                         updated_at"#,
        )
        .bind(id)
        .bind(title.trim())
        .bind(description)
        .bind(status)
        .bind(parent_workspace_id)
        .bind(sort_order)
        .fetch_one(pool)
        .await
    }

    pub async fn bulk_update(
        pool: &SqlitePool,
        updates: &[BulkUpdateTaskItem],
    ) -> Result<Vec<Self>, sqlx::Error> {
        let mut tx = pool.begin().await?;
        let mut updated_tasks = Vec::with_capacity(updates.len());

        for update in updates {
            let task = Self::find_by_id(pool, update.id)
                .await?
                .ok_or(sqlx::Error::RowNotFound)?;
            let title = update.changes.title.as_ref().unwrap_or(&task.title);
            let description = update
                .changes
                .description
                .clone()
                .unwrap_or_else(|| task.description.clone());
            let status = update.changes.status.clone().unwrap_or(task.status);
            let parent_workspace_id = update
                .changes
                .parent_workspace_id
                .unwrap_or(task.parent_workspace_id);
            let sort_order = update.changes.sort_order.unwrap_or(task.sort_order);

            let updated = sqlx::query_as::<_, Task>(
                r#"UPDATE tasks
                   SET title = $2,
                       description = $3,
                       status = $4,
                       parent_workspace_id = $5,
                       sort_order = $6,
                       updated_at = datetime('now', 'subsec')
                   WHERE id = $1
                   RETURNING id,
                             project_id,
                             title,
                             description,
                             status,
                             parent_workspace_id,
                             sort_order,
                             created_at,
                             updated_at"#,
            )
            .bind(update.id)
            .bind(title.trim())
            .bind(description)
            .bind(status)
            .bind(parent_workspace_id)
            .bind(sort_order)
            .fetch_one(&mut *tx)
            .await?;

            updated_tasks.push(updated);
        }

        tx.commit().await?;
        Ok(updated_tasks)
    }

    pub async fn delete(pool: &SqlitePool, id: Uuid) -> Result<u64, sqlx::Error> {
        let result = sqlx::query("DELETE FROM tasks WHERE id = $1")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected())
    }
}
