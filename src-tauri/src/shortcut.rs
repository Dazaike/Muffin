//! The OS-wide `Ctrl+Alt+M` show/hide shortcut.

use tauri::{AppHandle, Runtime};
use tauri_plugin_global_shortcut::{
    Builder, Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
};

use crate::error::{AppError, Result};
use crate::tray::toggle_main_window;

fn shortcut() -> Shortcut {
    Shortcut::new(Some(Modifiers::CONTROL | Modifiers::ALT), Code::KeyM)
}

/// The plugin with its single handler; the shortcut itself is (un)registered by [`set_enabled`].
pub fn plugin<R: Runtime>() -> tauri::plugin::TauriPlugin<R> {
    Builder::new()
        .with_handler(|app, _shortcut, event| {
            if event.state() == ShortcutState::Pressed {
                toggle_main_window(app);
            }
        })
        .build()
}

pub fn set_enabled<R: Runtime>(app: &AppHandle<R>, enabled: bool) -> Result<()> {
    let gs = app.global_shortcut();
    let registered = gs.is_registered(shortcut());
    if enabled && !registered {
        gs.register(shortcut()).map_err(|_| {
            AppError::invalid("Couldn't register Ctrl+Alt+M — another app is probably using it")
        })?;
    } else if !enabled && registered {
        gs.unregister(shortcut())
            .map_err(|e| AppError::invalid(format!("Couldn't unregister Ctrl+Alt+M: {e}")))?;
    }
    Ok(())
}
