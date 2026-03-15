import { app } from "../../scripts/app.js";

// ============================================================
// ComfyUI 2D Pose Editor 拡張
// index_v2.html のリギングロジックをノード内キャンバスに移植
// カメラ操作・頭/体/手切り替え・テクスチャ(1枚絵UV)対応
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

            // --- ボタン行1: 切り替えボタン ---
            const btnRow1 = document.createElement("div");
            btnRow1.style.cssText = "display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap;justify-content:center;";

            const btnToggleHead  = makeButton("👤 Head: Front",  "#9c27b0");
            const btnToggleBody  = makeButton("👕 Body: Front",  "#9c27b0");
            const btnToggleLHand = makeButton("Left: ✊",         "#ff9800");
            const btnToggleRHand = makeButton("Right: ✊",        "#ff9800");

            btnRow1.appendChild(btnToggleHead);
            btnRow1.appendChild(btnToggleBody);
            btnRow1.appendChild(btnToggleLHand);
            btnRow1.appendChild(btnToggleRHand);

            // --- テクスチャアップロード行 ---
            const texRow = document.createElement("div");
            texRow.style.cssText = "display:flex;gap:6px;margin-bottom:6px;align-items:center;";

            // ネイティブ input は非表示にしてカスタムボタンで英語表示
            const texInput = document.createElement("input");
            texInput.type = "file";
            texInput.accept = "image/*";
            texInput.style.cssText = "display:none;";

            const texBtn = document.createElement("button");
            texBtn.textContent = "🖼 Load Texture";
            texBtn.style.cssText =
                "padding:4px 12px;background:#555;color:#fff;border:none;" +
                "border-radius:4px;cursor:pointer;font-size:12px;font-weight:bold;";
            texBtn.addEventListener("mouseover", () => { texBtn.style.background = "#777"; });
            texBtn.addEventListener("mouseout",  () => { texBtn.style.background = "#555"; });
            texBtn.addEventListener("click", () => texInput.click());

            const texName = document.createElement("span");
            texName.textContent = "No file";
            texName.style.cssText = "color:#aaa;font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;";

            texInput.addEventListener("change", () => {
                texName.textContent = texInput.files[0]?.name ?? "No file";
            });

            texRow.appendChild(texBtn);
            texRow.appendChild(texName);
            texRow.appendChild(texInput);

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

            // --- ボタン行2: Capture / Reset / Camera Reset / Toggle Rig ---
            const btnRow2 = document.createElement("div");
            btnRow2.style.cssText = "display:flex;gap:8px;margin-top:8px;flex-wrap:wrap;justify-content:center;";

            const captureBtn     = makeButton("📸 Capture",      "#4a90d9");
            const resetBtn       = makeButton("🔄 Reset Pose",   "#6c757d");
            const cameraResetBtn = makeButton("🎥 Reset Camera", "#5a7a5a");
            const toggleRigBtn   = makeButton("🦴 Hide Rig",     "#4a7a6a");

            btnRow2.appendChild(captureBtn);
            btnRow2.appendChild(resetBtn);
            btnRow2.appendChild(cameraResetBtn);
            btnRow2.appendChild(toggleRigBtn);

            container.appendChild(btnRow1);
            container.appendChild(texRow);
            container.appendChild(cvs);
            container.appendChild(btnRow2);

            // --- リギングエディタ初期化 ---
            const editor = initPoseEditor(cvs, {
                btnToggleHead,
                btnToggleBody,
                btnToggleLHand,
                btnToggleRHand,
                texInput,
            });

            // --- リグ表示切り替えボタン ---
            toggleRigBtn.addEventListener("click", () => {
                const visible = editor.toggleRig();
                toggleRigBtn.textContent = visible ? "🦴 Hide Rig" : "🦴 Show Rig";
                toggleRigBtn.style.background = visible ? "#4a7a6a" : "#2a5a4a";
            });

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
                editor.resetPose();
            });

            // --- カメラリセットボタン ---
            cameraResetBtn.addEventListener("click", () => {
                editor.resetCamera();
            });

            // --- DOM ウィジェットとして追加 ---
            node.addDOMWidget("pose_editor_widget", "pose_editor", container, {
                getValue() {
                    const imgWidget = node.widgets?.find(w => w.name === "image_data");
                    return imgWidget?.value ?? "";
                },
                setValue() {},
                computeSize() { return [630, 740]; },
            });

            // ノードサイズを固定（リサイズ不可）
            const FIXED_SIZE = [650, 830];
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
        `padding:6px 12px;background:${bg};color:#fff;border:none;` +
        "border-radius:5px;cursor:pointer;font-size:12px;font-weight:bold;" +
        "transition:opacity 0.15s;";
    btn.addEventListener("mouseover", () => { btn.style.opacity = "0.85"; });
    btn.addEventListener("mouseout",  () => { btn.style.opacity = "1"; });
    return btn;
}

