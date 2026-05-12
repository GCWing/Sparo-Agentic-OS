use crate::service::workspace_session::{
    workspace_session_identity, WorkspaceSessionIdentity, LOCAL_WORKSPACE_SCOPE_HOST,
};
use async_trait::async_trait;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use tokio_util::sync::CancellationToken;

/// Session-bound workspace information used during agent execution.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct WorkspaceBinding {
    pub workspace_id: Option<String>,
    pub root_path: PathBuf,
    pub session_identity: WorkspaceSessionIdentity,
}

impl WorkspaceBinding {
    pub fn new(workspace_id: Option<String>, root_path: PathBuf) -> Self {
        let logical_workspace_path = root_path.to_string_lossy().to_string();
        let session_identity = workspace_session_identity(&logical_workspace_path).unwrap_or(
            WorkspaceSessionIdentity {
                hostname: LOCAL_WORKSPACE_SCOPE_HOST.to_string(),
                logical_workspace_path,
            },
        );
        Self {
            workspace_id,
            root_path,
            session_identity,
        }
    }

    pub fn root_path(&self) -> &Path {
        &self.root_path
    }

    pub fn root_path_string(&self) -> String {
        self.root_path.to_string_lossy().to_string()
    }

    pub fn is_remote(&self) -> bool {
        false
    }

    pub fn connection_id(&self) -> Option<&str> {
        None
    }

    pub fn session_storage_path(&self) -> PathBuf {
        self.session_identity.session_storage_path()
    }
}

// ============================================================
// Workspace-level I/O abstractions — tools program against these
// traits instead of branching on storage layout.
// ============================================================

#[derive(Debug, Clone)]
pub struct WorkspaceDirEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub is_symlink: bool,
}

#[async_trait]
pub trait WorkspaceFileSystem: Send + Sync {
    async fn read_file(&self, path: &str) -> anyhow::Result<Vec<u8>>;
    async fn read_file_text(&self, path: &str) -> anyhow::Result<String>;
    async fn write_file(&self, path: &str, contents: &[u8]) -> anyhow::Result<()>;
    async fn exists(&self, path: &str) -> anyhow::Result<bool>;
    async fn is_file(&self, path: &str) -> anyhow::Result<bool>;
    async fn is_dir(&self, path: &str) -> anyhow::Result<bool>;
    async fn read_dir(&self, path: &str) -> anyhow::Result<Vec<WorkspaceDirEntry>>;
}

#[derive(Debug, Clone, Default)]
pub struct WorkspaceCommandOptions {
    pub timeout_ms: Option<u64>,
    pub cancellation_token: Option<CancellationToken>,
}

#[derive(Debug, Clone)]
pub struct WorkspaceCommandResult {
    pub stdout: String,
    pub stderr: String,
    pub exit_code: i32,
    pub interrupted: bool,
    pub timed_out: bool,
}

impl WorkspaceCommandResult {
    pub fn combined_output(&self) -> String {
        if self.stderr.is_empty() {
            self.stdout.clone()
        } else if self.stdout.is_empty() {
            self.stderr.clone()
        } else {
            format!("{}\n{}", self.stdout, self.stderr)
        }
    }
}

#[async_trait]
pub trait WorkspaceShell: Send + Sync {
    async fn exec_with_options(
        &self,
        command: &str,
        options: WorkspaceCommandOptions,
    ) -> anyhow::Result<WorkspaceCommandResult>;

    async fn exec(
        &self,
        command: &str,
        timeout_ms: Option<u64>,
    ) -> anyhow::Result<(String, String, i32)> {
        let result = self
            .exec_with_options(
                command,
                WorkspaceCommandOptions {
                    timeout_ms,
                    ..Default::default()
                },
            )
            .await?;

        if result.timed_out {
            anyhow::bail!(
                "Command timed out after {}ms",
                timeout_ms.unwrap_or_default()
            );
        }
        if result.interrupted {
            anyhow::bail!("Command was cancelled");
        }

        Ok((result.stdout, result.stderr, result.exit_code))
    }
}

pub struct WorkspaceServices {
    pub fs: Arc<dyn WorkspaceFileSystem>,
    pub shell: Arc<dyn WorkspaceShell>,
}

impl Clone for WorkspaceServices {
    fn clone(&self) -> Self {
        Self {
            fs: Arc::clone(&self.fs),
            shell: Arc::clone(&self.shell),
        }
    }
}

impl std::fmt::Debug for WorkspaceServices {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("WorkspaceServices")
            .field("fs", &"<dyn WorkspaceFileSystem>")
            .field("shell", &"<dyn WorkspaceShell>")
            .finish()
    }
}

pub struct LocalWorkspaceFs;

#[async_trait]
impl WorkspaceFileSystem for LocalWorkspaceFs {
    async fn read_file(&self, path: &str) -> anyhow::Result<Vec<u8>> {
        Ok(tokio::fs::read(path).await?)
    }

    async fn read_file_text(&self, path: &str) -> anyhow::Result<String> {
        Ok(tokio::fs::read_to_string(path).await?)
    }

