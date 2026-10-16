use crate::vpn_optimizer::NetworkConfig;
use std::net::{SocketAddr, TcpStream};
use std::time::Duration;
use tauri::State;

/// Resolve a proxy hostname and try each address within one overall timeout.
/// DNS lookup is also covered by that deadline, unlike synchronous
/// `ToSocketAddrs`, which can block indefinitely on resolver problems.
async fn proxy_connection_latency(host: &str, port: u16, timeout: Duration) -> Option<i64> {
    let started = std::time::Instant::now();
    let resolved = tokio::time::timeout(timeout, tokio::net::lookup_host((host, port)))
        .await
        .ok()?
        .ok()?;
    let addresses: Vec<SocketAddr> = resolved.collect();

    for address in addresses {
        let remaining = timeout.checked_sub(started.elapsed())?;
        if remaining.is_zero() {
            return None;
        }
        if tokio::time::timeout(remaining, tokio::net::TcpStream::connect(address))
            .await
            .is_ok_and(|result| result.is_ok())
        {
            return Some(started.elapsed().as_millis() as i64);
        }
    }

    None
}

/// An unauthenticated `get_me` call normally returns an authorization RPC
/// error. Any RPC response proves Telegram was reached; transport and local
/// session failures do not.
fn proxy_test_response_reachable<T>(result: Result<T, grammers_client::InvocationError>) -> bool {
    match result {
        Ok(_) => true,
        Err(grammers_client::InvocationError::Rpc(_)) => true,
        Err(_) => false,
    }
}

#[derive(Debug, Clone, serde::Deserialize, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidTransferEnvironment {
    pub connected: bool,
    #[serde(default)]
    pub wifi: bool,
    pub metered: bool,
    pub roaming: bool,
    pub charging: bool,
    pub battery_low: bool,
    pub storage_low: bool,
    pub free_bytes: u64,
    pub power_save_mode: bool,
    pub background_restricted: bool,
    pub is_television: bool,
}

