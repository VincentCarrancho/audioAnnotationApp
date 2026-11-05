use serde::Serialize;
use serde_json::{json, Value};
use std::{
    collections::{HashMap, HashSet},
    fs::{self, File, OpenOptions},
    io::{BufWriter, Write},
    path::{Component, Path, PathBuf},
    sync::Mutex,
};
use tauri::{AppHandle, Manager, State};
use uuid::Uuid;

const METADATA: &str = "wavnotes.json";
const RECORDING: &str = "recording.wav";

#[derive(Default)]
pub struct Registry(Mutex<HashMap<PathBuf, Active>>);

struct Active {
    token: String,
    id: String,
    recording: String,
    duration: f64,
    revision: Option<u64>,
    serialized: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Opened {
    directory: String,
    project: Value,
    recording_path: String,
    token: String,
}

fn err(context: &str, error: impl std::fmt::Display) -> String {
    format!("{context}: {error}")
}

fn safe_component(name: &str) -> bool {
    !name.is_empty()
        && name != "."
        && name != ".."
        && !name.contains(['/', '\\', '\0'])
        && !name.chars().any(char::is_control)
}

fn recording_path(dir: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.contains('\\')
        || relative.is_empty()
        || !relative.to_ascii_lowercase().ends_with(".wav")
    {
        return Err("Recording path must be a relative WAV path inside the project".into());
    }
    let path = Path::new(relative);
    if !path.components().all(|c| matches!(c, Component::Normal(_)))
        || relative.split('/').any(|part| !safe_component(part))
    {
        return Err("Recording path contains an unsafe component".into());
    }
    let resolved = fs::canonicalize(dir.join(path)).map_err(|e| {
        err(
            "Project recording is missing or inaccessible; restore the copied WAV",
            e,
        )
    })?;
    if !resolved.starts_with(dir) || !resolved.is_file() {
        return Err("Recording resolves outside the project or is not a file".into());
    }
    Ok(resolved)
}

fn wav_duration(path: &Path) -> Result<f64, String> {
    let mut reader = hound::WavReader::open(path).map_err(|e| {
        err(
            "Cannot decode WAV; choose a valid PCM or floating-point WAV",
            e,
        )
    })?;
    let spec = reader.spec();
    if spec.channels == 0 || spec.sample_rate == 0 {
        return Err("Cannot decode WAV: invalid channel count or sample rate".into());
    }
    let frames = reader.duration();
    // Consume samples so a truncated file does not pass a header-only check.
    let count = match spec.sample_format {
        hound::SampleFormat::Float => reader
            .samples::<f32>()
            .try_fold(0u64, |n, s| s.map(|_| n + 1)),
        hound::SampleFormat::Int => reader
            .samples::<i32>()
            .try_fold(0u64, |n, s| s.map(|_| n + 1)),
    }
    .map_err(|e| {
        err(
            "Cannot decode WAV; the recording may be damaged or unsupported",
            e,
        )
    })?;
    if count != u64::from(frames) * u64::from(spec.channels) {
        return Err("Cannot decode WAV: the recording is truncated".into());
    }
    Ok(f64::from(frames) / f64::from(spec.sample_rate))
}

fn identifier(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).is_some_and(|s| {
        !s.is_empty()
            && s.len() <= 256
            && !matches!(s, "__proto__" | "prototype" | "constructor")
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    })
}

fn note(value: Option<&Value>) -> bool {
    value
        .and_then(Value::as_object)
        .and_then(|o| o.get("blocks"))
        .and_then(Value::as_array)
        .is_some_and(|blocks| {
            blocks.iter().all(|b| {
                b.as_object().is_some_and(|o| {
                    o.get("type")
                        .and_then(Value::as_str)
                        .is_some_and(|t| !t.is_empty())
                        && o.get("data").is_some_and(Value::is_object)
                        && o.get("id").is_none_or(Value::is_string)
                })
            })
        })
}

