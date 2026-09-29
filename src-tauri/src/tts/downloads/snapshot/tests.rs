use super::*;
use std::{
    io::{Read, Write},
    net::TcpListener,
    sync::{atomic::Ordering, Mutex},
    thread,
    time::{Duration, Instant},
};

struct Reply {
    path: &'static str,
    status: &'static str,
    body: String,
    declared_length: Option<usize>,
}

fn reply(path: &'static str, body: &str) -> Reply {
    Reply {
        path,
        status: "200 OK",
        body: body.to_string(),
        declared_length: None,
    }
}

/// Exercise the production HTTP and filesystem code without remote models or credentials.
fn serve(replies: Vec<Reply>) -> (SnapshotSource, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let origin = format!("http://{}", listener.local_addr().unwrap());
    listener.set_nonblocking(true).unwrap();
    let server = thread::spawn(move || {
        for reply in replies {
            let deadline = Instant::now() + Duration::from_secs(5);
            let mut stream = loop {
                match listener.accept() {
                    Ok((stream, _)) => break stream,
                    Err(error) if error.kind() == std::io::ErrorKind::WouldBlock => {
                        assert!(
                            Instant::now() < deadline,
                            "Expected request for {}",
                            reply.path
                        );
                        thread::sleep(Duration::from_millis(5));
                    }
                    Err(error) => panic!("Fixture accept failed: {error}"),
                }
            };
            stream
                .set_read_timeout(Some(Duration::from_secs(2)))
                .unwrap();
            let mut bytes = Vec::new();
            let mut chunk = [0_u8; 2048];
            while !bytes.windows(4).any(|window| window == b"\r\n\r\n") {
                let count = stream.read(&mut chunk).unwrap();
                assert!(count > 0);
                bytes.extend_from_slice(&chunk[..count]);
            }
            let request = String::from_utf8(bytes).unwrap();
            assert!(
                request.starts_with(&format!("GET {} HTTP/1.1", reply.path)),
                "{request}"
            );
            assert!(request
                .to_lowercase()
                .contains("authorization: bearer test-only-token"));
            let size = reply.declared_length.unwrap_or(reply.body.len());
            write!(stream, "HTTP/1.1 {}\r\nContent-Length: {size}\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{}", reply.status, reply.body).unwrap();
        }
    });
    (
        SnapshotSource {
            client: reqwest::Client::new(),
            origin,
            token: Some("test-only-token".to_string()),
        },
        server,
    )
}

fn request(root: &Path, layout: SnapshotLayout) -> SnapshotRequest<'_> {
    SnapshotRequest {
        repo_id: "owner/model",
        install_dir: root,
        label: "fixture model",
        layout,
        cancel_flag: None,
    }
}

#[tokio::test]
async fn both_layouts_use_the_same_transfer_and_preserve_progress_contract() {
    for layout in [
        SnapshotLayout::ExactDirectory,
        SnapshotLayout::RepositorySubdirectory,
    ] {
        let root = tempfile::tempdir().unwrap();
        let install = root.path().join("installed");
        fs::create_dir_all(&install).unwrap();
        fs::write(install.join("obsolete"), "old").unwrap();
        let (source, server) = serve(vec![
            reply(
                "/api/models/owner/model",
                r#"{"siblings":[{"rfilename":"config.json","size":2},{"rfilename":"weights/model.bin","size":7}]}"#,
            ),
            reply("/owner/model/resolve/main/config.json", "{}"),
            reply("/owner/model/resolve/main/weights/model.bin", "weights"),
        ]);
        let events = Mutex::new(Vec::new());
        source
            .download(request(&install, layout), |p| {
                events.lock().unwrap().push(p)
            })
            .await
            .unwrap();
        server.join().unwrap();
        let payload = match layout {
            SnapshotLayout::ExactDirectory => install.clone(),
            SnapshotLayout::RepositorySubdirectory => install.join("model"),
        };
        assert_eq!(
            fs::read_to_string(payload.join("weights/model.bin")).unwrap(),
            "weights"
        );
        assert_eq!(
            fs::read_to_string(payload.join("config.json")).unwrap(),
            "{}"
        );
        assert!(!install.join("obsolete").exists());
        let events = events.into_inner().unwrap();
        assert_eq!(
            serde_json::to_value(&events[0]).unwrap(),
            serde_json::json!({
                "repo_id":"owner/model", "stage":"preparing", "file":null, "file_index":null,
                "file_count":null, "downloaded_bytes":null, "total_bytes":null, "error":null
            })
        );
        assert_eq!(
            serde_json::to_value(events.last().unwrap()).unwrap(),
            serde_json::json!({
                "repo_id":"owner/model", "stage":"complete", "file":null, "file_index":2,
                "file_count":2, "downloaded_bytes":9, "total_bytes":9, "error":null
            })
        );
        assert!(events
            .windows(2)
            .all(|pair| pair[0].downloaded_bytes.unwrap_or(0)
                <= pair[1].downloaded_bytes.unwrap_or(0)));
    }
}

