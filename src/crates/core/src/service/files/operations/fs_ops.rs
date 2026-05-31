use std::path::{Path, PathBuf};

pub fn move_path_recoverably(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create target directory: {}", error))?;
        }
    }

    match std::fs::rename(source, target) {
        Ok(()) => Ok(()),
        Err(rename_error) => {
            copy_path_recursive(source, target).map_err(|copy_error| {
                format!(
                    "direct move failed: {}; fallback copy failed: {}",
                    rename_error, copy_error
                )
            })?;

            let remove_result = if source.is_dir() {
                std::fs::remove_dir_all(source)
            } else {
                std::fs::remove_file(source)
            };

            if let Err(remove_error) = remove_result {
                cleanup_copied_path(target);
                return Err(format!(
                    "direct move failed: {}; copied fallback but failed to remove original: {}",
                    rename_error, remove_error
                ));
            }

            Ok(())
        }
    }
}

pub fn copy_path_recursive(source: &Path, target: &Path) -> std::io::Result<()> {
    let metadata = std::fs::symlink_metadata(source)?;
    if metadata.file_type().is_symlink() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::Unsupported,
            "symbolic links are not supported by managed file moves",
        ));
    }

    if metadata.is_dir() {
        std::fs::create_dir_all(target)?;
        for entry_result in std::fs::read_dir(source)? {
            let entry = entry_result?;
            copy_path_recursive(&entry.path(), &target.join(entry.file_name()))?;
        }
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)?;
        }
    }
    std::fs::copy(source, target)?;
    Ok(())
}

pub fn default_archive_path(source: &Path) -> PathBuf {
    let parent = source.parent().map(Path::to_path_buf).unwrap_or_default();
    let name = source
        .file_stem()
        .or_else(|| source.file_name())
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "archive".to_string());
    unique_available_path(parent.join(format!("{}.zip", name)))
}

pub fn default_extract_path(source: &Path) -> PathBuf {
    let parent = source.parent().map(Path::to_path_buf).unwrap_or_default();
    let name = source
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "extracted".to_string());
    unique_available_path(parent.join(name))
}

pub fn archive_path_to_zip(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err("Archive source path does not exist".to_string());
    }
    if target.exists() {
        return Err("Archive target path already exists".to_string());
    }
    if let Some(parent) = target.parent() {
        if !parent.as_os_str().is_empty() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create archive directory: {}", error))?;
        }
    }

    let file = std::fs::File::create(target)
        .map_err(|error| format!("Failed to create archive file: {}", error))?;
    let mut zip = zip::ZipWriter::new(file);
    let options = zip::write::FileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated)
        .unix_permissions(0o644);
    let root_name = source
        .file_name()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| "archive".to_string());

    if source.is_dir() {
        add_directory_to_zip(&mut zip, source, &root_name, options)?;
    } else {
        add_file_to_zip(&mut zip, source, &root_name, options)?;
    }

    zip.finish()
        .map_err(|error| format!("Failed to finish archive: {}", error))?;
    Ok(())
}

pub fn extract_zip_to_dir(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Err("Archive source path does not exist".to_string());
    }
    if target.exists() {
        return Err("Extract target path already exists".to_string());
    }

    std::fs::create_dir_all(target)
        .map_err(|error| format!("Failed to create extract target directory: {}", error))?;
    let file = std::fs::File::open(source)
        .map_err(|error| format!("Failed to open archive source file: {}", error))?;
    let mut archive = zip::ZipArchive::new(file)
        .map_err(|error| format!("Failed to read archive file: {}", error))?;

    for index in 0..archive.len() {
        let mut item = archive
            .by_index(index)
            .map_err(|error| format!("Failed to read archive entry: {}", error))?;
        let Some(enclosed_name) = item.enclosed_name().map(Path::to_path_buf) else {
            return Err(format!(
                "Archive entry is not safe to extract: {}",
                item.name()
            ));
        };
        let output_path = target.join(enclosed_name);

        if item.name().ends_with('/') {
            std::fs::create_dir_all(&output_path)
                .map_err(|error| format!("Failed to create extracted directory: {}", error))?;
            continue;
        }

        if let Some(parent) = output_path.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Failed to create extracted parent: {}", error))?;
        }
        let mut output = std::fs::File::create(&output_path)
            .map_err(|error| format!("Failed to create extracted file: {}", error))?;
        std::io::copy(&mut item, &mut output)
            .map_err(|error| format!("Failed to write extracted file: {}", error))?;
    }

    Ok(())
}

