use super::model::{GoalCriterionVerdict, GoalVerdict, GoalVerdictState};
use crate::error::{CoreError, CoreResult};
use serde::de::DeserializeOwned;
use serde_json::Value;

pub struct GoalStructuredOutputParser;

impl GoalStructuredOutputParser {
    /// Strict-ish parse used for the extraction contract. Extracts the first
    /// balanced JSON object from `text`, then deserializes it.
    pub fn parse_json<T: DeserializeOwned>(text: &str, label: &str) -> CoreResult<T> {
        let value = Self::extract_json_value(text).ok_or_else(|| {
            CoreError::validation(format!("{} output did not contain a JSON object", label))
        })?;
        serde_json::from_value(value).map_err(|error| {
            CoreError::validation(format!("Failed to parse {} JSON: {}", label, error))
        })
    }

    /// Extract the first balanced JSON object as a [`Value`].
    pub fn extract_json_value(text: &str) -> Option<Value> {
        let trimmed = text.trim();
        if trimmed.is_empty() {
            return None;
        }
        let json_text = if trimmed.starts_with('{') {
            trimmed.to_string()
        } else {
            Self::extract_json_object(trimmed)?
        };
        serde_json::from_str(&json_text).ok()
    }

    /// Tolerant verdict extraction.
    ///
    /// Models drift on structured output (string-vs-object refs, synonym verdict
    /// labels, snake/camel keys). Rather than reject a semantically-correct
    /// verdict on a type mismatch, we read each field defensively from the raw
    /// JSON value. Returns `None` only when no JSON object or no recognizable
    /// state can be found (the loop then re-asks).
    pub fn parse_verdict_loose(text: &str) -> Option<GoalVerdict> {
        let value = Self::extract_json_value(text)?;
        let obj = value.as_object()?;

        if Self::has_any_key(
            obj,
            &[
                "nextSteering",
                "next_steering",
                "steering",
                "displayText",
                "instructions",
            ],
        ) {
            return None;
        }

        let state = Self::read_state(obj)?;
        let summary =
            Self::read_string(obj, &["summary", "reasonSummary", "reason"]).unwrap_or_default();
        let user_question = Self::read_string(obj, &["userQuestion", "user_question", "question"]);
        let confidence = Self::read_f32(obj, &["confidence"]).unwrap_or(0.7);
        let criteria = Self::read_criteria(obj);
        let remaining_gaps = Self::read_gaps(obj);

        Some(GoalVerdict {
            state,
            summary,
            criteria,
            remaining_gaps,
            user_question,
            confidence,
        })
    }

    fn read_state(obj: &serde_json::Map<String, Value>) -> Option<GoalVerdictState> {
        let raw = obj
            .get("state")
            .or_else(|| obj.get("verdict"))
            .or_else(|| obj.get("decision"))
            .and_then(Value::as_str)?
            .trim()
            .to_ascii_lowercase();
        let normalized = raw.replace([' ', '-'], "_");
        let state = match normalized.as_str() {
            "pass" | "passed" | "complete" | "completed" | "done" | "success" | "approved" => {
                GoalVerdictState::Pass
            }
            "continue" | "needs_revision" | "revise" | "in_progress" | "not_done"
            | "incomplete" | "continue_work" => GoalVerdictState::Continue,
            "needs_user" | "ask_user" | "needs_clarification" | "waiting_user" | "user" => {
                GoalVerdictState::NeedsUser
            }
            "blocked" | "stuck" | "blocker" | "fail" | "failed" => GoalVerdictState::Blocked,
            _ => return None,
        };
        Some(state)
    }

