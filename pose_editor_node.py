import torch
import numpy as np
from PIL import Image
import base64
import io


class PoseEditor2DNode:
    """
    2D リギングポーズエディタ ノード
    フロントエンドのキャンバスでポーズを編集し、画像として出力する
    """

    @classmethod
    def INPUT_TYPES(cls):
        return {
            "required": {
                "image_data": ("STRING", {"default": ""}),
            }
        }

    RETURN_TYPES = ("IMAGE",)
    RETURN_NAMES = ("pose_image",)
    FUNCTION = "export_pose"
    CATEGORY = "2D Pose"
    OUTPUT_NODE = False

    def export_pose(self, image_data: str):
        if not image_data or image_data.strip() == "":
            # キャプチャ前はグレーのプレースホルダー画像を返す
            img = Image.new("RGB", (600, 600), (224, 224, 224))
        else:
            try:
                # "data:image/png;base64,..." 形式の場合はヘッダを除去
                if "," in image_data:
                    image_data = image_data.split(",", 1)[1]
                img_bytes = base64.b64decode(image_data)
                img = Image.open(io.BytesIO(img_bytes)).convert("RGB")
            except Exception as e:
                print(f"[PoseEditor2D] 画像デコードエラー: {e}")
                img = Image.new("RGB", (600, 600), (200, 100, 100))

        img_array = np.array(img).astype(np.float32) / 255.0
        img_tensor = torch.from_numpy(img_array).unsqueeze(0)  # (1, H, W, C)
        return (img_tensor,)

    @classmethod
    def IS_CHANGED(cls, image_data):
        # image_data が変わるたびに再実行
        import hashlib
        return hashlib.md5(image_data.encode()).hexdigest()


NODE_CLASS_MAPPINGS = {
    "PoseEditor2D": PoseEditor2DNode,
}

NODE_DISPLAY_NAME_MAPPINGS = {
    "PoseEditor2D": "2D Pose Editor",
}
