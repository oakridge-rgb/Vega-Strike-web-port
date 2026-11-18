# Technical Feasibility Report — Summary

Full report: [`feasibility-report.pdf`](feasibility-report.pdf) (15 pages, tables and figures; a .docx version ships alongside the project release). Investigation date: 2026-11-18. Evidence basis: upstream repository inspection (GitHub API), in-sandbox Emscripten 7.0.0 compile tests, and this project's own verification suite (re-run, all pass).

## Verdict

A staged upgrade is feasible and recommended; a big-bang rewrite is not.

- **The modern engine has no Ogre dependency.** Master (release 0.11.0-era) states in its own CMakeLists: *"Always building without Ogre now"*. Its dependencies (SDL2, OpenAL, Vorbis, libjpeg/libpng, zlib, embedded Python 3) map almost item-for-item onto Emscripten's maintained ports.
- **Toolchain probes pass in this sandbox (tested):** Emscripten 7.0.0 compiled SDL2+WebGL2 and OpenAL+Vorbis+zlib smoke programs; the fixed-function `LEGACY_GL_EMULATION` shim still exists — important because the classic renderer draws in `glBegin/glEnd` style.
- **One decisive risk:** the engine embeds CPython via Boost.Python (most gameplay — missions, quests, fixers, base dialogs — is 225 Python files, 1.3 MB, in the asset repo). Boost.Python has no known WebAssembly build. This is the go/no-go item, resolved by a time-boxed spike, not assumed.
- **A playable original-asset subset weighs ~91 MB** (6-ship cast 19.9 MB measured; sounds 9.1 MB; music/HUD/planet subsets estimated), not 1.49 GB. Browser storage handles this.

## Reuse directly / compatibility work / missing

| Bucket | Items |
| --- | --- |
| **Reuse directly** | universe data (units.csv, master_part_list.csv, .system files — already in the port); Python gameplay scripts (as executable logic in the engine path, or as the spec for the JS path); Ogg audio; .bfxm models (native for the wasm engine); engine source (~260k LOC C++, estimate); GPL LICENSE corpus (already shipped) |
| **Compatibility work** | .texture/.image/.cube texture containers → KTX2/PNG for the JS path (none needed for wasm engine); bfxm→glTF converter for the JS renderer; GL fixed-function audit; Python embedding (major); libepoxy/GLU/freeglut substitution; vendored expat; single-threading audit; save-format bridge |
| **Missing either way** | 4-quadrant shields + 8-facet armour; afterburner/time compression/autopilot; missiles/turrets/beams/cloak/ECM; ship dealers + mount limits; base interiors with dialogue; dynamic universe/news/campaigns; faction standing |

The full 17-row feature comparison (original documented feature set vs the port, each row marked *tested / partial / missing*) is in Section 7 of the PDF.

## Recommended roadmap (nothing is destroyed at any step)

1. **Phase 1 — authentic assets + mechanics inside the existing JS game** (est. 4-8 person-weeks): bfxm/texture conversion pipeline, real Llama/Mule/Dostoevsky models rendered in the existing WebGL scene, quadrant shields, afterburner, three more mission types transcribed from upstream Python, ship dealer from units.csv prices. Existing test suite must still pass.
2. **Phase 2 — two time-boxed WASM spikes** (est. 2-3 person-weeks): (A) headless engine boot without Python; (B) CPython-on-wasm linking a minimal gameplay-API binding loading one upstream mission script. Written go/no-go verdicts.
3. **Phase 3 — full engine in the browser** (est. 6-12 person-months, only on a double pass): engine build against the ~91 MB subset, engine-native saves, performance pass. Desktop browsers first; mobile claims nothing until measured.

**Gate rule:** either Phase 2 spike failing means the JS port stays the permanent path and Phase 1 continues; the current port remains the shipped product at every boundary. Every phase is additive; the test suite is the regression contract.
