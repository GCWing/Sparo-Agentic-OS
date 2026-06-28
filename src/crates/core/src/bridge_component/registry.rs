use super::BridgeComponentPackage;
use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Default)]
pub struct BridgeComponentRegistry {
    packages: RwLock<HashMap<String, BridgeComponentPackage>>,
}

impl BridgeComponentRegistry {
    pub fn register(&self, package: BridgeComponentPackage) {
        if let Ok(mut packages) = self.packages.write() {
            packages.insert(package.manifest.id.clone(), package);
        }
    }

    pub fn get(&self, app_id: &str) -> Option<BridgeComponentPackage> {
        self.packages
            .read()
            .ok()
            .and_then(|packages| packages.get(app_id).cloned())
    }

    pub fn list(&self) -> Vec<BridgeComponentPackage> {
        self.packages
            .read()
            .map(|packages| packages.values().cloned().collect())
            .unwrap_or_default()
    }
}
