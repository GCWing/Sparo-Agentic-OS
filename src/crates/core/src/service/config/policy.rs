//! Trusted configuration write policy.

use super::catalog::{SettingDescriptor, SettingMutability, SettingRisk, SettingSensitivity};
use crate::error::{CoreError, CoreResult};
use serde_json::Value;
use sparo_events::{ConfigApplyStrategy, ConfigChangeSourceKind};

pub(crate) fn validate_write(
    descriptor: &SettingDescriptor,
    value: &Value,
    source: ConfigChangeSourceKind,
) -> CoreResult<()> {
    validate_write_access(descriptor, source)?;
    validate_schema(&descriptor.value_schema, value).map_err(|message| {
        CoreError::validation(format!(
            "Invalid value for setting '{}': {message}",
            descriptor.id
        ))
    })
}

/// Validates removal of a dynamic leaf that is absent from the candidate.
/// The access policy still applies, but there is no replacement value to
/// validate against the removed leaf's schema.
pub(crate) fn validate_delete(
    descriptor: &SettingDescriptor,
    source: ConfigChangeSourceKind,
) -> CoreResult<()> {
    validate_write_access(descriptor, source)
}

fn validate_write_access(
    descriptor: &SettingDescriptor,
    source: ConfigChangeSourceKind,
) -> CoreResult<()> {
    if descriptor.policy.mutability == SettingMutability::ReadOnly {
        return Err(CoreError::validation(format!(
            "Setting '{}' is read-only",
            descriptor.id
        )));
    }
    if descriptor.policy.risk == SettingRisk::Destructive {
        return Err(CoreError::validation(format!(
            "Setting '{}' requires a dedicated destructive action",
            descriptor.id
        )));
    }
    if source == ConfigChangeSourceKind::Ai
        && (descriptor.policy.sensitivity == SettingSensitivity::Secret
            || descriptor.policy.apply_strategy == ConfigApplyStrategy::ManualOnly
            || !descriptor.ai.writable)
    {
        return Err(CoreError::validation(format!(
            "Setting '{}' cannot be written by AI",
            descriptor.id
        )));
    }
    Ok(())
}

pub(crate) fn requires_confirmation(descriptor: &SettingDescriptor) -> bool {
    descriptor.policy.risk >= SettingRisk::Elevated
        || descriptor.policy.sensitivity == SettingSensitivity::Secret
        || descriptor.policy.apply_strategy == ConfigApplyStrategy::ManualOnly
}

fn validate_schema(schema: &Value, value: &Value) -> Result<(), String> {
    validate_schema_at(schema, value, "$")
}

