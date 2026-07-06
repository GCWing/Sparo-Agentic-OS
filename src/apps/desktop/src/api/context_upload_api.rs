//! Temporary Image Storage API

use serde::{Deserialize, Serialize};
use sparo_core::agentic::tools::image_context::{
    create_image_context_provider as create_core_image_context_provider, store_image_contexts,
    GlobalImageContextProvider, ImageContextData as CoreImageContextData,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ImageContextData {
    pub id: String,
    pub image_path: Option<String>,
    pub data_url: Option<String>,
    pub mime_type: String,
    pub image_name: String,
    pub file_size: usize,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub source: String,
}

impl From<ImageContextData> for CoreImageContextData {
    fn from(data: ImageContextData) -> Self {
        CoreImageContextData {
            id: data.id,
            image_path: data.image_path,
            data_url: data.data_url,
            mime_type: data.mime_type,
            image_name: data.image_name,
            file_size: data.file_size,
            width: data.width,
            height: data.height,
            source: data.source,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct UploadImageContextRequest {
    pub images: Vec<ImageContextData>,
}

#[tauri::command]
pub async fn upload_image_contexts(request: UploadImageContextRequest) -> Result<(), String> {
    let images: Vec<CoreImageContextData> = request.images.into_iter().map(Into::into).collect();
    store_image_contexts(images);
    Ok(())
}

pub fn create_image_context_provider() -> GlobalImageContextProvider {
    create_core_image_context_provider()
}
