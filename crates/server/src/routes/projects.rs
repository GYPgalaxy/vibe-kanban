use axum::{
    Json, Router,
    extract::{Path, State},
    response::Json as ResponseJson,
    routing::{get, post, put},
};
use db::models::{
    project::{CreateProject, Project, UpdateProject},
    task::{BulkUpdateTaskItem, CreateTask, Task, UpdateTask},
};
use deployment::Deployment;
use serde::{Deserialize, Serialize};
use ts_rs::TS;
use utils::response::ApiResponse;
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

#[derive(Debug, Deserialize, TS)]
pub struct BulkUpdateTasksRequest {
    pub updates: Vec<BulkUpdateTaskItem>,
}

#[derive(Debug, Serialize, TS)]
pub struct BulkUpdateTasksResponse {
    pub tasks: Vec<Task>,
}

fn require_non_empty(value: &str, field: &str) -> Result<(), ApiError> {
    if value.trim().is_empty() {
        return Err(ApiError::BadRequest(format!("{field} is required")));
    }

    Ok(())
}

pub async fn get_projects(
    State(deployment): State<DeploymentImpl>,
) -> Result<ResponseJson<ApiResponse<Vec<Project>>>, ApiError> {
    let projects = Project::find_all(&deployment.db().pool).await?;
    Ok(ResponseJson(ApiResponse::success(projects)))
}

pub async fn get_project(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    let project = Project::find_by_id(&deployment.db().pool, project_id)
        .await?
        .ok_or(sqlx::Error::RowNotFound)?;

    Ok(ResponseJson(ApiResponse::success(project)))
}

pub async fn create_project(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<CreateProject>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    require_non_empty(&payload.name, "Project name")?;

    let project = Project::create(&deployment.db().pool, &payload).await?;

    deployment
        .track_if_analytics_allowed(
            "local_project_created",
            serde_json::json!({
                "project_id": project.id.to_string(),
            }),
        )
        .await;

    Ok(ResponseJson(ApiResponse::success(project)))
}

pub async fn update_project(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<UpdateProject>,
) -> Result<ResponseJson<ApiResponse<Project>>, ApiError> {
    if let Some(name) = &payload.name {
        require_non_empty(name, "Project name")?;
    }

    let project = Project::update(&deployment.db().pool, project_id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(project)))
}

pub async fn delete_project(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let rows_affected = Project::delete(&deployment.db().pool, project_id).await?;
    if rows_affected == 0 {
        return Err(ApiError::Database(sqlx::Error::RowNotFound));
    }

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn get_project_tasks(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<Vec<Task>>>, ApiError> {
    let tasks = Task::find_by_project_id(&deployment.db().pool, project_id).await?;
    Ok(ResponseJson(ApiResponse::success(tasks)))
}

pub async fn create_project_task(
    State(deployment): State<DeploymentImpl>,
    Path(project_id): Path<Uuid>,
    Json(payload): Json<CreateTask>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    require_non_empty(&payload.title, "Task title")?;

    let task = Task::create(&deployment.db().pool, project_id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(task)))
}

pub async fn update_task(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
    Json(payload): Json<UpdateTask>,
) -> Result<ResponseJson<ApiResponse<Task>>, ApiError> {
    if let Some(title) = &payload.title {
        require_non_empty(title, "Task title")?;
    }

    let task = Task::update(&deployment.db().pool, task_id, &payload).await?;
    Ok(ResponseJson(ApiResponse::success(task)))
}

pub async fn delete_task(
    State(deployment): State<DeploymentImpl>,
    Path(task_id): Path<Uuid>,
) -> Result<ResponseJson<ApiResponse<()>>, ApiError> {
    let rows_affected = Task::delete(&deployment.db().pool, task_id).await?;
    if rows_affected == 0 {
        return Err(ApiError::Database(sqlx::Error::RowNotFound));
    }

    Ok(ResponseJson(ApiResponse::success(())))
}

pub async fn bulk_update_tasks(
    State(deployment): State<DeploymentImpl>,
    Json(payload): Json<BulkUpdateTasksRequest>,
) -> Result<ResponseJson<ApiResponse<BulkUpdateTasksResponse>>, ApiError> {
    for update in &payload.updates {
        if let Some(title) = &update.changes.title {
            require_non_empty(title, "Task title")?;
        }
    }

    let tasks = Task::bulk_update(&deployment.db().pool, &payload.updates).await?;
    Ok(ResponseJson(ApiResponse::success(
        BulkUpdateTasksResponse { tasks },
    )))
}

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route("/projects", get(get_projects).post(create_project))
        .route(
            "/projects/{project_id}",
            get(get_project).put(update_project).delete(delete_project),
        )
        .route(
            "/projects/{project_id}/tasks",
            get(get_project_tasks).post(create_project_task),
        )
        .route("/tasks/bulk", post(bulk_update_tasks))
        .route("/tasks/{task_id}", put(update_task).delete(delete_task))
}
