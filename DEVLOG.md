# Development Log — ComfyUI 2D Pose Editor

---

## v0.4.0 — 2026-03-17

### Overview
Rig-free capture, drag & drop image input, stadium-shape rig outlines, body proportion tuning,
and atlas template generator overhaul.

### Added
- **Rig-free capture** — `captureWithoutRig()` temporarily hides rig during capture so output is always clean
- **Drag & drop image input** — Image Input Mode now accepts file drops on the node (with visual highlight)
- **Stadium-shape rig outlines** — rig overlay draws the actual bone shape (stadium) as outlines for each part
- **Direction annotations** on atlas template — `↑肘`, `↑手首`, `↑膝` etc. show which end is which

### Changed
- Body proportions adjusted for better balance:
  - `chest` width: 85→90, `abdomen` width: 75→80
  - `handClosed` width/length: 24/25→28/28, `handOpen`: 34/32→36/34
  - `foot` width: 32→36
- Joint gap coverage improved:
  - `arm` texOffset: 0→−10 (shoulder connection)
  - `foot` texOffset: −14→−16 (ankle connection)
- Dummy atlas colors: realistic skin (`#f5c8a0`), cloth (`#7fc8c8`), shoe (`#d4a878`) tones
- `generate_atlas_template.html` rewritten: colored fills matching dummy atlas, stadium-shape outlines with center lines, direction annotations, coordinate labels, and live bone-placement preview
- `generate_sample_atlas.html` bone parameters synced with pose_editor.js

---

## v0.3.0 — 2026-03-16

### Overview
UV atlas overhaul with full left/right separation for all limbs, joint gap fixes using
stadium-shape clip and texOffset, compact UI redesign, background compositing,
image input mode, and output size mode switching.

### Added
- **Background compositing** — optional `background_image` (IMAGE) input; pose is alpha-composited over the background
- **Image Input Mode (I)** — node acts as an image loader (📂), disabling the pose editor; toggle with P/I buttons
- **Output size mode** — three modes selectable from the node UI:
  - `Standard`: uses the canvas render size
  - `Background`: matches the connected background image size
  - `Custom`: user-specified width × height
- **Compact UI redesign**
  - P / I mode toggle buttons (active state highlighted)
  - Action buttons (📸 Capture, 🦴 Rig, RP Reset Pose, RC Reset Camera) right-aligned in mode row
  - Part toggles and texture load button in a separate parts row
  - Canvas display scaled to 80% (384px); node size reduced accordingly
- **Left / Right UV separation** for all limb parts
  - `armL/armR`, `foreArmL/foreArmR`, `handClosedL/R`, `handOpenL/R`
  - `legL/legR`, `shinL/shinR`, `footL/footR`
- **`texOffset` parameter** on Bone — slides child texture under parent to cover joint gaps
- **Stadium-shape clip path** for bone rendering — rectangle + semicircles at both ends, replacing rectangle-only clip

### Fixed
- Joint tear/gap at elbow and knee — covered by `texOffset` overlap (foreArm: −14, shin: −16)
- Hand orientation — both hands now face outward (fingers pointing away from body)
  - `leftHandBone flipTex=true`, `rightHandBone flipTex=true`
  - UV images for handClosedL/R and handOpenL/R drawn with correct thumb placement per side
- Foot orientation — toes now point outward for both feet
  - `footL`: toes → right side of UV; `footR`: toes → left side of UV
- Chest and abdomen gap — `texOffset=−14` added to both bones
- Head, neck, chest, abdomen UV heights expanded for better overlap coverage
- `handOpen` UV upper/lower orientation corrected (palm at top / fingers at bottom to match `flipTex=true`)

### Changed
- UV layout reorganized (no overlapping regions):
  - ROW1 (y:0): head, neck, chest, abdomen
  - ROW2 (y:180): armL/R, foreArmL/R, handClosedL/R, handOpenL/R, footL/R
  - ROW3 (y:370): legL/R, shinL/R
  - ROW4 (y:610): headBack, chestBack, abdomenBack
- `generate_sample_atlas.html` fully rewritten — L/R drawing functions with mirror parameter, stadium preview
- `generate_atlas_template.html` updated to match new UV layout with foot direction annotations

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