fn validate_schema_at(schema: &Value, value: &Value, path: &str) -> Result<(), String> {
    match schema {
        Value::Bool(true) => return Ok(()),
        Value::Bool(false) => return Err(format!("{path} is rejected by the declared schema")),
        Value::Object(_) => {}
        _ => return Err("Trusted setting schema must be a JSON object or boolean".to_string()),
    }

    // `nullable` is the normalized representation used by the Catalog for
    // `Option<T>`. It must be handled before `const`/`enum`; otherwise a null
    // value accepted by the original union would be rejected by the non-null
    // branch's constraints.
    if value.is_null() && schema.get("nullable").and_then(Value::as_bool) == Some(true) {
        return Ok(());
    }

    if let Some(expected) = schema.get("const") {
        if value != expected {
            return Err(format!("{path} must equal the declared constant"));
        }
    }
    if let Some(allowed) = schema.get("enum").and_then(Value::as_array) {
        if !allowed.contains(value) {
            return Err(format!("{path} is not in the allowed set"));
        }
    }
    if let Some(branches) = schema.get("allOf").and_then(Value::as_array) {
        for branch in branches {
            validate_schema_at(branch, value, path)?;
        }
    }
    if let Some(branches) = schema.get("anyOf").and_then(Value::as_array) {
        if !branches
            .iter()
            .any(|branch| validate_schema_at(branch, value, path).is_ok())
        {
            return Err(format!("{path} does not match any allowed schema"));
        }
    }
    if let Some(branches) = schema.get("oneOf").and_then(Value::as_array) {
        let matches = branches
            .iter()
            .filter(|branch| validate_schema_at(branch, value, path).is_ok())
            .count();
        if matches != 1 {
            return Err(format!("{path} must match exactly one allowed schema"));
        }
    }

    if let Some(expected) = schema.get("type") {
        let expected_types = match expected {
            Value::String(expected) => vec![expected.as_str()],
            Value::Array(expected) => expected
                .iter()
                .map(|value| {
                    value.as_str().ok_or_else(|| {
                        "Trusted setting schema contains a non-string type".to_string()
                    })
                })
                .collect::<Result<Vec<_>, _>>()?,
            _ => return Err("Trusted setting schema contains an invalid type".to_string()),
        };
        let valid = expected_types
            .iter()
            .any(|expected| value_matches_type(value, expected));
        if !valid {
            return Err(format!(
                "{path}: expected {}, received {}",
                expected_types.join(" or "),
                value_kind(value)
            ));
        }
    }

    if let Some(minimum) = schema.get("minimum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|candidate| candidate < minimum) {
            return Err(format!("{path} must be at least {minimum}"));
        }
    }
    if let Some(maximum) = schema.get("maximum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|candidate| candidate > maximum) {
            return Err(format!("{path} must be at most {maximum}"));
        }
    }
    if let Some(minimum) = schema.get("exclusiveMinimum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|candidate| candidate <= minimum) {
            return Err(format!("{path} must be greater than {minimum}"));
        }
    }
    if let Some(maximum) = schema.get("exclusiveMaximum").and_then(Value::as_f64) {
        if value.as_f64().is_some_and(|candidate| candidate >= maximum) {
            return Err(format!("{path} must be less than {maximum}"));
        }
    }

    if let Some(text) = value.as_str() {
        let length = text.chars().count() as u64;
        if schema
            .get("minLength")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| length < minimum)
        {
            return Err(format!("{path} is shorter than the declared minimum"));
        }
        if schema
            .get("maxLength")
            .and_then(Value::as_u64)
            .is_some_and(|maximum| length > maximum)
        {
            return Err(format!("{path} is longer than the declared maximum"));
        }
        if let Some(pattern) = schema.get("pattern").and_then(Value::as_str) {
            let pattern = regex::Regex::new(pattern)
                .map_err(|error| format!("Invalid trusted schema pattern: {error}"))?;
            if !pattern.is_match(text) {
                return Err(format!("{path} does not match the declared pattern"));
            }
        }
    }

    if let Some(items) = value.as_array() {
        if schema
            .get("minItems")
            .and_then(Value::as_u64)
            .is_some_and(|minimum| items.len() < minimum as usize)
        {
            return Err(format!("{path} contains too few items"));
        }
        if schema
            .get("maxItems")
            .and_then(Value::as_u64)
            .is_some_and(|maximum| items.len() > maximum as usize)
        {
            return Err(format!("{path} contains too many items"));
        }
        if schema.get("uniqueItems").and_then(Value::as_bool) == Some(true) {
            for (index, item) in items.iter().enumerate() {
                if items[..index].contains(item) {
                    return Err(format!("{path} contains duplicate items"));
                }
            }
        }
        if let Some(item_schema) = schema.get("items") {
            for (index, item) in items.iter().enumerate() {
                validate_schema_at(item_schema, item, &format!("{path}[{index}]"))?;
            }
        }
    }

    if let Some(object) = value.as_object() {
        let properties = schema.get("properties").and_then(Value::as_object);
        if let Some(required) = schema.get("required").and_then(Value::as_array) {
            for name in required.iter().filter_map(Value::as_str) {
                if !object.contains_key(name) {
                    return Err(format!("{path}.{name} is required"));
                }
            }
        }
        for (name, child) in object {
            if let Some(child_schema) = properties.and_then(|properties| properties.get(name)) {
                validate_schema_at(child_schema, child, &format!("{path}.{name}"))?;
                continue;
            }
            match schema.get("additionalProperties") {
                Some(Value::Bool(false)) => {
                    return Err(format!("{path}.{name} is not a declared property"));
                }
                Some(additional_schema @ Value::Object(_)) => {
                    validate_schema_at(additional_schema, child, &format!("{path}.{name}"))?;
                }
                _ => {}
            }
        }
    }
    Ok(())
}

