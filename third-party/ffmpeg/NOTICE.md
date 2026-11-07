# FFmpeg decoder

aNotate uses the FFmpeg command-line program as an independent subprocess.
FFmpeg is copyright its contributors and is licensed under LGPL 2.1 or later
for this build. Its source is https://ffmpeg.org/releases/ffmpeg-7.1.1.tar.xz
(SHA-256 `733984395e0dbbe5c046abda2dc49a5544e7e0e1e2366bba849222ae9e3a03b1`).
The exact configure and build commands are in `provision-decoder.sh` (included
alongside this notice; in the project repository it is under `scripts/`);
GPL, version 3, nonfree, network, shared libraries and auto-detected external
libraries are disabled. The original unmodified source and build script permit
rebuilding and relinking the separate executable. The source archive is also
available through the FFmpeg release archive above. The source repository for
the application and provisioning script is https://github.com/VincentCarrancho/audioAnnotationApp.
Distributors must ensure
corresponding source and these notices remain available to recipients, and
review LGPL compliance for their distribution. FFmpeg is not endorsed by this
project. FFmpeg: https://ffmpeg.org/.

The decoder preserves the selected stream's sample rate and channel count,
producing 32-bit float PCM WAV. Files approaching the 2,000,000,000-byte
playback limit are rejected rather than accepted as truncated.
New imports preserve the original basename in the `original/` project folder;
older `original/source` references remain valid. Import checks declared WAV
container and chunk bounds but cannot detect every corrupt compressed stream.

Developer builds verify the cached executable, configuration, archive digest,
compiler fingerprint, architecture and macOS system-library linkage. Cache misses
unpack a fresh copy of the verified source rather than rebuilding an old tree.
The format acceptance gate is `scripts/verify-audio-import.sh` with explicit
`ANOTATE_AUDIO_FIXTURES` and `ANOTATE_TEST_DECODER` paths; fixture generation is
separate and may use a local encoder, which is never shipped or used for import.
