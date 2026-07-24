use include_dir::{include_dir, Dir};

pub(crate) static SYSTEM_PRODUCT_APP_BUNDLES: Dir<'_> =
    include_dir!("$SPARO_EMBEDDED_PRODUCT_APPS_DIR");
pub(crate) static SYSTEM_COMPONENT_BUNDLES: Dir<'_> =
    include_dir!("$CARGO_MANIFEST_DIR/../../../bundles/components");
