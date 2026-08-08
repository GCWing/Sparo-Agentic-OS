use super::*;

struct PetPackageSource {
    pet_json: Vec<u8>,
    spritesheet_name: PathBuf,
    spritesheet: Vec<u8>,
}

fn sanitize_pet_id(id: &str) -> String {
    let sanitized: String = id
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    let trimmed = sanitized.trim_matches('-');
    if trimmed.is_empty() {
        "custom-pet".to_string()
    } else {
        trimmed.to_string()
    }
}

fn spritesheet_mime_type(file_name: &str) -> &'static str {
    match Path::new(file_name)
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        _ => "image/webp",
    }
}

fn load_pet_manifest_from_bytes(bytes: &[u8]) -> Result<(serde_json::Value, PathBuf), String> {
    let manifest: serde_json::Value =
        serde_json::from_slice(bytes).map_err(|e| format!("Failed to parse pet.json: {}", e))?;
    let spritesheet_path = manifest
        .get("spritesheetPath")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "pet.json is missing spritesheetPath".to_string())?
        .to_string();
    Ok((manifest, PathBuf::from(spritesheet_path)))
}

fn load_pet_package_source(source_path: &Path) -> Result<PetPackageSource, String> {
    if source_path.is_dir() {
        let pet_json_path = source_path.join("pet.json");
        let pet_json =
            std::fs::read(&pet_json_path).map_err(|e| format!("Failed to read pet.json: {}", e))?;
        let (_, spritesheet_name) = load_pet_manifest_from_bytes(&pet_json)?;
        let spritesheet_path = source_path.join(&spritesheet_name);
        let spritesheet = std::fs::read(&spritesheet_path)
            .map_err(|e| format!("Failed to read spritesheet: {}", e))?;
        return Ok(PetPackageSource {
            pet_json,
            spritesheet_name,
            spritesheet,
        });
    }

    let file = std::fs::File::open(source_path)
        .map_err(|e| format!("Failed to open pet zip package: {}", e))?;
    let mut archive =
        zip::ZipArchive::new(file).map_err(|e| format!("Failed to read pet zip package: {}", e))?;

    let mut manifest_index = None;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|e| format!("Failed to inspect pet zip package: {}", e))?;
        if Path::new(entry.name()).file_name().and_then(|n| n.to_str()) == Some("pet.json") {
            manifest_index = Some(index);
            break;
        }
    }
    let manifest_index =
        manifest_index.ok_or_else(|| "Pet package must contain pet.json".to_string())?;

    let mut pet_json = Vec::new();
    let manifest_name = {
        let mut manifest_file = archive
            .by_index(manifest_index)
            .map_err(|e| format!("Failed to open pet.json in zip package: {}", e))?;
        std::io::copy(&mut manifest_file, &mut pet_json)
            .map_err(|e| format!("Failed to read pet.json from zip package: {}", e))?;
        PathBuf::from(manifest_file.name())
    };
    let (_, spritesheet_name) = load_pet_manifest_from_bytes(&pet_json)?;
    let spritesheet_zip_path = manifest_name
        .parent()
        .unwrap_or_else(|| Path::new(""))
        .join(&spritesheet_name)
        .to_string_lossy()
        .replace('\\', "/");

    let mut spritesheet = Vec::new();
    let mut spritesheet_file = archive
        .by_name(&spritesheet_zip_path)
        .map_err(|e| format!("Failed to open spritesheet in zip package: {}", e))?;
    std::io::copy(&mut spritesheet_file, &mut spritesheet)
        .map_err(|e| format!("Failed to read spritesheet from zip package: {}", e))?;

    Ok(PetPackageSource {
        pet_json,
        spritesheet_name,
        spritesheet,
    })
}

fn companion_user_packages_dir(state: &AppState) -> PathBuf {
    state
        .workspace_service
        .path_manager()
        .apps_dir()
        .join("agent-companions")
}

fn pet_package_dto_from_dir(
    dir: &Path,
    source: &str,
) -> Result<AgentCompanionPetPackageDto, String> {
    let pet_json_path = dir.join("pet.json");
    let pet_json = std::fs::read(&pet_json_path)
        .map_err(|e| format!("Failed to read {}: {}", pet_json_path.display(), e))?;
    let (manifest, spritesheet_rel_path) = load_pet_manifest_from_bytes(&pet_json)?;
    let raw_id = manifest
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or_else(|| {
            dir.file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("pet")
        });
    let display_name = manifest
        .get("displayName")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(raw_id)
        .trim()
        .to_string();
    let description = manifest
        .get("description")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let spritesheet_path = dir.join(&spritesheet_rel_path);
    if !spritesheet_path.is_file() {
        return Err(format!(
            "Spritesheet not found: {}",
            spritesheet_path.display()
        ));
    }
    let spritesheet_file_name = spritesheet_rel_path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("spritesheet.webp");

    Ok(AgentCompanionPetPackageDto {
        id: sanitize_pet_id(raw_id),
        display_name,
        description,
        source: source.to_string(),
        package_path: dir.to_string_lossy().to_string(),
        spritesheet_path: spritesheet_path.to_string_lossy().to_string(),
        spritesheet_mime_type: spritesheet_mime_type(spritesheet_file_name).to_string(),
    })
}

