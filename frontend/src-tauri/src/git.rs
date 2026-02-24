use serde::{Deserialize, Serialize};
use std::path::Path;
use crate::command_utils::new_command;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitHubProjectInfo {
    pub github_url: String,
    pub git_root: String,
}

#[tauri::command]
pub async fn get_github_remote_url(folder_path: String) -> Result<Option<GitHubProjectInfo>, String> {
    let path = Path::new(&folder_path);

    // Find git repository by walking up the directory tree
    let git_repo_path = find_git_repo(path)?;

    let git_repo_path = match git_repo_path {
        Some(repo_path) => repo_path,
        None => return Ok(None), // No git repo found
    };

    // Convert git root path to string
    let git_root_str = git_repo_path
        .to_str()
        .ok_or_else(|| "Failed to convert git root path to string".to_string())?
        .to_string();

    // Get remote URLs from the git repo
    let output = new_command("git")
        .arg("remote")
        .arg("-v")
        .current_dir(&git_repo_path)
        .output()
        .map_err(|e| format!("Failed to execute git command: {}", e))?;

    if !output.status.success() {
        // Git command failed, but we still have a git repo
        return Ok(Some(GitHubProjectInfo {
            github_url: String::new(),
            git_root: git_root_str,
        }));
    }

    let remote_output = String::from_utf8_lossy(&output.stdout);

    // Look for GitHub URLs in the remotes
    for line in remote_output.lines() {
        if line.contains("github.com") {
            // Extract the URL from the line
            // Format is typically: "origin	https://github.com/user/repo.git (fetch)"
            let parts: Vec<&str> = line.split_whitespace().collect();
            if parts.len() >= 2 {
                let url = parts[1];
                // Clean up the URL (remove .git suffix if present)
                let clean_url = if url.ends_with(".git") {
                    &url[..url.len() - 4]
                } else {
                    url
                };
                return Ok(Some(GitHubProjectInfo {
                    github_url: clean_url.to_string(),
                    git_root: git_root_str,
                }));
            }
        }
    }

    // No GitHub remote found, but we still have a git repo
    Ok(Some(GitHubProjectInfo {
        github_url: String::new(), // Empty string indicates no GitHub remote
        git_root: git_root_str,
    }))
}

fn find_git_repo(start_path: &Path) -> Result<Option<std::path::PathBuf>, String> {
    let mut current_path = start_path;

    loop {
        let git_path = current_path.join(".git");
        if git_path.exists() {
            return Ok(Some(current_path.to_path_buf()));
        }

        // Move to parent directory
        match current_path.parent() {
            Some(parent) => current_path = parent,
            None => break, // Reached filesystem root
        }
    }

    Ok(None) // No .git directory found
}