    fn read_criteria(obj: &serde_json::Map<String, Value>) -> Vec<GoalCriterionVerdict> {
        let Some(items) = obj
            .get("criteria")
            .or_else(|| obj.get("criteriaResults"))
            .or_else(|| obj.get("criteria_results"))
            .and_then(Value::as_array)
        else {
            return Vec::new();
        };
        items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => Some(GoalCriterionVerdict {
                    id: text.trim().to_string(),
                    met: false,
                    note: String::new(),
                }),
                Value::Object(map) => {
                    let id = Self::read_string(map, &["id", "criterionId", "criterion_id"])
                        .unwrap_or_else(|| "criterion".to_string());
                    let met = Self::read_bool_met(map);
                    let note = Self::read_string(map, &["note", "evidence", "reason", "summary"])
                        .unwrap_or_default();
                    Some(GoalCriterionVerdict { id, met, note })
                }
                _ => None,
            })
            .collect()
    }

    fn read_bool_met(map: &serde_json::Map<String, Value>) -> bool {
        if let Some(met) = map.get("met").and_then(Value::as_bool) {
            return met;
        }
        if let Some(status) = map
            .get("status")
            .or_else(|| map.get("result"))
            .and_then(Value::as_str)
        {
            return matches!(
                status.trim().to_ascii_lowercase().as_str(),
                "passed" | "pass" | "met" | "satisfied" | "true" | "ok"
            );
        }
        false
    }

    fn read_gaps(obj: &serde_json::Map<String, Value>) -> Vec<String> {
        let Some(items) = obj
            .get("remainingGaps")
            .or_else(|| obj.get("remaining_gaps"))
            .or_else(|| obj.get("gaps"))
            .and_then(Value::as_array)
        else {
            return Vec::new();
        };
        items
            .iter()
            .filter_map(|item| match item {
                Value::String(text) => Some(text.trim().to_string()),
                Value::Object(map) => {
                    Self::read_string(map, &["description", "summary", "note", "gap"])
                }
                _ => None,
            })
            .filter(|text| !text.is_empty())
            .collect()
    }

    fn read_string(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<String> {
        for key in keys {
            if let Some(text) = map.get(*key).and_then(Value::as_str) {
                let trimmed = text.trim();
                if !trimmed.is_empty() {
                    return Some(trimmed.to_string());
                }
            }
        }
        None
    }

    fn has_any_key(map: &serde_json::Map<String, Value>, keys: &[&str]) -> bool {
        keys.iter().any(|key| map.contains_key(*key))
    }

    fn read_f32(map: &serde_json::Map<String, Value>, keys: &[&str]) -> Option<f32> {
        for key in keys {
            if let Some(number) = map.get(*key).and_then(Value::as_f64) {
                return Some(number as f32);
            }
        }
        None
    }

    fn extract_json_object(text: &str) -> Option<String> {
        let start = text.find('{')?;
        let mut depth = 0_i32;
        let mut in_string = false;
        let mut escaped = false;
        for (offset, ch) in text[start..].char_indices() {
            if escaped {
                escaped = false;
                continue;
            }
            if ch == '\\' && in_string {
                escaped = true;
                continue;
            }
            if ch == '"' {
                in_string = !in_string;
                continue;
            }
            if in_string {
                continue;
            }
            match ch {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        return Some(text[start..=start + offset].to_string());
                    }
                }
                _ => {}
            }
        }
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::agentic::goal::model::GoalVerdictState;
    use serde::Deserialize;

    #[derive(Deserialize)]
    struct Tiny {
        value: String,
    }

    #[test]
    fn parser_extracts_json_from_text() {
        let parsed: Tiny =
            GoalStructuredOutputParser::parse_json("prefix {\"value\":\"ok\"} suffix", "tiny")
                .expect("json");
        assert_eq!(parsed.value, "ok");
    }

    #[test]
    fn verdict_loose_accepts_synonyms_and_string_refs() {
        let text = r#"Here is my verdict:
        {
          "verdict": "completed",
          "summary": "All good",
          "criteria": ["c1", {"id": "c2", "status": "passed"}],
          "remainingGaps": ["nothing", {"description": "tidy up"}],
          "confidence": 0.9
        }"#;
        let verdict = GoalStructuredOutputParser::parse_verdict_loose(text).expect("verdict");
        assert_eq!(verdict.state, GoalVerdictState::Pass);
        assert_eq!(verdict.criteria.len(), 2);
        assert!(verdict.criteria[1].met);
        assert_eq!(verdict.remaining_gaps.len(), 2);
    }

    #[test]
    fn verdict_loose_rejects_next_action_fields() {
        let text = r#"{
          "state": "continue",
          "summary": "Still incomplete",
          "remainingGaps": ["missing evidence"],
          "nextSteering": "inspect the file",
          "confidence": 0.9
        }"#;
        assert!(GoalStructuredOutputParser::parse_verdict_loose(text).is_none());
    }

    #[test]
    fn verdict_loose_returns_none_without_state() {
        assert!(GoalStructuredOutputParser::parse_verdict_loose("no json here").is_none());
        assert!(GoalStructuredOutputParser::parse_verdict_loose("{\"foo\": 1}").is_none());
    }
}
