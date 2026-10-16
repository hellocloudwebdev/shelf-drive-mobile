//! Tauri commands for applying proxy and VPN optimizer settings.
//! These are called from the frontend when the user changes network configuration.

use crate::vpn_optimizer::{
    apply_candidate_transaction, NetworkConfig, NetworkConfigSnapshot, ProxyConfig, VpnConfig,
};
use tauri::State;

#[derive(Debug, serde::Deserialize)]
pub struct ProxySettingsRequest {
    enabled: bool,
    proxy_type: String,
    host: String,
    port: u16,
    username: String,
    password: String,
}

/// Apply proxy settings from the frontend.
/// Stores the config in global state so network operations can read it.
#[tauri::command]
pub async fn cmd_apply_proxy_settings(
    req: ProxySettingsRequest,
    net_config: State<'_, std::sync::Arc<NetworkConfig>>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let net_config = net_config.inner().clone();
    let _update_guard = net_config.settings_update_lock.lock().await;
    let old_snapshot = net_config.snapshot();
    let password = if req.password.is_empty() {
        old_snapshot.proxy.password.clone()
    } else {
        req.password.clone()
    };
    let config = ProxyConfig {
        enabled: req.enabled,
        proxy_type: req.proxy_type,
        host: req.host,
        port: req.port,
        username: req.username,
        password,
    };

    log::info!(
        "Applying proxy settings: enabled={}, type={}, host={}:{}",
        config.enabled,
        config.proxy_type,
        config.host,
        config.port
    );

    let candidate = NetworkConfigSnapshot {
        proxy: config.clone(),
        vpn: old_snapshot.vpn.clone(),
    };
    let proxy_for_bridge = config;
    let secret_to_store = (!req.password.is_empty()).then_some(req.password);
    let net_config_for_publish = net_config.clone();
    let app_for_publish = app.clone();
    let rollback_snapshot = old_snapshot.clone();

    apply_candidate_transaction(
        candidate,
        || async move { NetworkConfig::prepare_proxy_bridge(&proxy_for_bridge).await },
        move |candidate, prepared_bridge| {
            // Hold both guards while persisting and swapping, so readers can
            // see either the old proxy/bridge pair or the fully committed pair.
            let mut proxy = net_config_for_publish
                .proxy
                .write()
                .map_err(|error| error.to_string())?;
            let mut bridge = net_config_for_publish
                .bridge_handle
                .lock()
                .map_err(|error| error.to_string())?;

            crate::vpn_optimizer::save_network_config(&app_for_publish, candidate)
                .map_err(|error| format!("Failed to save proxy settings: {error}"))?;

            if let Some(password) = secret_to_store.as_deref() {
                if let Err(error) = crate::proxy_secret::store_password(password) {
                    let rollback = crate::vpn_optimizer::save_network_config(
                        &app_for_publish,
                        &rollback_snapshot,
                    );
                    return Err(match rollback {
                        Ok(()) => format!("Failed to save proxy credentials: {error}"),
                        Err(rollback_error) => format!(
                            "Failed to save proxy credentials: {error}; also failed to restore prior settings: {rollback_error}"
                        ),
                    });
                }
            }

            *proxy = candidate.proxy.clone();
            let replaced = std::mem::replace(&mut *bridge, prepared_bridge.take());
            drop(bridge);
            drop(proxy);
            if let Some(previous) = replaced {
                previous.handle.abort();
                log::info!("Previous SOCKS5 bridge stopped after proxy settings commit.");
            }
            Ok(())
        },
        |prepared_bridge| {
            if let Some(bridge) = prepared_bridge {
                bridge.handle.abort();
            }
        },
    )
    .await?;

    Ok("Proxy settings applied".into())
}

/// Import a password found in a legacy frontend settings file. The caller may
/// scrub the legacy value only after this command succeeds.
#[tauri::command]
pub async fn cmd_migrate_proxy_secret(
    password: String,
    net_config: State<'_, std::sync::Arc<NetworkConfig>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    if password.is_empty() {
        return Ok(());
    }
    crate::proxy_secret::store_password(&password)?;
    net_config
        .proxy
        .write()
        .map_err(|error| error.to_string())?
        .password = password;
    crate::vpn_optimizer::save_network_config(&app, &net_config.snapshot())
}