fn validate(project: &Value, dir: &Path, duration: f64) -> Result<PathBuf, String> {
    let invalid =
        || "Invalid project metadata; check the project file or restore a backup".to_string();
    let obj = project.as_object().ok_or_else(invalid)?;
    if obj.get("version").and_then(Value::as_u64) != Some(1) {
        return Err("Unsupported project version; this app supports version 1".into());
    }
    if !identifier(obj.get("id"))
        || !obj
            .get("name")
            .and_then(Value::as_str)
            .is_some_and(safe_component)
        || !note(obj.get("projectNote"))
    {
        return Err(invalid());
    }
    let relative = obj
        .get("recording")
        .and_then(|r| r.get("relativePath"))
        .and_then(Value::as_str)
        .ok_or_else(invalid)?;
    let path = recording_path(dir, relative)?;
    let annotations = obj
        .get("annotations")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    let mut ids = HashSet::new();
    for annotation in annotations {
        if !identifier(annotation.get("id")) || !note(annotation.get("note")) {
            return Err(invalid());
        }
        let id = annotation["id"].as_str().ok_or_else(invalid)?;
        if !ids.insert(id) {
            return Err("Duplicate annotation ID in project".into());
        }
        let anchor = annotation.get("anchor").ok_or_else(invalid)?;
        let time = |key| {
            anchor
                .get(key)
                .and_then(Value::as_f64)
                .filter(|t| t.is_finite() && *t >= 0.0 && *t <= duration)
        };
        let valid = match anchor.get("kind").and_then(Value::as_str) {
            Some("point") => time("time").is_some(),
            Some("range") => matches!((time("start"), time("end")), (Some(a), Some(b)) if a < b),
            _ => false,
        };
        if !valid {
            return Err("Annotation has an invalid or out-of-bounds time".into());
        }
    }
    let pending = obj
        .get("pendingAnnotationIds")
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    let mut seen = HashSet::new();
    for item in pending {
        let id = item.as_str().ok_or_else(invalid)?;
        if !ids.contains(id) || !seen.insert(id) {
            return Err("Pending queue contains a missing or duplicate annotation ID".into());
        }
    }
    Ok(path)
}

fn atomic_write(dir: &Path, project: &Value, create: bool) -> Result<(), String> {
    let mut temp = tempfile::NamedTempFile::new_in(dir)
        .map_err(|e| err("Cannot create temporary project file", e))?;
    serde_json::to_writer_pretty(&mut temp, project)
        .map_err(|e| err("Cannot serialize project", e))?;
    temp.write_all(b"\n")
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|e| err("Cannot write project; check disk space and permissions", e))?;
    let persisted = if create {
        temp.persist_noclobber(dir.join(METADATA))
    } else {
        temp.persist(dir.join(METADATA))
    };
    persisted.map_err(|e| {
        err(
            "Cannot replace project file; the previous file was kept",
            e.error,
        )
    })?;
    File::open(dir).and_then(|f| f.sync_all()).map_err(|e| {
        err(
            "Project was replaced but its folder could not be synced; retry saving",
            e,
        )
    })?;
    Ok(())
}

fn open_inner(dir: &Path, registry: &mut HashMap<PathBuf, Active>) -> Result<Opened, String> {
    let dir = fs::canonicalize(dir).map_err(|e| err("Cannot open project folder", e))?;
    if !dir.is_dir() {
        return Err("Choose a project folder, not a file".into());
    }
    let metadata = dir.join(METADATA);
    if fs::symlink_metadata(&metadata)
        .map_err(|e| err("Cannot find wavnotes.json in this project folder", e))?
        .file_type()
        .is_symlink()
    {
        return Err("Project metadata must not be a symbolic link".into());
    }
    let project: Value = serde_json::from_reader(
        File::open(metadata).map_err(|e| err("Cannot read project metadata", e))?,
    )
    .map_err(|e| err("Cannot read project JSON", e))?;
    let relative = project
        .get("recording")
        .and_then(|r| r.get("relativePath"))
        .and_then(Value::as_str)
        .ok_or("Project has no recording path")?;
    let path = recording_path(&dir, relative)?;
    let duration = wav_duration(&path)?;
    validate(&project, &dir, duration)?;
    let token = Uuid::new_v4().to_string();
    registry.insert(
        dir.clone(),
        Active {
            token: token.clone(),
            id: project["id"].as_str().unwrap().to_owned(),
            recording: relative.to_owned(),
            duration,
            revision: None,
            serialized: None,
        },
    );
    Ok(Opened {
        directory: dir.to_string_lossy().into_owned(),
        project,
        recording_path: path.to_string_lossy().into_owned(),
        token,
    })
}

