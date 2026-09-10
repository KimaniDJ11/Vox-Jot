use std::io::{self, Write};

/// A diagnostic writer that never lets a closed console pipe crash the app.
///
/// Desktop apps launched by a development runner can outlive that runner for a
/// short time. In that window stdout and stderr may both return `BrokenPipe`.
/// Fern's fallback path panics when both writes fail, so console logging needs
/// to be explicitly lossy. File logging remains unaffected.
struct LossyWriter<W> {
    inner: W,
}

impl<W> LossyWriter<W> {
    fn new(inner: W) -> Self {
        Self { inner }
    }
}

impl<W: Write> Write for LossyWriter<W> {
    fn write(&mut self, buffer: &[u8]) -> io::Result<usize> {
        match self.inner.write(buffer) {
            Ok(0) if !buffer.is_empty() => Ok(buffer.len()),
            Ok(written) => Ok(written),
            Err(_) => Ok(buffer.len()),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        let _ = self.inner.flush();
        Ok(())
    }
}

pub(crate) fn lossy_stdout_dispatch() -> tauri_plugin_log::fern::Dispatch {
    let writer: Box<dyn Write + Send> = Box::new(LossyWriter::new(std::io::stdout()));
    tauri_plugin_log::fern::Dispatch::new().chain(writer)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct ClosedPipe;

    impl Write for ClosedPipe {
        fn write(&mut self, _buffer: &[u8]) -> io::Result<usize> {
            Err(io::Error::new(io::ErrorKind::BrokenPipe, "runner exited"))
        }

        fn flush(&mut self) -> io::Result<()> {
            Err(io::Error::new(io::ErrorKind::BrokenPipe, "runner exited"))
        }
    }

    #[test]
    fn closed_diagnostic_pipe_is_lossy_instead_of_fatal() {
        let mut writer = LossyWriter::new(ClosedPipe);

        assert_eq!(writer.write(b"shortcut event").unwrap(), 14);
        writer.flush().unwrap();
        writer.write_all(b"still running").unwrap();
    }
}
