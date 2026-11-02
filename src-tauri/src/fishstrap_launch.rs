//! "Hide Fishstrap": launch Roblox through `Fishstrap.exe <uri> -quiet` (no bootstrapper window) and
//! report what Fishstrap is doing by following its log file, so Muffin can show the same steps
//! (connecting, downloading, applying mods, starting) natively.
//!
//! Fishstrap logs one line per stage to `Logs\Fishstrap_<utc>.log`. `Tracker` turns those lines into
//! a `LaunchProgress` snapshot; `start_hidden` spawns Fishstrap and a watcher thread that feeds the
//! tracker and emits `fishstrap-launch` events.

use std::collections::HashSet;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter};

const EVENT: &str = "fishstrap-launch";
const POLL: Duration = Duration::from_millis(250);
/// Fishstrap writes its first log line within moments of starting.
const DISCOVERY_TIMEOUT: Duration = Duration::from_secs(30);
/// Downloading a fresh Roblox install can take a while on slow connections.
const WATCH_TIMEOUT: Duration = Duration::from_secs(20 * 60);
/// How long an updated Fishstrap gets to start writing its log after its predecessor exits. A
/// Fishstrap that can't create its log exits at once, so a longer wait would only hide a failure.
const HANDOFF_TIMEOUT: Duration = Duration::from_secs(10);
const STEPS: [&str; 5] = [
    "Connecting to Roblox",
    "Checking for updates",
    "Downloading Roblox",
    "Applying modifications",
    "Starting Roblox",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Phase {
    Running,
    Done,
    Failed,
    Cancelled,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum StepState {
    Pending,
    Active,
    Done,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Step {
    pub label: &'static str,
    pub state: StepState,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LaunchProgress {
    pub phase: Phase,
    /// One-line status: the active step, a Fishstrap update note, or the failure reason.
    pub message: String,
    pub steps: Vec<Step>,
    pub packages_downloaded: u32,
    pub downloaded_bytes: u64,
}

/// Incremental parser of Fishstrap log lines.
#[derive(Debug, Clone)]
pub struct Tracker {
    step: usize,
    phase: Phase,
    updating_fishstrap: bool,
    /// `-upgrade` relaunch started (see `watch`) …
    handoff: bool,
    /// … and the old process has exited.
    handoff_done: bool,
    notice: Option<String>,
    failure: Option<String>,
    packages: u32,
    bytes: u64,
}

/// `2026-10-30T18:58:30Z [Bootstrapper::Run] Running bootstrapper` → (`Bootstrapper::Run`, `Running bootstrapper`).
fn split_line(line: &str) -> Option<(&str, &str)> {
    let open = line.find('[')?;
    let close = open + line[open..].find(']')?;
    Some((&line[open + 1..close], line[close + 1..].trim()))
}

/// `Finished downloading! (1234 bytes total)` → 1234.
fn downloaded_bytes(msg: &str) -> Option<u64> {
    let rest = msg.strip_prefix("Finished downloading!")?;
    let inner = rest.trim().strip_prefix('(')?;
    inner.split_whitespace().next()?.parse().ok()
}

impl Tracker {
    pub fn new() -> Self {
        Self {
            step: 0,
            phase: Phase::Running,
            updating_fishstrap: false,
            handoff: false,
            handoff_done: false,
            notice: None,
            failure: None,
            packages: 0,
            bytes: 0,
        }
    }

    pub fn phase(&self) -> Phase {
        self.phase
    }

    /// Fishstrap started an updated copy of itself and exited; that copy continues the launch.
    pub fn awaiting_handoff(&self) -> bool {
        self.phase == Phase::Running && self.handoff_done
    }

    /// A new Fishstrap process (or log) is now being followed.
    pub fn resume(&mut self) {
        self.handoff = false;
        self.handoff_done = false;
        self.updating_fishstrap = false;
    }

    fn advance(&mut self, to: usize) -> bool {
        if self.phase != Phase::Running || to <= self.step {
            return false;
        }
        self.step = to;
        true
    }

    fn fail(&mut self, message: String) -> bool {
        if self.phase != Phase::Running {
            return false;
        }
        self.phase = Phase::Failed;
        self.failure = Some(message);
        true
    }

    /// Feeds one log line; returns whether the snapshot changed.
    pub fn feed(&mut self, line: &str) -> bool {
        let Some((ident, msg)) = split_line(line) else { return false };
        match ident {
            "Bootstrapper::Run" if msg.contains("mutex exists, exiting") => {
                self.fail("Another Roblox launch is already running".into())
            }
            "Bootstrapper::Run" if msg.starts_with("Running bootstrapper") => self.advance(0),
            "Bootstrapper::GetLatestVersionInfo" | "Deployment::GetInfo" => self.advance(1),
            "Bootstrapper::CheckForUpdates" if msg.starts_with("Downloading") || msg.starts_with("Starting") => {
                self.handoff = msg.starts_with("Starting") || self.handoff;
                !std::mem::replace(&mut self.updating_fishstrap, true)
            }
            "Bootstrapper::UpgradeRoblox" | "Bootstrapper::ExtractPackage" => self.advance(2),
            i if i.starts_with("Bootstrapper::DownloadPackage") => {
                let mut changed = self.advance(2);
                if let Some(n) = downloaded_bytes(msg) {
                    self.packages += 1;
                    self.bytes += n;
                    changed = true;
                }
                changed
            }
            "Bootstrapper::ApplyModifications" => self.advance(3),
            "Bootstrapper::StartRoblox" if msg.starts_with("Started Roblox") => {
                self.phase = Phase::Done;
                self.step = STEPS.len();
                true
            }
            "Bootstrapper::GetJoinDataByLaunchCommand" | "Bootstrapper::StartRoblox" => self.advance(4),
            "Frontend::ShowMessageBox" => {
                // Quiet mode suppresses Fishstrap's dialogs but still logs their text.
                let first = msg.lines().next().unwrap_or(msg).trim();
                let changed = self.notice.as_deref() != Some(first);
                self.notice = Some(first.to_string());
                changed
            }
            "App::Terminate" => {
                let code = msg
                    .strip_prefix("Terminating with exit code ")
                    .and_then(|r| r.split_whitespace().next())
                    .and_then(|n| n.parse::<i64>().ok());
                match code {
                    Some(0) if self.handoff => {
                        self.handoff_done = true;
                        true
                    }
                    Some(0) => self.fail(
                        self.notice.clone().unwrap_or_else(|| "Fishstrap closed before Roblox started".into()),
                    ),
                    Some(n) => self.fail(
                        self.notice.clone().unwrap_or_else(|| format!("Fishstrap stopped with an error (code {n})")),
                    ),
                    None => false,
                }
            }
            _ => false,
        }
    }

    pub fn snapshot(&self) -> LaunchProgress {
        let steps = STEPS
            .iter()
            .enumerate()
            .map(|(i, label)| Step {
                label,
                state: if i < self.step {
                    StepState::Done
                } else if i == self.step && self.phase == Phase::Running {
                    StepState::Active
                } else {
                    StepState::Pending
                },
            })
            .collect();
        let message = match self.phase {
            Phase::Done => "Roblox started".to_string(),
            Phase::Failed => self.failure.clone().unwrap_or_else(|| "Launch failed".into()),
            Phase::Cancelled => "Launch cancelled".to_string(),
            Phase::Running if self.updating_fishstrap && self.step <= 1 => "Updating Fishstrap".to_string(),
            Phase::Running => STEPS.get(self.step).copied().unwrap_or("Starting Roblox").to_string(),
        };
        LaunchProgress {
            phase: self.phase,
            message,
            steps,
            packages_downloaded: self.packages,
            downloaded_bytes: self.bytes,
        }
    }
}

impl Default for Tracker {
    fn default() -> Self {
        Self::new()
    }
}

// ---- log following ---------------------------------------------------------------------------

/// Reads complete lines appended to a file since the last call.
struct LogTail {
    file: File,
    /// Bytes already turned into lines; a trailing partial line stays unread until it's finished.
    consumed: u64,
}

impl LogTail {
    fn open(path: &Path) -> std::io::Result<Self> {
        Ok(Self { file: File::open(path)?, consumed: 0 })
    }

    fn read_lines(&mut self) -> std::io::Result<Vec<String>> {
        self.file.seek(SeekFrom::Start(self.consumed))?;
        let mut fresh = Vec::new();
        self.file.read_to_end(&mut fresh)?;
        let Some(end) = fresh.iter().rposition(|&b| b == b'\n') else { return Ok(Vec::new()) };
        self.consumed += end as u64 + 1;
        Ok(String::from_utf8_lossy(&fresh[..end])
            .lines()
            .map(|l| l.trim_start_matches('\u{feff}').to_string())
            .collect())
    }
}

/// The first log written since `since`, not in `used`, that records a Roblox launch (not a settings
/// window or the background watcher).
fn find_launch_log(logs: &Path, since: SystemTime, used: &[PathBuf]) -> Option<PathBuf> {
    let cutoff = since.checked_sub(Duration::from_secs(2)).unwrap_or(since);
    let mut candidates: Vec<(SystemTime, PathBuf)> = std::fs::read_dir(logs)
        .ok()?
        .flatten()
        .filter_map(|e| {
            let path = e.path();
            let name = path.file_name()?.to_string_lossy().into_owned();
            if !name.starts_with("Fishstrap_") || !name.ends_with(".log") || used.contains(&path) {
                return None;
            }
            let modified = e.metadata().ok()?.modified().ok()?;
            (modified >= cutoff).then_some((modified, path))
        })
        .collect();
    candidates.sort();
    candidates.into_iter().map(|(_, p)| p).find(|p| {
        std::fs::read(p).is_ok_and(|b| String::from_utf8_lossy(&b).contains("Opening bootstrapper"))
    })
}

// ---- launch + watcher ------------------------------------------------------------------------

static GENERATION: AtomicU64 = AtomicU64::new(0);
static LATEST: Mutex<Option<LaunchProgress>> = Mutex::new(None);

fn publish(app: &AppHandle, p: LaunchProgress) {
    *LATEST.lock().unwrap_or_else(|e| e.into_inner()) = Some(p.clone());
    let _ = app.emit(EVENT, p);
}

enum Next {
    Log(PathBuf, LogTail),
    Timeout,
    Superseded,
}

/// Waits for the next Fishstrap log of this launch.
fn next_log(logs: &Path, since: SystemTime, used: &[PathBuf], timeout: Duration, current: &impl Fn() -> bool) -> Next {
    let started = Instant::now();
    loop {
        if !current() {
            return Next::Superseded;
        }
        if let Some(path) = find_launch_log(logs, since, used) {
            if let Ok(t) = LogTail::open(&path) {
                return Next::Log(path, t);
            }
        }
        if started.elapsed() > timeout {
            return Next::Timeout;
        }
        std::thread::sleep(POLL);
    }
}

/// Fishstrap names its log after the current UTC second, and a process that can't create its log
/// ("Possible duplicate launch detected") exits silently. When Fishstrap updates itself, the parent
/// starts the new build well under a second later, so the two usually collide and the launch dies.
/// Spawning in the back half of a second puts the parent's startup late in that second, so the child
/// (~0.5 s later) lands in the next one.
const SAFE_FROM_MS: u64 = 550;
const SAFE_TO_MS: u64 = 750;

fn align_delay(subsec_ms: u64) -> Duration {
    let ms = if subsec_ms < SAFE_FROM_MS {
        SAFE_FROM_MS - subsec_ms
    } else if subsec_ms < SAFE_TO_MS {
        0
    } else {
        1000 - subsec_ms + SAFE_FROM_MS
    };
    Duration::from_millis(ms)
}

/// Starts `Fishstrap.exe -player <uri> -quiet`, returning the time it was started.
///
/// `-player <uri>` (not a bare `<uri>`) matters: when Fishstrap updates itself it relaunches the new
/// build as `-upgrade <original args>`, and `-upgrade` swallows a bare URI as its own value, so the
/// game being joined would be lost.
fn spawn_fishstrap(exe: &Path, uri: &str) -> std::io::Result<SystemTime> {
    let now = SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default();
    std::thread::sleep(align_delay(u64::from(now.subsec_millis())));
    let since = SystemTime::now();
    Command::new(exe).arg("-player").arg(uri).arg("-quiet").spawn()?;
    Ok(since)
}

struct Launch {
    exe: PathBuf,
    uri: String,
    logs: PathBuf,
}

/// Follows a launch across Fishstrap processes. When an update is pending Fishstrap downloads the
/// new build, starts it as `-upgrade …` and exits with code 0; the new process continues the launch
/// in its own log. If it never shows up (see `SAFE_FROM_MS`) the launch is retried once.
fn watch(app: AppHandle, generation: u64, launch: Launch, mut since: SystemTime) {
    let current = || GENERATION.load(Ordering::SeqCst) == generation;
    let emit = |p: LaunchProgress| {
        if current() {
            publish(&app, p);
        }
    };
    let started = Instant::now();
    let mut tracker = Tracker::new();
    emit(tracker.snapshot());

    let mut used: Vec<PathBuf> = Vec::new();
    let mut wait = DISCOVERY_TIMEOUT;
    let mut after_handoff = false;
    let mut retries = 1;
    loop {
        let mut tail = match next_log(&launch.logs, since, &used, wait, &current) {
            Next::Log(path, tail) => {
                used.push(path);
                tail
            }
            Next::Superseded => return,
            Next::Timeout if after_handoff && retries > 0 && current() => {
                retries -= 1;
                match spawn_fishstrap(&launch.exe, &launch.uri) {
                    Ok(t) => since = t,
                    Err(_) => {
                        tracker.fail("Couldn't restart Fishstrap".into());
                        emit(tracker.snapshot());
                        return;
                    }
                }
                used.clear();
                tracker = Tracker::new();
                emit(tracker.snapshot());
                after_handoff = false;
                wait = DISCOVERY_TIMEOUT;
                continue;
            }
            Next::Timeout => {
                let why = if after_handoff {
                    "Fishstrap updated itself but didn't continue the launch. Try again, or update Fishstrap."
                } else {
                    "Fishstrap didn't report a launch"
                };
                tracker.fail(why.into());
                emit(tracker.snapshot());
                return;
            }
        };
        tracker.resume();

        while current() && tracker.phase() == Phase::Running && !tracker.awaiting_handoff() {
            if started.elapsed() > WATCH_TIMEOUT {
                tracker.fail("Launching took too long".into());
                emit(tracker.snapshot());
                return;
            }
            let mut changed = false;
            match tail.read_lines() {
                Ok(lines) => {
                    for l in lines {
                        changed |= tracker.feed(&l);
                    }
                }
                Err(_) => {
                    tracker.fail("Couldn't read Fishstrap's log".into());
                    changed = true;
                }
            }
            if changed {
                emit(tracker.snapshot());
            }
            if tracker.phase() == Phase::Running && !tracker.awaiting_handoff() {
                std::thread::sleep(POLL);
            }
        }
        if !current() || tracker.phase() != Phase::Running {
            return;
        }
        after_handoff = true;
        wait = HANDOFF_TIMEOUT;
    }
}

/// Starts Fishstrap hidden and follows its progress. `uri` is built by `launch.rs`.
pub fn start_hidden(app: &AppHandle, exe: &Path, uri: &str) -> std::io::Result<()> {
    *BASELINE.lock().unwrap_or_else(|e| e.into_inner()) = Some(running_now());
    let since = spawn_fishstrap(exe, uri)?;
    let generation = GENERATION.fetch_add(1, Ordering::SeqCst) + 1;
    if let Some(root) = exe.parent() {
        let app = app.clone();
        let launch = Launch { exe: exe.to_path_buf(), uri: uri.to_string(), logs: root.join("Logs") };
        std::thread::spawn(move || watch(app, generation, launch, since));
    }
    Ok(())
}

/// The latest launch snapshot, so a view opened mid-launch can catch up.
#[tauri::command]
pub fn fishstrap_launch_progress() -> Option<LaunchProgress> {
    LATEST.lock().unwrap_or_else(|e| e.into_inner()).clone()
}

/// Processes that existed before this launch, so cancelling only touches what the launch started
/// (not a Fishstrap settings window or a Roblox you already had open).
struct Baseline {
    fishstrap: HashSet<u32>,
    player: HashSet<u32>,
}

static BASELINE: Mutex<Option<Baseline>> = Mutex::new(None);

fn running_now() -> Baseline {
    Baseline {
        fishstrap: crate::playtime::process_pids(|n| n.eq_ignore_ascii_case("Fishstrap.exe")).unwrap_or_default(),
        player: crate::playtime::process_pids(crate::playtime::is_player_process).unwrap_or_default(),
    }
}

fn terminate(pid: u32) {
    let mut sys = sysinfo::System::new();
    let pid = sysinfo::Pid::from_u32(pid);
    sys.refresh_processes_specifics(sysinfo::ProcessesToUpdate::Some(&[pid]), true, sysinfo::ProcessRefreshKind::nothing());
    if let Some(p) = sys.process(pid) {
        p.kill();
    }
}

/// Stops the launch in progress: ends the Fishstrap (and Roblox) processes it started and the
/// watcher. Returns false when no launch is running.
#[tauri::command(async)]
pub fn fishstrap_launch_cancel(app: AppHandle) -> bool {
    let running = LATEST.lock().unwrap_or_else(|e| e.into_inner()).as_ref().is_some_and(|p| p.phase == Phase::Running);
    let before = BASELINE.lock().unwrap_or_else(|e| e.into_inner()).take();
    let (true, Some(before)) = (running, before) else { return false };
    // Retire the watcher first so it can't report the killed processes as a failure.
    GENERATION.fetch_add(1, Ordering::SeqCst);
    let now = running_now();
    for pid in now.fishstrap.difference(&before.fishstrap).chain(now.player.difference(&before.player)) {
        terminate(*pid);
    }
    let mut p = LATEST.lock().unwrap_or_else(|e| e.into_inner()).clone().unwrap_or_else(|| Tracker::new().snapshot());
    p.phase = Phase::Cancelled;
    p.message = "Launch cancelled".into();
    for s in &mut p.steps {
        if s.state == StepState::Active {
            s.state = StepState::Pending;
        }
    }
    publish(&app, p);
    true
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lines taken from a real Fishstrap player launch log.
    const LAUNCH: &str = "\
2026-10-30T18:58:30Z [LaunchHandler::ProcessLaunchArgs] Opening bootstrapper (Player)
2026-10-30T18:58:30Z [Bootstrapper::Run] Running bootstrapper
2026-10-30T18:58:30Z [Bootstrapper::Run] Connectivity check finished
2026-10-30T18:58:30Z [Deployment::GetInfo] Getting deploy info for channel production
2026-10-30T18:58:30Z [Bootstrapper::ApplyModifications] Checking file mods...
2026-10-30T18:58:30Z [Bootstrapper::GetJoinDataByLaunchCommand] Detecting join type
2026-10-30T18:58:30Z [Bootstrapper::StartRoblox] join origin: 
2026-10-30T18:58:35Z [Bootstrapper::StartRoblox] Started Roblox (PID 23228), waiting for log file
2026-10-30T18:58:50Z [App::Terminate] Terminating with exit code 0 (ERROR_SUCCESS)";

    fn run(lines: &str) -> Tracker {
        let mut t = Tracker::new();
        for l in lines.lines() {
            t.feed(l);
        }
        t
    }

    fn states(t: &Tracker) -> Vec<StepState> {
        t.snapshot().steps.iter().map(|s| s.state).collect()
    }

    #[test]
    fn up_to_date_launch_reaches_done_and_exit_zero_afterwards_is_not_a_failure() {
        let t = run(LAUNCH);
        assert_eq!(t.phase(), Phase::Done);
        assert!(states(&t).iter().all(|s| *s == StepState::Done));
        assert_eq!(t.snapshot().message, "Roblox started");
    }

    #[test]
    fn steps_advance_in_order_and_never_go_back() {
        let mut t = Tracker::new();
        t.feed("2026-10-30T18:58:30Z [Bootstrapper::ApplyModifications] Checking file mods...");
        assert_eq!(t.snapshot().message, "Applying modifications");
        t.feed("2026-10-30T18:58:30Z [Deployment::GetInfo] Getting deploy info for channel production");
        assert_eq!(t.snapshot().message, "Applying modifications");
        assert_eq!(
            states(&t),
            vec![StepState::Done, StepState::Done, StepState::Done, StepState::Active, StepState::Pending]
        );
    }

    #[test]
    fn counts_finished_downloads() {
        let t = run("\
2026-10-30T18:58:30Z [Bootstrapper::UpgradeRoblox] Registering approximate program size...
2026-10-30T18:58:31Z [Bootstrapper::DownloadPackage.RobloxApp.zip] Downloading...
2026-10-30T18:58:32Z [Bootstrapper::DownloadPackage.RobloxApp.zip] Finished downloading! (1500 bytes total)
2026-10-30T18:58:33Z [Bootstrapper::DownloadPackage.ssl.zip] Finished downloading! (500 bytes total)");
        let s = t.snapshot();
        assert_eq!((s.packages_downloaded, s.downloaded_bytes), (2, 2000));
        assert_eq!(s.message, "Downloading Roblox");
    }

    #[test]
    fn nonzero_exit_before_start_fails_with_the_logged_dialog_text() {
        let t = run("\
2026-10-30T18:58:30Z [Bootstrapper::Run] Running bootstrapper
2026-10-30T18:58:31Z [Frontend::ShowMessageBox] Roblox failed to download.
Check your connection.
2026-10-30T18:58:31Z [App::Terminate] Terminating with exit code 1 (ERROR)");
        assert_eq!(t.phase(), Phase::Failed);
        assert_eq!(t.snapshot().message, "Roblox failed to download.");
    }

    #[test]
    fn exit_without_a_message_still_reports_failure() {
        let t = run("2026-10-30T18:58:31Z [App::Terminate] Terminating with exit code 0 (ERROR_SUCCESS)");
        assert_eq!(t.snapshot().message, "Fishstrap closed before Roblox started");
        let t = run("2026-10-30T18:58:31Z [App::Terminate] Terminating with exit code 5 (X)");
        assert_eq!(t.snapshot().message, "Fishstrap stopped with an error (code 5)");
    }

    // A real launch log where Fishstrap updated itself: it starts the new build and exits with code 0.
    const SELF_UPDATE: &str = "\
2026-11-02T16:33:41Z [Bootstrapper::Run] Running bootstrapper
2026-11-02T16:33:41Z [Bootstrapper::CheckForUpdates] Checking for updates...
2026-11-02T16:33:41Z [Bootstrapper::CheckForUpdates] Downloading v3.2.1...
2026-11-02T16:33:41Z [Bootstrapper::CheckForUpdates] Starting v3.2.1...
2026-11-02T16:33:41Z [App::Terminate] Terminating with exit code 0 (ERROR_SUCCESS)";

    #[test]
    fn self_update_exit_is_a_handoff_not_a_failure() {
        let mut t = run(SELF_UPDATE);
        assert_eq!(t.phase(), Phase::Running);
        assert!(t.awaiting_handoff());
        assert_eq!(t.snapshot().message, "Updating Fishstrap");
        // The updated process's log continues the same launch.
        t.resume();
        assert!(!t.awaiting_handoff());
        for l in LAUNCH.lines() {
            t.feed(l);
        }
        assert_eq!(t.phase(), Phase::Done);
    }

    #[test]
    fn error_exit_during_update_still_fails() {
        let t = run(&format!(
            "{}\n2026-11-02T16:33:42Z [App::Terminate] Terminating with exit code 3 (X)",
            SELF_UPDATE.rsplit_once('\n').unwrap().0
        ));
        assert_eq!(t.phase(), Phase::Failed);
    }

    #[test]
    fn spawn_lands_in_the_back_half_of_a_second() {
        for subsec in 0..1000u64 {
            let landed = (subsec + align_delay(subsec).as_millis() as u64) % 1000;
            assert!((SAFE_FROM_MS..SAFE_TO_MS).contains(&landed), "{subsec} -> {landed}");
            assert!(align_delay(subsec) <= Duration::from_millis(1000), "{subsec}");
        }
    }

    #[test]
    fn tail_returns_only_complete_new_lines() {
        let path = std::env::temp_dir().join(format!("muffin-fs-tail-{}.log", std::process::id()));
        std::fs::write(&path, "one\ntwo\npart").unwrap();
        let mut tail = LogTail::open(&path).unwrap();
        assert_eq!(tail.read_lines().unwrap(), vec!["one", "two"]);
        assert!(tail.read_lines().unwrap().is_empty());
        std::fs::write(&path, "one\ntwo\npartial\nthree\n").unwrap();
        assert_eq!(tail.read_lines().unwrap(), vec!["partial", "three"]);
        let _ = std::fs::remove_file(&path);
    }
}
