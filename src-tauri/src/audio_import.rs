use std::{
    fs::{self, File},
    io::{Read, Seek, SeekFrom},
    path::Path,
    process::Command,
};

// FFmpeg's -fs may stop successfully at the limit, so reserve a large margin
// and reject anything near it. RIFF's 32-bit size remains safely below 4 GiB.
const LIMIT: u64 = 2_000_000_000;
const MARGIN: u64 = 1_048_576;

/// Check container boundaries without interpreting the audio codec. FFmpeg may
/// accept a WAV cut exactly at an input packet boundary despite its RIFF/data
/// sizes declaring substantially more audio.
pub fn validate_source_container(path: &Path) -> Result<(), String> {
    let mut file =
        File::open(path).map_err(|e| format!("Cannot inspect original recording: {e}"))?;
    let len = file
        .metadata()
        .map_err(|e| format!("Cannot inspect original recording: {e}"))?
        .len();
    let mut header = [0u8; 12];
    let n = len.min(header.len() as u64) as usize;
    file.read_exact(&mut header[..n])
        .map_err(|e| format!("Cannot inspect original recording: {e}"))?;
    if n < 4 || !matches!(&header[..4], b"RIFF" | b"RIFX" | b"RF64") {
        return Ok(());
    }
    if n < 12 {
        return Err("WAV container is truncated in its header".into());
    }
    if &header[8..12] != b"WAVE" {
        return Ok(());
    }
    let be = &header[..4] == b"RIFX";
    let rf64 = &header[..4] == b"RF64";
    let u32_at = |bytes: &[u8]| {
        let a: [u8; 4] = bytes.try_into().unwrap();
        if be {
            u32::from_be_bytes(a)
        } else {
            u32::from_le_bytes(a)
        }
    };
    let mut end = 8u64 + u64::from(u32_at(&header[4..8]));
    let mut data_size = None;
    if rf64 {
        let mut ds = [0u8; 36];
        file.read_exact(&mut ds)
            .map_err(|_| "RF64 WAV is truncated or missing its ds64 header")?;
        if &ds[0..4] != b"ds64" || u32::from_le_bytes(ds[4..8].try_into().unwrap()) < 28 {
            return Err("RF64 WAV is missing its ds64 size information".into());
        }
        end = 8u64
            .checked_add(u64::from_le_bytes(ds[8..16].try_into().unwrap()))
            .ok_or("Invalid RF64 WAV size")?;
        data_size = Some(u64::from_le_bytes(ds[16..24].try_into().unwrap()));
    }
    if end < 12 || end > len {
        return Err("WAV container is truncated: declared RIFF size exceeds the file".into());
    }
    let mut pos = 12u64;
    while pos < end {
        if end - pos < 8 {
            return Err("WAV container is truncated in a chunk header".into());
        }
        file.seek(SeekFrom::Start(pos))
            .map_err(|e| format!("Cannot inspect WAV chunks: {e}"))?;
        let mut chunk = [0u8; 8];
        file.read_exact(&mut chunk)
            .map_err(|_| "WAV container is truncated in a chunk header")?;
        let declared = u32_at(&chunk[4..8]);
        let size = if rf64 && declared == u32::MAX {
            if &chunk[..4] != b"data" {
                return Err("Unsupported RF64 WAV extended chunk size".into());
            }
            data_size.ok_or("RF64 WAV has no data size")?
        } else {
            u64::from(declared)
        };
        let payload_end = pos
            .checked_add(8)
            .and_then(|p| p.checked_add(size))
            .ok_or("Invalid WAV chunk size")?;
        if payload_end > end {
            return Err("WAV container is truncated: a declared chunk exceeds the file".into());
        }
        // Some valid WAV writers omit only the terminal padding byte. The
        // complete payload must end at both the RIFF boundary and actual EOF;
        // intermediate chunks still require their alignment byte.
        if size & 1 == 1 && payload_end == end && end == len {
            break;
        }
        pos = payload_end
            .checked_add(size & 1)
            .ok_or("Invalid WAV chunk size")?;
        if pos > end {
            return Err("WAV container is truncated: a declared chunk exceeds the file".into());
        }
    }
    Ok(())
}

