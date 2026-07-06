pub(crate) mod prompt;
mod service;
mod store;
mod types;

pub use service::{
    get_global_daily_letter_service, global_daily_letter_markdown_path,
    global_daily_letters_output_dir, install_global_daily_letter_service, DailyLetterService,
};
pub use types::{
    DailyLetterAgentOutput, DailyLetterAgentResult, DailyLetterAppOpportunity,
    DailyLetterApplyReceiptsRequest, DailyLetterAttemptStatus, DailyLetterContextPacket,
    DailyLetterContinuationCard, DailyLetterGenerateRequest,
    DailyLetterGetRequest, DailyLetterListRequest, DailyLetterPreview, DailyLetterReceiptAction,
    DailyLetterReceiptCandidate, DailyLetterReceiptStatus, DailyLetterRecord,
    DailyLetterRecordStatus, DailyLetterRunSummary, DailyLetterScope, DailyLetterSealRequest,
    DailyLetterSourceFragment, DailyLetterSourceFragmentType, DailyLetterSourceStats,
    DailyLetterState, DailyLetterTrigger, DailyLetterUpdateContinuationRequest,
    DailyLetterWorkspaceRef,
};