// ============================================================
// リギングエディタ本体（index_v2.html のロジックを移植）
// カメラ操作・頭/体/手切り替え・テクスチャアトラス(UV)対応
// ============================================================
function initPoseEditor(canvas, { btnToggleHead, btnToggleBody, btnToggleLHand, btnToggleRHand, texInput }) {
    const ctx = canvas.getContext("2d");
    const CANVAS_W = canvas.width;
    const CANVAS_H = canvas.height;

    // ---- カメラ状態 ----
    const camera = { x: 0, y: 0, zoom: 1.0 };
    const DEFAULT_CAMERA = { x: 0, y: 0, zoom: 1.0 };

    function screenToWorld(sx, sy) {
        return {
            x: (sx - CANVAS_W / 2) / camera.zoom + CANVAS_W / 2 - camera.x,
            y: (sy - CANVAS_H / 2) / camera.zoom + CANVAS_H / 2 - camera.y,
        };
    }

    // ---- UV マップ定義（基準サイズ 1024×1024） ----
    // 画像サイズが異なる場合は uvScale で自動スケーリングされる
    const UV_BASE_W = 1024;
    const UV_BASE_H = 1024;
    const uvMap = {
        head:        { x:   0, y:   0, w: 110, h: 150 },
        neck:        { x: 120, y:   0, w:  52, h:  70 },
        chest:       { x: 180, y:   0, w: 170, h: 150 },
        abdomen:     { x: 360, y:   0, w: 150, h: 130 },
        arm:         { x:   0, y: 160, w:  60, h: 160 },
        foreArm:     { x:  80, y: 160, w:  52, h: 140 },
        handClosed:  { x: 140, y: 160, w:  48, h:  60 },
        handOpen:    { x: 200, y: 160, w:  68, h:  72 },
        leg:         { x:   0, y: 340, w:  80, h: 200 },
        shin:        { x: 100, y: 340, w:  68, h: 190 },
        foot:        { x: 180, y: 340, w:  56, h:  80 },
        headBack:    { x:   0, y: 560, w: 110, h: 150 },
        chestBack:   { x: 120, y: 560, w: 170, h: 150 },
        abdomenBack: { x: 300, y: 560, w: 150, h: 130 },
    };

    // 画像サイズに応じた UV スケール係数（読み込み時に更新）
    let uvScaleX = 1.0;
    let uvScaleY = 1.0;

    function updateUvScale(imgW, imgH) {
        uvScaleX = imgW / UV_BASE_W;
        uvScaleY = imgH / UV_BASE_H;
    }

    // UV座標をスケーリングして返す
    function scaledUv(uv) {
        return {
            x: uv.x * uvScaleX,
            y: uv.y * uvScaleY,
            w: uv.w * uvScaleX,
            h: uv.h * uvScaleY,
        };
    }

    // ---- テクスチャアトラス画像 ----
    // ダミーアトラスを生成（ユーザーが画像を読み込むまで使用）
    function createDummyAtlas() {
        const tc = document.createElement("canvas");
        tc.width = 1024; tc.height = 1024;
        const tCtx = tc.getContext("2d");

        const colors = {
            head: "#ffcccc", neck: "#ffddcc", chest: "#ccffcc", abdomen: "#aaddaa",
            arm: "#ccccff", foreArm: "#ccccff", handClosed: "#ffeedd", handOpen: "#ffeedd",
            leg: "#ffffcc", shin: "#ffffcc", foot: "#dddddd",
            headBack: "#eebbbb", chestBack: "#bbddbb", abdomenBack: "#99cc99",
        };

        for (const [key, uv] of Object.entries(uvMap)) {
            tCtx.fillStyle = colors[key] || "#cccccc";
            tCtx.beginPath();
            if (tCtx.roundRect) {
                tCtx.roundRect(uv.x, uv.y, uv.w, uv.h, 10);
            } else {
                tCtx.rect(uv.x, uv.y, uv.w, uv.h);
            }
            tCtx.fill();
            tCtx.strokeStyle = "#333"; tCtx.lineWidth = 2; tCtx.stroke();

            if (!key.startsWith("head")) {
                tCtx.fillStyle = "#333"; tCtx.font = "11px Arial";
                tCtx.textAlign = "center"; tCtx.textBaseline = "middle";
                tCtx.fillText(
                    key.replace("Back", "").replace("Closed", "").replace("Open", ""),
                    uv.x + uv.w / 2, uv.y + uv.h / 2
                );
            }
        }
        const img = new Image();
        img.src = tc.toDataURL();
        return img;
    }

    let atlasImage = createDummyAtlas();
    let atlasReady = false;
    atlasImage.addEventListener("load", () => {
        updateUvScale(atlasImage.naturalWidth, atlasImage.naturalHeight);
        atlasReady = true;
        draw();
    });

    // テクスチャアップロード処理
    texInput.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const newImg = new Image();
            newImg.onload = () => {
                atlasImage = newImg;
                updateUvScale(newImg.naturalWidth, newImg.naturalHeight);
                atlasReady = true;
                draw();
            };
            newImg.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    // ---- Bone クラス ----
    class Bone {
        // flipTex=true : テクスチャの「上」が根元側（肘・膝など、根元から先端へ描く）
        // flipTex=false: テクスチャの「上」が先端側（頭頂・指先など、先端から根元へ描く）
        constructor(name, length, localAngle, uv, width, parent = null,
                    isSlidable = false, minLen = 10, maxLen = 100, flipTex = false) {
            this.name        = name;
            this.length      = length;
            this.localAngle  = localAngle;
            this.uv          = uv;     // { x, y, w, h } or null
            this.width       = width;
            this.parent      = parent;
            this.isSlidable  = isSlidable;
            this.minLen      = minLen;
            this.maxLen      = maxLen;
            this.flipTex     = flipTex;
            this.visible     = true;
            this.children    = [];
            if (parent) parent.children.push(this);
            this.gx = 0; this.gy = 0; this.gAngle = 0;
            this.endX = 0; this.endY = 0;
            // リセット用初期値
            this._initLength     = length;
            this._initLocalAngle = localAngle;
            this._initUv         = uv;
            this._initWidth      = width;
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
            this.uv         = this._initUv;
            this.width      = this._initWidth;
            this.visible    = true;
        }
    }

    // ---- リグ構築 ----
    const ROOT_X = CANVAS_W / 2;
    const ROOT_Y = CANVAS_H * 0.533;
    const ROOT_A = 0;
    let root, allBones, drawOrder;

    // 切り替え状態（rig外で保持し resetPose 時にリセット）
    let isHeadBack = false;
    let isBodyBack = false;
    let isLeftOpen = false;
    let isRightOpen = false;

    // rig内の可変ボーン参照（切り替えボタンから操作するため）
    let headBone, chestBone, abdomenBone, leftEyeBone, rightEyeBone, leftHandBone, rightHandBone;

    function buildRig() {
        root = new Bone("Root", 0, 0, null, 0);

        // flipTex=true → テクスチャ上辺が根元側（肘・膝側）になるよう根元から先端方向へ描画
        //              → foreArm（袖が肘側）、shin（ソックスが足首側）などに使用
        abdomenBone = new Bone("Abdomen", 55, -Math.PI / 2, uvMap.abdomen, 75, root,        false, 10, 100, false);
        chestBone   = new Bone("Chest",   65, 0,            uvMap.chest,   85, abdomenBone, false, 10, 100, false);
        const neck  = new Bone("Neck",    20, 0,            uvMap.neck,    26, chestBone,   false, 10, 100, false);
        headBone    = new Bone("Head",    50, 0,            uvMap.head,    55, neck,         false, 10, 100, false);

        const lEyeBase  = new Bone("LeftEyeBase",  28, -0.4, null, 0, neck);
        const rEyeBase  = new Bone("RightEyeBase", 28,  0.4, null, 0, neck);
        leftEyeBone  = new Bone("LeftEye",  2, 0, null, 0, lEyeBase,  true, 0, 7);
        rightEyeBone = new Bone("RightEye", 2, 0, null, 0, rEyeBase,  true, 0, 7);

        const lShoulder = new Bone("LeftShoulder",  35, -Math.PI / 2,       null,            0, chestBone,  true, 15, 80);
        const rShoulder = new Bone("RightShoulder", 35,  Math.PI / 2,       null,            0, chestBone,  true, 15, 80);
        const lArm      = new Bone("LeftArm",       70, -Math.PI / 2 + 0.3, uvMap.arm,      30, lShoulder,  false, 10, 100, false);
        const lForeArm  = new Bone("LeftForeArm",   60,  0,                 uvMap.foreArm,  26, lArm,       false, 10, 100, true);
        leftHandBone    = new Bone("LeftHand",      25,  0,                 uvMap.handClosed,24, lForeArm,   false, 10, 100, false);
        const rArm      = new Bone("RightArm",      70,  Math.PI / 2 - 0.3, uvMap.arm,      30, rShoulder,  false, 10, 100, false);
        const rForeArm  = new Bone("RightForeArm",  60,  0,                 uvMap.foreArm,  26, rArm,       false, 10, 100, true);
        rightHandBone   = new Bone("RightHand",     25,  0,                 uvMap.handClosed,24, rForeArm,   false, 10, 100, false);

        const lHip  = new Bone("LeftHip",   25,  Math.PI,           null,      0, root,  true, 10, 60);
        const rHip  = new Bone("RightHip",  25,  0,                 null,      0, root,  true, 10, 60);
        const lLeg  = new Bone("LeftLeg",   90, -Math.PI / 2 + 0.1, uvMap.leg, 40, lHip,  false, 10, 100, false);
        const lShin = new Bone("LeftShin",  85,  0,                 uvMap.shin,34, lLeg,  false, 10, 100, true);
        const lFoot = new Bone("LeftFoot",  30,  Math.PI / 2,       uvMap.foot,28, lShin, false, 10, 100, true);
        const rLeg  = new Bone("RightLeg",  90,  Math.PI / 2 - 0.1, uvMap.leg, 40, rHip,  false, 10, 100, false);
        const rShin = new Bone("RightShin", 85,  0,                 uvMap.shin,34, rLeg,  false, 10, 100, true);
        const rFoot = new Bone("RightFoot", 30,  Math.PI / 2,       uvMap.foot,28, rShin, false, 10, 100, true);

        drawOrder = [
            leftHandBone, lForeArm, lArm, lShoulder,
            lFoot, lShin, lLeg, lHip,
            abdomenBone, chestBone, neck, headBone,
            leftEyeBone, rightEyeBone,
            rFoot, rShin, rLeg, rHip,
            rightHandBone, rForeArm, rArm, rShoulder,
        ];
        allBones = drawOrder;
    }

    // ---- リグ表示フラグ ----
    let showRig = true;

    // ---- 描画 ----
    function draw() {
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        ctx.save();
        // カメラ変換
        ctx.translate(CANVAS_W / 2, CANVAS_H / 2);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.translate(-CANVAS_W / 2 + camera.x, -CANVAS_H / 2 + camera.y);

        // A. パーツ（UV切り抜き描画）& 目
        for (const bone of drawOrder) {
            if (!bone.visible) continue;
            if (bone.uv && atlasReady) {
                const suv = scaledUv(bone.uv);
                ctx.save();
                if (bone.flipTex) {
                    // テクスチャ上辺＝根元側：根元を原点にして根元→先端方向へ描画
                    ctx.translate(bone.gx, bone.gy);
                    ctx.rotate(bone.gAngle - Math.PI / 2);
                } else {
                    // テクスチャ上辺＝先端側：先端を原点にして先端→根元方向へ描画
                    ctx.translate(bone.endX, bone.endY);
                    ctx.rotate(bone.gAngle + Math.PI / 2);
                }
                ctx.drawImage(
                    atlasImage,
                    suv.x, suv.y, suv.w, suv.h,
                    -bone.width / 2, 0, bone.width, bone.length + 10
                );
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
                    ctx.lineWidth = 2 / camera.zoom;
                    ctx.stroke();
                }
            }
        }

        if (showRig) {
            // B. 骨格ライン
            ctx.lineWidth = 2 / camera.zoom;
            for (const bone of allBones) {
                if (!bone.visible) continue;
                if (bone.name === "Root" || bone.name.includes("Eye") || bone.name.includes("EyeBase")) continue;
                ctx.beginPath();
                ctx.moveTo(bone.gx, bone.gy);
                ctx.lineTo(bone.endX, bone.endY);
                if (bone.isSlidable) {
                    ctx.strokeStyle = "rgba(255,60,60,0.75)";
                    ctx.setLineDash([5 / camera.zoom, 5 / camera.zoom]);
                } else {
                    ctx.strokeStyle = "rgba(120,120,120,0.3)";
                    ctx.setLineDash([]);
                }
                ctx.stroke();
            }
            ctx.setLineDash([]);

            // C. 関節ポイント
            for (const bone of allBones) {
                if (!bone.visible) continue;
                if (bone.name === "Root" || bone.name.includes("Eye") || bone.name.includes("EyeBase")) continue;

                if (bone === selectedBone) {
                    ctx.beginPath();
                    ctx.arc(bone.endX, bone.endY, 8 / camera.zoom, 0, Math.PI * 2);
                    ctx.strokeStyle = "rgba(255,230,0,0.85)";
                    ctx.lineWidth = 2 / camera.zoom;
                    ctx.stroke();
                }

                ctx.beginPath();
                ctx.arc(bone.endX, bone.endY, 4 / camera.zoom, 0, Math.PI * 2);
                ctx.fillStyle = bone.isSlidable ? "rgba(255,100,100,0.8)" : "rgba(255,255,255,0.85)";
                ctx.fill();
                ctx.strokeStyle = "rgba(80,80,80,0.6)";
                ctx.lineWidth = 1 / camera.zoom;
                ctx.stroke();
            }
        }

        ctx.restore();
    }

    // ---- マウス操作 ----
    let isDragging = false;
    let isPanning  = false;
    let selectedBone = null;
    let lastMX = 0, lastMY = 0;

    canvas.addEventListener("mousedown", (e) => {
        const r = canvas.getBoundingClientRect();
        const scaleX = CANVAS_W / r.width;
        const scaleY = CANVAS_H / r.height;
        const sx = (e.clientX - r.left) * scaleX;
        const sy = (e.clientY - r.top)  * scaleY;
        lastMX = sx; lastMY = sy;

        const world = screenToWorld(sx, sy);
        let minDist = Infinity;
        selectedBone = null;

        for (let i = allBones.length - 1; i >= 0; i--) {
            const bone = allBones[i];
            if (!bone.visible) continue;
            const dist = Math.hypot(bone.endX - world.x, bone.endY - world.y);
            const hit  = (bone.name.includes("Eye") ? 15 : 20) / camera.zoom;
            if (dist < hit && dist < minDist) {
                minDist = dist;
                selectedBone = bone;
            }
        }

        if (selectedBone) isDragging = true;
        else isPanning = true;
        draw();
    });

    canvas.addEventListener("mousemove", (e) => {
        const r = canvas.getBoundingClientRect();
        const scaleX = CANVAS_W / r.width;
        const scaleY = CANVAS_H / r.height;
        const sx = (e.clientX - r.left) * scaleX;
        const sy = (e.clientY - r.top)  * scaleY;

        if (isPanning) {
            camera.x += (sx - lastMX) / camera.zoom;
            camera.y += (sy - lastMY) / camera.zoom;
            lastMX = sx; lastMY = sy;
            draw();
            return;
        }
        if (!isDragging || !selectedBone) return;

        const world = screenToWorld(sx, sy);
        const targetAngle = Math.atan2(world.y - selectedBone.gy, world.x - selectedBone.gx);
        const parentAngle = selectedBone.parent ? selectedBone.parent.gAngle : ROOT_A;
        selectedBone.localAngle = targetAngle - parentAngle;

        if (selectedBone.isSlidable) {
            const dist = Math.hypot(world.x - selectedBone.gx, world.y - selectedBone.gy);
            selectedBone.length = Math.max(selectedBone.minLen, Math.min(dist, selectedBone.maxLen));
        }

        root.update(ROOT_X, ROOT_Y, ROOT_A);
        draw();
    });

    canvas.addEventListener("mouseup",    () => { isDragging = false; isPanning = false; selectedBone = null; draw(); });
    canvas.addEventListener("mouseleave", () => { isDragging = false; isPanning = false; selectedBone = null; draw(); });

    // ズーム（ホイール）
    canvas.addEventListener("wheel", (e) => {
        e.preventDefault();
        camera.zoom = Math.max(0.2, Math.min(5.0, camera.zoom - e.deltaY * 0.001));
        draw();
    }, { passive: false });

    // ---- 頭の切り替えボタン ----
    btnToggleHead.addEventListener("click", () => {
        isHeadBack = !isHeadBack;
        if (isHeadBack) {
            headBone.uv = uvMap.headBack;
            leftEyeBone.visible = false;
            rightEyeBone.visible = false;
            btnToggleHead.textContent = "👤 Head: Back";
        } else {
            headBone.uv = uvMap.head;
            leftEyeBone.visible = true;
            rightEyeBone.visible = true;
            btnToggleHead.textContent = "👤 Head: Front";
        }
        draw();
    });

    // ---- 体の切り替えボタン ----
    btnToggleBody.addEventListener("click", () => {
        isBodyBack = !isBodyBack;
        if (isBodyBack) {
            chestBone.uv   = uvMap.chestBack;
            abdomenBone.uv = uvMap.abdomenBack;
            btnToggleBody.textContent = "👕 Body: Back";
        } else {
            chestBone.uv   = uvMap.chest;
            abdomenBone.uv = uvMap.abdomen;
            btnToggleBody.textContent = "👕 Body: Front";
        }
        draw();
    });

    // ---- 手の切り替えボタン ----
    // ボタンの Left/Right はユーザー視点（画面左=Left ボタン）
    // 画面左側はキャラの右手（rightHandBone）、画面右側はキャラの左手（leftHandBone）
    btnToggleLHand.addEventListener("click", () => {
        isLeftOpen = !isLeftOpen;
        if (isLeftOpen) {
            rightHandBone.uv = uvMap.handOpen; rightHandBone.width = 34; rightHandBone.length = 32;
            btnToggleLHand.textContent = "Left: 🖐";
        } else {
            rightHandBone.uv = uvMap.handClosed; rightHandBone.width = 24; rightHandBone.length = 25;
            btnToggleLHand.textContent = "Left: ✊";
        }
        root.update(ROOT_X, ROOT_Y, ROOT_A);
        draw();
    });

    btnToggleRHand.addEventListener("click", () => {
        isRightOpen = !isRightOpen;
        if (isRightOpen) {
            leftHandBone.uv = uvMap.handOpen; leftHandBone.width = 34; leftHandBone.length = 32;
            btnToggleRHand.textContent = "Right: 🖐";
        } else {
            leftHandBone.uv = uvMap.handClosed; leftHandBone.width = 24; leftHandBone.length = 25;
            btnToggleRHand.textContent = "Right: ✊";
        }
        root.update(ROOT_X, ROOT_Y, ROOT_A);
        draw();
    });

    // ---- ポーズリセット ----
    function resetPose() {
        isHeadBack = false;
        isBodyBack = false;
        isLeftOpen = false;
        isRightOpen = false;
        btnToggleHead.textContent  = "👤 Head: Front";
        btnToggleBody.textContent  = "👕 Body: Front";
        btnToggleLHand.textContent = "Left: ✊";
        btnToggleRHand.textContent = "Right: ✊";
        buildRig();
        root.update(ROOT_X, ROOT_Y, ROOT_A);
        draw();
    }

    // ---- カメラリセット ----
    function resetCamera() {
        camera.x    = DEFAULT_CAMERA.x;
        camera.y    = DEFAULT_CAMERA.y;
        camera.zoom = DEFAULT_CAMERA.zoom;
        draw();
    }

    // ---- リグ表示切り替え（現在の表示状態を返す） ----
    function toggleRig() {
        showRig = !showRig;
        draw();
        return showRig;
    }

    // ---- 初期化 ----
    buildRig();
    // アトラスが既にロード済みなら即描画
    if (atlasReady) {
        root.update(ROOT_X, ROOT_Y, ROOT_A);
        draw();
    } else {
        atlasImage.addEventListener("load", () => {
            atlasReady = true;
            root.update(ROOT_X, ROOT_Y, ROOT_A);
            draw();
        });
    }

    return { resetPose, resetCamera, toggleRig };
}