fn create_inner(
    source: &Path,
    parent: &Path,
    name: &str,
    registry: &mut HashMap<PathBuf, Active>,
) -> Result<Opened, String> {
    if !safe_component(name) || name.trim() != name {
        return Err("Project name must be a single non-empty folder name without slashes or surrounding spaces".into());
    }
    if !source
        .extension()
        .is_some_and(|s| s.eq_ignore_ascii_case("wav"))
    {
        return Err("Choose a WAV recording".into());
    }
    wav_duration(source)?;
    let parent = fs::canonicalize(parent).map_err(|e| err("Cannot access project location", e))?;
    let dir = parent.join(name);
    fs::create_dir(&dir).map_err(|e| {
        err(
            "Cannot create project folder (it may already exist); choose another name or location",
            e,
        )
    })?;
    let result = (|| {
        let mut source_file = File::open(source).map_err(|e| err("Cannot open source WAV", e))?;
        let target = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(dir.join(RECORDING))
            .map_err(|e| err("Cannot create project recording", e))?;
        let mut target = BufWriter::new(target);
        std::io::copy(&mut source_file, &mut target)
            .and_then(|_| target.flush())
            .and_then(|_| target.get_ref().sync_all())
            .map_err(|e| err("Cannot copy WAV; check disk space and permissions", e))?;
        wav_duration(&dir.join(RECORDING))?;
        let project = json!({"version": 1, "id": Uuid::new_v4().to_string(), "name": name, "recording": {"relativePath": RECORDING}, "annotations": [], "projectNote": {"blocks": []}, "pendingAnnotationIds": []});
        atomic_write(&dir, &project, true)?;
        open_inner(&dir, registry)
    })();
    result.map_err(|e| {
        format!(
            "{e}. The newly created folder {} was left in place; inspect it before retrying",
            dir.display()
        )
    })
}

fn save_inner(
    dir: &Path,
    token: &str,
    project: &Value,
    revision: u64,
    registry: &mut HashMap<PathBuf, Active>,
) -> Result<(), String> {
    let dir = fs::canonicalize(dir).map_err(|e| err("Project folder is unavailable", e))?;
    let active = registry
        .get_mut(&dir)
        .ok_or("Project session is no longer open; reopen the project")?;
    if active.token != token {
        return Err("Project session was replaced; reopen the project before saving".into());
    }
    let serialized =
        serde_json::to_string(project).map_err(|e| err("Cannot serialize project", e))?;
    if let Some(saved) = active.revision {
        if revision < saved {
            return Ok(());
        }
        if revision == saved {
            return if active.serialized.as_deref() == Some(serialized.as_str()) {
                Ok(())
            } else {
                Err("A save revision was reused for different content".into())
            };
        }
    }
    if project.get("id").and_then(Value::as_str) != Some(active.id.as_str())
        || project
            .get("recording")
            .and_then(|r| r.get("relativePath"))
            .and_then(Value::as_str)
            != Some(active.recording.as_str())
    {
        return Err("Cannot change a project's identity or recording during save".into());
    }
    validate(project, &dir, active.duration)?;
    atomic_write(&dir, project, false)?;
    active.revision = Some(revision);
    active.serialized = Some(serialized);
    Ok(())
}

fn approve(app: &AppHandle, opened: &Opened) -> Result<(), String> {
    app.asset_protocol_scope()
        .allow_file(&opened.recording_path)
        .map_err(|e| err("Cannot authorize the project recording for playback", e))
}

#[tauri::command]
pub fn create_project(
    app: AppHandle,
    state: State<'_, Registry>,
    source_wav_path: String,
    parent_directory: String,
    name: String,
) -> Result<Opened, String> {
    let mut registry = state
        .0
        .lock()
        .map_err(|_| "Project registry is unavailable")?;
    let opened = create_inner(
        Path::new(&source_wav_path),
        Path::new(&parent_directory),
        &name,
        &mut registry,
    )?;
    approve(&app, &opened)?;
    Ok(opened)
}

