use std::{
    collections::HashMap,
    net::TcpListener as StdTcpListener,
    process::Stdio,
    sync::OnceLock,
    time::{Duration, Instant},
};

use axum::{
    Json, Router,
    extract::{Path, State},
    http::{HeaderMap, Method, StatusCode, header},
    routing::{get, put},
};
use futures_util::StreamExt;
use relay_hosts::ProxiedResponse;
use serde::{Deserialize, Serialize};
use thiserror::Error;
use tokio::{process::Child, sync::Mutex};
use ts_rs::TS;
use utils::{assets::direct_hosts_path, http_headers::is_hop_by_hop_header, response::ApiResponse};
use uuid::Uuid;

use crate::{DeploymentImpl, error::ApiError};

const DEFAULT_SSH_PORT: u16 = 22;
const DEFAULT_REMOTE_API_HOST: &str = "127.0.0.1";
const DEFAULT_REMOTE_API_PORT: u16 = 3000;

pub fn router() -> Router<DeploymentImpl> {
    Router::new()
        .route(
            "/direct-hosts",
            get(list_direct_hosts).post(create_direct_host),
        )
        .route(
            "/direct-hosts/{host_id}",
            put(update_direct_host).delete(delete_direct_host),
        )
}

#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DirectHostStatus {
    Online,
    Offline,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DirectHost {
    pub id: Uuid,
    pub name: String,
    pub ssh_host: String,
    pub ssh_port: u16,
    pub ssh_user: Option<String>,
    pub remote_api_host: String,
    pub remote_api_port: u16,
    pub created_at: String,
    pub updated_at: String,
    #[serde(default = "default_host_status")]
    pub status: DirectHostStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct CreateDirectHostRequest {
    pub name: String,
    pub ssh_host: String,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub remote_api_host: Option<String>,
    #[serde(default)]
    pub remote_api_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct UpdateDirectHostRequest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub ssh_host: Option<String>,
    #[serde(default)]
    pub ssh_port: Option<u16>,
    #[serde(default)]
    pub ssh_user: Option<String>,
    #[serde(default)]
    pub remote_api_host: Option<String>,
    #[serde(default)]
    pub remote_api_port: Option<u16>,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct ListDirectHostsResponse {
    pub hosts: Vec<DirectHost>,
}

#[derive(Debug, Serialize, Deserialize, Default)]
struct DirectHostsFile {
    hosts: Vec<DirectHost>,
}

#[derive(Debug, Error)]
enum DirectHostProxyError {
    #[error("Failed to reserve a local tunnel port: {0}")]
    ReservePort(std::io::Error),
    #[error("Failed to start ssh tunnel: {0}")]
    StartSsh(std::io::Error),
    #[error("Failed to inspect ssh tunnel process: {0}")]
    InspectSsh(std::io::Error),
    #[error("SSH tunnel exited before the remote API became reachable")]
    SshExited,
    #[error("Timed out waiting for the remote Vibe Kanban API")]
    HealthTimeout,
    #[error("Remote Vibe Kanban API request failed: {0}")]
    UpstreamHttp(reqwest::Error),
}

struct ActiveDirectTunnel {
    key: String,
    local_port: u16,
    child: Child,
}

#[derive(Default)]
struct DirectHostTunnelManager {
    tunnels: Mutex<HashMap<Uuid, ActiveDirectTunnel>>,
}

impl DirectHostTunnelManager {
    async fn get_or_create_tunnel(&self, host: &DirectHost) -> Result<u16, DirectHostProxyError> {
        let key = tunnel_key(host);

        {
            let mut tunnels = self.tunnels.lock().await;
            if let Some(active) = tunnels.get_mut(&host.id) {
                if active.key == key
                    && active
                        .child
                        .try_wait()
                        .map_err(DirectHostProxyError::InspectSsh)?
                        .is_none()
                {
                    return Ok(active.local_port);
                }

                let _ = active.child.start_kill();
                tunnels.remove(&host.id);
            }
        }

        let local_port = reserve_local_port().map_err(DirectHostProxyError::ReservePort)?;
        let mut child =
            spawn_ssh_tunnel(host, local_port).map_err(DirectHostProxyError::StartSsh)?;
        wait_for_remote_api(local_port, &mut child).await?;

        let mut tunnels = self.tunnels.lock().await;
        tunnels.insert(
            host.id,
            ActiveDirectTunnel {
                key,
                local_port,
                child,
            },
        );

        Ok(local_port)
    }

    async fn cancel_tunnel(&self, host_id: Uuid) {
        let mut tunnels = self.tunnels.lock().await;
        if let Some(mut active) = tunnels.remove(&host_id) {
            let _ = active.child.start_kill();
        }
    }
}

async fn list_direct_hosts(
    State(_deployment): State<DeploymentImpl>,
) -> Result<Json<ApiResponse<ListDirectHostsResponse>>, ApiError> {
    Ok(Json(ApiResponse::success(ListDirectHostsResponse {
        hosts: load_hosts().await?,
    })))
}

async fn create_direct_host(
    State(_deployment): State<DeploymentImpl>,
    Json(req): Json<CreateDirectHostRequest>,
) -> Result<Json<ApiResponse<DirectHost>>, ApiError> {
    let mut hosts = load_hosts().await?;
    let now = chrono::Utc::now().to_rfc3339();
    let host = DirectHost {
        id: Uuid::new_v4(),
        name: validate_required("name", &req.name)?,
        ssh_host: validate_required("ssh_host", &req.ssh_host)?,
        ssh_port: req.ssh_port.unwrap_or(DEFAULT_SSH_PORT),
        ssh_user: normalize_optional(req.ssh_user),
        remote_api_host: normalize_optional(req.remote_api_host)
            .unwrap_or_else(|| DEFAULT_REMOTE_API_HOST.to_string()),
        remote_api_port: req.remote_api_port.unwrap_or(DEFAULT_REMOTE_API_PORT),
        created_at: now.clone(),
        updated_at: now,
        status: DirectHostStatus::Online,
    };
    validate_host_ports(&host)?;
    hosts.push(host.clone());
    save_hosts(&hosts).await?;

    Ok(Json(ApiResponse::success(host)))
}

async fn update_direct_host(
    State(_deployment): State<DeploymentImpl>,
    Path(host_id): Path<Uuid>,
    Json(req): Json<UpdateDirectHostRequest>,
) -> Result<Json<ApiResponse<DirectHost>>, ApiError> {
    let mut hosts = load_hosts().await?;
    let Some(index) = hosts.iter().position(|host| host.id == host_id) else {
        return Err(ApiError::BadRequest("Direct host not found".to_string()));
    };

    let mut host = hosts[index].clone();
    if let Some(name) = req.name {
        host.name = validate_required("name", &name)?;
    }
    if let Some(ssh_host) = req.ssh_host {
        host.ssh_host = validate_required("ssh_host", &ssh_host)?;
    }
    if let Some(ssh_port) = req.ssh_port {
        host.ssh_port = ssh_port;
    }
    if let Some(remote_api_host) = req.remote_api_host {
        host.remote_api_host = validate_required("remote_api_host", &remote_api_host)?;
    }
    if let Some(remote_api_port) = req.remote_api_port {
        host.remote_api_port = remote_api_port;
    }
    if let Some(ssh_user) = req.ssh_user {
        host.ssh_user = normalize_optional(Some(ssh_user));
    }
    host.updated_at = chrono::Utc::now().to_rfc3339();
    validate_host_ports(&host)?;

    hosts[index] = host.clone();
    save_hosts(&hosts).await?;
    tunnel_manager().cancel_tunnel(host_id).await;

    Ok(Json(ApiResponse::success(host)))
}

async fn delete_direct_host(
    State(_deployment): State<DeploymentImpl>,
    Path(host_id): Path<Uuid>,
) -> Result<Json<ApiResponse<()>>, ApiError> {
    let mut hosts = load_hosts().await?;
    let original_len = hosts.len();
    hosts.retain(|host| host.id != host_id);
    if hosts.len() == original_len {
        return Err(ApiError::BadRequest("Direct host not found".to_string()));
    }

    save_hosts(&hosts).await?;
    tunnel_manager().cancel_tunnel(host_id).await;

    Ok(Json(ApiResponse::success(())))
}

pub async fn find_direct_host(host_id: Uuid) -> Result<Option<DirectHost>, ApiError> {
    Ok(load_hosts()
        .await?
        .into_iter()
        .find(|host| host.id == host_id))
}

pub async fn get_or_create_tunnel(host: &DirectHost) -> Result<u16, ApiError> {
    tunnel_manager()
        .get_or_create_tunnel(host)
        .await
        .map_err(|error| ApiError::BadGateway(error.to_string()))
}

pub async fn proxy_http(
    host: &DirectHost,
    method: &Method,
    target_path: &str,
    headers: &HeaderMap,
    body: &[u8],
) -> Result<ProxiedResponse, ApiError> {
    let local_port = get_or_create_tunnel(host).await?;
    let url = format!("http://127.0.0.1:{local_port}{target_path}");
    let client = reqwest::Client::new();
    let mut request = client.request(method.clone(), url);

    for (name, value) in headers {
        if should_forward_header(name) {
            request = request.header(name, value);
        }
    }

    let response = request.body(body.to_vec()).send().await.map_err(|error| {
        ApiError::BadGateway(DirectHostProxyError::UpstreamHttp(error).to_string())
    })?;
    let status = response.status();
    let headers = response.headers().clone();
    let body = Box::pin(
        response
            .bytes_stream()
            .map(|chunk| chunk.map_err(|e| std::io::Error::other(e.to_string()))),
    );

    Ok(ProxiedResponse {
        status,
        headers,
        body,
    })
}

pub fn direct_ws_url(local_port: u16, target_path: &str) -> String {
    format!("ws://127.0.0.1:{local_port}{target_path}")
}

async fn load_hosts() -> Result<Vec<DirectHost>, ApiError> {
    let path = direct_hosts_path();
    let Ok(raw) = tokio::fs::read_to_string(&path).await else {
        return Ok(Vec::new());
    };

    let mut file: DirectHostsFile = serde_json::from_str(&raw)
        .map_err(|error| ApiError::BadRequest(format!("Invalid direct host config: {error}")))?;
    file.hosts.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(file.hosts)
}

async fn save_hosts(hosts: &[DirectHost]) -> Result<(), ApiError> {
    let path = direct_hosts_path();
    if let Some(parent) = path.parent() {
        tokio::fs::create_dir_all(parent).await?;
    }

    let file = DirectHostsFile {
        hosts: hosts.to_vec(),
    };
    let raw = serde_json::to_string_pretty(&file).map_err(|error| {
        ApiError::BadGateway(format!("Failed to serialize direct hosts: {error}"))
    })?;
    tokio::fs::write(path, raw).await?;
    Ok(())
}

fn tunnel_manager() -> &'static DirectHostTunnelManager {
    static MANAGER: OnceLock<DirectHostTunnelManager> = OnceLock::new();
    MANAGER.get_or_init(DirectHostTunnelManager::default)
}

fn reserve_local_port() -> std::io::Result<u16> {
    let listener = StdTcpListener::bind("127.0.0.1:0")?;
    Ok(listener.local_addr()?.port())
}

fn spawn_ssh_tunnel(host: &DirectHost, local_port: u16) -> std::io::Result<Child> {
    let target = match host.ssh_user.as_deref() {
        Some(user) => format!("{user}@{}", host.ssh_host),
        None => host.ssh_host.clone(),
    };
    let forward = format!(
        "127.0.0.1:{local_port}:{}:{}",
        host.remote_api_host, host.remote_api_port
    );

    tokio::process::Command::new("ssh")
        .arg("-N")
        .arg("-L")
        .arg(forward)
        .arg("-p")
        .arg(host.ssh_port.to_string())
        .arg("-o")
        .arg("ExitOnForwardFailure=yes")
        .arg("-o")
        .arg("BatchMode=yes")
        .arg("-o")
        .arg("ServerAliveInterval=30")
        .arg("-o")
        .arg("ServerAliveCountMax=2")
        .arg(target)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .kill_on_drop(true)
        .spawn()
}

async fn wait_for_remote_api(
    local_port: u16,
    child: &mut Child,
) -> Result<(), DirectHostProxyError> {
    let deadline = Instant::now() + Duration::from_secs(8);
    let client = reqwest::Client::new();
    let health_url = format!("http://127.0.0.1:{local_port}/api/health");

    loop {
        if child
            .try_wait()
            .map_err(DirectHostProxyError::InspectSsh)?
            .is_some()
        {
            return Err(DirectHostProxyError::SshExited);
        }

        if Instant::now() >= deadline {
            let _ = child.start_kill();
            return Err(DirectHostProxyError::HealthTimeout);
        }

        if let Ok(response) = client
            .get(&health_url)
            .timeout(Duration::from_millis(500))
            .send()
            .await
            && response.status() == StatusCode::OK
        {
            return Ok(());
        }

        tokio::time::sleep(Duration::from_millis(150)).await;
    }
}

fn should_forward_header(name: &header::HeaderName) -> bool {
    !is_hop_by_hop_header(name.as_str())
        && name != header::HOST
        && name != header::ORIGIN
        && name != header::CONTENT_LENGTH
}

fn validate_required(field: &str, value: &str) -> Result<String, ApiError> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return Err(ApiError::BadRequest(format!("{field} is required")));
    }
    Ok(trimmed.to_string())
}

fn normalize_optional(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn validate_host_ports(host: &DirectHost) -> Result<(), ApiError> {
    if host.ssh_port == 0 {
        return Err(ApiError::BadRequest(
            "ssh_port must be greater than 0".to_string(),
        ));
    }
    if host.remote_api_port == 0 {
        return Err(ApiError::BadRequest(
            "remote_api_port must be greater than 0".to_string(),
        ));
    }
    Ok(())
}

fn default_host_status() -> DirectHostStatus {
    DirectHostStatus::Online
}

fn tunnel_key(host: &DirectHost) -> String {
    format!(
        "{}:{}:{:?}:{}:{}",
        host.ssh_host, host.ssh_port, host.ssh_user, host.remote_api_host, host.remote_api_port
    )
}