fn scan_pet_package_dirs(root: &Path, source: &str) -> Vec<AgentCompanionPetPackageDto> {
    let Ok(entries) = std::fs::read_dir(root) else {
        return Vec::new();
    };
    let mut pets = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() || !path.join("pet.json").is_file() {
            continue;
        }
        match pet_package_dto_from_dir(&path, source) {
            Ok(dto) => pets.push(dto),
            Err(err) => warn!("Skipping invalid Agent companion pet package: {}", err),
        }
    }
    pets.sort_by(|a, b| {
        a.display_name
            .to_lowercase()
            .cmp(&b.display_name.to_lowercase())
    });
    pets
}

#[tauri::command]
pub async fn list_agent_companion_pets(
    state: State<'_, AppState>,
) -> Result<ListAgentCompanionPetsResponse, String> {
    let pets = scan_pet_package_dirs(&companion_user_packages_dir(&state), "user");
    Ok(ListAgentCompanionPetsResponse { pets })
}

#[tauri::command]
pub async fn import_agent_companion_pet_package(
    state: State<'_, AppState>,
    request: ImportAgentCompanionPetPackageRequest,
) -> Result<AgentCompanionPetPackageDto, String> {
    let source_path = PathBuf::from(request.path);
    let source = load_pet_package_source(&source_path)?;
    let (pet_json, _) = load_pet_manifest_from_bytes(&source.pet_json)?;

    let raw_id = pet_json
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or("custom-pet");
    let id = sanitize_pet_id(raw_id);
    let display_name = pet_json
        .get("displayName")
        .and_then(|value| value.as_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(raw_id)
        .trim()
        .to_string();
    let description = pet_json
        .get("description")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    let package_dir = state
        .workspace_service
        .path_manager()
        .apps_dir()
        .join("agent-companions")
        .join(format!("{}-{}", id, uuid::Uuid::new_v4().simple()));

    std::fs::create_dir_all(&package_dir)
        .map_err(|e| format!("Failed to create pet package directory: {}", e))?;

    let spritesheet_file_name = source
        .spritesheet_name
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("spritesheet.webp")
        .to_string();
    let spritesheet_path = package_dir.join(&spritesheet_file_name);

    let mut normalized_manifest = pet_json;
    if let Some(obj) = normalized_manifest.as_object_mut() {
        obj.insert(
            "spritesheetPath".to_string(),
            serde_json::Value::String(spritesheet_file_name.clone()),
        );
    }

    let manifest_bytes = serde_json::to_vec_pretty(&normalized_manifest)
        .map_err(|e| format!("Failed to serialize pet.json: {}", e))?;
    std::fs::write(package_dir.join("pet.json"), manifest_bytes)
        .map_err(|e| format!("Failed to write pet.json: {}", e))?;
    std::fs::write(&spritesheet_path, source.spritesheet)
        .map_err(|e| format!("Failed to write spritesheet: {}", e))?;

    info!("Imported Agent companion pet package '{}'", id);

    Ok(AgentCompanionPetPackageDto {
        id,
        display_name,
        description,
        source: "user".to_string(),
        package_path: package_dir.to_string_lossy().to_string(),
        spritesheet_path: spritesheet_path.to_string_lossy().to_string(),
        spritesheet_mime_type: spritesheet_mime_type(&spritesheet_file_name).to_string(),
    })
}

#[tauri::command]
pub async fn delete_agent_companion_pet_package(
    state: State<'_, AppState>,
    request: DeleteAgentCompanionPetPackageRequest,
) -> Result<(), String> {
    let root = companion_user_packages_dir(&state);
    if !root.exists() {
        return Err("Agent companion packages directory does not exist".to_string());
    }
    let root = root
        .canonicalize()
        .map_err(|e| format!("Failed to resolve Agent companion packages root: {}", e))?;

    let candidate = PathBuf::from(&request.package_path);
    let resolved = candidate
        .canonicalize()
        .map_err(|e| format!("Pet package path not found: {}", e))?;

    if !resolved.starts_with(&root) {
        return Err(
            "Refusing to delete path outside imported Agent companion packages".to_string(),
        );
    }
    if !resolved.is_dir() {
        return Err("Pet package is not a directory".to_string());
    }

    std::fs::remove_dir_all(&resolved)
        .map_err(|e| format!("Failed to delete pet package: {}", e))?;

    info!("Deleted Agent companion pet package");
    Ok(())
}
