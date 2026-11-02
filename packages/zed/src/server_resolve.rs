use serde_json::{Map, Value};

pub const PACKAGE_NAME: &str = "@x18n/lsp";
pub const LOCAL_SERVER_REL: &str = "node_modules/@x18n/lsp/bin.mjs";
pub const LOCAL_PACKAGE_JSON_REL: &str = "node_modules/@x18n/lsp/package.json";
/// npm dist-tag used when `serverVersion` is not set.
pub const DEFAULT_SERVER_VERSION: &str = "latest";

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ServerSource {
    CustomBinary,
    LocalWorkspace,
    Npx,
    Bundled,
}

/// Resolution order: custom binary, workspace `@x18n/lsp`, npx, then the extension-managed install.
pub fn choose_server_source(
    has_custom_binary: bool,
    use_local: bool,
    has_local: bool,
    npx_available: bool,
) -> ServerSource {
    if has_custom_binary {
        ServerSource::CustomBinary
    } else if use_local && has_local {
        ServerSource::LocalWorkspace
    } else if npx_available {
        ServerSource::Npx
    } else {
        ServerSource::Bundled
    }
}

pub fn local_server_path_from_root(worktree_root: &str) -> String {
    join_path(worktree_root, LOCAL_SERVER_REL)
}

pub fn join_path(base: &str, rel: &str) -> String {
    let base = base.trim_end_matches(['/', '\\']);
    let rel = rel.trim_start_matches(['/', '\\']);
    format!("{base}/{rel}")
}

pub fn package_json_lists_x18n_lsp(package_json: &str) -> bool {
    let Ok(value) = serde_json::from_str::<Value>(package_json) else {
        return false;
    };
    lists_package(&value, "dependencies") || lists_package(&value, "devDependencies")
}

fn lists_package(value: &Value, field: &str) -> bool {
    value
        .get(field)
        .and_then(|deps| deps.get(PACKAGE_NAME))
        .map(|entry| !entry.is_null())
        .unwrap_or(false)
}

pub fn use_local_server(settings: &Value) -> bool {
    settings
        .get("useLocalServer")
        .and_then(Value::as_bool)
        .unwrap_or(true)
}

pub fn pinned_server_version(settings: &Value) -> &str {
    settings
        .get("serverVersion")
        .and_then(Value::as_str)
        .filter(|version| !version.is_empty())
        .unwrap_or(DEFAULT_SERVER_VERSION)
}

pub fn use_npx_fallback(settings: &Value) -> bool {
    settings
        .get("useNpx")
        .and_then(Value::as_bool)
        .unwrap_or(false)
}

/// Initialization options `@x18n/lsp` reads during `initialize`.
pub fn build_initialization_options(settings: &Value) -> Value {
    let mut map = Map::new();

    if let Some(locale) = settings.get("displayLocale").and_then(Value::as_str) {
        if !locale.is_empty() {
            map.insert("displayLocale".into(), Value::String(locale.to_string()));
        }
    }

    if let Some(max_len) = settings.get("annotationMaxLength").and_then(Value::as_u64) {
        map.insert("annotationMaxLength".into(), Value::Number(max_len.into()));
    }

    if let Some(code_lens) = settings.get("codeLens").and_then(Value::as_bool) {
        map.insert("codeLens".into(), Value::Bool(code_lens));
    }

    if let Some(show_flags) = settings.get("showFlags").and_then(Value::as_bool) {
        map.insert("showFlags".into(), Value::Bool(show_flags));
    }

    Value::Object(map)
}

pub fn with_worktree_root(options: Value, worktree_root: &str) -> Value {
    let Value::Object(mut map) = options else {
        let mut map = Map::new();
        map.insert(
            "worktreeRoot".into(),
            Value::String(worktree_root.to_string()),
        );
        return Value::Object(map);
    };
    map.insert(
        "worktreeRoot".into(),
        Value::String(worktree_root.to_string()),
    );
    Value::Object(map)
}

pub fn merge_initialization_options(from_settings: &Value, explicit: Option<Value>) -> Value {
    let mut base = build_initialization_options(from_settings);
    let Some(Value::Object(explicit_map)) = explicit else {
        return base;
    };
    let Value::Object(base_map) = &mut base else {
        return base;
    };
    for (key, value) in explicit_map {
        base_map.insert(key, value);
    }
    base
}

pub fn parse_version(version: &str) -> Vec<u64> {
    version
        .split(['.', '-'])
        .take(3)
        .map(|part| part.parse().unwrap_or(0))
        .collect()
}

pub fn is_version_outdated(installed: &str, latest: &str) -> bool {
    parse_version(installed) < parse_version(latest)
}

