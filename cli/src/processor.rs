use crate::collector::CollectedItems;
use crate::instrumentation::instrument_files_batch;
use crate::utils::create_link_or_copy;
use anyhow::{anyhow, Result};
use ariana_server::traces::instrumentation::ecma::EcmaImportStyle;
use indicatif::{ProgressBar, ProgressStyle};
use rayon::iter::{IntoParallelRefIterator, ParallelIterator};
use std::collections::HashMap;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::Arc;
use zip::write::FileOptions;
use zip::{ZipArchive, ZipWriter};

/// Processes files_to_instrument in batches of up to 100 files in parallel.
fn process_instrument_files_in_batches(
    mut files: Vec<(PathBuf, PathBuf)>,
    api_url: &str,
    vault_key: &str,
    import_style: &EcmaImportStyle,
    pb: Arc<ProgressBar>,
    is_inplace: bool,
    zip_writer: Option<Arc<std::sync::Mutex<ZipWriter<File>>>>,
) {
    let mut paths_sizes = HashMap::new();
    files.sort_by(|a, b| {
        let a_size = fs::metadata(&a.0).unwrap().len();
        let b_size = fs::metadata(&b.0).unwrap().len();
        paths_sizes.insert(a.0.clone(), a_size);
        paths_sizes.insert(b.0.clone(), b_size);

        a_size.cmp(&b_size)
    });

    for (i, batch) in files.chunks(300).enumerate() {
        let mut total_size = 0;
        for (src, _) in batch {
            total_size += paths_sizes.get(src).unwrap();
        }

        let files_contents: Vec<String> = batch
            .par_iter()
            .map(|(src, _)| fs::read_to_string(&src).unwrap())
            .collect();

        let mut src_paths = vec![];
        let mut dest_paths = vec![];
        for (src, dest) in batch.into_iter() {
            src_paths.push(src.clone());
            dest_paths.push(dest.clone());
        }
        let result = instrument_files_batch(
            &src_paths,
            files_contents.clone(),
            api_url.to_string(),
            vault_key.to_string(),
            import_style,
        );
        let maybe_instrumented_contents = match result {
            Ok(maybe_instrumented_contents) => maybe_instrumented_contents,
            Err(e) => {
                eprintln!("Could not process batch {} because of: {:?}", i, e.source());
                continue;
            }
        };

        for (((src_path, dest_path), original_content), maybe_instrumented_content) in src_paths
            .iter()
            .zip(dest_paths.iter())
            .zip(files_contents.iter())
            .zip(maybe_instrumented_contents.iter())
        {
            let instrumented_content =
                if let Some(instrumented_content) = maybe_instrumented_content {
                    instrumented_content
                } else {
                    original_content
                };
            if is_inplace {
                if let Some(ref zw) = zip_writer {
                    let mut zw = zw.lock().unwrap();
                    let path_str = src_path.to_string_lossy().to_string();
                    zw.start_file(&path_str, FileOptions::<()>::default())
                        .unwrap();
                    zw.write_all(original_content.as_bytes()).unwrap();
                    fs::write(src_path, instrumented_content).unwrap();
                } else {
                    panic!("No zip writer");
                }
            } else {
                if let Some(parent) = dest_path.parent() {
                    // println!("create dir all {:?}", parent);
                    fs::create_dir_all(parent).unwrap();
                }
                fs::write(dest_path, instrumented_content).unwrap();
            }
            pb.inc(1);
        }
    }
}

pub fn process_items(
    items: &CollectedItems,
    api_url: &str,
    vault_key: &str,
    import_style: &EcmaImportStyle,
    is_inplace: bool,
) -> Result<(), String> {
    // Calculate total for progress bar
    let total = if is_inplace {
        items.files_to_instrument.len() as u64
    } else {
        (items.directories_to_link_or_copy.len()
            + items.files_to_instrument.len()
            + items.files_to_link_or_copy.len()) as u64
    };

    // Initialize progress bar
    let pb = Arc::new(ProgressBar::new(total));
    pb.set_style(
        ProgressStyle::default_bar()
            .template("[{elapsed_precise}] {bar:40.cyan/blue} {pos}/{len} {msg}")
            .unwrap()
            .progress_chars("##-"),
    );

    // Process items based on is_inplace flag
    if is_inplace {
        fs::create_dir_all(".ariana").map_err(|_| format!("Couldn't create .ariana"))?;
        let zip_file = File::create(".ariana/__ariana_backups.zip")
            .map_err(|_| format!("Couldn't create .ariana/__ariana_backups.zip"))?;
        let zip_writer = Arc::new(std::sync::Mutex::new(ZipWriter::new(zip_file)));
        process_instrument_files_in_batches(
            items.files_to_instrument.to_vec(),
            api_url,
            vault_key,
            import_style,
            pb.clone(),
            true,
            Some(zip_writer),
        );
    } else {
        rayon::scope(|s| {
            // Process directories to link or copy
            for (src, dest) in &items.directories_to_link_or_copy {
                let pb = pb.clone();
                let src = src.clone();
                let dest = dest.clone();
                s.spawn(move |_| {
                    if let Some(parent) = dest.parent() {
                        if let Err(e) = fs::create_dir_all(parent) {
                            eprintln!("Could not create {:?}: {}", parent, e);
                        }
                    }
                    if let Err(e) = create_link_or_copy(&src, &dest) {
                        eprintln!("Could not copy or link {:?}: {}", src, e);
                    }
                    pb.inc(1);
                });
            }

            // Process files to link or copy
            for (src, dest) in &items.files_to_link_or_copy {
                let pb = pb.clone();
                let src = src.clone();
                let dest = dest.clone();
                s.spawn(move |_| {
                    if let Some(parent) = dest.parent() {
                        if let Err(e) = fs::create_dir_all(parent) {
                            eprintln!("Could not create {:?}: {}", parent, e);
                        }
                    }
                    if let Err(e) = create_link_or_copy(&src, &dest) {
                        eprintln!("Could not copy or link {:?}: {}", src, e);
                    }
                    pb.inc(1);
                });
            }

            // Process files_to_instrument in batches within a separate task
            s.spawn(|_| {
                process_instrument_files_in_batches(
                    items.files_to_instrument.to_vec(),
                    api_url,
                    vault_key,
                    import_style,
                    pb.clone(),
                    false,
                    None,
                );
            });
        });
    }

    // Finalize progress bar and message thread
    pb.finish();

    Ok(())
}

pub fn restore_backup(items: &CollectedItems) -> Result<()> {
    let zip_path = Path::new(".ariana/__ariana_backups.zip");
    if !zip_path.exists() {
        return Err(anyhow!("Backup not found, could not restore."));
    }

    let zip_file = File::open(zip_path)?;
    let mut archive = ZipArchive::new(zip_file)?;

    let total = items.files_to_instrument.len() as u64;
    let pb = ProgressBar::new(total);
    pb.set_style(
        ProgressStyle::default_bar()
            .template("[{elapsed_precise}] {bar:40.cyan/blue} {pos}/{len} Restoring backups")
            .unwrap()
            .progress_chars("##-"),
    );

    for (src, _) in &items.files_to_instrument {
        let path_str = src.to_string_lossy().to_string();
        if let Ok(mut file) = archive.by_name(&path_str) {
            let mut content = Vec::new();
            file.read_to_end(&mut content)?;
            std::fs::write(src, content)?;
            pb.inc(1);
        }
    }

    drop(archive); // Close the archive
    // let _ = std::fs::remove_dir_all(".ariana"); // Clean up if empty

    pb.finish_with_message("Backup restoration complete");
    Ok(())
}
