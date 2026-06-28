fn main() {
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".to_string());
    let bundles_root = std::path::Path::new(&manifest_dir)
        .join("..")
        .join("..")
        .join("..")
        .join("bundles");
    emit_rerun_if_changed(&bundles_root.join("skills"));
    emit_rerun_if_changed(&bundles_root.join("playbooks"));
    emit_rerun_if_changed(&bundles_root.join("apps"));
    emit_rerun_if_changed(&bundles_root.join("components"));
    emit_rerun_if_changed(&bundles_root.join("surface-components"));
    emit_rerun_if_changed(&bundles_root.join("bridge-components"));

    if let Err(message) = validate_product_app_bundles(&bundles_root.join("apps")) {
        panic!("Product App bundle validation failed: {message}");
    }
    if let Err(message) = validate_component_bundles(&bundles_root.join("components")) {
        panic!("Component bundle validation failed: {message}");
    }
    if let Err(message) =
        validate_surface_component_bundles(&bundles_root.join("surface-components"))
    {
        panic!("Surface Component bundle validation failed: {message}");
    }
    if let Err(message) = validate_bridge_component_bundles(&bundles_root.join("bridge-components"))
    {
        panic!("Bridge Component bundle validation failed: {message}");
    }

    // Run the build script to embed prompts data
    if let Err(e) = build_embedded_prompts() {
        eprintln!("Warning: Failed to embed prompts data: {}", e);
    }

    // Embed announcement content (tips + feature cards)
    if let Err(e) = embed_announcement_content() {
        eprintln!("Warning: Failed to embed announcement content: {}", e);
    }
}

fn build_embedded_prompts() -> Result<(), Box<dyn std::error::Error>> {
    // Embed prompts data
    embed_agents_prompt_data()
}

fn validate_product_app_bundles(apps_root: &std::path::Path) -> Result<(), String> {
    if !apps_root.exists() {
        return Ok(());
    }

    for app_entry in std::fs::read_dir(apps_root).map_err(|e| e.to_string())? {
        let app_path = app_entry.map_err(|e| e.to_string())?.path();
        if !app_path.is_dir() {
            continue;
        }
        for version_entry in std::fs::read_dir(&app_path).map_err(|e| e.to_string())? {
            let version_path = version_entry.map_err(|e| e.to_string())?.path();
            if !version_path.is_dir() {
                continue;
            }
            if !version_path.join("app.json").is_file() {
                return Err(format!(
                    "missing app.json in Product App package '{}'",
                    version_path.display()
                ));
            }
            if version_path.join("node_modules").exists() {
                return Err(format!(
                    "Product App package '{}' contains node_modules/.",
                    version_path.display()
                ));
            }
        }
    }

    Ok(())
}

fn validate_component_bundles(components_root: &std::path::Path) -> Result<(), String> {
    if !components_root.exists() {
        return Ok(());
    }

    for kind_entry in std::fs::read_dir(components_root).map_err(|e| e.to_string())? {
        let kind_path = kind_entry.map_err(|e| e.to_string())?.path();
        if !kind_path.is_dir() {
            continue;
        }
        for component_entry in std::fs::read_dir(&kind_path).map_err(|e| e.to_string())? {
            let component_path = component_entry.map_err(|e| e.to_string())?.path();
            if !component_path.is_dir() {
                continue;
            }
            for version_entry in std::fs::read_dir(&component_path).map_err(|e| e.to_string())? {
                let version_path = version_entry.map_err(|e| e.to_string())?.path();
                if !version_path.is_dir() {
                    continue;
                }
                if !version_path.join("component.json").is_file() {
                    return Err(format!(
                        "missing component.json in Component package '{}'",
                        version_path.display()
                    ));
                }
                if version_path.join("node_modules").exists() {
                    return Err(format!(
                        "Component package '{}' contains node_modules/.",
                        version_path.display()
                    ));
                }
            }
        }
    }

    Ok(())
}