fn value_kind(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "boolean",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

fn value_matches_type(value: &Value, expected: &str) -> bool {
    match expected {
        "boolean" => value.is_boolean(),
        "string" => value.is_string(),
        "integer" => value.as_i64().is_some() || value.as_u64().is_some(),
        "number" => value.is_number(),
        "array" => value.is_array(),
        "null" => value.is_null(),
        "object" => value.is_object(),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::service::config::catalog::ConfigCatalog;
    use crate::service::config::types::{AIModelConfig, GlobalConfig};

    #[test]
    fn nullable_scalar_accepts_null_and_enforces_its_non_null_type() {
        let defaults = serde_json::json!({
            "ai": { "stream_idle_timeout_secs": null }
        });
        let catalog = ConfigCatalog::build(&defaults, &defaults).expect("catalog");
        let descriptor = catalog
            .find_by_path("ai.stream_idle_timeout_secs")
            .expect("timeout descriptor");

        validate_write(descriptor, &Value::Null, ConfigChangeSourceKind::Manual)
            .expect("null reset");
        validate_write(
            descriptor,
            &serde_json::json!(30),
            ConfigChangeSourceKind::Manual,
        )
        .expect("number write");
        assert!(validate_write(
            descriptor,
            &Value::String("30".to_string()),
            ConfigChangeSourceKind::Manual,
        )
        .is_err());
    }

    #[test]
    fn ai_models_recursively_enforce_required_and_declared_fields() {
        let config = serde_json::to_value(GlobalConfig::default()).expect("serialize config");
        let catalog = ConfigCatalog::build(&config, &config).expect("catalog");
        let descriptor = catalog
            .find_by_path("ai.models")
            .expect("models descriptor");
        let mut model = serde_json::to_value(AIModelConfig {
            metadata: Some(serde_json::json!("opaque provider metadata")),
            ..AIModelConfig::default()
        })
        .expect("serialize model");

        validate_write(
            descriptor,
            &Value::Array(vec![model.clone()]),
            ConfigChangeSourceKind::Manual,
        )
        .expect("valid model list");

        let mut omitted_optional_metadata = model.clone();
        omitted_optional_metadata
            .as_object_mut()
            .expect("model object")
            .remove("metadata");
        validate_write(
            descriptor,
            &Value::Array(vec![omitted_optional_metadata]),
            ConfigChangeSourceKind::Manual,
        )
        .expect("optional nested fields may remain omitted");

        let mut unknown_auth_field = model.clone();
        unknown_auth_field["auth"]
            .as_object_mut()
            .expect("auth object")
            .insert("legacy_field".to_string(), Value::Bool(true));
        assert!(validate_write(
            descriptor,
            &Value::Array(vec![unknown_auth_field]),
            ConfigChangeSourceKind::Manual,
        )
        .is_err());

        model
            .as_object_mut()
            .expect("model object")
            .remove("reasoning_mode");
        let missing_required = validate_write(
            descriptor,
            &Value::Array(vec![model.clone()]),
            ConfigChangeSourceKind::Manual,
        )
        .expect_err("missing nested required field must fail");
        assert!(missing_required.to_string().contains("reasoning_mode"));

        model
            .as_object_mut()
            .expect("model object")
            .insert("reasoning_mode".to_string(), serde_json::json!("default"));
        model
            .as_object_mut()
            .expect("model object")
            .insert("legacy_field".to_string(), Value::Bool(true));
        let unknown_field = validate_write(
            descriptor,
            &Value::Array(vec![model]),
            ConfigChangeSourceKind::Manual,
        )
        .expect_err("unknown nested field must fail");
        assert!(unknown_field.to_string().contains("legacy_field"));
    }

    #[test]
    fn boolean_json_schemas_follow_json_schema_semantics() {
        validate_schema(&Value::Bool(true), &serde_json::json!(["any", 1]))
            .expect("true schema accepts every JSON value");
        assert!(validate_schema(&Value::Bool(false), &Value::Null).is_err());
        validate_schema(
            &serde_json::json!({ "type": ["string", "null"] }),
            &Value::Null,
        )
        .expect("union type accepts a declared member");
        assert!(validate_schema(
            &serde_json::json!({ "type": ["string", "null"] }),
            &Value::Bool(true),
        )
        .is_err());
    }
}