pub fn convert(decoder: &Path, source: &Path, output: &Path) -> Result<(), String> {
    let result = Command::new(decoder)
        .args([
            "-nostdin",
            "-hide_banner",
            "-loglevel",
            "error",
            "-xerror",
            "-err_detect",
            "explode",
            "-protocol_whitelist",
            "file",
            "-format_whitelist",
            "wav,mp3,mov,aac,flac,ogg,aiff,asf",
            "-i",
        ])
        .arg(source)
        .args([
            "-map",
            "0:a:0",
            "-vn",
            "-sn",
            "-dn",
            "-map_metadata",
            "-1",
            "-c:a",
            "pcm_f32le",
            "-fs",
            "2000000000",
            "-f",
            "wav",
            "-n",
        ])
        .arg(output)
        .output()
        .map_err(|e| format!("Cannot launch bundled audio decoder; reinstall aNotate: {e}"))?;
    if !result.status.success() {
        let message = String::from_utf8_lossy(&result.stderr);
        let summary: String = message.chars().take(1000).collect();
        return Err(format!("Cannot decode audio; the file may be damaged, protected, unsupported, or the disk may be full: {}", summary.trim()));
    }
    let size = fs::metadata(output)
        .map_err(|e| format!("Cannot inspect decoded audio: {e}"))?
        .len();
    if size >= LIMIT - MARGIN {
        return Err(
            "Decoded audio is too large for the 2 GB playback limit; use a shorter recording"
                .into(),
        );
    }
    Ok(())
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn checks_wave_chunk_bounds_without_interpreting_codec() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("audio");
        // A non-PCM format tag is permitted: this only validates RIFF framing.
        let mut bytes = b"RIFF\x18\0\0\0WAVEfmt \x04\0\0\0\x55\0\x02\0data\x00\0\0\0".to_vec();
        fs::write(&file, &bytes).unwrap();
        validate_source_container(&file).unwrap();
        bytes[28..32].copy_from_slice(&20u32.to_le_bytes());
        fs::write(&file, &bytes).unwrap();
        assert!(validate_source_container(&file)
            .unwrap_err()
            .contains("truncated"));
        fs::write(&file, b"RIFF\x20\0\0\0WAVE").unwrap();
        assert!(validate_source_container(&file)
            .unwrap_err()
            .contains("truncated"));
        fs::write(&file, b"not a wave").unwrap();
        validate_source_container(&file).unwrap();
    }

    #[test]
    fn rejects_odd_intermediate_chunk_without_its_padding() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("audio.wav");
        let bytes = b"RIFF\x0d\0\0\0WAVEJUNK\x01\0\0\0xdata\0\0\0\0";
        // Adjust RIFF size so both chunks are inside the declared container.
        let mut bytes = bytes.to_vec();
        let size = (bytes.len() - 8) as u32;
        bytes[4..8].copy_from_slice(&size.to_le_bytes());
        fs::write(&file, bytes).unwrap();
        assert!(validate_source_container(&file).is_err());
    }

    #[test]
    fn accepts_padded_final_chunk_but_not_missing_padding_before_trailing_bytes() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("audio.wav");
        let mut bytes = b"RIFF\x0e\0\0\0WAVEdata\x01\0\0\0x\0".to_vec();
        fs::write(&file, &bytes).unwrap();
        validate_source_container(&file).unwrap();
        // Container declares the final odd byte as its end, but the file has
        // further bytes: this is not the tolerated terminal EOF case.
        bytes[4..8].copy_from_slice(&13u32.to_le_bytes());
        bytes.extend_from_slice(b"trailing");
        fs::write(&file, &bytes).unwrap();
        assert!(validate_source_container(&file).is_err());
    }

    #[test]
    fn checks_big_endian_rifx_and_rf64_sizes() {
        let temp = tempfile::tempdir().unwrap();
        let file = temp.path().join("audio");
        let rifx = b"RIFX\0\0\0\x10WAVEdata\0\0\0\x04\0\0\0\0";
        fs::write(&file, rifx).unwrap();
        validate_source_container(&file).unwrap();
        let mut rf64 = b"RF64\xff\xff\xff\xffWAVEds64\x1c\0\0\0".to_vec();
        rf64.extend_from_slice(&52u64.to_le_bytes());
        rf64.extend_from_slice(&4u64.to_le_bytes());
        rf64.extend_from_slice(&1u64.to_le_bytes());
        rf64.extend_from_slice(&0u32.to_le_bytes());
        rf64.extend_from_slice(b"data\xff\xff\xff\xff\0\0\0\0");
        fs::write(&file, &rf64).unwrap();
        validate_source_container(&file).unwrap();
        rf64.truncate(rf64.len() - 4);
        fs::write(&file, &rf64).unwrap();
        assert!(validate_source_container(&file)
            .unwrap_err()
            .contains("truncated"));
    }

    #[test]
    fn refuses_output_at_the_size_limit_even_if_process_succeeds() {
        let temp = tempfile::tempdir().unwrap();
        let fake = temp.path().join("decoder");
        // A successful process that leaves a sparse oversized file simulates
        // FFmpeg's successful -fs termination without allocating 2 GB.
        fs::write(&fake, "#!/bin/sh\nfor arg do last=$arg; done\n/bin/dd if=/dev/zero of=\"$last\" bs=1 count=1 seek=1999999999 2>/dev/null\n").unwrap();
        fs::set_permissions(&fake, fs::Permissions::from_mode(0o755)).unwrap();
        let error = convert(
            &fake,
            &temp.path().join("input"),
            &temp.path().join("output.wav"),
        )
        .unwrap_err();
        assert!(error.contains("too large"));
    }
}