fn validate_surface_component_bundles(
    surface_components_root: &std::path::Path,
) -> Result<(), String> {
    if !surface_components_root.exists() {
        return Ok(());
    }

    for entry in std::fs::read_dir(surface_components_root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if !path.is_dir() {
            continue;
        }

        let bundle_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("<unknown>");

        let bundle_manifest = path.join("bundle.json");
        if !bundle_manifest.is_file() {
            return Err(format!(
                "missing bundle.json in Surface Component bundle '{}'",
                path.display()
            ));
        }

        let node_modules = path.join("node_modules");
        if node_modules.exists() {
            return Err(format!(
                "Surface Component bundle '{}' contains node_modules/. Remove it before building. \
                 Do not run npm install inside bundles/surface-components/*.",
                bundle_name
            ));
        }
    }

    Ok(())
}

fn validate_bridge_component_bundles(
    bridge_components_root: &std::path::Path,
) -> Result<(), String> {
    if !bridge_components_root.exists() {
        return Ok(());
    }

    for entry in std::fs::read_dir(bridge_components_root).map_err(|e| e.to_string())? {
        let path = entry.map_err(|e| e.to_string())?.path();
        if !path.is_dir() {
            continue;
        }

        let bundle_name = path
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("<unknown>");

        let bundle_manifest = path.join("bundle.json");
        if !bundle_manifest.is_file() {
            return Err(format!(
                "missing bundle.json in Bridge Component bundle '{}'",
                path.display()
            ));
        }

        let node_modules = path.join("node_modules");
        if node_modules.exists() {
            return Err(format!(
                "Bridge Component bundle '{}' contains node_modules/. Remove it before building.",
                bundle_name
            ));
        }
    }

    Ok(())
}

fn escape_rust_string(s: &str) -> String {
    // To avoid quote issues, return the original string directly
    // Using r### syntax can include any character
    s.to_string()
}

fn emit_rerun_if_changed(path: &std::path::Path) {
    if !path.exists() {
        return;
    }

    println!("cargo:rerun-if-changed={}", path.display());

    if path.is_dir() {
        let entries = match std::fs::read_dir(path) {
            Ok(entries) => entries,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            emit_rerun_if_changed(&entry.path());
        }
    }
}

// Function to embed prompts data
fn embed_agents_prompt_data() -> Result<(), Box<dyn std::error::Error>> {
    use std::collections::HashMap;
    use std::path::Path;

    println!("cargo:rerun-if-changed=src/agentic/agents/prompts");

    // Get CARGO_MANIFEST_DIR (i.e. crates/core directory)
    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")?;

    let mut prompts = HashMap::new();

    // Read agentic agents prompts
    let agentic_prompt_path = Path::new(&manifest_dir)
        .join("src")
        .join("agentic")
        .join("agents")
        .join("prompts");

    if agentic_prompt_path.exists() {
        println!("Embedding agentic prompts from: {:?}", agentic_prompt_path);
        read_prompts_recursive(&agentic_prompt_path, &agentic_prompt_path, &mut prompts)?;
    } else {
        eprintln!(
            "Warning: agentic prompts directory not found at {:?}",
            agentic_prompt_path
        );
    }

    if prompts.is_empty() {
        // Create empty embedded data
        create_empty_embedded_prompts(&manifest_dir)?;
        return Ok(());
    }

    // Generate embedded Rust code
    generate_embedded_prompts_code(&manifest_dir, &prompts)?;

    println!("Successfully embedded {} prompt files", prompts.len());

    Ok(())
}

fn check_extension(path: &std::path::Path) -> bool {
    if let Some(ext) = path.extension() {
        match ext.to_str() {
            Some(ext) => ext == "txt" || ext == "md",
            None => false,
        }
    } else {
        false
    }
}

fn gen_key(relative_path: &str, prefix: &str) -> String {
    format!(
        "{}{}",
        prefix,
        relative_path
            .trim_end_matches(".txt")
            .trim_end_matches(".md")
    )
}