#[tokio::test]
async fn unknown_sizes_remain_unknown_while_received_bytes_are_counted() {
    let root = tempfile::tempdir().unwrap();
    let (source, server) = serve(vec![
        reply(
            "/api/models/owner/model",
            r#"{"siblings":[{"rfilename":"config.json"}]}"#,
        ),
        reply("/owner/model/resolve/main/config.json", "{}"),
    ]);
    let events = Mutex::new(Vec::new());
    source
        .download(
            request(&root.path().join("model"), SnapshotLayout::ExactDirectory),
            |p| events.lock().unwrap().push(p),
        )
        .await
        .unwrap();
    server.join().unwrap();
    let events = events.into_inner().unwrap();
    assert!(events.iter().all(|event| event.total_bytes.is_none()));
    assert_eq!(events.last().unwrap().downloaded_bytes, Some(2));
}

#[tokio::test]
async fn gated_errors_keep_the_terms_guidance_and_do_not_touch_the_install() {
    for status in ["401 Unauthorized", "403 Forbidden"] {
        let root = tempfile::tempdir().unwrap();
        let marker = root.path().join("existing");
        fs::write(&marker, "existing").unwrap();
        let (source, server) = serve(vec![Reply {
            status,
            ..reply("/api/models/owner/model", "denied")
        }]);
        let error = source
            .download(request(root.path(), SnapshotLayout::ExactDirectory), |_| {})
            .await
            .unwrap_err();
        server.join().unwrap();
        assert!(error.contains("https://huggingface.co/owner/model"));
        assert!(error.contains("accept the model terms"));
        assert!(error.contains("Hugging Face read token"));
        assert!(marker.exists());
    }
}

#[tokio::test]
async fn cancellation_before_transfer_does_not_contact_the_server() {
    let root = tempfile::tempdir().unwrap();
    let flag = Arc::new(AtomicBool::new(true));
    let source = SnapshotSource {
        client: reqwest::Client::new(),
        origin: "http://127.0.0.1:1".to_string(),
        token: None,
    };
    let mut request = request(root.path(), SnapshotLayout::ExactDirectory);
    request.cancel_flag = Some(&flag);
    let error = source
        .download(request, |_| panic!("Cancelled before progress"))
        .await
        .unwrap_err();
    assert_eq!(error, crate::artifact_download::DOWNLOAD_CANCELLED_MESSAGE);
}

#[tokio::test]
async fn cancellation_between_files_stops_without_publishing_complete() {
    let root = tempfile::tempdir().unwrap();
    let (source, server) = serve(vec![
        reply(
            "/api/models/owner/model",
            r#"{"siblings":[{"rfilename":"config.json"},{"rfilename":"weights.bin"}]}"#,
        ),
        reply("/owner/model/resolve/main/config.json", "{}"),
    ]);
    let flag = Arc::new(AtomicBool::new(false));
    let install = root.path().join("model");
    let mut request = request(&install, SnapshotLayout::ExactDirectory);
    request.cancel_flag = Some(&flag);
    let error = source
        .download(request, |event| {
            assert!(!matches!(event.stage, Stage::Complete));
            if event.file_index == Some(1) {
                flag.store(true, Ordering::Relaxed);
            }
        })
        .await
        .unwrap_err();
    server.join().unwrap();
    assert_eq!(error, crate::artifact_download::DOWNLOAD_CANCELLED_MESSAGE);
    assert!(install.join("config.json").exists());
    assert!(!install.join("weights.bin").exists());
}

#[tokio::test]
async fn unsafe_remote_paths_are_rejected_before_clearing_installed_files() {
    for filename in ["../escape", "/escape", "nested/../../escape"] {
        let root = tempfile::tempdir().unwrap();
        let marker = root.path().join("existing");
        fs::write(&marker, "existing").unwrap();
        let body = serde_json::json!({"siblings":[{"rfilename":filename}]}).to_string();
        let (source, server) = serve(vec![reply("/api/models/owner/model", &body)]);
        let error = source
            .download(request(root.path(), SnapshotLayout::ExactDirectory), |_| {})
            .await
            .unwrap_err();
        server.join().unwrap();
        assert!(error.contains("Unsafe artifact path"));
        assert!(marker.exists());
    }
}

#[tokio::test]
async fn truncated_downloads_do_not_publish_complete() {
    let root = tempfile::tempdir().unwrap();
    let (source, server) = serve(vec![
        reply(
            "/api/models/owner/model",
            r#"{"siblings":[{"rfilename":"weights.bin","size":100}]}"#,
        ),
        Reply {
            declared_length: Some(100),
            ..reply("/owner/model/resolve/main/weights.bin", "short")
        },
    ]);
    let error = source
        .download(
            request(&root.path().join("model"), SnapshotLayout::ExactDirectory),
            |event| {
                assert!(!matches!(event.stage, Stage::Complete));
            },
        )
        .await
        .unwrap_err();
    server.join().unwrap();
    assert!(error.contains("Failed to read weights.bin"));
}