#[tauri::command]
pub fn open_project(
    app: AppHandle,
    state: State<'_, Registry>,
    directory: String,
) -> Result<Opened, String> {
    let mut registry = state
        .0
        .lock()
        .map_err(|_| "Project registry is unavailable")?;
    let opened = open_inner(Path::new(&directory), &mut registry)?;
    approve(&app, &opened)?;
    Ok(opened)
}

#[tauri::command]
pub fn save_project(
    state: State<'_, Registry>,
    directory: String,
    token: String,
    project: Value,
    revision: u64,
) -> Result<(), String> {
    let mut registry = state
        .0
        .lock()
        .map_err(|_| "Project registry is unavailable")?;
    save_inner(
        Path::new(&directory),
        &token,
        &project,
        revision,
        &mut registry,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> (tempfile::TempDir, PathBuf) {
        let temp = tempfile::tempdir().unwrap();
        let source = temp.path().join("source.wav");
        let spec = hound::WavSpec {
            channels: 1,
            sample_rate: 8_000,
            bits_per_sample: 16,
            sample_format: hound::SampleFormat::Int,
        };
        let mut wav = hound::WavWriter::create(&source, spec).unwrap();
        for _ in 0..8_000 {
            wav.write_sample(0i16).unwrap();
        }
        wav.finalize().unwrap();
        (temp, source)
    }

    #[test]
    fn create_save_reopen_move_and_session_revisions() {
        let (temp, source) = fixture();
        let mut registry = HashMap::new();
        let opened = create_inner(&source, temp.path(), "Notebook", &mut registry).unwrap();
        assert!(create_inner(&source, temp.path(), "Notebook", &mut registry).is_err());
        fs::remove_file(&source).unwrap();
        let dir = PathBuf::from(&opened.directory);
        let mut data = opened.project.clone();
        data["projectNote"] = json!({"blocks": [{"type":"paragraph", "data":{"text":"whole"}}]});
        data["annotations"] = json!([{"id":"a", "anchor":{"kind":"point","time":0.5}, "note":{"blocks":[{"type":"paragraph","data":{"text":"partial"}}]}}]);
        data["pendingAnnotationIds"] = json!(["a"]);
        save_inner(&dir, &opened.token, &data, 2, &mut registry).unwrap();
        save_inner(&dir, &opened.token, &opened.project, 1, &mut registry).unwrap();
        assert_eq!(
            serde_json::from_reader::<_, Value>(File::open(dir.join(METADATA)).unwrap()).unwrap(),
            data
        );
        let reopened = open_inner(&dir, &mut registry).unwrap();
        assert_eq!(reopened.project, data);
        assert!(save_inner(&dir, &opened.token, &opened.project, 3, &mut registry).is_err());
        save_inner(&dir, &reopened.token, &data, 0, &mut registry).unwrap();
        let moved = temp.path().join("Moved");
        fs::rename(&dir, &moved).unwrap();
        let reopened = open_inner(&moved, &mut registry).unwrap();
        assert_eq!(reopened.project, data);
        assert!(Path::new(&reopened.recording_path).starts_with(fs::canonicalize(&moved).unwrap()));
    }

    #[test]
    fn failed_replace_retains_last_saved_file_and_allows_retry() {
        let (temp, source) = fixture();
        let mut registry = HashMap::new();
        let opened = create_inner(&source, temp.path(), "Notebook", &mut registry).unwrap();
        let dir = PathBuf::from(&opened.directory);
        let metadata = dir.join(METADATA);
        let backup = dir.join("previous.json");
        fs::rename(&metadata, &backup).unwrap();
        fs::create_dir(&metadata).unwrap();
        let mut edited = opened.project.clone();
        edited["projectNote"] = json!({"blocks":[{"type":"paragraph","data":{"text":"edited"}}]});
        assert!(save_inner(&dir, &opened.token, &edited, 1, &mut registry).is_err());
        assert_eq!(
            serde_json::from_reader::<_, Value>(File::open(&backup).unwrap()).unwrap(),
            opened.project
        );
        fs::remove_dir(&metadata).unwrap();
        fs::rename(&backup, &metadata).unwrap();
        save_inner(&dir, &opened.token, &edited, 1, &mut registry).unwrap();
        assert_eq!(
            serde_json::from_reader::<_, Value>(File::open(&metadata).unwrap()).unwrap(),
            edited
        );
    }

    #[test]
    fn rejects_unsafe_metadata_and_does_not_replace_previous_save() {
        let (temp, source) = fixture();
        let mut registry = HashMap::new();
        let opened = create_inner(&source, temp.path(), "Notebook", &mut registry).unwrap();
        let dir = PathBuf::from(&opened.directory);
        let original = fs::read(dir.join(METADATA)).unwrap();
        for relative in [
            "../source.wav",
            "/tmp/x.wav",
            "a/../../source.wav",
            "foo\\bar.wav",
        ] {
            let mut bad = opened.project.clone();
            bad["recording"]["relativePath"] = json!(relative);
            assert!(save_inner(&dir, &opened.token, &bad, 1, &mut registry).is_err());
            assert_eq!(fs::read(dir.join(METADATA)).unwrap(), original);
        }
        let mut bad = opened.project.clone();
        bad["pendingAnnotationIds"] = json!(["missing"]);
        assert!(save_inner(&dir, &opened.token, &bad, 1, &mut registry).is_err());
        bad["annotations"] = json!([{"id":"same", "anchor":{"kind":"point","time":0}, "note":{"blocks":[]}},{"id":"same", "anchor":{"kind":"point","time":0}, "note":{"blocks":[]}}]);
        bad["pendingAnnotationIds"] = json!([]);
        assert!(save_inner(&dir, &opened.token, &bad, 1, &mut registry).is_err());
        for id in ["../other", "__proto__", "constructor"] {
            bad["annotations"] =
                json!([{"id":id, "anchor":{"kind":"point","time":0}, "note":{"blocks":[]}}]);
            bad["pendingAnnotationIds"] = json!([id]);
            assert!(save_inner(&dir, &opened.token, &bad, 1, &mut registry).is_err());
        }
        assert_eq!(fs::read(dir.join(METADATA)).unwrap(), original);
        save_inner(&dir, &opened.token, &opened.project, 1, &mut registry).unwrap();
    }

    #[test]
    fn open_rejects_malicious_paths_versions_and_queue_references() {
        let (temp, source) = fixture();
        let mut registry = HashMap::new();
        let opened = create_inner(&source, temp.path(), "Notebook", &mut registry).unwrap();
        let dir = PathBuf::from(&opened.directory);
        let mut bad = opened.project.clone();
        for path in ["../source.wav", "/tmp/outside.wav", "foo\\..\\source.wav"] {
            bad["recording"]["relativePath"] = json!(path);
            fs::write(dir.join(METADATA), serde_json::to_vec(&bad).unwrap()).unwrap();
            assert!(open_inner(&dir, &mut registry).is_err());
        }
        bad = opened.project.clone();
        bad["version"] = json!(2);
        fs::write(dir.join(METADATA), serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(open_inner(&dir, &mut registry)
            .unwrap_err()
            .contains("version"));
        bad = opened.project.clone();
        bad["pendingAnnotationIds"] = json!(["missing"]);
        fs::write(dir.join(METADATA), serde_json::to_vec(&bad).unwrap()).unwrap();
        assert!(open_inner(&dir, &mut registry)
            .unwrap_err()
            .contains("queue"));
    }

    #[test]
    fn initial_metadata_write_never_clobbers_existing_file() {
        let temp = tempfile::tempdir().unwrap();
        let path = temp.path().join(METADATA);
        fs::write(&path, b"keep me").unwrap();
        assert!(atomic_write(temp.path(), &json!({"version":1}), true).is_err());
        assert_eq!(fs::read(path).unwrap(), b"keep me");
    }

    #[cfg(unix)]
    #[test]
    fn rejects_recording_symlink_outside_project_and_missing_wav() {
        let (temp, source) = fixture();
        let mut registry = HashMap::new();
        let opened = create_inner(&source, temp.path(), "Notebook", &mut registry).unwrap();
        let dir = PathBuf::from(&opened.directory);
        fs::remove_file(dir.join(RECORDING)).unwrap();
        assert!(open_inner(&dir, &mut registry)
            .unwrap_err()
            .contains("missing"));
        std::os::unix::fs::symlink(&source, dir.join(RECORDING)).unwrap();
        assert!(open_inner(&dir, &mut registry)
            .unwrap_err()
            .contains("outside"));
    }
}
