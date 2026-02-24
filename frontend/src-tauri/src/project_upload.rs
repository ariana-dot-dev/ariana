use std::fs;
use std::io::Write;
use std::path::Path;

use ignore::WalkBuilder;

use crate::git::get_github_remote_url;
use crate::command_utils::new_command;

/// Normalize line endings to LF (required for git patches)
/// Converts CRLF (\r\n) to LF (\n) for cross-platform compatibility
fn normalize_line_endings(data: &[u8]) -> Vec<u8> {
    let mut result = Vec::with_capacity(data.len());
    let mut i = 0;

    while i < data.len() {
        if i + 1 < data.len() && data[i] == b'\r' && data[i + 1] == b'\n' {
            // Skip the \r, keep only the \n
            result.push(b'\n');
            i += 2;
        } else {
            result.push(data[i]);
            i += 1;
        }
    }

    result
}

#[tauri::command]
pub async fn create_zip_from_directory(source_path: String) -> Result<String, String> {
    let source_dir = Path::new(&source_path);
    if !source_dir.exists() || !source_dir.is_dir() {
        return Err(format!("Source directory does not exist: {}", source_path));
    }

    println!("[ZIP] Starting zip creation for: {}", source_path);

    // Collect files to include using the ignore crate (respects .gitignore)
    let mut files_to_include: Vec<std::path::PathBuf> = Vec::new();
    let walker = WalkBuilder::new(source_dir)
        .hidden(false)           // Include hidden files
        .git_ignore(true)        // Respect .gitignore
        .git_global(true)        // Respect global gitignore
        .git_exclude(true)       // Respect .git/info/exclude
        .build();

    for entry in walker {
        match entry {
            Ok(entry) => {
                let path = entry.path();
                // Only include files, not directories
                if path.is_file() {
                    files_to_include.push(path.to_path_buf());
                }
            }
            Err(e) => {
                eprintln!("[ZIP] Warning: Failed to walk entry: {}", e);
            }
        }
    }
    println!("[ZIP] Found {} files to include", files_to_include.len());

    // Calculate total size
    let total_size: u64 = files_to_include.iter()
        .filter_map(|f| fs::metadata(f).ok())
        .map(|m| m.len())
        .sum();
    let total_size_mb = total_size as f64 / (1024.0 * 1024.0);
    println!("[ZIP] Total size: {:.2} MB ({} bytes)", total_size_mb, total_size);

    log_files_summary(&files_to_include, source_dir);

    if files_to_include.is_empty() {
        return Err("No files found to include in zip".to_string());
    }

    println!("[ZIP] Creating zip archive...");

    #[cfg(target_os = "windows")]
    let zip_buffer = create_zip_windows(source_dir, &files_to_include)?;

    #[cfg(any(target_os = "macos", target_os = "linux"))]
    let zip_buffer = create_zip_unix(source_dir, &files_to_include)?;

    let temp_dir = std::env::temp_dir();
    let zip_filename = format!("ariana_project_{}.zip", uuid::Uuid::new_v4());
    let zip_path = temp_dir.join(&zip_filename);

    fs::write(&zip_path, &zip_buffer)
        .map_err(|e| format!("Failed to write zip to disk: {}", e))?;

    println!("[ZIP] Zip written to: {}", zip_path.display());
    println!("[ZIP] Size: {} bytes", zip_buffer.len());

    Ok(zip_path.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn read_file_bytes(file_path: String) -> Result<Vec<u8>, String> {
    println!("[FILE-READ] Starting to read file: {}", file_path);
    let metadata = fs::metadata(&file_path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    let file_size = metadata.len();
    println!("[FILE-READ] File size: {} bytes ({:.2} MB)", file_size, file_size as f64 / 1024.0 / 1024.0);

    let bytes = fs::read(&file_path)
        .map_err(|e| format!("Failed to read file: {}", e))?;

    println!("[FILE-READ] Successfully read {} bytes into memory", bytes.len());
    println!("[FILE-READ] Returning bytes to JavaScript (this may take a while for large files)");
    Ok(bytes)
}

#[tauri::command]
pub async fn delete_temp_file(file_path: String) -> Result<(), String> {
    fs::remove_file(&file_path)
        .map_err(|e| format!("Failed to delete temp file: {}", e))
}

#[tauri::command]
pub async fn get_file_info(file_path: String) -> Result<(u64, usize), String> {
    let metadata = fs::metadata(&file_path)
        .map_err(|e| format!("Failed to get file metadata: {}", e))?;
    let file_size = metadata.len();

    // Calculate base64 size: 4 bytes output per 3 bytes input, rounded up
    let base64_size = ((file_size + 2) / 3) * 4;

    println!("[FILE-INFO] File: {}, size: {} bytes, base64 size: {} bytes", file_path, file_size, base64_size);

    Ok((file_size, base64_size as usize))
}

#[tauri::command]
pub async fn read_file_chunk_base64(file_path: String, offset: u64, chunk_size: usize) -> Result<String, String> {
    use std::io::{Read, Seek, SeekFrom};
    use base64::{Engine as _, engine::general_purpose};

    let mut file = fs::File::open(&file_path)
        .map_err(|e| format!("Failed to open file: {}", e))?;

    file.seek(SeekFrom::Start(offset))
        .map_err(|e| format!("Failed to seek in file: {}", e))?;

    let mut buffer = vec![0u8; chunk_size];
    let bytes_read = file.read(&mut buffer)
        .map_err(|e| format!("Failed to read file chunk: {}", e))?;

    buffer.truncate(bytes_read);

    let base64_chunk = general_purpose::STANDARD.encode(&buffer);

    println!("[FILE-CHUNK] Read {} bytes from offset {}, base64 size: {}", bytes_read, offset, base64_chunk.len());

    Ok(base64_chunk)
}

fn log_files_summary(files: &[std::path::PathBuf], source_dir: &Path) {
    if files.is_empty() {
        return;
    }

    println!("[ZIP] First files to include:");
    for (i, file) in files.iter().take(7000).enumerate() {
        let relative = file.strip_prefix(source_dir).unwrap_or(file.as_path());
        println!("[ZIP]   {}. {}", i + 1, relative.display());
    }

    if files.len() > 25 {
        println!("[ZIP]   ... {} more files ...", files.len() - 25);
        println!("[ZIP] Last 5 files:");
        for file in files.iter().skip(files.len() - 5) {
            let relative = file.strip_prefix(source_dir).unwrap_or(file.as_path());
            println!("[ZIP]   - {}", relative.display());
        }
    } else if files.len() > 20 {
        for (i, file) in files.iter().skip(20).enumerate() {
            let relative = file.strip_prefix(source_dir).unwrap_or(file.as_path());
            println!("[ZIP]   {}. {}", 21 + i, relative.display());
        }
    }
}

#[cfg(target_os = "windows")]
fn create_zip_windows(source_dir: &Path, files_to_include: &[std::path::PathBuf]) -> Result<Vec<u8>, String> {
    use zip::{ZipWriter, write::FileOptions};
    use std::io::{BufReader, copy};
    use std::fs::File;

    let mut zip_buffer = Vec::new();
    {
        use std::io::Cursor;

        let writer = Cursor::new(&mut zip_buffer);
        let mut zip = ZipWriter::new(writer);
        let options = FileOptions::default()
            .compression_method(zip::CompressionMethod::Stored); // Use Stored for speed, or Deflated for compression

        let total_files = files_to_include.len();
        for (i, file_path) in files_to_include.iter().enumerate() {
            if i % 100 == 0 {
                println!("[ZIP] Progress: {}/{} files ({:.1}%)", 
                    i, total_files, (i as f32 / total_files as f32) * 100.0);
            }

            let relative_path = file_path.strip_prefix(source_dir)
                .map_err(|e| format!("Failed to calculate relative path: {}", e))?;

            let zip_path = relative_path.to_string_lossy().replace("\\", "/");

            // Get file metadata for better zip entry creation
            let metadata = fs::metadata(file_path)
                .map_err(|e| format!("Failed to get metadata for {}: {}", file_path.display(), e))?;

            // Start the zip entry
            zip.start_file(&zip_path, options)
                .map_err(|e| format!("Failed to start zip file entry: {}", e))?;

            // Stream the file directly to zip instead of reading it all into memory
            if metadata.len() > 0 {
                let file = File::open(file_path)
                    .map_err(|e| format!("Failed to open file {}: {}", file_path.display(), e))?;
                let mut reader = BufReader::new(file);
                
                copy(&mut reader, &mut zip)
                    .map_err(|e| format!("Failed to stream file to zip: {}", e))?;
            }
            // Empty files are handled by just creating the entry
        }

        println!("[ZIP] Finalizing archive...");
        zip.finish().map_err(|e| format!("Failed to finalize zip: {}", e))?;
    }

    println!("[ZIP] Zip creation completed successfully. Size: {} bytes", zip_buffer.len());
    Ok(zip_buffer)
}

#[cfg(any(target_os = "macos", target_os = "linux"))]
fn create_zip_unix(source_dir: &Path, files_to_include: &[std::path::PathBuf]) -> Result<Vec<u8>, String> {
    use std::process::Stdio;
    use std::io::BufWriter;

    // Create temporary zip file
    let temp_zip = format!("/tmp/project_{}.zip", uuid::Uuid::new_v4());

    // Create the zip command
    let mut child = new_command("zip")
        .arg("-q")  // quiet
        .arg("-0")  // store files, don't compress
        .arg("-@")  // read file names from stdin
        .arg(&temp_zip)
        .current_dir(source_dir)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to start zip command: {}", e))?;

    // Write file paths to stdin
    {
        let stdin = child.stdin.take()
            .ok_or_else(|| "Failed to get stdin handle".to_string())?;
        let mut writer = BufWriter::new(stdin);

        for file_path in files_to_include {
            let relative_path = file_path.strip_prefix(source_dir)
                .map_err(|e| format!("Failed to calculate relative path: {}", e))?;

            writeln!(writer, "{}", relative_path.to_string_lossy())
                .map_err(|e| format!("Failed to write to zip stdin: {}", e))?;
        }

        writer.flush()
            .map_err(|e| format!("Failed to flush zip stdin: {}", e))?;
    }

    // Wait for the command to complete
    let output = child.wait_with_output()
        .map_err(|e| format!("Failed to wait for zip command: {}", e))?;

    if !output.status.success() {
        return Err(format!("Zip creation failed: {}",
            String::from_utf8_lossy(&output.stderr)));
    }

    // Read the created zip file
    let zip_data = fs::read(&temp_zip)
        .map_err(|e| format!("Failed to read created zip: {}", e))?;

    // Clean up temp zip file
    let _ = fs::remove_file(&temp_zip);

    println!("[ZIP] Zip creation completed successfully. Size: {} bytes", zip_data.len());
    Ok(zip_data)
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BundleMetadata {
    pub bundle_path: String,
    pub patch_path: String,
    pub is_incremental: bool,
    pub base_commit_sha: Option<String>,
    pub remote_url: Option<String>,
}

/// Find the merge-base (common ancestor) between HEAD and the remote branch
fn find_remote_merge_base(source_dir: &Path) -> Option<String> {
    // First, fetch from origin to update remote tracking branches
    // This is non-invasive - it only updates local knowledge of remote state
    println!("[GIT] Fetching from origin to find merge-base...");
    let fetch_output = new_command("git")
        .args(&["fetch", "origin", "--quiet"])
        .current_dir(source_dir)
        .output()
        .ok()?;

    if !fetch_output.status.success() {
        println!("[GIT] Warning: git fetch origin failed: {}",
            String::from_utf8_lossy(&fetch_output.stderr));
        // Continue anyway - maybe remote branches already exist
    }

    // Get current branch
    let branch_output = new_command("git")
        .args(&["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(source_dir)
        .output()
        .ok()?;

    if !branch_output.status.success() {
        return None;
    }

    let branch = String::from_utf8_lossy(&branch_output.stdout).trim().to_string();

    // Try origin/<branch> first
    let remote_branch = format!("origin/{}", branch);
    let merge_base_output = new_command("git")
        .args(&["merge-base", "HEAD", &remote_branch])
        .current_dir(source_dir)
        .output()
        .ok()?;

    if merge_base_output.status.success() {
        let sha = String::from_utf8_lossy(&merge_base_output.stdout).trim().to_string();
        if !sha.is_empty() {
            println!("[GIT] Found merge-base with {}: {}", remote_branch, sha);
            return Some(sha);
        }
    }

    // Fallback: try origin/main
    let merge_base_output = new_command("git")
        .args(&["merge-base", "HEAD", "origin/main"])
        .current_dir(source_dir)
        .output()
        .ok()?;

    if merge_base_output.status.success() {
        let sha = String::from_utf8_lossy(&merge_base_output.stdout).trim().to_string();
        if !sha.is_empty() {
            println!("[GIT] Found merge-base with origin/main: {}", sha);
            return Some(sha);
        }
    }

    // Fallback: try origin/master
    let merge_base_output = new_command("git")
        .args(&["merge-base", "HEAD", "origin/master"])
        .current_dir(source_dir)
        .output()
        .ok()?;

    if merge_base_output.status.success() {
        let sha = String::from_utf8_lossy(&merge_base_output.stdout).trim().to_string();
        if !sha.is_empty() {
            println!("[GIT] Found merge-base with origin/master: {}", sha);
            return Some(sha);
        }
    }

    None
}

/// Find the last commit that exists on the remote (gitHistoryLastPushedCommitSha)
/// Checks the last 200 commits to find the first one that exists on a remote branch
fn find_last_pushed_commit(source_dir: &Path) -> Option<String> {
    println!("[GIT] Finding last pushed commit...");

    // Get last 200 commits
    let log_output = new_command("git")
        .args(&["log", "--format=%H", "-n", "200"])
        .current_dir(source_dir)
        .output()
        .ok()?;

    if !log_output.status.success() {
        return None;
    }

    let commits = String::from_utf8_lossy(&log_output.stdout);

    // Check each commit to see if it exists on a remote branch
    for sha in commits.lines() {
        if sha.is_empty() {
            continue;
        }

        // Check if this commit is in any remote branch
        let branch_output = new_command("git")
            .args(&["branch", "-r", "--contains", sha])
            .current_dir(source_dir)
            .output()
            .ok()?;

        if branch_output.status.success() {
            let remote_branches = String::from_utf8_lossy(&branch_output.stdout);
            if !remote_branches.trim().is_empty() {
                println!("[GIT] Found last pushed commit: {}", sha);
                return Some(sha.to_string());
            }
        }
    }

    println!("[GIT] No pushed commits found in last 200 commits");
    None
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommitPatch {
    pub sha: String,
    pub title: String,
    pub timestamp: i64,
    pub patch: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PatchBasedUploadData {
    pub git_history_last_pushed_commit_sha: Option<String>,
    pub commits: Vec<CommitPatch>,
    pub uncommitted_patch: String,
    pub remote_url: Option<String>,
}

/// Create patch-based upload data (replacement for incremental bundle)
/// Extracts plain diffs for each unpushed commit using git diff (not git format-patch)
#[tauri::command]
pub async fn create_patch_based_upload_data(
    source_path: String
) -> Result<PatchBasedUploadData, String> {
    let source_dir = Path::new(&source_path);
    if !source_dir.exists() || !source_dir.is_dir() {
        return Err(format!("Source directory does not exist: {}", source_path));
    }

    println!("[GIT] Creating patch-based upload data for: {}", source_path);

    // Check if repository has any commits
    let log_output = new_command("git")
        .args(&["rev-list", "--all", "--count"])
        .current_dir(source_dir)
        .output()
        .map_err(|e| format!("Failed to check git history: {}", e))?;

    let commit_count = if log_output.status.success() {
        String::from_utf8_lossy(&log_output.stdout)
            .trim()
            .parse::<u32>()
            .unwrap_or(0)
    } else {
        0
    };

    println!("[GIT] Repository has {} commits", commit_count);

    if commit_count == 0 {
        return Err("Repository has no commits - cannot create patch-based upload".to_string());
    }

    // Find last pushed commit
    let git_history_last_pushed_commit_sha = find_last_pushed_commit(source_dir);

    // Get remote URL
    let remote_url = match get_github_remote_url(source_path.clone()).await {
        Ok(Some(info)) if !info.github_url.is_empty() => Some(info.github_url),
        _ => None
    };

    // Get list of unpushed commits
    let mut commits = Vec::new();

    if let Some(ref base_sha) = git_history_last_pushed_commit_sha {
        // Get commits between base and HEAD
        let log_output = new_command("git")
            .args(&["rev-list", &format!("{}..HEAD", base_sha)])
            .current_dir(source_dir)
            .output()
            .map_err(|e| format!("Failed to list commits: {}", e))?;

        if log_output.status.success() {
            let commit_shas = String::from_utf8_lossy(&log_output.stdout);
            let shas: Vec<&str> = commit_shas.lines().rev().collect(); // Reverse to get chronological order

            println!("[GIT] Found {} unpushed commits", shas.len());

            for sha in shas {
                if sha.is_empty() {
                    continue;
                }

                // Get commit title
                let title_output = new_command("git")
                    .args(&["show", "-s", "--format=%s", sha])
                    .current_dir(source_dir)
                    .output()
                    .map_err(|e| format!("Failed to get commit title: {}", e))?;

                let title = if title_output.status.success() {
                    String::from_utf8_lossy(&title_output.stdout).trim().to_string()
                } else {
                    "some changes".to_string()
                };

                // Get commit timestamp (seconds since epoch)
                let timestamp_output = new_command("git")
                    .args(&["show", "-s", "--format=%ct", sha])
                    .current_dir(source_dir)
                    .output()
                    .map_err(|e| format!("Failed to get commit timestamp: {}", e))?;

                let timestamp = if timestamp_output.status.success() {
                    String::from_utf8_lossy(&timestamp_output.stdout)
                        .trim()
                        .parse::<i64>()
                        .unwrap_or(0) * 1000 // Convert to milliseconds
                } else {
                    0
                };

                // Get patch using git diff (not format-patch)
                let patch_output = new_command("git")
                    .args(&["diff", &format!("{}~1", sha), sha])
                    .current_dir(source_dir)
                    .output()
                    .map_err(|e| format!("Failed to create patch: {}", e))?;

                let patch = if patch_output.status.success() {
                    String::from_utf8_lossy(&patch_output.stdout).to_string()
                } else {
                    return Err(format!("Failed to create patch for commit {}", sha));
                };

                commits.push(CommitPatch {
                    sha: sha.to_string(),
                    title,
                    timestamp,
                    patch,
                });
            }
        }
    }

    // Get uncommitted changes (same as before)
    let mut patch_content = Vec::new();

    // Get diff for tracked files
    let diff_output = new_command("git")
        .args(&["diff", "HEAD"])
        .current_dir(source_dir)
        .output()
        .map_err(|e| format!("Failed to get diff: {}", e))?;

    if diff_output.status.success() {
        patch_content = diff_output.stdout;
    }

    // Get list of untracked files
    let untracked_output = new_command("git")
        .args(&["ls-files", "--others", "--exclude-standard"])
        .current_dir(source_dir)
        .output()
        .map_err(|e| format!("Failed to list untracked files: {}", e))?;

    if untracked_output.status.success() {
        let untracked_files = String::from_utf8_lossy(&untracked_output.stdout);

        for file_path in untracked_files.lines() {
            if file_path.is_empty() {
                continue;
            }

            let full_path = source_dir.join(file_path);

            if let Ok(content) = fs::read_to_string(&full_path) {
                let lines: Vec<&str> = content.lines().collect();

                if lines.is_empty() {
                    let diff_header = format!(
                        "diff --git a/{} b/{}\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/{}\n",
                        file_path, file_path, file_path
                    );
                    patch_content.extend_from_slice(diff_header.as_bytes());
                } else {
                    let diff_header = format!(
                        "diff --git a/{} b/{}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n",
                        file_path, file_path, file_path, lines.len()
                    );
                    patch_content.extend_from_slice(diff_header.as_bytes());

                    for line in lines {
                        patch_content.extend_from_slice(b"+");
                        patch_content.extend_from_slice(line.as_bytes());
                        patch_content.extend_from_slice(b"\n");
                    }
                }
            }
        }
    }

    // Normalize line endings
    let patch_content = normalize_line_endings(&patch_content);
    let uncommitted_patch = String::from_utf8_lossy(&patch_content).to_string();

    println!("[GIT] Extracted {} commit patches", commits.len());
    println!("[GIT] Uncommitted changes size: {} bytes", uncommitted_patch.len());

    Ok(PatchBasedUploadData {
        git_history_last_pushed_commit_sha,
        commits,
        uncommitted_patch,
        remote_url,
    })
}

/// Create an incremental git bundle (only commits since merge-base)
/// Automatically detects GitHub remote URL using get_github_remote_url
#[tauri::command]
pub async fn create_incremental_git_bundle_and_patch(
    source_path: String
) -> Result<BundleMetadata, String> {
    let source_dir = Path::new(&source_path);
    if !source_dir.exists() || !source_dir.is_dir() {
        return Err(format!("Source directory does not exist: {}", source_path));
    }

    println!("[GIT] Creating incremental git bundle for: {}", source_path);

    // Check if repository has any commits
    let log_output = new_command("git")
        .args(&["rev-list", "--all", "--count"])
        .current_dir(source_dir)
        .output()
        .map_err(|e| format!("Failed to check git history: {}", e))?;

    let commit_count = if log_output.status.success() {
        String::from_utf8_lossy(&log_output.stdout)
            .trim()
            .parse::<u32>()
            .unwrap_or(0)
    } else {
        0
    };

    println!("[GIT] Repository has {} commits", commit_count);

    // Try to find merge-base
    let base_commit = find_remote_merge_base(source_dir);

    // Detect GitHub remote URL using the same function as frontend
    // This returns None if remote is not GitHub (GitLab, Bitbucket, etc.)
    let detected_remote_url = match get_github_remote_url(source_path.clone()).await {
        Ok(Some(info)) if !info.github_url.is_empty() => Some(info.github_url),
        _ => None
    };

    let temp_dir = std::env::temp_dir();
    let bundle_filename = format!("ariana_bundle_{}.bundle", uuid::Uuid::new_v4());
    let patch_filename = format!("ariana_patch_{}.patch", uuid::Uuid::new_v4());
    let bundle_path = temp_dir.join(&bundle_filename);
    let patch_path = temp_dir.join(&patch_filename);

    let mut is_incremental = false;

    if commit_count == 0 {
        // Repository has no commits - create an empty bundle
        println!("[GIT] No commits found - creating empty bundle");
        fs::write(&bundle_path, &[])
            .map_err(|e| format!("Failed to create empty bundle: {}", e))?;
    } else if let Some(ref base_sha) = base_commit {
        // Check if HEAD is at the base commit (no new commits)
        let head_sha_output = new_command("git")
            .args(&["rev-parse", "HEAD"])
            .current_dir(source_dir)
            .output()
            .map_err(|e| format!("Failed to get HEAD SHA: {}", e))?;

        let head_sha = if head_sha_output.status.success() {
            String::from_utf8_lossy(&head_sha_output.stdout).trim().to_string()
        } else {
            String::new()
        };

        if head_sha == *base_sha {
            // HEAD is at base commit - no new commits, create empty bundle
            println!("[GIT] HEAD is at merge-base {} - no new commits, creating empty incremental bundle", base_sha);
            fs::write(&bundle_path, &[])
                .map_err(|e| format!("Failed to create empty bundle: {}", e))?;
            is_incremental = true;
        } else {
            // Try to create incremental bundle
            println!("[GIT] Attempting incremental bundle from {} to HEAD", base_sha);

            let bundle_output = new_command("git")
                .args(&[
                    "bundle",
                    "create",
                    bundle_path.to_str().unwrap(),
                    &format!("{}..HEAD", base_sha),
                ])
                .current_dir(source_dir)
                .output()
                .map_err(|e| format!("Failed to create incremental bundle: {}", e))?;

            if bundle_output.status.success() {
                is_incremental = true;
                println!("[GIT] Incremental bundle created successfully");
            } else {
                println!("[GIT] Incremental bundle failed, falling back to full bundle");
                // Fall back to full bundle
                let bundle_output = new_command("git")
                    .args(&["bundle", "create", bundle_path.to_str().unwrap(), "--all"])
                    .current_dir(source_dir)
                    .output()
                    .map_err(|e| format!("Failed to create git bundle: {}", e))?;

                if !bundle_output.status.success() {
                    return Err(format!(
                        "Git bundle creation failed: {}",
                        String::from_utf8_lossy(&bundle_output.stderr)
                    ));
                }
            }
        }
    } else {
        println!("[GIT] No merge-base found, creating full bundle");
        // No merge-base, create full bundle
        let bundle_output = new_command("git")
            .args(&["bundle", "create", bundle_path.to_str().unwrap(), "--all"])
            .current_dir(source_dir)
            .output()
            .map_err(|e| format!("Failed to create git bundle: {}", e))?;

        if !bundle_output.status.success() {
            return Err(format!(
                "Git bundle creation failed: {}",
                String::from_utf8_lossy(&bundle_output.stderr)
            ));
        }
    }

    println!("[GIT] Bundle created at: {}", bundle_path.display());

    // Create patch for uncommitted changes (non-invasive - never touches staging area)
    println!("[GIT] Creating patch from uncommitted changes");

    let mut patch_content = Vec::new();

    // 1. Get diff for tracked files (only if we have commits, i.e., HEAD exists)
    if commit_count > 0 {
        let diff_output = new_command("git")
            .args(&["diff", "HEAD"])
            .current_dir(source_dir)
            .output()
            .map_err(|e| format!("Failed to get diff: {}", e))?;

        if !diff_output.status.success() {
            let _ = fs::remove_file(&bundle_path);
            return Err(format!(
                "Git diff failed: {}",
                String::from_utf8_lossy(&diff_output.stderr)
            ));
        }

        patch_content = diff_output.stdout;
    }

    // 2. Get list of untracked files
    let untracked_output = new_command("git")
        .args(&["ls-files", "--others", "--exclude-standard"])
        .current_dir(source_dir)
        .output()
        .map_err(|e| format!("Failed to list untracked files: {}", e))?;

    if untracked_output.status.success() {
        let untracked_files = String::from_utf8_lossy(&untracked_output.stdout);

        // 3. For each untracked file, create a diff entry
        for file_path in untracked_files.lines() {
            if file_path.is_empty() {
                continue;
            }

            let full_path = source_dir.join(file_path);

            // Read file content
            if let Ok(content) = fs::read_to_string(&full_path) {
                let lines: Vec<&str> = content.lines().collect();

                if lines.is_empty() {
                    // Empty file - no hunk header needed
                    let diff_header = format!(
                        "diff --git a/{} b/{}\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/{}\n",
                        file_path, file_path, file_path
                    );
                    patch_content.extend_from_slice(diff_header.as_bytes());
                } else {
                    // Non-empty file - include hunk header
                    let diff_header = format!(
                        "diff --git a/{} b/{}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n",
                        file_path, file_path, file_path, lines.len()
                    );
                    patch_content.extend_from_slice(diff_header.as_bytes());

                    for line in lines {
                        patch_content.extend_from_slice(b"+");
                        patch_content.extend_from_slice(line.as_bytes());
                        patch_content.extend_from_slice(b"\n");
                    }
                }
            }
        }
    }

    // Normalize line endings to LF (git patches must use LF, not CRLF)
    // This is critical for cross-platform compatibility (Windows -> Linux)
    let patch_content = normalize_line_endings(&patch_content);

    // Write combined patch to file
    fs::write(&patch_path, &patch_content)
        .map_err(|e| {
            let _ = fs::remove_file(&bundle_path);
            format!("Failed to write patch file: {}", e)
        })?;

    println!("[GIT] Patch created at: {}", patch_path.display());

    let bundle_size = fs::metadata(&bundle_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let patch_size = fs::metadata(&patch_path)
        .map(|m| m.len())
        .unwrap_or(0);

    println!(
        "[GIT] Bundle size: {} bytes, Patch size: {} bytes, Incremental: {}",
        bundle_size, patch_size, is_incremental
    );

    Ok(BundleMetadata {
        bundle_path: bundle_path.to_string_lossy().to_string(),
        patch_path: patch_path.to_string_lossy().to_string(),
        is_incremental,
        base_commit_sha: if is_incremental { base_commit } else { None },
        remote_url: detected_remote_url,
    })
}

#[tauri::command]
pub async fn create_git_bundle_and_patch(source_path: String) -> Result<(String, String), String> {
    let source_dir = Path::new(&source_path);
    if !source_dir.exists() || !source_dir.is_dir() {
        return Err(format!("Source directory does not exist: {}", source_path));
    }

    println!("[GIT] Creating git bundle and patch for: {}", source_path);

    let temp_dir = std::env::temp_dir();
    let bundle_filename = format!("ariana_bundle_{}.bundle", uuid::Uuid::new_v4());
    let patch_filename = format!("ariana_patch_{}.patch", uuid::Uuid::new_v4());
    let bundle_path = temp_dir.join(&bundle_filename);
    let patch_path = temp_dir.join(&patch_filename);

    // Check if repository has any commits
    println!("[GIT] Checking if repository has commits");
    println!("[GIT] Running: git rev-list --all --count");
    let log_output = new_command("git")
        .args(&["rev-list", "--all", "--count"])
        .current_dir(source_dir)
        .output()
        .map_err(|e| format!("Failed to check git history: {}", e))?;
    println!("[GIT] git rev-list completed");

    let commit_count = if log_output.status.success() {
        String::from_utf8_lossy(&log_output.stdout)
            .trim()
            .parse::<u32>()
            .unwrap_or(0)
    } else {
        0
    };

    println!("[GIT] Repository has {} commits", commit_count);

    if commit_count == 0 {
        // Repository has no commits - create an empty bundle
        println!("[GIT] No commits found - creating empty bundle");

        // Create an empty file for the bundle
        fs::write(&bundle_path, &[])
            .map_err(|e| format!("Failed to create empty bundle: {}", e))?;
    } else {
        // Create git bundle with all refs (entire history needed for clone)
        println!("[GIT] Creating bundle with --all");
        println!("[GIT] Running: git bundle create {} --all", bundle_path.display());
        let bundle_output = new_command("git")
            .args(&["bundle", "create", bundle_path.to_str().unwrap(), "--all"])
            .current_dir(source_dir)
            .output()
            .map_err(|e| format!("Failed to create git bundle: {}", e))?;
        println!("[GIT] git bundle create completed");

        if !bundle_output.status.success() {
            return Err(format!(
                "Git bundle creation failed: {}",
                String::from_utf8_lossy(&bundle_output.stderr)
            ));
        }
        println!("[GIT] Bundle created successfully");
    }

    println!("[GIT] Bundle created at: {}", bundle_path.display());

    // Create patch for uncommitted changes (non-invasive - never touches staging area)
    println!("[GIT] Creating patch from uncommitted changes");

    let mut patch_content = Vec::new();

    // 1. Get diff for tracked files (only if we have commits, i.e., HEAD exists)
    if commit_count > 0 {
        let diff_output = new_command("git")
            .args(&["diff", "HEAD"])
            .current_dir(source_dir)
            .output()
            .map_err(|e| format!("Failed to get diff: {}", e))?;

        if !diff_output.status.success() {
            let _ = fs::remove_file(&bundle_path);
            return Err(format!(
                "Git diff failed: {}",
                String::from_utf8_lossy(&diff_output.stderr)
            ));
        }

        patch_content = diff_output.stdout;
    }

    // 2. Get list of untracked files
    let untracked_output = new_command("git")
        .args(&["ls-files", "--others", "--exclude-standard"])
        .current_dir(source_dir)
        .output()
        .map_err(|e| format!("Failed to list untracked files: {}", e))?;

    if untracked_output.status.success() {
        let untracked_files = String::from_utf8_lossy(&untracked_output.stdout);

        // 3. For each untracked file, create a diff entry
        for file_path in untracked_files.lines() {
            if file_path.is_empty() {
                continue;
            }

            let full_path = source_dir.join(file_path);

            // Read file content
            if let Ok(content) = fs::read_to_string(&full_path) {
                let lines: Vec<&str> = content.lines().collect();

                if lines.is_empty() {
                    // Empty file - no hunk header needed
                    let diff_header = format!(
                        "diff --git a/{} b/{}\nnew file mode 100644\nindex 0000000..e69de29\n--- /dev/null\n+++ b/{}\n",
                        file_path, file_path, file_path
                    );
                    patch_content.extend_from_slice(diff_header.as_bytes());
                } else {
                    // Non-empty file - include hunk header
                    let diff_header = format!(
                        "diff --git a/{} b/{}\nnew file mode 100644\nindex 0000000..0000000\n--- /dev/null\n+++ b/{}\n@@ -0,0 +1,{} @@\n",
                        file_path, file_path, file_path, lines.len()
                    );
                    patch_content.extend_from_slice(diff_header.as_bytes());

                    for line in lines {
                        patch_content.extend_from_slice(b"+");
                        patch_content.extend_from_slice(line.as_bytes());
                        patch_content.extend_from_slice(b"\n");
                    }
                }
            }
        }
    }

    // Normalize line endings to LF (git patches must use LF, not CRLF)
    // This is critical for cross-platform compatibility (Windows -> Linux)
    let patch_content = normalize_line_endings(&patch_content);

    // Write combined patch to file
    fs::write(&patch_path, &patch_content)
        .map_err(|e| {
            let _ = fs::remove_file(&bundle_path);
            format!("Failed to write patch file: {}", e)
        })?;

    println!("[GIT] Patch created at: {}", patch_path.display());

    let bundle_size = fs::metadata(&bundle_path)
        .map(|m| m.len())
        .unwrap_or(0);
    let patch_size = fs::metadata(&patch_path)
        .map(|m| m.len())
        .unwrap_or(0);

    println!(
        "[GIT] Bundle size: {} bytes ({:.2} MB), Patch size: {} bytes ({:.2} KB)",
        bundle_size, bundle_size as f64 / 1024.0 / 1024.0,
        patch_size, patch_size as f64 / 1024.0
    );

    println!("[GIT] Returning bundle and patch paths to JavaScript");
    Ok((
        bundle_path.to_string_lossy().to_string(),
        patch_path.to_string_lossy().to_string(),
    ))
}

