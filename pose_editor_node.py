import torch
import numpy as np
from PIL import Image
import base64
import io


class PoseEditor2DNode:
    """
    2D リギングポーズエディタ ノード
    - ポーズエディタでポーズを編集し IMAGE として出力
    - background_image 入力で背景合成・複数人物の重ね合わせ対応
    - image_input_mode=True で画像読込ノードとして動作（ポーズエディタオフ）
    - output_size_mode: Standard / Background / Custom
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_data":       ("STRING", {"default": ""}),
                "output_size_mode": (["Standard", "Background", "Custom"], {"default": "Standard"}),
                "custom_width":     ("INT", {"default": 600, "min": 64, "max": 4096, "step": 8}),
                "custom_height":    ("INT", {"default": 600, "min": 64, "max": 4096, "step": 8}),
            },
            "optional": {
                "background_image": ("IMAGE",),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("image",)
    FUNCTION = "export_pose"
    CATEGORY = "2D Pose"
    OUTPUT_NODE = False

    def export_pose(self,
                    image_data: str,
                    output_size_mode: str = "Standard",
                    custom_width: int = 600,
                    custom_height: int = 600,
                    background_image=None,
                    **kwargs):

        # ---- 背景画像の準備 ----
        bg_pil = None
        if background_image is not None:
            bg_np = (background_image[0].numpy() * 255).clip(0, 255).astype(np.uint8)
            bg_pil = Image.fromarray(bg_np).convert("RGBA")

        # ---- image_data デコード ----
        pose_pil = None
        if image_data and image_data.strip():
            try:
                data = image_data
                if "," in data:
                    data = data.split(",", 1)[1]
                pose_pil = Image.open(io.BytesIO(base64.b64decode(data))).convert("RGBA")
            except Exception as e:
                print(f"[PoseEditor2D] 画像デコードエラー: {e}")

        # ---- 出力サイズ決定 ----
        if output_size_mode == "Background" and bg_pil is not None:
            out_w, out_h = bg_pil.size
        elif output_size_mode == "Custom":
            out_w, out_h = custom_width, custom_height
        else:  # Standard（またはBackgroundで背景なし）
            if pose_pil is not None:
                out_w, out_h = pose_pil.size
            elif bg_pil is not None:
                out_w, out_h = bg_pil.size
            else:
                out_w, out_h = 600, 600

        def fit_contain(img: Image.Image, w: int, h: int) -> tuple[Image.Image, int, int]:
            """アスペクト比を保ったまま w×h に収め、オフセットも返す"""
            iw, ih = img.size
            scale = min(w / iw, h / ih)
            nw, nh = round(iw * scale), round(ih * scale)
            resized = img.resize((nw, nh), Image.LANCZOS)
            ox, oy = (w - nw) // 2, (h - nh) // 2
            return resized, ox, oy

        # ---- 合成 ----
        result = Image.new("RGBA", (out_w, out_h), (224, 224, 224, 255))

        # 背景を貼る（背景は出力キャンバス全体にフィット）
        if bg_pil is not None:
            bg_resized = bg_pil.resize((out_w, out_h), Image.LANCZOS) if bg_pil.size != (out_w, out_h) else bg_pil
            result.paste(bg_resized, (0, 0))

        # ポーズ（前景）を貼る（アスペクト比を保って中央配置）
        if pose_pil is not None:
            pose_resized, ox, oy = fit_contain(pose_pil, out_w, out_h)
            result.paste(pose_resized, (ox, oy), pose_resized)

        # ---- テンソル変換 ----
        result_rgb = result.convert("RGB")
        img_array = np.array(result_rgb).astype(np.float32) / 255.0
        img_tensor = torch.from_numpy(img_array).unsqueeze(0)  # (1, H, W, C)
        return (img_tensor,)

    @classmethod
    def IS_CHANGED(cls, image_data, output_size_mode="Standard",
                   custom_width=600, custom_height=600, background_image=None, **kwargs):
        import hashlib
        key = f"{image_data}|{output_size_mode}|{custom_width}|{custom_height}"
        return hashlib.md5(key.encode()).hexdigest()


NODE_CLASS_MAPPINGS = {
    "PoseEditor2D": PoseEditor2DNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PoseEditor2D": "2D Pose Editor",
}