fn cleanup_copied_path(path: &Path) {
    if path.is_dir() {
        let _ = std::fs::remove_dir_all(path);
    } else {
        let _ = std::fs::remove_file(path);
    }
}

fn unique_available_path(path: PathBuf) -> PathBuf {
    if !path.exists() {
        return path;
    }
    let parent = path.parent().map(Path::to_path_buf).unwrap_or_default();
    let stem = path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "item".to_string());
    let extension = path
        .extension()
        .map(|value| value.to_string_lossy().to_string());
    for index in 1..1000 {
        let file_name = match extension.as_deref() {
            Some(extension) if !extension.is_empty() => format!("{}-{}.{}", stem, index, extension),
            _ => format!("{}-{}", stem, index),
        };
        let candidate = parent.join(file_name);
        if !candidate.exists() {
            return candidate;
        }
    }
    path
}

fn add_directory_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    source: &Path,
    zip_prefix: &str,
    options: zip::write::FileOptions,
) -> Result<(), String> {
    let directory_name = if zip_prefix.ends_with('/') {
        zip_prefix.to_string()
    } else {
        format!("{}/", zip_prefix)
    };
    zip.add_directory(directory_name.clone(), options)
        .map_err(|error| format!("Failed to add archive directory: {}", error))?;

    for entry_result in std::fs::read_dir(source)
        .map_err(|error| format!("Failed to read archive source directory: {}", error))?
    {
        let entry = entry_result
            .map_err(|error| format!("Failed to read archive source entry: {}", error))?;
        let entry_path = entry.path();
        let entry_name = entry.file_name().to_string_lossy().replace('\\', "/");
        let child_zip_name = format!("{}{}", directory_name, entry_name);
        if entry_path.is_dir() {
            add_directory_to_zip(zip, &entry_path, &child_zip_name, options)?;
        } else {
            add_file_to_zip(zip, &entry_path, &child_zip_name, options)?;
        }
    }
    Ok(())
}

fn add_file_to_zip(
    zip: &mut zip::ZipWriter<std::fs::File>,
    source: &Path,
    zip_name: &str,
    options: zip::write::FileOptions,
) -> Result<(), String> {
    zip.start_file(zip_name.replace('\\', "/"), options)
        .map_err(|error| format!("Failed to add archive file: {}", error))?;
    let mut file = std::fs::File::open(source)
        .map_err(|error| format!("Failed to open archive source file: {}", error))?;
    std::io::copy(&mut file, zip)
        .map_err(|error| format!("Failed to write archive file: {}", error))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{archive_path_to_zip, copy_path_recursive, extract_zip_to_dir};

    #[test]
    fn copies_directory_recursively() {
        let root = std::env::temp_dir().join(format!(
            "sparo-core-file-copy-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_dir = root.join("source");
        let nested_dir = source_dir.join("nested");
        let source_file = nested_dir.join("note.txt");
        let target_dir = root.join("target");
        std::fs::create_dir_all(&nested_dir).expect("nested source dir");
        std::fs::write(&source_file, "copy me").expect("source file");

        copy_path_recursive(&source_dir, &target_dir).expect("copy directory");

        assert_eq!(
            std::fs::read_to_string(target_dir.join("nested").join("note.txt"))
                .expect("copied file content"),
            "copy me"
        );

        std::fs::remove_dir_all(root).ok();
    }

    #[test]
    fn archives_and_extracts_directory_without_zip_slip() {
        let root = std::env::temp_dir().join(format!(
            "sparo-core-file-archive-test-{}",
            uuid::Uuid::new_v4()
        ));
        let source_dir = root.join("source");
        let nested_dir = source_dir.join("nested");
        let source_file = nested_dir.join("note.txt");
        let archive_path = root.join("source.zip");
        let extract_dir = root.join("extracted");
        std::fs::create_dir_all(&nested_dir).expect("nested source dir");
        std::fs::write(&source_file, "archive me").expect("source file");

        archive_path_to_zip(&source_dir, &archive_path).expect("archive directory");
        extract_zip_to_dir(&archive_path, &extract_dir).expect("extract archive");

        assert_eq!(
            std::fs::read_to_string(extract_dir.join("source").join("nested").join("note.txt"))
                .expect("extracted file content"),
            "archive me"
        );

        std::fs::remove_dir_all(root).ok();
    }
}