// Read prompts and add prefix
#[allow(dead_code)]
fn read_prompts_with_prefix(
    current_dir: &std::path::Path,
    base_dir: &std::path::Path,
    prefix: &str,
    prompts: &mut std::collections::HashMap<String, String>,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;

    for entry in fs::read_dir(current_dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            read_prompts_with_prefix(&path, base_dir, prefix, prompts)?;
        } else if check_extension(&path) {
            let content = fs::read_to_string(&path)?;
            let relative_path = path
                .strip_prefix(base_dir)?
                .to_string_lossy()
                .replace('\\', "/"); // Use forward slash

            // Remove extension and add prefix as key
            let key = gen_key(&relative_path, prefix);
            prompts.insert(key, content);
        }
    }

    Ok(())
}

fn read_prompts_recursive(
    current_dir: &std::path::Path,
    base_dir: &std::path::Path,
    prompts: &mut std::collections::HashMap<String, String>,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;

    for entry in fs::read_dir(current_dir)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() {
            read_prompts_recursive(&path, base_dir, prompts)?;
        } else if check_extension(&path) {
            let content = fs::read_to_string(&path)?;
            let relative_path = path
                .strip_prefix(base_dir)?
                .to_string_lossy()
                .replace('\\', "/"); // Use forward slash

            // Remove extension as key
            let key = gen_key(&relative_path, "");
            prompts.insert(key, content);
        }
    }

    Ok(())
}

fn generate_embedded_prompts_code(
    _manifest_dir: &str,
    prompts: &std::collections::HashMap<String, String>,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;
    use std::io::Write;
    use std::path::Path;

    let out_dir = std::env::var("OUT_DIR")?;
    let dest_path = Path::new(&out_dir).join("embedded_agents_prompt.rs");
    let mut file = fs::File::create(&dest_path)?;

    writeln!(file, "// Embedded Agent Prompt data")?;
    writeln!(
        file,
        "// This file is automatically generated by the build script, do not modify manually"
    )?;
    writeln!(file)?;
    writeln!(file, "use std::collections::HashMap;")?;
    writeln!(file, "use std::sync::LazyLock;")?;
    writeln!(file)?;

    // Embed all prompt content
    writeln!(file, "/// Embedded prompt content mapping")?;
    writeln!(
        file,
        "pub static EMBEDDED_PROMPTS: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {{"
    )?;
    writeln!(file, "    let mut map = HashMap::new();")?;

    for (name, content) in prompts {
        writeln!(
            file,
            "    map.insert(r###\"{}\"###, r###\"{}\"###);",
            escape_rust_string(name),
            escape_rust_string(content)
        )?;
    }

    writeln!(file, "    map")?;
    writeln!(file, "}});")?;
    writeln!(file)?;

    // Add convenient functions
    writeln!(file, "/// Get embedded prompt content")?;
    writeln!(
        file,
        "pub fn get_embedded_prompt(prompt_name: &str) -> Option<&'static str> {{"
    )?;
    writeln!(file, "    EMBEDDED_PROMPTS.get(prompt_name).copied()")?;
    writeln!(file, "}}")?;
    writeln!(file)?;

    writeln!(file, "/// Get all embedded prompt names")?;
    writeln!(file, "#[allow(dead_code)]")?;
    writeln!(
        file,
        "pub fn get_all_embedded_prompt_names() -> Vec<&'static str> {{"
    )?;
    writeln!(file, "    EMBEDDED_PROMPTS.keys().copied().collect()")?;
    writeln!(file, "}}")?;

    Ok(())
}

