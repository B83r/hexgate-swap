use std::process::{Child, Command};
use std::sync::Mutex;

#[cfg(windows)]
use std::os::windows::process::CommandExt;

use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{Manager, WindowEvent};

const SWITCHER_PORT: &str = "8722";
/// Racine du projet Python en développement uniquement (module `switcher/`).
/// En release, le backend est un sidecar packagé PyInstaller **onedir** (voir
/// `tools/build-sidecar.ps1`) : un dossier `hexgate-backend/` (exe +
/// `_internal/`) embarqué comme resource Tauri plutôt que via `externalBin`
/// (qui ne gère qu'un binaire plat) — le passage de `--onefile` à `--onedir`
/// le 17/09/2026 a supprimé la ré-extraction du runtime Python à chaque
/// lancement (~2 s mesurées), seule façon de rendre le démarrage instantané.
/// On spawn donc directement via `std::process::Command`, plus besoin de
/// `tauri_plugin_shell` (qui ne servait qu'à ça).
#[cfg(debug_assertions)]
const SWITCHER_DIR: &str = r"C:\Users\yaniss\hexgate-swap-v2\backend";

/// Empêche Windows d'allouer une console visible pour le processus enfant.
#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

struct SidecarState(Mutex<Option<Child>>);

#[cfg(debug_assertions)]
fn spawn_sidecar(_app: &tauri::AppHandle) -> Option<Child> {
    let mut cmd = Command::new("python");
    cmd.args(["-m", "switcher.server", SWITCHER_PORT])
        .current_dir(SWITCHER_DIR);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
        .map_err(|e| eprintln!("Impossible de démarrer le moteur switcher (dev) : {e}"))
        .ok()
}

#[cfg(not(debug_assertions))]
fn spawn_sidecar(app: &tauri::AppHandle) -> Option<Child> {
    let resource_dir = match app.path().resource_dir() {
        Ok(dir) => dir,
        Err(e) => {
            eprintln!("Répertoire de ressources introuvable : {e}");
            return None;
        }
    };
    // resource_dir() renvoie la racine de l'install ($INSTDIR), PAS
    // $INSTDIR\resources\ : constat direct le 17/09/2026 (le premier essai,
    // sans le segment "resources", donnait "os error 3 : chemin introuvable").
    let exe = resource_dir
        .join("resources")
        .join("hexgate-backend")
        .join("hexgate-backend.exe");
    let mut cmd = Command::new(&exe);
    cmd.args([SWITCHER_PORT]);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
        .map_err(|e| eprintln!("Impossible de démarrer le moteur switcher ({}) : {e}", exe.display()))
        .ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(windows)]
    std::env::set_var(
        "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS",
        "--renderer-process-limit=1 --js-flags=\"--max-old-space-size=128\"",
    );

    tauri::Builder::default()
        // Doit rester le premier plugin : une seconde invocation réveille la
        // fenêtre existante sans démarrer un second moteur Python.
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            show_main_window(app);
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_autostart::init(tauri_plugin_autostart::MacosLauncher::LaunchAgent, Some(vec!["--minimized"])))
        .manage(SidecarState(Mutex::new(None)))
        .setup(|app| {
            if let Some(state) = app.try_state::<SidecarState>() {
                *state.0.lock().unwrap() = spawn_sidecar(app.handle());
            }
            let open_item = MenuItem::with_id(app, "open", "Ouvrir Hexgate Swap", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&open_item, &quit_item])?;

            TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Hexgate Swap")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "open" => show_main_window(app),
                    "quit" => {
                        kill_sidecar(app);
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let tauri::tray::TrayIconEvent::Click {
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                     } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            let is_minimized = std::env::args().any(|arg| arg == "--minimized");
            if let Some(window) = app.get_webview_window("main") {
                window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(720.0, 600.0)))?;
                window.center()?;
                if !is_minimized {
                    window.show()?;
                    window.set_focus()?;
                }
            }

            Ok(())
        })
        .on_window_event(|window, event| {
            // La croix minimise vers le tray plutôt que de fermer l'application.
            if let WindowEvent::CloseRequested { api, .. } = event {
                window.hide().ok();
                api.prevent_close();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                kill_sidecar(app_handle);
            }
        });
}

fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        window.show().ok();
        window.unminimize().ok();
        window.set_focus().ok();
    }
}

fn kill_sidecar(app: &tauri::AppHandle) {
    if let Some(state) = app.try_state::<SidecarState>() {
        if let Some(mut child) = state.0.lock().unwrap().take() {
            child.kill().ok();
        }
    }
}
