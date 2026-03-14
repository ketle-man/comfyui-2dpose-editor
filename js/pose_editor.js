import { app } from "../../scripts/app.js";

// ============================================================
// ComfyUI 2D Pose Editor 拡張
// index_v.html のリギングロジックをノード内キャンバスに移植
// ============================================================

app.registerExtension({
    name: "Comfy.2DPoseEditor",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PoseEditor2D") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const ret = onNodeCreated?.apply(this, arguments);
            const node = this;

            // --- image_data ウィジェットを非表示にする ---
            setTimeout(() => {
                const imgWidget = node.widgets?.find(w => w.name === "image_data");
                if (imgWidget) {
                    imgWidget.computeSize = () => [0, -4];
                    imgWidget.hidden = true;
                }
                node.setDirtyCanvas(true, true);
            }, 0);

            // --- コンテナ作成 ---
            const container = document.createElement("div");
            container.style.cssText =
                "display:flex;flex-direction:column;align-items:center;" +
                "background:#2c2c2c;padding:6px;box-sizing:border-box;";

            // --- キャンバス作成 ---
            const cvs = document.createElement("canvas");
            cvs.width = 600;
            cvs.height = 600;
            cvs.style.cssText =
                "background:#e0e0e0;border-radius:6px;cursor:grab;" +
                "display:block;box-shadow:0 2px 8px rgba(0,0,0,0.5);";
            cvs.addEventListener("mousedown", () => { cvs.style.cursor = "grabbing"; });
            cvs.addEventListener("mouseup",   () => { cvs.style.cursor = "grab"; });
            cvs.addEventListener("mouseleave",() => { cvs.style.cursor = "grab"; });

            // --- ボタン行 ---
            const btnRow = document.createElement("div");
            btnRow.style.cssText = "display:flex;gap:8px;margin-top:8px;";

            const captureBtn = makeButton("📸 Capture", "#4a90d9");
            const resetBtn   = makeButton("🔄 Reset",   "#6c757d");

            btnRow.appendChild(captureBtn);
            btnRow.appendChild(resetBtn);
            container.appendChild(cvs);
            container.appendChild(btnRow);

            // --- リギングエディタ初期化 ---
            const editor = initPoseEditor(cvs);

            // --- キャプチャボタン ---
            captureBtn.addEventListener("click", () => {
                const dataUrl = cvs.toDataURL("image/png");
                const imgWidget = node.widgets?.find(w => w.name === "image_data");
                if (imgWidget) {
                    imgWidget.value = dataUrl;
                }
                captureBtn.textContent = "✅ Captured!";
                captureBtn.style.background = "#28a745";
                setTimeout(() => {
                    captureBtn.textContent = "📸 Capture";
                    captureBtn.style.background = "#4a90d9";
                }, 1800);
            });

            // --- リセットボタン ---
            resetBtn.addEventListener("click", () => {
                editor.reset();
            });

            // --- DOM ウィジェットとして追加 ---
            node.addDOMWidget("pose_editor_widget", "pose_editor", container, {
                getValue() {
                    const imgWidget = node.widgets?.find(w => w.name === "image_data");
                    return imgWidget?.value ?? "";
                },
                setValue() {},
                computeSize() { return [630, 660]; },
            });

            // ノードサイズを固定（リサイズ不可）
            const FIXED_SIZE = [650, 740];
            node.size = [...FIXED_SIZE];
            node.resizable = false;
            node.onResize = function () {
                this.size = [...FIXED_SIZE];
            };

            return ret;
        };
    },
});

// ---- ボタン生成ヘルパー ----
function makeButton(label, bg) {
    const btn = document.createElement("button");
    btn.textContent = label;
    btn.style.cssText =
        `padding:7px 16px;background:${bg};color:#fff;border:none;` +
        "border-radius:5px;cursor:pointer;font-size:13px;font-weight:bold;" +
        "transition:opacity 0.15s;";
    btn.addEventListener("mouseover", () => { btn.style.opacity = "0.85"; });
    btn.addEventListener("mouseout",  () => { btn.style.opacity = "1"; });
    return btn;
}

