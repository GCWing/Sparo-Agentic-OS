use super::BridgeAppPackage;
use std::collections::HashMap;
use std::sync::RwLock;

#[derive(Default)]
pub struct BridgeAppRegistry {
    packages: RwLock<HashMap<String, BridgeAppPackage>>,
}

impl BridgeAppRegistry {
    pub fn register(&self, package: BridgeAppPackage) {
        if let Ok(mut packages) = self.packages.write() {
            packages.insert(package.manifest.id.clone(), package);
        }
    }

    pub fn get(&self, app_id: &str) -> Option<BridgeAppPackage> {
        self.packages
            .read()
            .ok()
            .and_then(|packages| packages.get(app_id).cloned())
    }

    pub fn list(&self) -> Vec<BridgeAppPackage> {
        self.packages
            .read()
            .map(|packages| packages.values().cloned().collect())
            .unwrap_or_default()
    }
}
