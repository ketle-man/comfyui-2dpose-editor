# Development Log — ComfyUI 2D Pose Editor

---

## v0.2.0 — 2026-03-15

### Overview
Major feature update. Rebuilt the frontend around a texture atlas (UV-based sprite sheet),
added camera controls, part visibility toggles, and rig overlay show/hide.

### Added
- **Camera controls**
  - Background drag to pan
  - Mouse wheel to zoom (range: 0.2×–5.0×)
  - 🎥 Reset Camera button to restore default view
- **Texture atlas support**
  - Load a single PNG image to skin all body parts via UV mapping
  - UV coordinates based on 1024×1024 reference layout
  - Image size is detected on load; UV coordinates scale automatically
  - 🖼 Load Texture button (English label, custom file picker with filename display)
- **Part toggle buttons**
  - 👤 Head: Front / Back — switches UV between front face and back of head; hides pupils in back mode
  - 👕 Body: Front / Back — switches chest and abdomen UV between front and back textures
  - ✊ Left / Right hand open / close — switches hand UV and adjusts bone length (viewer perspective)
- **Rig visibility toggle**
  - 🦴 Hide Rig / Show Rig button toggles skeleton lines and control points
  - Capture output reflects the current visibility state (hidden rig = clean image)
- **Atlas tools**
  - `generate_atlas_template.html` — generates and downloads a labeled 1024×1024 UV template PNG
  - `generate_sample_atlas.html` — generates a sample figure texture atlas with preview

### Fixed
- Texture orientation corrected per bone using `flipTex` flag
  - `flipTex = false` (default): texture top = tip side (head top, fingertip, toe)
  - `flipTex = true`: texture top = root side (elbow→wrist, knee→ankle)
  - Affected bones: `foreArm`, `shin`, `foot` → `flipTex = true`
- Left / Right hand buttons now operate from viewer perspective
  - Left button → right hand bone (screen left)
  - Right button → left hand bone (screen right)
- Load Texture button label is now English (replaced native `<input type="file">` with custom button)

### Changed
- Node height increased to accommodate new button rows (650×830)
- Bone constructor extended with `flipTex` parameter (10th argument, default `false`)
- `draw()` split into guarded sections: textures always drawn, rig drawn only when `showRig = true`

---

## v0.1.0 — 2026-03-14

### Overview
Initial release. A ComfyUI custom node with an interactive 2D rigging figure
embedded directly inside the node widget.

### Added
- **Full body rig** — 20+ bones: head, neck, chest, abdomen, shoulders, arms, forearms,
  hands, hips, legs, shins, feet
- **Eye gaze control** — drag black pupil dots to move gaze direction independently per eye
- **Bone interaction**
  - White dots: rotate the bone
  - Red dashed lines (shoulder / hip): rotate + slide to change bone length
  - Yellow ring: highlights the selected bone
- **📸 Capture button** — writes canvas PNG as base64 to the hidden `image_data` widget;
  Queue Prompt outputs it as a float32 IMAGE tensor `(1, H, W, C)`
- **🔄 Reset button** — rebuilds the rig and redraws the default pose
- **Fixed node size** (650×740) with `resizable = false`
- **Part images** generated programmatically (colored rounded rectangles with labels)
- `pose_editor_node.py` — backend decodes base64 PNG → PIL → numpy → torch tensor
- `__init__.py` — registers node and sets `WEB_DIRECTORY = "./js"`
- `index_v.html` — standalone reference HTML used as the basis for the node frontend
- `README.md`, `LICENSE` (MIT)

### Also in v0.1.0 (post-release patch)
- Button labels changed from Japanese to English
  (`📸 キャプチャ` → `📸 Capture`, `🔄 リセット` → `🔄 Reset`)

---

## Planned / Ideas

- Pose save / load (JSON export and import)
- Mirror pose (flip left ↔ right)
- Additional part variants (expressions, shoes, accessories)
- Touch / stylus support for tablet use
- Background image input for reference overlay
