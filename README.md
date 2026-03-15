# ComfyUI 2D Pose Editor Node

A ComfyUI custom node that embeds an interactive 2D rigging figure directly inside the node.
Drag joints to pose the figure, then capture it as an `IMAGE` output.

ノード内で 2D リギングフィギュアをドラッグしてポーズを編集し、`IMAGE` として出力する ComfyUI カスタムノードです。

![2D Pose Editor](https://img.shields.io/badge/ComfyUI-Custom%20Node-blue)
![Version](https://img.shields.io/badge/version-0.2.0-green)

---

## Features / 機能

- 🦴 **Full body rigging** — head, neck, chest, abdomen, arms, hands, legs, feet
- 👁️ **Eye control** — drag the pupils to move the gaze direction
- 🎥 **Camera control** — pan (drag background) and zoom (mouse wheel) with reset
- 🖼️ **Texture atlas** — load a single PNG to skin all body parts via UV mapping
- 👤 **Head toggle** — switch between front face and back of head
- 👕 **Body toggle** — switch between front and back torso
- ✊ **Hand toggle** — switch each hand between open and closed (viewer perspective)
- 👁️‍🗨️ **Rig visibility** — show/hide skeleton lines and control points (reflected in capture)
- 📸 **One-click capture** — saves the current pose as a PNG image
- 🔄 **Reset pose** — return to the default pose instantly

---

## Installation / インストール

### Option A: Clone into custom_nodes

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ketle-man/comfyui-2dpose-editor.git
```

### Option B: Manual
1. Download this repository as a ZIP and extract it
2. Place the `2dpose_custom_cm` folder inside `ComfyUI/custom_nodes/`
3. Restart ComfyUI

---

## Usage / 使い方

1. In ComfyUI, right-click the canvas → **Add Node** → **2D Pose** → **2D Pose Editor**
2. Drag the **white dots** (joints) to pose the figure
3. Drag the **black pupils** to change the eye direction
4. Use the toggle buttons to switch head / body / hand appearance
5. Optionally load a custom texture via **🖼 Load Texture**
6. Click **🦴 Hide Rig** to hide the skeleton overlay before capturing
7. Click **📸 Capture** to save the current frame
8. Click **Queue Prompt** — the node outputs the pose as an `IMAGE`
9. Click **🔄 Reset Pose** to return to the default pose

### Camera controls

| Operation | Action |
|-----------|--------|
| Drag background | Pan the camera |
| Mouse wheel | Zoom in / out |
| 🎥 Reset Camera | Return to default view |

### Control points

| Dot | Behavior |
|-----|----------|
| White dot (joint) | Rotate the bone |
| Red dashed line (shoulder / hip) | Rotate + slide (change length) |
| Black dot (pupil) | Move eye gaze direction |
| Yellow ring | Currently selected / dragging |

### Texture Atlas

The node supports a **single sprite-sheet image** (texture atlas) for skinning all body parts.
UV coordinates are based on a **1024×1024** reference layout, but any image size is accepted —
UV coordinates scale automatically to match the loaded image.

Use `generate_atlas_template.html` to export a labeled 1024×1024 template PNG,
then paint your character parts inside each colored region.

**Atlas layout:**

| Row | Parts | Y offset |
|-----|-------|----------|
| 1 | head, neck, chest, abdomen | 0 |
| 2 | arm, foreArm, handClosed, handOpen | 160 |
| 3 | leg, shin, foot | 340 |
| 4 | headBack, chestBack, abdomenBack | 560 |

---

## Node Spec / ノード仕様

| Item | Value |
|------|-------|
| Node name | `PoseEditor2D` |
| Display name | `2D Pose Editor` |
| Category | `2D Pose` |
| Input | `image_data` (STRING, hidden — set by the JS widget) |
| Output | `IMAGE` — shape `(1, H, W, C)`, float32 torch tensor |

---

## File Structure / ファイル構成

```
2dpose_custom_cm/
├── __init__.py                   # Node registration, WEB_DIRECTORY
├── pose_editor_node.py           # Backend: base64 PNG → IMAGE tensor
├── js/
│   └── pose_editor.js            # Frontend: ComfyUI extension + rigging logic
├── index_v2.html                 # Standalone reference HTML (v0.2.0 features)
├── generate_atlas_template.html  # Tool: export 1024×1024 UV template PNG
└── generate_sample_atlas.html    # Tool: export sample figure texture atlas
```

---

## Changelog

### v0.2.0
- Camera pan and zoom with reset button
- Texture atlas support (UV-based, auto-scales to image size)
- Head front/back, body front/back, hand open/close toggles
- Rig / control point show-hide toggle (reflected in capture output)
- Fixed texture orientation per bone (`flipTex` flag)
- Load Texture button (English label, custom file picker)
- Added atlas template and sample atlas generator tools

### v0.1.0
- Initial release: full body rigging inside a ComfyUI node
- Eye gaze control, capture, reset

---

## Requirements / 動作環境

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- Python 3.10+
- `torch`, `Pillow`, `numpy` (included with ComfyUI)

---

## License

MIT License
