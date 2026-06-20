pub const GOAL_EXTRACTION_INSTRUCTION_VERSION: &str = "goal-extraction-2026-06-20";
pub const GOAL_JUDGE_INSTRUCTION_VERSION: &str = "goal-judge-2026-06-20";

pub const GOAL_EXTRACTION_INSTRUCTION: &str = r#"You are the goal extraction worker for Sparo.
Classify the current user input and, only when the user is explicitly asking for goal mode, compile a durable GoalContract from the conversation above plus the supplied raw input.

Rules:
- Resolve references ("the plan above", "this") against the conversation, and freeze the resolved objective into `contextResolution.frozenContextMarkdown`.
- Each success criterion must be concrete and checkable.
- Return ONLY one JSON object that matches the schema. No prose, no markdown fences.
- Do not execute the goal, edit files, or call tools.
- If the input is ordinary discussion, return intent.kind = "chat_only".
- If the request is too ambiguous to act on, return intent.kind = "ask_clarification" with questions."#;

pub const GOAL_JUDGE_INSTRUCTION: &str = r#"You are the goal judge for this session.
The work to evaluate is the conversation above (every prior turn, tool output, and diff is visible to you).

Decide whether the goal is DONE against its success criteria and required checks:
- Prefer evidence already visible in the conversation.
- If a criterion or required check cannot be confirmed from the conversation, USE YOUR TOOLS to inspect files or run the required checks, then judge.
- You are a reviewer: do NOT modify the workspace, do NOT edit files, do NOT continue the work yourself.
- Be strict: only return state "pass" when every required criterion is genuinely met.
- When not done, write `nextSteering` as a precise, actionable instruction for the executor's next turn (what to do, where, and why), and list concrete `remainingGaps`.
- Use state "needs_user" only when a real user decision/input is required; use "blocked" only when progress is impossible without intervention.

After any inspection, return ONLY one JSON object that matches the schema as your final message. No prose, no markdown fences."#;

pub fn extraction_output_schema() -> String {
    r#"Return GoalExtractionResult JSON (camelCase). Use these exact shapes:
{
  "extractionId": "<echo the provided extractionId>",
  "parentSessionId": "<echo>",
  "triggerTurnId": "<echo>",
  "intent": {
    "kind": "chat_only | create_goal | update_goal | apply_guidance | query_goal | control_goal | ask_clarification",
    "confidence": 0.0,
    "rawTrigger": "string",
    "targetGoalId": null,
    "controlAction": null,
    "reasonSummary": "string",
    "clarificationQuestions": []
  },
  "contextResolution": {
    "resolvedObjective": "string",
    "frozenContextMarkdown": "string",
    "confidence": 0.0,
    "ambiguityQuestions": []
  },
  "contract": {
    "rawTrigger": "string",
    "resolvedObjective": "string",
    "successCriteria": [
      { "id": "criterion-1", "description": "string", "required": true }
    ],
    "requiredChecks": [
      { "id": "check-1", "description": "string", "command": "optional shell command or null" }
    ],
    "nonGoals": [],
    "constraints": [],
    "riskLevel": "low | medium | high"
  },
  "confidence": 0.0,
  "warnings": []
}
Set contextResolution and contract to null when intent.kind is chat_only / query_goal / control_goal / ask_clarification."#
        .to_string()
}

pub fn judge_output_schema() -> String {
    r#"Return GoalVerdict JSON (camelCase). Use these exact shapes:
{
  "state": "pass | continue | needs_user | blocked",
  "summary": "one or two sentences on the current state of the goal",
  "criteria": [
    { "id": "criterion-1", "met": true, "note": "why it is or isn't met" }
  ],
  "remainingGaps": ["plain-text gap description", "another gap"],
  "nextSteering": "precise next-turn instruction for the executor (empty when state is pass)",
  "userQuestion": null,
  "confidence": 0.0
}"#
    .to_string()
}