// ============================================================
// リギングエディタ本体（index_v.html のロジックを移植）
// ============================================================
function initPoseEditor(canvas) {
    const ctx = canvas.getContext("2d");
    const CANVAS_W = canvas.width;
    const CANVAS_H = canvas.height;

    // ---- パーツ画像生成 ----
    function createPartImage(color, text, w, h) {
        const tmp = document.createElement("canvas");
        tmp.width = w; tmp.height = h;
        const tc = tmp.getContext("2d");
        tc.fillStyle = color;
        tc.beginPath();
        if (tc.roundRect) {
            tc.roundRect(0, 0, w, h, 12);
        } else {
            tc.rect(0, 0, w, h);
        }
        tc.fill();
        tc.strokeStyle = "#333"; tc.lineWidth = 2; tc.stroke();
        if (text !== "Head") {
            tc.fillStyle = "#333"; tc.font = "13px Arial";
            tc.textAlign = "center"; tc.textBaseline = "middle";
            tc.fillText(text, w / 2, h / 2);
        }
        const img = new Image();
        img.src = tmp.toDataURL();
        return img;
    }

    const imgs = {
        head:    createPartImage("#ffcccc", "Head",    55, 75),
        neck:    createPartImage("#ffddcc", "Neck",    26, 35),
        chest:   createPartImage("#ccffcc", "Chest",   85, 75),
        abdomen: createPartImage("#aaddaa", "Abdomen", 75, 65),
        arm:     createPartImage("#ccccff", "Arm",     30, 80),
        foreArm: createPartImage("#ccccff", "Fore",    26, 70),
        hand:    createPartImage("#ffeedd", "Hand",    24, 30),
        leg:     createPartImage("#ffffcc", "Leg",     40, 100),
        shin:    createPartImage("#ffffcc", "Shin",    34, 95),
        foot:    createPartImage("#dddddd", "Foot",    28, 40),
    };

    // ---- Bone クラス ----
    class Bone {
        constructor(name, length, localAngle, image, width, parent = null,
                    isSlidable = false, minLen = 10, maxLen = 100) {
            this.name       = name;
            this.length     = length;
            this.localAngle = localAngle;
            this.image      = image;
            this.width      = width;
            this.parent     = parent;
            this.isSlidable = isSlidable;
            this.minLen     = minLen;
            this.maxLen     = maxLen;
            this.children   = [];
            if (parent) parent.children.push(this);
            this.gx = 0; this.gy = 0; this.gAngle = 0;
            this.endX = 0; this.endY = 0;
            // 初期値を記録（リセット用）
            this._initLength     = length;
            this._initLocalAngle = localAngle;
        }
        update(px, py, pa) {
            this.gx = px; this.gy = py;
            this.gAngle = pa + this.localAngle;
            this.endX = px + Math.cos(this.gAngle) * this.length;
            this.endY = py + Math.sin(this.gAngle) * this.length;
            for (const c of this.children) c.update(this.endX, this.endY, this.gAngle);
        }
        resetToInit() {
            this.length     = this._initLength;
            this.localAngle = this._initLocalAngle;
        }
    }

    // ---- リグ構築 ----
    const ROOT_X = CANVAS_W / 2;
    const ROOT_Y = CANVAS_H * 0.533;
    const ROOT_A = 0;
    let root, allBones, drawOrder;

    function buildRig() {
        root = new Bone("Root", 0, 0, null, 0);

        // 胴体
        const abdomen = new Bone("Abdomen", 55, -Math.PI / 2, imgs.abdomen, 75, root);
        const chest   = new Bone("Chest",   65, 0,            imgs.chest,   85, abdomen);
        const neck    = new Bone("Neck",    20, 0,            imgs.neck,    26, chest);
        const head    = new Bone("Head",    50, 0,            imgs.head,    55, neck);

        // 目（見えないボーン＋黒点）
        const leftEyeBase  = new Bone("LeftEyeBase",  28, -0.4, null, 0, neck);
        const rightEyeBase = new Bone("RightEyeBase", 28,  0.4, null, 0, neck);
        const leftEye      = new Bone("LeftEye",  2, 0, null, 0, leftEyeBase,  true, 0, 7);
        const rightEye     = new Bone("RightEye", 2, 0, null, 0, rightEyeBase, true, 0, 7);

        // 肩・腕
        const lShoulder  = new Bone("LeftShoulder",  35, -Math.PI / 2,       null,         0, chest,    true, 15, 80);
        const rShoulder  = new Bone("RightShoulder", 35,  Math.PI / 2,       null,         0, chest,    true, 15, 80);
        const lArm       = new Bone("LeftArm",       70, -Math.PI / 2 + 0.3, imgs.arm,    30, lShoulder);
        const lForeArm   = new Bone("LeftForeArm",   60,  0,                 imgs.foreArm, 26, lArm);
        const lHand      = new Bone("LeftHand",      25,  0,                 imgs.hand,   24, lForeArm);
        const rArm       = new Bone("RightArm",      70,  Math.PI / 2 - 0.3, imgs.arm,    30, rShoulder);
        const rForeArm   = new Bone("RightForeArm",  60,  0,                 imgs.foreArm, 26, rArm);
        const rHand      = new Bone("RightHand",     25,  0,                 imgs.hand,   24, rForeArm);

        // 腰・足
        const lHip  = new Bone("LeftHip",   25,  Math.PI,           null,     0, root,  true, 10, 60);
        const rHip  = new Bone("RightHip",  25,  0,                 null,     0, root,  true, 10, 60);
        const lLeg  = new Bone("LeftLeg",   90, -Math.PI / 2 + 0.1, imgs.leg, 40, lHip);
        const lShin = new Bone("LeftShin",  85,  0,                 imgs.shin,34, lLeg);
        const lFoot = new Bone("LeftFoot",  30,  Math.PI / 2,       imgs.foot,28, lShin);
        const rLeg  = new Bone("RightLeg",  90,  Math.PI / 2 - 0.1, imgs.leg, 40, rHip);
        const rShin = new Bone("RightShin", 85,  0,                 imgs.shin,34, rLeg);
        const rFoot = new Bone("RightFoot", 30,  Math.PI / 2,       imgs.foot,28, rShin);

        // 描画順（後ろほど手前）
        drawOrder = [
            lHand, lForeArm, lArm, lShoulder,
            lFoot, lShin, lLeg, lHip,
            abdomen, chest, neck, head,
            leftEye, rightEye,
            rFoot, rShin, rLeg, rHip,
            rHand, rForeArm, rArm, rShoulder,
        ];
        allBones = drawOrder;
    }

    // ---- 描画 ----
    function draw() {
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);

        // A. パーツ画像 & 目
        for (const bone of drawOrder) {
            if (bone.image) {
                ctx.save();
                ctx.translate(bone.gx, bone.gy);
                ctx.rotate(bone.gAngle - Math.PI / 2);
                ctx.drawImage(bone.image, -bone.width / 2, 0, bone.width, bone.length + 10);
                ctx.restore();
            } else if (bone.name.includes("Eye")) {
                ctx.beginPath();
                ctx.arc(bone.endX, bone.endY, 5, 0, Math.PI * 2);
                ctx.fillStyle = "#222";
                ctx.fill();
                if (bone === selectedBone) {
                    ctx.beginPath();
                    ctx.arc(bone.endX, bone.endY, 9, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(255,255,0,0.9)";
                    ctx.lineWidth = 2;
                    ctx.stroke();
                }
            }
        }

        // B. 骨格ライン
        ctx.lineWidth = 2;
        for (const bone of allBones) {
            if (bone.name === "Root" || bone.name.includes("Eye") || bone.name.includes("EyeBase")) continue;
            ctx.beginPath();
            ctx.moveTo(bone.gx, bone.gy);
            ctx.lineTo(bone.endX, bone.endY);
            if (bone.isSlidable) {
                ctx.strokeStyle = "rgba(255,60,60,0.75)";
                ctx.setLineDash([5, 5]);
            } else {
                ctx.strokeStyle = "rgba(120,120,120,0.3)";
                ctx.setLineDash([]);
            }
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // C. 関節ポイント（小さい白ドット）
        for (const bone of allBones) {
            if (bone.name === "Root" || bone.name.includes("Eye") || bone.name.includes("EyeBase")) continue;

            // 選択中のみ黄色リングでハイライト
            if (bone === selectedBone) {
                ctx.beginPath();
                ctx.arc(bone.endX, bone.endY, 8, 0, Math.PI * 2);
                ctx.strokeStyle = "rgba(255,230,0,0.85)";
                ctx.lineWidth = 2;
                ctx.stroke();
            }

            // 白い小ドット
            ctx.beginPath();
            ctx.arc(bone.endX, bone.endY, 4, 0, Math.PI * 2);
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.fill();
            ctx.strokeStyle = "rgba(80,80,80,0.6)";
            ctx.lineWidth = 1;
            ctx.stroke();
        }
    }

    // ---- マウス操作 ----
    let isDragging = false;
    let selectedBone = null;

    canvas.addEventListener("mousedown", (e) => {
        const r = canvas.getBoundingClientRect();
        const scaleX = CANVAS_W / r.width;
        const scaleY = CANVAS_H / r.height;
        const mx = (e.clientX - r.left) * scaleX;
        const my = (e.clientY - r.top)  * scaleY;

        let minDist = Infinity;
        selectedBone = null;

        for (let i = allBones.length - 1; i >= 0; i--) {
            const bone = allBones[i];
            const dist = Math.hypot(bone.endX - mx, bone.endY - my);
            const hit  = bone.name.includes("Eye") ? 15 : 20;
            if (dist < hit && dist < minDist) {
                minDist = dist;
                selectedBone = bone;
            }
        }
        if (selectedBone) isDragging = true;
        draw();
    });

    canvas.addEventListener("mousemove", (e) => {
        if (!isDragging || !selectedBone) return;
        const r = canvas.getBoundingClientRect();
        const scaleX = CANVAS_W / r.width;
        const scaleY = CANVAS_H / r.height;
        const mx = (e.clientX - r.left) * scaleX;
        const my = (e.clientY - r.top)  * scaleY;

        const targetAngle = Math.atan2(my - selectedBone.gy, mx - selectedBone.gx);
        const parentAngle = selectedBone.parent ? selectedBone.parent.gAngle : ROOT_A;
        selectedBone.localAngle = targetAngle - parentAngle;

        if (selectedBone.isSlidable) {
            const dist = Math.hypot(mx - selectedBone.gx, my - selectedBone.gy);
            selectedBone.length = Math.max(selectedBone.minLen, Math.min(dist, selectedBone.maxLen));
        }

        root.update(ROOT_X, ROOT_Y, ROOT_A);
        draw();
    });

    canvas.addEventListener("mouseup",    () => { isDragging = false; selectedBone = null; draw(); });
    canvas.addEventListener("mouseleave", () => { isDragging = false; selectedBone = null; draw(); });

    // ---- 初期化 & リセット ----
    function reset() {
        buildRig();
        root.update(ROOT_X, ROOT_Y, ROOT_A);
        draw();
    }

    // 画像ロードを待ってから初描画
    let loadCount = 0;
    const imgList = Object.values(imgs);
    imgList.forEach(img => {
        if (img.complete) {
            if (++loadCount === imgList.length) reset();
        } else {
            img.addEventListener("load", () => {
                if (++loadCount === imgList.length) reset();
            });
        }
    });

    return { reset };
}