/// Embed announcement MD content (tips + feature cards) from the content/ directory.
///
/// Scans `src/service/announcement/content/{tips,features}/{locale}/*.md` and generates
/// `embedded_announcements.rs` in OUT_DIR with a static HashMap keyed by
/// `"{type}/{locale}/{stem}"` (e.g. `"tips/zh-CN/vibe_describe_task"`).
fn embed_announcement_content() -> Result<(), Box<dyn std::error::Error>> {
    use std::collections::HashMap;
    use std::path::Path;

    let manifest_dir = std::env::var("CARGO_MANIFEST_DIR")?;
    let content_root = Path::new(&manifest_dir)
        .join("src")
        .join("service")
        .join("announcement")
        .join("content");

    println!("cargo:rerun-if-changed={}", content_root.display());
    emit_rerun_if_changed(&content_root);

    let mut entries: HashMap<String, String> = HashMap::new();

    for category in &["tips", "features"] {
        let cat_dir = content_root.join(category);
        if !cat_dir.exists() {
            continue;
        }
        for locale_entry in std::fs::read_dir(&cat_dir)?.flatten() {
            let locale_path = locale_entry.path();
            if !locale_path.is_dir() {
                continue;
            }
            let locale = locale_path
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
            for file_entry in std::fs::read_dir(&locale_path)?.flatten() {
                let file_path = file_entry.path();
                if file_path.extension().and_then(|e| e.to_str()) != Some("md") {
                    continue;
                }
                let stem = file_path
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
                // Strip leading numeric prefix (e.g. "001_") to use bare id as key.
                let key_stem = if stem.len() > 4
                    && stem.chars().take(3).all(|c| c.is_ascii_digit())
                    && stem.chars().nth(3) == Some('_')
                {
                    stem[4..].to_string()
                } else {
                    stem
                };
                let key = format!("{}/{}/{}", category, locale, key_stem);
                let content = std::fs::read_to_string(&file_path)?;
                entries.insert(key, content);
            }
        }
    }

    generate_embedded_announcements_code(&entries)
}

fn generate_embedded_announcements_code(
    entries: &std::collections::HashMap<String, String>,
) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;
    use std::io::Write;
    use std::path::Path;

    let out_dir = std::env::var("OUT_DIR")?;
    let dest_path = Path::new(&out_dir).join("embedded_announcements.rs");
    let mut file = fs::File::create(&dest_path)?;

    writeln!(
        file,
        "// Embedded announcement content (auto-generated by build.rs)"
    )?;
    writeln!(file, "// Do not edit manually.")?;
    writeln!(file)?;
    writeln!(file, "use std::collections::HashMap;")?;
    writeln!(file, "use std::sync::LazyLock;")?;
    writeln!(file)?;
    writeln!(
        file,
        "pub static EMBEDDED_ANNOUNCEMENTS: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| {{"
    )?;
    writeln!(file, "    let mut map = HashMap::new();")?;

    for (key, content) in entries {
        writeln!(
            file,
            "    map.insert(r###\"{}\"###, r###\"{}\"###);",
            escape_rust_string(key),
            escape_rust_string(content)
        )?;
    }

    writeln!(file, "    map")?;
    writeln!(file, "}});")?;
    writeln!(file)?;
    writeln!(
        file,
        "pub fn get_announcement_content(key: &str) -> Option<&'static str> {{"
    )?;
    writeln!(file, "    EMBEDDED_ANNOUNCEMENTS.get(key).copied()")?;
    writeln!(file, "}}")?;

    Ok(())
}

fn create_empty_embedded_prompts(_manifest_dir: &str) -> Result<(), Box<dyn std::error::Error>> {
    use std::fs;
    use std::io::Write;
    use std::path::Path;

    let out_dir = std::env::var("OUT_DIR")?;
    let dest_path = Path::new(&out_dir).join("embedded_agents_prompt.rs");
    let mut file = fs::File::create(&dest_path)?;

    writeln!(file, "// Empty embedded data (prompts directory not found)")?;
    writeln!(file, "use std::collections::HashMap;")?;
    writeln!(file, "use std::sync::LazyLock;")?;
    writeln!(file)?;
    writeln!(file, "pub static EMBEDDED_PROMPTS: LazyLock<HashMap<&'static str, &'static str>> = LazyLock::new(|| HashMap::new());")?;
    writeln!(
        file,
        "pub fn get_embedded_prompt(_prompt_name: &str) -> Option<&'static str> {{ None }}"
    )?;
    writeln!(
        file,
        "pub fn get_all_embedded_prompt_names() -> Vec<&'static str> {{ Vec::new() }}"
    )?;

    Ok(())
}
