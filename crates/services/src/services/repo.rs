use std::path::{Path, PathBuf};

use db::models::repo::{Repo as RepoModel, SearchMatchType, SearchResult};
use git::{GitService, GitServiceError};
use sqlx::SqlitePool;
use thiserror::Error;
use utils::path::expand_tilde;
use uuid::Uuid;

use super::file_search::{FileSearchCache, SearchQuery};

#[derive(Debug, Error)]
pub enum RepoError {
    #[error(transparent)]
    Database(#[from] sqlx::Error),
    #[error(transparent)]
    Io(#[from] std::io::Error),
    #[error("Path does not exist: {0}")]
    PathNotFound(PathBuf),
    #[error("Path is not a directory: {0}")]
    PathNotDirectory(PathBuf),
    #[error("Path is not a git repository: {0}")]
    NotGitRepository(PathBuf),
    #[error("Repository not found")]
    NotFound,
    #[error("Directory already exists: {0}")]
    DirectoryAlreadyExists(PathBuf),
    #[error("Git error: {0}")]
    Git(#[from] GitServiceError),
    #[error("Invalid folder name: {0}")]
    InvalidFolderName(String),
}

pub type Result<T> = std::result::Result<T, RepoError>;

#[derive(Clone, Default)]
pub struct RepoService;

impl RepoService {
    pub fn new() -> Self {
        Self
    }

    fn validate_git_repo_path(&self, path: &Path) -> Result<()> {
        if !path.exists() {
            return Err(RepoError::PathNotFound(path.to_path_buf()));
        }

        if !path.is_dir() {
            return Err(RepoError::PathNotDirectory(path.to_path_buf()));
        }

        Ok(())
    }

    pub fn normalize_path(&self, path: &str) -> std::io::Result<PathBuf> {
        std::path::absolute(expand_tilde(path))
    }

    pub async fn register(
        &self,
        pool: &SqlitePool,
        git: &GitService,
        path: &str,
        display_name: Option<&str>,
    ) -> Result<RepoModel> {
        let normalized_path = self.normalize_path(path)?;
        self.validate_git_repo_path(&normalized_path)?;

        // If the directory is not already a git repository, initialize one in
        // place so any existing directory can be registered. Repositories with
        // existing history are left untouched (idempotent).
        if !git.is_repo_openable(&normalized_path) {
            git.initialize_repo_with_main_branch(&normalized_path)?;
        }

        let name = normalized_path
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "unnamed".to_string());

        let display_name = display_name.unwrap_or(&name);

        let repo = RepoModel::find_or_create(pool, &normalized_path, display_name).await?;
        Ok(repo)
    }

    pub async fn find_by_id(&self, pool: &SqlitePool, repo_id: Uuid) -> Result<Option<RepoModel>> {
        let repo = RepoModel::find_by_id(pool, repo_id).await?;
        Ok(repo)
    }

    pub async fn get_by_id(&self, pool: &SqlitePool, repo_id: Uuid) -> Result<RepoModel> {
        self.find_by_id(pool, repo_id)
            .await?
            .ok_or(RepoError::NotFound)
    }

    pub async fn init_repo(
        &self,
        pool: &SqlitePool,
        git: &GitService,
        parent_path: &str,
        folder_name: &str,
    ) -> Result<RepoModel> {
        if folder_name.is_empty()
            || folder_name.contains('/')
            || folder_name.contains('\\')
            || folder_name == "."
            || folder_name == ".."
        {
            return Err(RepoError::InvalidFolderName(folder_name.to_string()));
        }

        let normalized_parent = self.normalize_path(parent_path)?;
        if !normalized_parent.exists() {
            return Err(RepoError::PathNotFound(normalized_parent));
        }
        if !normalized_parent.is_dir() {
            return Err(RepoError::PathNotDirectory(normalized_parent));
        }

        let repo_path = normalized_parent.join(folder_name);
        // Reuse the directory if it already exists instead of erroring. A
        // non-git directory is initialized below; an existing git repository is
        // left untouched (initialize_repo_with_main_branch is idempotent and
        // preserves existing history).

        git.initialize_repo_with_main_branch(&repo_path)?;

        let repo = RepoModel::find_or_create(pool, &repo_path, folder_name).await?;
        Ok(repo)
    }

    pub async fn search_files(
        &self,
        cache: &FileSearchCache,
        repositories: &[RepoModel],
        query: &SearchQuery,
    ) -> Result<Vec<SearchResult>> {
        let query_str = query.q.trim();
        if query_str.is_empty() || repositories.is_empty() {
            return Ok(vec![]);
        }

        // Search in parallel and prefix paths with repo name
        let search_futures: Vec<_> = repositories
            .iter()
            .map(|repo| {
                let repo_name = repo.name.clone();
                let repo_path = repo.path.clone();
                let mode = query.mode.clone();
                let query_str = query_str.to_string();
                async move {
                    let results = cache
                        .search_repo(&repo_path, &query_str, mode)
                        .await
                        .unwrap_or_else(|e| {
                            tracing::warn!("Search failed for repo {}: {}", repo_name, e);
                            vec![]
                        });
                    (repo_name, results)
                }
            })
            .collect();

        let repo_results = futures::future::join_all(search_futures).await;

        let mut all_results: Vec<SearchResult> = repo_results
            .into_iter()
            .flat_map(|(repo_name, results)| {
                results.into_iter().map(move |r| SearchResult {
                    path: format!("{}/{}", repo_name, r.path),
                    is_file: r.is_file,
                    match_type: r.match_type.clone(),
                    score: r.score,
                })
            })
            .collect();

        all_results.sort_by(|a, b| {
            let priority = |m: &SearchMatchType| match m {
                SearchMatchType::FileName => 0,
                SearchMatchType::DirectoryName => 1,
                SearchMatchType::FullPath => 2,
            };
            priority(&a.match_type)
                .cmp(&priority(&b.match_type))
                .then_with(|| b.score.cmp(&a.score)) // Higher scores first
        });

        all_results.truncate(10);
        Ok(all_results)
    }
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use git::GitService;
    use sqlx::sqlite::{SqliteConnectOptions, SqlitePoolOptions};
    use tempfile::TempDir;

    use super::*;

    /// Build an in-memory SQLite pool with the db crate's migrations applied,
    /// so `find_or_create` has the `repos` table to work against.
    async fn setup_pool() -> SqlitePool {
        let options = SqliteConnectOptions::from_str("sqlite::memory:")
            .unwrap()
            .create_if_missing(true);
        let pool = SqlitePoolOptions::new()
            .max_connections(1)
            .connect_with(options)
            .await
            .unwrap();
        sqlx::migrate!("../db/migrations").run(&pool).await.unwrap();
        pool
    }

    #[tokio::test]
    async fn init_repo_creates_repo_in_new_directory() {
        let pool = setup_pool().await;
        let service = RepoService::new();
        let git = GitService::new();
        let parent = TempDir::new().unwrap();

        let repo = service
            .init_repo(&pool, &git, parent.path().to_str().unwrap(), "my-project")
            .await
            .unwrap();

        let repo_path = parent.path().join("my-project");
        assert!(repo_path.join(".git").exists());
        assert!(git.is_repo_openable(&repo_path));
        assert_eq!(repo.path, repo_path);
        // main branch + initial commit exist
        let head = git.get_head_info(&repo_path).unwrap();
        assert_eq!(head.branch, "main");
    }

    #[tokio::test]
    async fn init_repo_reuses_existing_empty_directory() {
        let pool = setup_pool().await;
        let service = RepoService::new();
        let git = GitService::new();
        let parent = TempDir::new().unwrap();

        // Pre-create the target directory (non-git, empty).
        let repo_path = parent.path().join("existing");
        std::fs::create_dir_all(&repo_path).unwrap();

        let repo = service
            .init_repo(&pool, &git, parent.path().to_str().unwrap(), "existing")
            .await
            .unwrap();

        assert!(git.is_repo_openable(&repo_path));
        assert_eq!(repo.path, repo_path);
    }

    #[tokio::test]
    async fn init_repo_preserves_existing_history() {
        let pool = setup_pool().await;
        let service = RepoService::new();
        let git = GitService::new();
        let parent = TempDir::new().unwrap();

        // Set up a repo with a real commit first.
        let repo_path = parent.path().join("with-history");
        git.initialize_repo_with_main_branch(&repo_path).unwrap();
        let original_oid = git.get_head_info(&repo_path).unwrap().oid;

        // Re-running init_repo on the existing repo must not rewrite history.
        let _repo = service
            .init_repo(&pool, &git, parent.path().to_str().unwrap(), "with-history")
            .await
            .unwrap();

        let after_oid = git.get_head_info(&repo_path).unwrap().oid;
        assert_eq!(
            after_oid, original_oid,
            "existing repo history must not be rewritten"
        );
    }

    #[tokio::test]
    async fn init_repo_rejects_invalid_folder_name() {
        let pool = setup_pool().await;
        let service = RepoService::new();
        let git = GitService::new();
        let parent = TempDir::new().unwrap();

        let result = service
            .init_repo(&pool, &git, parent.path().to_str().unwrap(), "bad/name")
            .await;
        assert!(matches!(result, Err(RepoError::InvalidFolderName(_))));
    }

    #[tokio::test]
    async fn register_auto_inits_non_git_directory() {
        let pool = setup_pool().await;
        let service = RepoService::new();
        let git = GitService::new();
        let dir = TempDir::new().unwrap();
        let path = dir.path().to_str().unwrap();

        // Fresh temp dir is not a git repo.
        assert!(!git.is_repo_openable(dir.path()));

        let repo = service.register(&pool, &git, path, None).await.unwrap();

        assert!(git.is_repo_openable(dir.path()));
        assert_eq!(repo.path, dir.path());
    }

    #[tokio::test]
    async fn register_preserves_existing_git_repository() {
        let pool = setup_pool().await;
        let service = RepoService::new();
        let git = GitService::new();
        let dir = TempDir::new().unwrap();

        // Existing repo with history.
        git.initialize_repo_with_main_branch(dir.path()).unwrap();
        let original_oid = git.get_head_info(dir.path()).unwrap().oid;

        let repo = service
            .register(&pool, &git, dir.path().to_str().unwrap(), None)
            .await
            .unwrap();

        let after_oid = git.get_head_info(dir.path()).unwrap().oid;
        assert_eq!(after_oid, original_oid, "history must be untouched");
        assert_eq!(repo.path, dir.path());
    }

    #[tokio::test]
    async fn register_rejects_missing_path() {
        let pool = setup_pool().await;
        let service = RepoService::new();
        let git = GitService::new();

        let result = service
            .register(&pool, &git, "/this/path/does/not/exist", None)
            .await;
        assert!(matches!(result, Err(RepoError::PathNotFound(_))));
    }
}
