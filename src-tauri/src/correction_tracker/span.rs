use chrono::Utc;
use serde::{Deserialize, Serialize};
use specta::Type;

/// How the text was inserted into the target field.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "snake_case")]
pub enum InsertionMethod {
    Clipboard,
    DirectType,
    ExternalScript,
}

/// Tracks what text was inserted into a target field so we can later
/// diff against the user's edits.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
pub struct InsertedSpan {
    pub id: String,
    pub app_identifier: Option<String>,
    pub app_name: Option<String>,
    pub timestamp: i64,
    pub inserted_text: String,
    pub prefix_context: Option<String>,
    pub suffix_context: Option<String>,
    pub insertion_method: InsertionMethod,
}

impl InsertedSpan {
    /// Create a new InsertedSpan with the given text and app info.
    pub fn new(
        inserted_text: String,
        app_identifier: Option<String>,
        app_name: Option<String>,
        insertion_method: InsertionMethod,
    ) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            app_identifier,
            app_name,
            timestamp: Utc::now().timestamp(),
            inserted_text,
            prefix_context: None,
            suffix_context: None,
            insertion_method,
        }
    }
}
