mod server_resolve;

use std::{env, fs};

use server_resolve::{
    build_initialization_options, choose_server_source, join_path, local_server_path_from_root,
    merge_initialization_options, package_json_lists_x18n_lsp, pinned_server_version,
    should_install_npm, use_local_server, use_npx_fallback, with_worktree_root, ServerSource,
    DEFAULT_SERVER_VERSION, LOCAL_PACKAGE_JSON_REL, LOCAL_SERVER_REL, PACKAGE_NAME,
};
use zed_extension_api::serde_json::Value;
use zed_extension_api::{self as zed, settings::LspSettings, Result};

struct X18nExtension {
    bundled_server_ready: bool,
}

impl X18nExtension {
    fn bundled_server_path(&self) -> String {
        join_path(
            &env::current_dir()
                .map(|path| path.to_string_lossy().into_owned())
                .unwrap_or_else(|_| ".".into()),
            LOCAL_SERVER_REL,
        )
    }

    fn bundled_server_exists(&self) -> bool {
        fs::metadata(self.bundled_server_path()).is_ok_and(|stat| stat.is_file())
    }

    fn worktree_lists_local_package(&self, worktree: &zed::Worktree) -> bool {
        let package_json = worktree.read_text_file("package.json").unwrap_or_default();
        package_json_lists_x18n_lsp(&package_json)
    }

    fn worktree_has_local_server(&self, worktree: &zed::Worktree) -> bool {
        worktree.read_text_file(LOCAL_PACKAGE_JSON_REL).is_ok()
            || self.worktree_lists_local_package(worktree)
    }

    fn ensure_bundled_server(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        version: &str,
    ) -> Result<()> {
        if self.bundled_server_ready && self.bundled_server_exists() {
            return Ok(());
        }

        zed::set_language_server_installation_status(
            language_server_id,
            &zed::LanguageServerInstallationStatus::CheckingForUpdate,
        );

        let installed = zed::npm_package_installed_version(PACKAGE_NAME)?;
        let target = if version == DEFAULT_SERVER_VERSION {
            // Offline: keep the installed server, or let npm resolve the tag.
            zed::npm_package_latest_version(PACKAGE_NAME)
                .ok()
                .or_else(|| installed.clone())
                .unwrap_or_else(|| version.to_string())
        } else {
            version.to_string()
        };
        let target = target.as_str();

        if should_install_npm(self.bundled_server_exists(), installed.as_deref(), target) {
            zed::set_language_server_installation_status(
                language_server_id,
                &zed::LanguageServerInstallationStatus::Downloading,
            );
            match zed::npm_install_package(PACKAGE_NAME, target) {
                Ok(()) => {
                    if !self.bundled_server_exists() {
                        return Err(format!(
                            "installed npm package '{PACKAGE_NAME}' is missing expected entry '{LOCAL_SERVER_REL}'"
                        ));
                    }
                }
                Err(error) => {
                    if !self.bundled_server_exists() {
                        return Err(error);
                    }
                }
            }
        }

        self.bundled_server_ready = true;
        Ok(())
    }

    fn prepare_bundled_bin(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        version: &str,
    ) -> Result<String> {
        self.ensure_bundled_server(language_server_id, version)?;
        Ok(self.bundled_server_path())
    }

    fn node_stdio_command(script: String) -> Result<zed::Command> {
        Ok(zed::Command {
            command: zed::node_binary_path()?,
            args: vec![script, "--stdio".into()],
            env: Default::default(),
        })
    }
}

impl zed::Extension for X18nExtension {
    fn new() -> Self {
        Self {
            bundled_server_ready: false,
        }
    }

    fn language_server_initialization_options(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<Value>> {
        let lsp_settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)?;
        let user_settings = lsp_settings.settings.unwrap_or(Value::Null);
        let options =
            merge_initialization_options(&user_settings, lsp_settings.initialization_options);
        Ok(Some(with_worktree_root(
            options,
            worktree.root_path().as_str(),
        )))
    }

    fn language_server_workspace_configuration(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<Option<Value>> {
        let lsp_settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)?;
        let user_settings = lsp_settings.settings.unwrap_or(Value::Null);
        Ok(Some(build_initialization_options(&user_settings)))
    }

    fn language_server_command(
        &mut self,
        language_server_id: &zed::LanguageServerId,
        worktree: &zed::Worktree,
    ) -> Result<zed::Command> {
        let lsp_settings = LspSettings::for_worktree(language_server_id.as_ref(), worktree)?;
        let user_settings = lsp_settings.settings.clone().unwrap_or(Value::Null);
        let version = pinned_server_version(&user_settings);
        let npx_path = if use_npx_fallback(&user_settings) {
            worktree.which("npx")
        } else {
            None
        };

        match choose_server_source(
            lsp_settings.binary.is_some(),
            use_local_server(&user_settings),
            self.worktree_has_local_server(worktree),
            npx_path.is_some(),
        ) {
            ServerSource::CustomBinary => {
                let binary = lsp_settings.binary.ok_or("missing lsp.x18n.binary")?;
                Ok(zed::Command {
                    command: binary.path.unwrap_or_else(|| {
                        zed::node_binary_path().unwrap_or_else(|_| "node".into())
                    }),
                    args: binary.arguments.unwrap_or_default(),
                    env: Default::default(),
                })
            }
            ServerSource::LocalWorkspace => {
                let script = local_server_path_from_root(worktree.root_path().as_str());
                Self::node_stdio_command(script)
            }
            ServerSource::Npx => {
                let npx = npx_path.ok_or("npx not found on PATH")?;
                let npx_bin = format!("{PACKAGE_NAME}@{version}");
                Ok(zed::Command {
                    command: npx,
                    args: vec!["-y".into(), npx_bin, "--stdio".into()],
                    env: Default::default(),
                })
            }
            ServerSource::Bundled => {
                let bundled = self.prepare_bundled_bin(language_server_id, version)?;
                Self::node_stdio_command(bundled)
            }
        }
    }
}

zed::register_extension!(X18nExtension);
