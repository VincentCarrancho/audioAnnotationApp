# wavNotes

A macOS listening notebook for WAV recordings. Capture a marker with **M** while listening; pause to write through the focus queue. Drag a passage to select it and choose **Annotate selection** to create a range note. Notes use Editor.js; Save (⌘S) saves without completing the current item.

## Run

Install Node.js and npm, Rust through [rustup](https://rustup.rs/), and the Apple Command Line Tools (`xcode-select --install`). Use macOS with the Tauri prerequisites installed.

```sh
npm install
npm run desktop:dev
```

Choose **New project**, select a WAV, name the project and choose a parent folder. The app copies the recording into the project folder; the original is not modified. **Open project** selects an existing project folder. Keep the entire folder together if moving it.

```sh
npm run build         # typecheck and build frontend
npm run typecheck
npm test
npm run desktop:build # native release bundle
```

`npm run dev` starts a browser-only interface for iteration. It cannot create, open, or save native projects; the explicitly labelled preview uses a bundled two-second fixture and discards edits. It is not a native playback or persistence test.

## Working with notes

Capture with M outside an editor, or use **Add marker**. Playback continues while capturing; pausing opens the first queued item. **Done → Next** completes an item, while **Skip for now** leaves it pending for a later pass. Normal playback during review does not move to another note. Select a marker or an item in the chronological note navigation to open it without seeking; use the explicit play or loop buttons to listen from it. Delete is separately undoable with **Undo delete** or ⌘Z (Ctrl+Z) outside an editor. The project note is independent of annotations.

Changes are autosaved after editing. A failed save remains visible and the app asks before discarding unsaved content on project switch or native close. The recording and notes are stored together in the project folder.
