use anyhow::Result;
use std::process::Command;
use crate::os::OsSession;

pub struct CommandExecutor;

impl CommandExecutor {
    pub fn execute_with_os_session(
        command: &str,
        args: &[&str],
        directory: Option<&str>,
        os_session: &OsSession,
    ) -> Result<String, String> {
        match os_session {
            OsSession::Local(_) => {
                Self::execute_local(command, args, directory)
            }
            OsSession::Wsl(wsl_session) => {
                Self::execute_wsl(command, args, directory, &wsl_session.distribution)
            }
        }
    }

    fn execute_local(
        command: &str,
        args: &[&str],
        directory: Option<&str>,
    ) -> Result<String, String> {
        let mut cmd = Command::new(command);
        cmd.args(args);
        
        if let Some(dir) = directory {
            cmd.current_dir(dir);
        }

        #[cfg(target_os = "windows")]
        let output = {
            use std::os::windows::process::CommandExt;
            cmd.creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .map_err(|e| format!("Failed to execute command: {}", e))?
        };
        
        #[cfg(not(target_os = "windows"))]
        let output = cmd
            .output()
            .map_err(|e| format!("Failed to execute command: {}", e))?;

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    #[cfg(target_os = "windows")]
    fn execute_wsl(
        command: &str,
        args: &[&str],
        directory: Option<&str>,
        distribution: &str,
    ) -> Result<String, String> {
        let mut wsl_args = vec!["-d", distribution];
        
        if let Some(dir) = directory {
            wsl_args.extend_from_slice(&["--cd", dir]);
        }
        
        wsl_args.push(command);
        wsl_args.extend_from_slice(args);

        let output = {
            use std::os::windows::process::CommandExt;
            Command::new("wsl")
                .args(&wsl_args)
                .creation_flags(0x08000000) // CREATE_NO_WINDOW
                .output()
                .map_err(|e| format!("Failed to execute WSL command: {}", e))?
        };

        if output.status.success() {
            Ok(String::from_utf8_lossy(&output.stdout).to_string())
        } else {
            Err(String::from_utf8_lossy(&output.stderr).to_string())
        }
    }

    #[cfg(not(target_os = "windows"))]
    fn execute_wsl(
        _command: &str,
        _args: &[&str],
        _directory: Option<&str>,
        _distribution: &str,
    ) -> Result<String, String> {
        Err("WSL is only supported on Windows".to_string())
    }
}