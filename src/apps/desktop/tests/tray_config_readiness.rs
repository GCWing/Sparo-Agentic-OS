use sparo_desktop_lib::bootstrap::{AppContainer, BootController};

#[test]
fn tray_config_dependency_is_unavailable_before_stage_c_publishes_it() {
    let container = AppContainer::new(BootController::new());

    assert!(container.config_service().is_none());
}