pub fn should_install_npm(server_exists: bool, installed: Option<&str>, latest: &str) -> bool {
    !server_exists
        || installed
            .map(|version| is_version_outdated(version, latest))
            .unwrap_or(true)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn join_path_normalizes_slashes() {
        assert_eq!(
            join_path("/repo/", "node_modules/@x18n/lsp/bin.mjs"),
            "/repo/node_modules/@x18n/lsp/bin.mjs"
        );
        assert_eq!(
            local_server_path_from_root("/repo\\"),
            "/repo/node_modules/@x18n/lsp/bin.mjs"
        );
    }

    #[test]
    fn detects_dependency_in_package_json() {
        assert!(package_json_lists_x18n_lsp(
            r#"{"devDependencies":{"@x18n/lsp":"0.1.3"}}"#
        ));
        assert!(package_json_lists_x18n_lsp(
            r#"{"dependencies":{"@x18n/lsp":"0.1.3"}}"#
        ));
        assert!(!package_json_lists_x18n_lsp(r#"{"dependencies":{}}"#));
        assert!(!package_json_lists_x18n_lsp("not json"));
    }

    #[test]
    fn settings_flags_and_pinned_version() {
        assert!(use_local_server(&Value::Null));
        assert!(!use_npx_fallback(&Value::Null));
        assert_eq!(pinned_server_version(&Value::Null), DEFAULT_SERVER_VERSION);
        assert_eq!(
            pinned_server_version(&serde_json::json!({"serverVersion": ""})),
            DEFAULT_SERVER_VERSION
        );
        assert_eq!(
            pinned_server_version(&serde_json::json!({"serverVersion": "0.1.1"})),
            "0.1.1"
        );
        assert!(!use_local_server(
            &serde_json::json!({"useLocalServer": false})
        ));
        assert!(use_npx_fallback(&serde_json::json!({"useNpx": true})));
    }

    #[test]
    fn choose_server_source_order() {
        assert_eq!(
            choose_server_source(true, true, true, true),
            ServerSource::CustomBinary
        );
        assert_eq!(
            choose_server_source(false, true, true, true),
            ServerSource::LocalWorkspace
        );
        assert_eq!(
            choose_server_source(false, true, false, true),
            ServerSource::Npx
        );
        assert_eq!(
            choose_server_source(false, false, true, true),
            ServerSource::Npx
        );
        assert_eq!(
            choose_server_source(false, true, false, false),
            ServerSource::Bundled
        );
        assert_eq!(
            choose_server_source(false, false, false, false),
            ServerSource::Bundled
        );
    }

    #[test]
    fn builds_initialization_options() {
        let settings = serde_json::json!({
            "displayLocale": "de",
            "annotationMaxLength": 32,
            "codeLens": true,
            "showFlags": false,
            "useLocalServer": false
        });
        assert_eq!(
            build_initialization_options(&settings),
            serde_json::json!({
                "displayLocale": "de",
                "annotationMaxLength": 32,
                "codeLens": true,
                "showFlags": false
            })
        );
        assert_eq!(
            build_initialization_options(&serde_json::json!({"displayLocale": ""})),
            serde_json::json!({})
        );
    }

    #[test]
    fn worktree_root_is_always_injected() {
        let merged = merge_initialization_options(
            &serde_json::json!({"displayLocale": "de", "worktreeRoot": "/wrong"}),
            Some(serde_json::json!({"showFlags": false, "worktreeRoot": "/also-wrong"})),
        );
        assert_eq!(
            with_worktree_root(merged, "/Users/dev/lig"),
            serde_json::json!({
                "displayLocale": "de",
                "showFlags": false,
                "worktreeRoot": "/Users/dev/lig"
            })
        );
        assert_eq!(
            with_worktree_root(Value::Null, "/project"),
            serde_json::json!({ "worktreeRoot": "/project" })
        );
    }

    #[test]
    fn merge_ignores_non_object_explicit_options() {
        let settings = serde_json::json!({"codeLens": true});
        assert_eq!(
            merge_initialization_options(&settings, Some(Value::Null)),
            serde_json::json!({ "codeLens": true })
        );
    }

    #[test]
    fn version_compare() {
        assert!(is_version_outdated("0.1.0", "0.1.1"));
        assert!(!is_version_outdated("0.2.0", "0.1.9"));
        assert!(!is_version_outdated("0.1.3", "0.1.3"));
    }

    #[test]
    fn should_install_when_missing_or_old() {
        assert!(should_install_npm(false, Some("0.1.0"), "0.1.3"));
        assert!(should_install_npm(true, None, "0.1.3"));
        assert!(!should_install_npm(true, Some("0.1.3"), "0.1.3"));
        assert!(!should_install_npm(true, Some("0.2.0"), "0.1.3"));
    }
}