#[tauri::command]
pub fn cmd_get_android_transfer_environment() -> Result<AndroidTransferEnvironment, String> {
    #[cfg(target_os = "android")]
    {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
            .map_err(|error| format!("Unable to access Android transfer conditions: {error}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|error| format!("Unable to attach Android transfer conditions: {error}"))?;
        let main_class = crate::jni_cache::get_main_activity_jclass()
            .ok_or("Android transfer conditions are still initializing")?;
        let value = env
            .call_static_method(
                &main_class,
                "getTransferEnvironmentJson",
                "()Ljava/lang/String;",
                &[],
            )
            .map_err(|error| format!("Unable to read Android transfer conditions: {error}"))?
            .l()
            .map_err(|error| {
                format!("Android transfer conditions returned an invalid value: {error}")
            })?;
        let value = jni::objects::JString::from(value);
        let json: String = env
            .get_string(&value)
            .map_err(|error| format!("Unable to decode Android transfer conditions: {error}"))?
            .into();
        return serde_json::from_str(&json)
            .map_err(|error| format!("Unable to parse Android transfer conditions: {error}"));
    }
    #[cfg(not(target_os = "android"))]
    Ok(AndroidTransferEnvironment {
        connected: true,
        wifi: false,
        metered: false,
        roaming: false,
        charging: true,
        battery_low: false,
        storage_low: false,
        free_bytes: u64::MAX,
        power_save_mode: false,
        background_restricted: false,
        is_television: false,
    })
}

#[tauri::command]
pub fn cmd_configure_android_transfer_recovery(
    wifi_only: bool,
    allow_roaming: bool,
    require_charging: bool,
    pause_on_low_battery: bool,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
            .map_err(|error| format!("Unable to access Android recovery settings: {error}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|error| format!("Unable to attach Android recovery settings: {error}"))?;
        let main_class = crate::jni_cache::get_main_activity_jclass()
            .ok_or("Android transfer recovery is still initializing")?;
        env.call_static_method(
            &main_class,
            "configureTransferRecovery",
            "(ZZZZ)V",
            &[
                jni::objects::JValue::Bool(if wifi_only { 1 } else { 0 }),
                jni::objects::JValue::Bool(if allow_roaming { 1 } else { 0 }),
                jni::objects::JValue::Bool(if require_charging { 1 } else { 0 }),
                jni::objects::JValue::Bool(if pause_on_low_battery { 1 } else { 0 }),
            ],
        )
        .map_err(|error| format!("Unable to configure Android transfer recovery: {error}"))?;
    }
    #[cfg(not(target_os = "android"))]
    let _ = (
        wifi_only,
        allow_roaming,
        require_charging,
        pause_on_low_battery,
    );
    Ok(())
}

#[tauri::command]
pub fn cmd_get_android_network_status() -> Result<bool, String> {
    #[cfg(target_os = "android")]
    {
        let context = ndk_context::android_context();
        let vm = unsafe { jni::JavaVM::from_raw(context.vm().cast()) }
            .map_err(|error| format!("Unable to access Android connectivity: {error}"))?;
        let mut env = vm
            .attach_current_thread()
            .map_err(|error| format!("Unable to attach Android connectivity check: {error}"))?;
        let main_class = crate::jni_cache::get_main_activity_jclass()
            .ok_or("Android connectivity is still initializing")?;
        env.call_static_method(&main_class, "isNetworkAvailable", "()Z", &[])
            .map_err(|error| format!("Unable to read Android connectivity: {error}"))?
            .z()
            .map_err(|error| format!("Android connectivity returned an invalid value: {error}"))
    }
    #[cfg(not(target_os = "android"))]
    {
        Ok(true)
    }
}

/// Result of a bounded TCP reachability check to the configured proxy.
#[derive(Debug, serde::Serialize)]
pub struct ProxyStatus {
    pub reachable: bool,
    pub latency_ms: i64,
}

#[tauri::command]
pub async fn cmd_get_proxy_status(
    net_config: State<'_, std::sync::Arc<NetworkConfig>>,
) -> Result<ProxyStatus, String> {
    let (enabled, host, port) = {
        let proxy = net_config.proxy.read().map_err(|e| e.to_string())?;
        (proxy.enabled, proxy.host.clone(), proxy.port)
    };
    if !enabled || host.is_empty() {
        return Ok(ProxyStatus {
            reachable: false,
            latency_ms: -1,
        });
    }

    let latency = proxy_connection_latency(&host, port, Duration::from_secs(3)).await;
    Ok(match latency {
        Some(latency_ms) => ProxyStatus {
            reachable: true,
            latency_ms,
        },
        None => ProxyStatus {
            reachable: false,
            latency_ms: -1,
        },
    })
}

/// Probe Telegram reachability through the configured proxy using an isolated,
/// unauthenticated session. Any Telegram RPC response (including an
/// authorization-required response) proves reachability; transport failures do not.
#[tauri::command]
pub async fn cmd_test_proxy_traffic(
    net_config: State<'_, std::sync::Arc<NetworkConfig>>,
) -> Result<bool, String> {
    let proxy_url = match net_config.effective_proxy_url() {
        Some(url) => url,
        None => return Ok(false),
    };

    // Copy the non-secret values while the lock is held, then end the guard's
    // lexical scope before this async command can reach an await. An explicit
    // drop is not sufficient for Send analysis on every 32-bit target.
    let (proxy_type, proxy_host, proxy_port) = {
        let proxy = net_config.proxy.read().map_err(|error| error.to_string())?;
        (proxy.proxy_type.clone(), proxy.host.clone(), proxy.port)
    };
    log::info!(
        "Testing proxy traffic through configured {} proxy at {}:{} (credentials redacted)",
        proxy_type,
        proxy_host,
        proxy_port
    );

    // Use a unique throwaway session: never open, replace, or delete the user's
    // saved Telegram session or another probe's files.
    let session_path = std::env::temp_dir().join(format!(
        "shelf_drive_proxy_test_{}.session",
        uuid::Uuid::new_v4()
    ));
    let session_path_str = session_path.to_string_lossy().to_string();

    let result: Result<bool, String> = tokio::task::spawn_blocking(move || {
        let rt = tokio::runtime::Runtime::new().map_err(|e| e.to_string())?;
        rt.block_on(async {
            // Open a fresh SQLite session used only by this probe.
            let session = grammers_session::storages::SqliteSession::open(&session_path_str)
                .await
                .map_err(|e| format!("Failed to open test session: {}", e))?;
            let session = std::sync::Arc::new(session);

            // Build connection params with proxy
            let conn_params = grammers_mtsender::ConnectionParams {
                proxy_url: Some(proxy_url),
                ..Default::default()
            };

            let pool = grammers_mtsender::SenderPool::with_configuration(
                session.clone(),
                // The probe is intentionally unauthenticated; get_me either
                // succeeds or yields a server authorization error.
                12345,
                conn_params,
            );

            let grammers_mtsender::SenderPool {
                runner,
                updates: test_updates,
                handle: test_handle,
            } = pool;
            let client = grammers_client::Client::new(test_handle);

            // Spawn the runner briefly
            let runner_handle = tokio::spawn(async move {
                runner.run().await;
            });

            // Try get_me() with a timeout
            let result =
                tokio::time::timeout(std::time::Duration::from_secs(10), client.get_me()).await;

            // Abort runner regardless of outcome
            runner_handle.abort();
            drop(test_updates);

            // Clean up test session files
            let _ = std::fs::remove_file(&session_path_str);
            let _ = std::fs::remove_file(format!("{}-wal", session_path_str));
            let _ = std::fs::remove_file(format!("{}-shm", session_path_str));

            match result {
                Ok(response) => {
                    let reachable = proxy_test_response_reachable(response);
                    if !reachable {
                        log::warn!("Proxy traffic probe received no successful or authorization-required Telegram response");
                    }
                    Ok(reachable)
                }
                Err(_timeout) => {
                    log::warn!("Proxy traffic test timed out after 10s");
                    Ok(false)
                }
            }
        })
    })
    .await
    .map_err(|e| e.to_string())?;

    result
}

/// Telegram DC addresses for connectivity checks and fallback
const DC_ADDRESSES: &[&str] = &[
    "149.154.167.50:443", // DC2
    "149.154.175.53:443", // DC1
    "149.154.167.51:443", // DC3
    "149.154.167.91:443", // DC4
    "91.108.56.130:443",  // DC5
];

/// Network availability check that respects VPN optimizer settings.
///
/// - Uses the configured timeout multiplier when VPN mode is on
/// - When proxy is active, checks proxy reachability instead
/// - Tries multiple DCs when VPN fallback is enabled
#[tauri::command]
pub async fn cmd_is_network_available(
    net_config: State<'_, std::sync::Arc<NetworkConfig>>,
) -> Result<bool, String> {
    let timeout_secs = net_config.connect_timeout_secs();
    let (proxy_host, proxy_port) = {
        let proxy = net_config.proxy.read().map_err(|e| e.to_string())?;
        if proxy.enabled && !proxy.host.is_empty() {
            (Some(proxy.host.clone()), proxy.port)
        } else {
            (None, proxy.port)
        }
    };
    let dc_attempts = {
        let vpn = net_config.vpn.read().map_err(|e| e.to_string())?;
        if vpn.enabled {
            vpn.dc_fallback_attempts as usize
        } else {
            1
        }
    };

    let timeout = Duration::from_secs(timeout_secs);
    if let Some(host) = proxy_host {
        return Ok(proxy_connection_latency(&host, proxy_port, timeout)
            .await
            .is_some());
    }

    tokio::task::spawn_blocking(move || {
        // Try DCs (up to dc_attempts when VPN mode is on)
        let attempts = dc_attempts.min(DC_ADDRESSES.len());
        for dc in &DC_ADDRESSES[..attempts] {
            if let Ok(addr) = dc.parse() {
                if TcpStream::connect_timeout(&addr, timeout).is_ok() {
                    return Ok(true);
                }
            }
        }
        Ok(false)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Measure TCP connect latency to the best Telegram DC.
/// Returns latency in milliseconds, or -1 if unreachable.
#[tauri::command]
pub async fn cmd_check_latency(
    net_config: State<'_, std::sync::Arc<NetworkConfig>>,
) -> Result<i64, String> {
    let timeout_secs = net_config.connect_timeout_secs();
    let proxy_endpoint = {
        let proxy = net_config.proxy.read().map_err(|e| e.to_string())?;
        (proxy.enabled && !proxy.host.is_empty()).then(|| (proxy.host.clone(), proxy.port))
    };
    let timeout = Duration::from_secs(timeout_secs);
    if let Some((host, port)) = proxy_endpoint {
        return Ok(proxy_connection_latency(&host, port, timeout)
            .await
            .unwrap_or(-1));
    }

    tokio::task::spawn_blocking(move || {
        let addr = match DC_ADDRESSES[0].parse() {
            Ok(a) => a,
            Err(_) => return Ok(-1i64),
        };

        let start = std::time::Instant::now();
        match TcpStream::connect_timeout(&addr, timeout) {
            Ok(_) => {
                let ms = start.elapsed().as_millis() as i64;
                Ok(ms)
            }
            Err(_) => Ok(-1i64),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Detect VPN network interfaces on the system.
/// Returns true if common VPN interfaces (tun, utun, wg, ppp, tap) are found.
#[tauri::command]
pub async fn cmd_detect_vpn() -> Result<bool, String> {
    tokio::task::spawn_blocking(|| {
        #[cfg(target_os = "macos")]
        {
            // macOS: check for utun/tun/wg/ppp/tap/ipsec interfaces via ifconfig
            match std::process::Command::new("ifconfig").arg("-l").output() {
                Ok(output) => {
                    let ifaces = String::from_utf8_lossy(&output.stdout);
                    let vpn_prefixes = ["utun", "tun", "wg", "ppp", "tap", "ipsec"];
                    let found = ifaces
                        .split_whitespace()
                        .any(|iface| vpn_prefixes.iter().any(|prefix| iface.starts_with(prefix)));
                    Ok(found)
                }
                Err(_) => Ok(false),
            }
        }

        #[cfg(target_os = "linux")]
        {
            // Linux: inspect /sys/class/net to find interface names without executing shell commands
            if let Ok(entries) = std::fs::read_dir("/sys/class/net") {
                let vpn_prefixes = ["tun", "tap", "wg", "ppp", "utun", "ipsec"];
                let mut found = false;
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        if vpn_prefixes.iter().any(|prefix| name.starts_with(prefix)) {
                            found = true;
                            break;
                        }
                    }
                }
                Ok(found)
            } else {
                Ok(false)
            }
        }

        #[cfg(target_os = "windows")]
        {
            // Windows: run ipconfig and check output for common VPN adapter keywords
            match std::process::Command::new("ipconfig").output() {
                Ok(output) => {
                    let stdout = String::from_utf8_lossy(&output.stdout).to_lowercase();
                    let vpn_keywords = [
                        "tap-windows",
                        "tunnel",
                        "wireguard",
                        "openvpn",
                        "fortinet",
                        "cisco",
                        "tailscale",
                        "zerotier",
                        "ipsec",
                    ];
                    let found = vpn_keywords.iter().any(|kw| stdout.contains(kw));
                    Ok(found)
                }
                Err(_) => Ok(false),
            }
        }

        #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
        {
            // Fallback for other systems
            Ok(false)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use grammers_client::InvocationError;
    use grammers_mtsender::RpcError;

    #[test]
    fn authorization_required_response_proves_telegram_was_reached() {
        let response: Result<(), InvocationError> = Err(InvocationError::Rpc(RpcError {
            code: 401,
            name: "AUTH_KEY_UNREGISTERED".to_string(),
            value: None,
            caused_by: None,
        }));

        assert!(proxy_test_response_reachable(response));
    }

    #[test]
    fn transport_failure_is_not_reported_as_reachable() {
        let response: Result<(), InvocationError> = Err(InvocationError::Io(std::io::Error::new(
            std::io::ErrorKind::ConnectionRefused,
            "connection refused",
        )));

        assert!(!proxy_test_response_reachable(response));
    }

    #[tokio::test]
    async fn proxy_connection_resolves_and_tries_hostname_addresses() {
        let listener = tokio::net::TcpListener::bind(("127.0.0.1", 0))
            .await
            .expect("bind test listener");
        let port = listener.local_addr().expect("listener address").port();

        let latency = proxy_connection_latency("localhost", port, Duration::from_secs(2)).await;

        assert!(latency.is_some(), "localhost should resolve and connect");
        listener.accept().await.expect("accept resolved connection");
    }
}