#[tauri::command]
pub async fn cmd_clear_proxy_secret(
    net_config: State<'_, std::sync::Arc<NetworkConfig>>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    crate::proxy_secret::delete_password()?;
    net_config
        .proxy
        .write()
        .map_err(|error| error.to_string())?
        .password
        .clear();
    crate::vpn_optimizer::save_network_config(&app, &net_config.snapshot())
}

#[derive(Debug, serde::Deserialize)]
pub struct VpnSettingsRequest {
    enabled: bool,
    timeout_multiplier: u32,
    retry_attempts: u32,
    retry_base_backoff_ms: u64,
    retry_max_backoff_ms: u64,
    adaptive_polling: bool,
    polling_min_sec: u32,
    polling_max_sec: u32,
    preferred_dc: String,
    dc_fallback_attempts: u32,
    flood_wait_respect: bool,
    peer_cache_size: usize,
    bandwidth_limit_up_kbs: u32,
    bandwidth_limit_down_kbs: u32,
    chunk_size_kb: u32,
    keep_alive_interval_sec: u32,
    auto_detect_vpn: bool,
    archive_max_bytes: u64,
}

/// Apply VPN optimizer settings from the frontend.
/// Stores the config in global state so network operations can read it.
#[tauri::command]
pub async fn cmd_apply_vpn_settings(
    req: VpnSettingsRequest,
    net_config: State<'_, std::sync::Arc<NetworkConfig>>,
    app: tauri::AppHandle,
) -> Result<String, String> {
    let net_config = net_config.inner().clone();
    let _update_guard = net_config.settings_update_lock.lock().await;
    let old_snapshot = net_config.snapshot();
    let config = VpnConfig {
        enabled: req.enabled,
        timeout_multiplier: req.timeout_multiplier.clamp(1, 5),
        retry_attempts: req.retry_attempts.clamp(0, 5),
        retry_base_backoff_ms: req.retry_base_backoff_ms.clamp(500, 5000),
        retry_max_backoff_ms: req.retry_max_backoff_ms.clamp(8000, 60000),
        adaptive_polling: req.adaptive_polling,
        polling_min_sec: req.polling_min_sec.clamp(10, 30),
        polling_max_sec: req.polling_max_sec.clamp(45, 120),
        preferred_dc: req.preferred_dc,
        dc_fallback_attempts: req.dc_fallback_attempts.clamp(1, 4),
        flood_wait_respect: req.flood_wait_respect,
        peer_cache_size: req.peer_cache_size.clamp(100, 2000),
        bandwidth_limit_up_kbs: req.bandwidth_limit_up_kbs,
        bandwidth_limit_down_kbs: req.bandwidth_limit_down_kbs,
        chunk_size_kb: req.chunk_size_kb.clamp(64, 512),
        keep_alive_interval_sec: if req.keep_alive_interval_sec == 0 {
            0
        } else {
            req.keep_alive_interval_sec.clamp(30, 120)
        },
        auto_detect_vpn: req.auto_detect_vpn,
        archive_max_bytes: req.archive_max_bytes,
    };

    log::info!(
        "Applying VPN settings: enabled={}, timeout={}x, retries={}, flood_wait={}",
        config.enabled,
        config.timeout_multiplier,
        config.retry_attempts,
        config.flood_wait_respect
    );

    let candidate = NetworkConfigSnapshot {
        proxy: old_snapshot.proxy,
        vpn: config,
    };
    let net_config_for_publish = net_config.clone();
    let app_for_publish = app.clone();

    apply_candidate_transaction(
        candidate,
        || async { Ok::<(), String>(()) },
        move |candidate, _| {
            let mut vpn = net_config_for_publish
                .vpn
                .write()
                .map_err(|error| error.to_string())?;
            crate::vpn_optimizer::save_network_config(&app_for_publish, candidate)
                .map_err(|error| format!("Failed to save VPN settings: {error}"))?;
            *vpn = candidate.vpn.clone();
            Ok(())
        },
        |_| {},
    )
    .await?;

    Ok("VPN settings applied".into())
}

/// Get current network configuration snapshot (called on startup / settings load).
#[tauri::command]
pub async fn cmd_get_network_config(
    net_config: State<'_, std::sync::Arc<NetworkConfig>>,
) -> Result<NetworkConfigSnapshot, String> {
    Ok(net_config.snapshot())
}
