use axum::{
    Router,
    body::{Body, to_bytes},
    extract::{
        Path, Request, State,
        ws::{WebSocketUpgrade, rejection::WebSocketUpgradeRejection},
    },
    http::{StatusCode, Uri},
    response::{IntoResponse, Response},
    routing::any,
};
use deployment::Deployment;
use relay_hosts::ProxiedResponse;
use utils::http_headers::is_hop_by_hop_header;
use uuid::Uuid;
use ws_bridge::{bridge_axum_ws, connect_upstream_ws};

use crate::{DeploymentImpl, error::ApiError, routes::direct_hosts};

type MaybeWsUpgrade = Result<WebSocketUpgrade, WebSocketUpgradeRejection>;

pub(super) fn router() -> Router<DeploymentImpl> {
    Router::new().route("/host/{host_id}/{*tail}", any(proxy_host_request))
}

async fn proxy_host_request(
    State(deployment): State<DeploymentImpl>,
    Path((host_id, tail)): Path<(Uuid, String)>,
    ws_upgrade: MaybeWsUpgrade,
    mut request: Request,
) -> Result<Response, ApiError> {
    let query = request.uri().query().map(str::to_owned);
    let upstream_uri = upstream_api_uri(&tail, query.as_deref())?;
    *request.uri_mut() = upstream_uri;

    match ws_upgrade {
        Ok(ws_upgrade) => forward_ws(&deployment, host_id, request, ws_upgrade).await,
        Err(_) => forward_http(&deployment, host_id, request).await,
    }
}

async fn forward_http(
    deployment: &DeploymentImpl,
    host_id: Uuid,
    request: Request,
) -> Result<Response, ApiError> {
    let (parts, body) = request.into_parts();
    let method = parts.method;
    let headers = parts.headers;
    let target_path = parts
        .uri
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .to_string();
    let body_bytes = to_bytes(body, usize::MAX).await.map_err(|error| {
        tracing::warn!(?error, "Failed to read relay proxy request body");
        ApiError::BadRequest("Invalid request body".to_string())
    })?;

    if let Some(direct_host) = direct_hosts::find_direct_host(host_id).await? {
        let response =
            direct_hosts::proxy_http(&direct_host, &method, &target_path, &headers, &body_bytes)
                .await?;
        return Ok(relay_http_response(response));
    }

    let relay_hosts = deployment.relay_hosts()?;
    let relay_host = relay_hosts.host(host_id).await?;
    let response = relay_host
        .proxy_http(&method, &target_path, &headers, &body_bytes)
        .await?;

    Ok(relay_http_response(response))
}

async fn forward_ws(
    deployment: &DeploymentImpl,
    host_id: Uuid,
    request: Request,
    ws_upgrade: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    let target_path = request
        .uri()
        .path_and_query()
        .map(|pq| pq.as_str())
        .unwrap_or("/")
        .to_string();
    let protocols = request
        .headers()
        .get("sec-websocket-protocol")
        .and_then(|v| v.to_str().ok())
        .map(ToOwned::to_owned);

    if let Some(direct_host) = direct_hosts::find_direct_host(host_id).await? {
        let local_port = direct_hosts::get_or_create_tunnel(&direct_host).await?;
        let ws_url = direct_hosts::direct_ws_url(local_port, &target_path);
        let (upstream_ws, selected_protocol) = connect_upstream_ws(ws_url, protocols.as_deref())
            .await
            .map_err(|error| ApiError::BadGateway(error.to_string()))?;
        let mut ws = ws_upgrade;
        if let Some(protocol) = &selected_protocol {
            ws = ws.protocols([protocol.clone()]);
        }
        return Ok(ws
            .on_upgrade(|socket| async move {
                if let Err(error) = bridge_axum_ws(socket, upstream_ws).await {
                    tracing::debug!(?error, "Direct host WS bridge closed with error");
                }
            })
            .into_response());
    }

    let relay_hosts = deployment.relay_hosts()?;
    let relay_host = relay_hosts.host(host_id).await?;

    let connection = relay_host
        .proxy_ws(&target_path, protocols.as_deref())
        .await?;
    let selected_protocol = connection.selected_protocol.clone();

    let mut ws = ws_upgrade;
    if let Some(protocol) = &selected_protocol {
        ws = ws.protocols([protocol.clone()]);
    }
    Ok(ws
        .on_upgrade(|socket| async move {
            if let Err(error) = connection.bridge(socket).await {
                tracing::debug!(?error, "WS bridge closed with error");
            }
        })
        .into_response())
}

#[allow(clippy::result_large_err)]
fn upstream_api_uri(tail: &str, query: Option<&str>) -> Result<Uri, ApiError> {
    let mut uri = String::from("/api/");
    uri.push_str(tail);

    if let Some(query) = query {
        uri.push('?');
        uri.push_str(query);
    }

    uri.parse()
        .map_err(|_| ApiError::BadRequest("Invalid rewritten relay path".to_string()))
}

fn relay_http_response(response: ProxiedResponse) -> Response {
    let mut builder = Response::builder().status(response.status);
    for (name, value) in &response.headers {
        if !is_hop_by_hop_header(name.as_str()) {
            builder = builder.header(name, value);
        }
    }

    builder
        .body(Body::from_stream(response.body))
        .unwrap_or_else(|_| {
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "Failed to build relay proxy response",
            )
                .into_response()
        })
}
