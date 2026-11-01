mod after_launch;
mod account;
mod background;
mod continue_sync;
mod db;
mod error;
mod economy;
mod favorites_sync;
mod playtime;
mod transfer;
mod games_extra;
mod launch;
mod notifier;
mod roblox_api;
mod rbx_session;
mod shortcut;
mod social;
mod store;
mod tray;

use tauri::{Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_autostart::MacosLauncher;
use tauri_plugin_window_state::StateFlags;

use crate::db::Db;
use crate::error::{AppError, Result};

/// True when launched with `--minimized` and the `startMinimized` setting is on.
struct StartHidden(bool);

/// Called once by the frontend after first paint; shows the window (created hidden to avoid a
/// white flash) unless the app was started minimized to the tray.
#[tauri::command(async)]
fn app_ready(window: WebviewWindow, start_hidden: State<'_, StartHidden>) -> Result<()> {
    if start_hidden.0 {
        return Ok(());
    }
    window
        .show()
        .and_then(|_| window.set_focus())
        .map_err(|e| AppError::new(error::ErrorCode::LaunchFailed, format!("Couldn't show the window: {e}")))
}

fn close_to_tray(db: &Db) -> bool {
    db.with(|c| db::setting_get(c, "closeBehavior"))
        .ok()
        .flatten()
        .is_some_and(|v| v.as_str() == Some("tray"))
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            tray::show_main_window(app);
        }))
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Visibility is owned by `app_ready` / the tray, not restored from disk.
                .with_state_flags(StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED)
                .build(),
        )
        .plugin(shortcut::plugin())
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let handle = app.handle().clone();
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let database = Db::open(&dir.join("muffin.db"))?;

            let minimized_arg = std::env::args().any(|a| a == "--minimized");
            let (start_minimized, shortcut_enabled) = database.with(|c| {
                Ok((
                    db::setting_bool(c, "startMinimized", false),
                    db::setting_bool(c, "globalShortcut", true),
                ))
            })?;

            app.manage(database);
            app.manage(roblox_api::build_client()?);
            app.manage(account::AccountState::default());
            app.manage(StartHidden(minimized_arg && start_minimized));

            tray::setup(&handle)?;
            if shortcut_enabled {
                if let Err(e) = shortcut::set_enabled(&handle, true) {
                    eprintln!("muffin: {e}");
                }
            }
            account::spawn_migration(&handle);
            notifier::start(&handle);
            playtime::init(&handle);
            transfer::init(&handle);
            favorites_sync::init(&handle);
            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() != "main" {
                return;
            }
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.try_state::<Db>().is_some_and(|db| close_to_tray(&db)) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            app_ready,
            // -- custom app background image
            background::background_pick,
            background::background_info,
            background::background_read,
            background::background_clear,
            roblox_api::rbx_get,
            launch::roblox_status,
            launch::launch_experience,
            // -- games (server browser, votes, badges, social links, external links)
            launch::launch_instance,
            games_extra::game_vote_state,
            games_extra::game_vote,
            games_extra::badges_awarded,
            games_extra::game_social_links,
            games_extra::game_recommendations,
            games_extra::game_passes_session,
            games_extra::open_external,
            launch::launch_private_server,
            launch::add_private_server,
            launch::list_private_servers,
            launch::rename_private_server,
            launch::remove_private_server,
            store::library_list,
            store::library_upsert,
            store::library_remove,
            store::library_set_flags,
            store::library_reorder,
            store::history_list,
            store::history_clear,
            store::searches_list,
            store::searches_add,
            store::searches_remove,
            store::searches_clear,
            store::settings_get_all,
            store::settings_set,
            store::cache_clear,
            store::data_summary,
            account::account_add,
            account::accounts_list,
            account::account_switch,
            account::account_remove,
            account::account_status,
            account::account_sign_out,
            account::account_data,
            // -- playtime, import/export, Roblox favorites import
            playtime::playtime_summary,
            playtime::playtime_sessions,
            playtime::playtime_clear,
            playtime::playtime_state,
            transfer::export_data,
            transfer::import_pick,
            transfer::import_apply,
            transfer::import_discard,
            favorites_sync::sync_roblox_favorites,
            favorites_sync::apply_roblox_favorites,
            continue_sync::roblox_continue,
            // -- background notifications
            notifier::notifier_status,
            // -- social (friends, presence, follow graph, user search, join friend)
            social::friends_list,
            social::friends_presence,
            social::friend_requests,
            social::friend_requests_count,
            social::follow_list,
            social::user_search,
            social::friend_action,
            social::join_friend,
            // -- economy: Robux history + private servers
            economy::economy_balance,
            economy::economy_transactions,
            economy::private_server_settings,
            economy::private_servers_owned,
            economy::private_server_detail,
            economy::private_server_rename,
            economy::private_server_regenerate_link,
            economy::private_server_set_active,
            economy::private_server_cancel_subscription,
            economy::private_server_purchase,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Muffin");
}
