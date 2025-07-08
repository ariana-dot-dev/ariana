use crate::commands::CommandExecutor;
use crate::os::OsSession;
use std::path::Path;
use std::process::Command;

/// Git repository management functions
pub struct GitManager;

impl GitManager {
    pub fn init_repository(directory: &str, os_session: &OsSession) -> Result<(), String> {
        CommandExecutor::execute_with_os_session("git", &["init"], Some(directory), os_session)
            .map(|_| ())
    }

    pub fn check_repository(directory: &str, os_session: &OsSession) -> Result<bool, String> {
        // Use git command to check if it's a repository through the appropriate OS session
        let result = CommandExecutor::execute_with_os_session(
            "git", 
            &["rev-parse", "--git-dir"], 
            Some(directory), 
            os_session
        );
            
        match result {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }

    pub fn commit(directory: &str, message: &str, os_session: &OsSession) -> Result<String, String> {
        // First, add all changes
        CommandExecutor::execute_with_os_session("git", &["add", "."], Some(directory), os_session)?;
        
        // Then commit
        let commit_result = CommandExecutor::execute_with_os_session(
            "git", 
            &["commit", "-m", message], 
            Some(directory), 
            os_session
        );
        
        match commit_result {
            Ok(_) => {
                // Get the commit hash
                CommandExecutor::execute_with_os_session(
                    "git", 
                    &["rev-parse", "HEAD"], 
                    Some(directory), 
                    os_session
                ).map(|hash| hash.trim().to_string())
            }
            Err(stderr) => {
                // Check for "nothing to commit" scenarios
                if stderr.contains("nothing to commit") {
                    Err("NO_CHANGES_TO_COMMIT".to_string())
                } else {
                    Err(format!("Git commit failed: {}", stderr))
                }
            }
        }
    }

    pub fn revert_to_commit(directory: &str, commit_hash: &str, os_session: &OsSession) -> Result<(), String> {
        CommandExecutor::execute_with_os_session(
            "git", 
            &["reset", "--hard", commit_hash], 
            Some(directory), 
            os_session
        ).map(|_| ())
    }

    pub fn create_branch(directory: &str, branch_name: &str, os_session: &OsSession) -> Result<(), String> {
        CommandExecutor::execute_with_os_session(
            "git", 
            &["checkout", "-B", branch_name], 
            Some(directory), 
            os_session
        ).map(|_| ())
    }

    pub fn get_current_branch(directory: &str, os_session: &OsSession) -> Result<String, String> {
        // Try modern git command first
        let result = CommandExecutor::execute_with_os_session(
            "git", 
            &["branch", "--show-current"], 
            Some(directory), 
            os_session
        );

        match result {
            Ok(branch) => Ok(branch.trim().to_string()),
            Err(_) => {
                // Fall back to older method
                CommandExecutor::execute_with_os_session(
                    "git", 
                    &["rev-parse", "--abbrev-ref", "HEAD"], 
                    Some(directory), 
                    os_session
                ).map(|branch| branch.trim().to_string())
            }
        }
    }

    pub fn check_merge_conflicts(
        directory: &str, 
        source_branch: &str, 
        target_branch: &str, 
        os_session: &OsSession
    ) -> Result<bool, String> {
        // Get merge base
        let merge_base = CommandExecutor::execute_with_os_session(
            "git", 
            &["merge-base", target_branch, source_branch], 
            Some(directory), 
            os_session
        )?.trim().to_string();

        // Check for conflicts using merge-tree
        let merge_result = CommandExecutor::execute_with_os_session(
            "git", 
            &["merge-tree", &merge_base, target_branch, source_branch], 
            Some(directory), 
            os_session
        )?;

        // If merge-tree output contains conflict markers, there are conflicts
        let has_conflicts = merge_result.contains("<<<<<<<") || merge_result.contains(">>>>>>>");
        Ok(has_conflicts)
    }

    pub fn get_conflict_files(directory: &str, os_session: &OsSession) -> Result<Vec<String>, String> {
        let output = CommandExecutor::execute_with_os_session(
            "git", 
            &["diff", "--name-only", "--diff-filter=U"], 
            Some(directory), 
            os_session
        )?;

        let files = output
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(|line| line.trim().to_string())
            .collect();

        Ok(files)
    }

    pub fn merge_branch(
        directory: &str, 
        source_branch: &str, 
        target_branch: &str, 
        os_session: &OsSession
    ) -> Result<String, String> {
        // First checkout target branch
        CommandExecutor::execute_with_os_session(
            "git", 
            &["checkout", target_branch], 
            Some(directory), 
            os_session
        )?;

        // Then merge source branch
        let merge_result = CommandExecutor::execute_with_os_session(
            "git", 
            &["merge", source_branch], 
            Some(directory), 
            os_session
        );

        match merge_result {
            Ok(_) => Ok("MERGE_SUCCESS".to_string()),
            Err(stderr) => {
                // Check if it's a conflict (which is expected sometimes)
                if stderr.contains("CONFLICT") {
                    Ok("MERGE_CONFLICTS".to_string())
                } else {
                    Err(format!("Git merge failed: {}", stderr))
                }
            }
        }
    }

    pub fn get_current_hash(directory: &str, os_session: &OsSession) -> Result<String, String> {
        CommandExecutor::execute_with_os_session(
            "git", 
            &["rev-parse", "HEAD"], 
            Some(directory), 
            os_session
        ).map(|output| output.trim().to_string())
    }
}