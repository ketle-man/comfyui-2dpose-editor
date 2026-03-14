# ComfyUI 2D Pose Editor Node

A ComfyUI custom node that embeds an interactive 2D rigging figure directly inside the node.
Drag joints to pose the figure, then capture it as an `IMAGE` output.

ノード内で 2D リギングフィギュアをドラッグしてポーズを編集し、`IMAGE` として出力する ComfyUI カスタムノードです。

![2D Pose Editor](https://img.shields.io/badge/ComfyUI-Custom%20Node-blue)

---

## Features / 機能

- 🦴 **Full body rigging** — head, neck, chest, abdomen, arms, hands, legs, feet
- 👁️ **Eye control** — drag the pupils to move the gaze direction
- 📸 **One-click capture** — saves the current pose as a PNG image
- 🔄 **Reset** — return to the default pose instantly
- 🔒 **Fixed node size** — clean, consistent layout in the ComfyUI graph

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
4. Click **📸 キャプチャ** to save the current frame
5. Click **Queue Prompt** — the node outputs the pose as an `IMAGE`
6. Click **🔄 リセット** to return to the default pose

### Control points

| Dot | Behavior |
|-----|----------|
| White dot (joint) | Rotate the bone |
| White dot with red skeleton line (shoulder / hip) | Rotate + slide (change length) |
| Black dot (pupil) | Move eye gaze direction |
| Yellow ring | Currently selected / dragging |

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
├── __init__.py          # Node registration, WEB_DIRECTORY
├── pose_editor_node.py  # Backend: base64 PNG → IMAGE tensor
├── js/
│   └── pose_editor.js   # Frontend: ComfyUI extension + rigging logic
└── index_v.html         # Original standalone HTML (reference)
```

---

## Requirements / 動作環境

- [ComfyUI](https://github.com/comfyanonymous/ComfyUI)
- Python 3.10+
- `torch`, `Pillow`, `numpy` (included with ComfyUI)

---

## License

MIT License
