use std::path::PathBuf;
use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::{Manager, RunEvent};

struct ServiceProcess(Mutex<Option<Child>>);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .setup(|app| {
            let core =
                PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../opencode/packages/opencode");
            let bun = std::env::var("LOCALAPPDATA")
                .map(|path| PathBuf::from(path).join("npm/bun.cmd"))
                .ok()
                .filter(|path| path.exists())
                .unwrap_or_else(|| PathBuf::from("bun"));
            let child = Command::new(bun)
                .args(["run", "algebrium", "--mock-provider"])
                .current_dir(core)
                .spawn()
                .map_err(|error| format!("无法启动 Algebrium 服务：{error}"))?;
            app.manage(ServiceProcess(Mutex::new(Some(child))));
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("failed to build Algebrium desktop application");

    app.run(|handle, event| {
        if !matches!(event, RunEvent::ExitRequested { .. } | RunEvent::Exit) {
            return;
        }
        if let Some(mut child) = handle.state::<ServiceProcess>().0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    });
}