    async fn write_file(&self, path: &str, contents: &[u8]) -> anyhow::Result<()> {
        if let Some(parent) = Path::new(path).parent() {
            tokio::fs::create_dir_all(parent).await?;
        }
        Ok(tokio::fs::write(path, contents).await?)
    }

    async fn exists(&self, path: &str) -> anyhow::Result<bool> {
        Ok(tokio::fs::try_exists(path).await.unwrap_or(false))
    }

    async fn is_file(&self, path: &str) -> anyhow::Result<bool> {
        match tokio::fs::metadata(path).await {
            Ok(m) => Ok(m.is_file()),
            Err(_) => Ok(false),
        }
    }

    async fn is_dir(&self, path: &str) -> anyhow::Result<bool> {
        match tokio::fs::metadata(path).await {
            Ok(m) => Ok(m.is_dir()),
            Err(_) => Ok(false),
        }
    }

    async fn read_dir(&self, path: &str) -> anyhow::Result<Vec<WorkspaceDirEntry>> {
        let mut out = Vec::new();
        let mut rd = tokio::fs::read_dir(path).await?;
        while let Ok(Some(entry)) = rd.next_entry().await {
            let p = entry.path();
            let meta = tokio::fs::symlink_metadata(&p).await?;
            if meta.file_type().is_symlink() {
                continue;
            }
            let name = entry.file_name().to_string_lossy().to_string();
            let path_str = p.to_string_lossy().to_string();
            let is_dir = meta.is_dir();
            out.push(WorkspaceDirEntry {
                name,
                path: path_str,
                is_dir,
                is_symlink: false,
            });
        }
        Ok(out)
    }
}

pub struct LocalWorkspaceShell {
    workspace_root: String,
}

impl LocalWorkspaceShell {
    pub fn new(workspace_root: String) -> Self {
        Self { workspace_root }
    }
}

#[async_trait]
impl WorkspaceShell for LocalWorkspaceShell {
    async fn exec_with_options(
        &self,
        command: &str,
        options: WorkspaceCommandOptions,
    ) -> anyhow::Result<WorkspaceCommandResult> {
        use std::process::Stdio;
        use tokio::io::AsyncReadExt;

        let mut cmd = tokio::process::Command::new("sh");
        cmd.arg("-c").arg(command);
        cmd.current_dir(&self.workspace_root);
        cmd.stdout(Stdio::piped());
        cmd.stderr(Stdio::piped());

        let mut child = cmd.spawn()?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| anyhow::anyhow!("Failed to capture command stdout"))?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| anyhow::anyhow!("Failed to capture command stderr"))?;

        let stdout_task = tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(stdout);
            let mut buffer = Vec::new();
            reader.read_to_end(&mut buffer).await?;
            Ok::<Vec<u8>, std::io::Error>(buffer)
        });
        let stderr_task = tokio::spawn(async move {
            let mut reader = tokio::io::BufReader::new(stderr);
            let mut buffer = Vec::new();
            reader.read_to_end(&mut buffer).await?;
            Ok::<Vec<u8>, std::io::Error>(buffer)
        });

        let mut interrupted = false;
        let mut timed_out = false;
        let mut exit_code = -1;
        let deadline = options
            .timeout_ms
            .map(|ms| tokio::time::Instant::now() + std::time::Duration::from_millis(ms));

        loop {
            if let Some(token) = options.cancellation_token.as_ref() {
                if token.is_cancelled() {
                    interrupted = true;
                    let _ = child.start_kill();
                    break;
                }
            }

            if let Some(deadline) = deadline {
                if tokio::time::Instant::now() >= deadline {
                    timed_out = true;
                    let _ = child.start_kill();
                    break;
                }
            }

            if let Some(status) = child.try_wait()? {
                exit_code = status.code().unwrap_or(-1);
                break;
            }

            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }

        if interrupted || timed_out {
            let _ = child.wait().await;
            if interrupted {
                #[cfg(windows)]
                {
                    exit_code = -1073741510;
                }
                #[cfg(not(windows))]
                {
                    exit_code = 130;
                }
            } else if timed_out {
                exit_code = 124;
            }
        }

        let stdout = String::from_utf8_lossy(
            &stdout_task
                .await
                .map_err(|e| anyhow::anyhow!("Failed to join stdout task: {}", e))??,
        )
        .to_string();
        let stderr = String::from_utf8_lossy(
            &stderr_task
                .await
                .map_err(|e| anyhow::anyhow!("Failed to join stderr task: {}", e))??,
        )
        .to_string();

        Ok(WorkspaceCommandResult {
            stdout,
            stderr,
            exit_code,
            interrupted,
            timed_out,
        })
    }
}

pub fn local_workspace_services(workspace_root: String) -> WorkspaceServices {
    WorkspaceServices {
        fs: Arc::new(LocalWorkspaceFs),
        shell: Arc::new(LocalWorkspaceShell::new(workspace_root)),
    }
}
