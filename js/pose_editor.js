import { app } from "../../scripts/app.js";

// ============================================================
// ComfyUI 2D Pose Editor 拡張
// index_v2.html のリギングロジックをノード内キャンバスに移植
// カメラ操作・頭/体/手切り替え・テクスチャ(1枚絵UV)対応
// 背景合成・Image Input Mode・出力サイズモード対応
// ============================================================

// ---- ワークフロー保存時に image_data の base64 を除外するフック ----
// ComfyUI はタブ切り替え等で graph.serialize() を呼んでドラフト保存するため、
// 大きな base64 文字列が含まれると "Failed to save workflow draft" が発生する。
// LGraph.serialize をラップし、直列化結果の JSON からのみ image_data を除去する。
// 実行時プロンプト構築（graphToPrompt）には一切手を加えない。
setTimeout(() => {
    if (!app.graph) return;
    const _origSerialize = app.graph.serialize.bind(app.graph);
    app.graph.serialize = function (...args) {
        const data = _origSerialize(...args);
        if (data?.nodes) {
            for (const n of data.nodes) {
                if (n.type !== "PoseEditor2D") continue;
                if (!n.widgets_values) continue;
                // image_data は widgets_values[0]（INPUT_TYPES の required 先頭）
                n.widgets_values[0] = "";
            }
        }
        return data;
    };
}, 500);

app.registerExtension({
    name: "Comfy.2DPoseEditor",

    async beforeRegisterNodeDef(nodeType, nodeData) {
        if (nodeData.name !== "PoseEditor2D") return;

        const onNodeCreated = nodeType.prototype.onNodeCreated;
        nodeType.prototype.onNodeCreated = function () {
            const ret = onNodeCreated?.apply(this, arguments);
            const node = this;

            // --- バックエンドウィジェットを非表示にする ---
            setTimeout(() => {
                for (const name of ["image_data", "output_size_mode", "custom_width", "custom_height"]) {
                    const w = node.widgets?.find(w => w.name === name);
                    if (w) {
                        w.computeSize = () => [0, -4];
                        w.hidden = true;
                    }
                }
                node.setDirtyCanvas(true, true);
            }, 0);

            // ---- モード状態 ----
            let imageInputMode = false;  // true: 画像読込ノードとして動作
            let outputSizeMode = "Standard"; // "Standard" | "Background" | "Custom"
            let customW = 600, customH = 600;

            // ---- 外部からの background_image 入力を検知して Image Input Mode を強制オフ ----
            const origOnConnectionsChange = node.onConnectionsChange;
            node.onConnectionsChange = function (...args) {
                origOnConnectionsChange?.apply(this, args);
                const hasBg = node.inputs?.some(inp => inp.name === "background_image" && inp.link != null);
                if (hasBg && imageInputMode) {
                    imageInputMode = false;
                    applyMode();
                }
            };

            // --- コンテナ作成 ---
            const container = document.createElement("div");
            container.style.cssText =
                "display:flex;flex-direction:column;align-items:stretch;" +
                "background:#2c2c2c;padding:6px;box-sizing:border-box;";

            // ============================================================
            // --- 行0: P/I + 操作ボタン + Image Input 用ファイル選択 ---
            // ============================================================
            const modeRow = document.createElement("div");
            modeRow.style.cssText = "display:flex;gap:4px;margin-bottom:4px;align-items:center;flex-wrap:wrap;";

            // P / I トグルボタン（アクティブ時色付き、非アクティブはグレー）
            const btnModeP = makeSmallButton("P", "#4a90d9", "Pose Editor");
            const btnModeI = makeSmallButton("I", "#555",    "Image Input");

            // Image Input 用
            const imgFileInput = document.createElement("input");
            imgFileInput.type = "file";
            imgFileInput.accept = "image/*";
            imgFileInput.style.cssText = "display:none;";
            const imgLoadBtn  = makeSmallButton("📂", "#4a6a9a", "Load Image");
            imgLoadBtn.style.display = "none";
            const imgFileName = document.createElement("span");
            imgFileName.textContent = "No file";
            imgFileName.style.cssText = "color:#aaa;font-size:10px;max-width:100px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;display:none;";

            // 操作ボタン（Pモード時のみ表示）
            const captureBtn     = makeSmallButton("📸",  "#4a90d9", "Capture");
            const toggleRigBtn   = makeSmallButton("🦴",  "#4a7a6a", "Hide Rig");
            const resetBtn       = makeSmallButton("RP",  "#6c757d", "Reset Pose");
            const cameraResetBtn = makeSmallButton("RC",  "#5a7a5a", "Reset Camera");
            // RC ボタンを幅2倍に
            cameraResetBtn.style.minWidth = "48px";

            // 右端寄せ用スペーサー
            const modeSpacer = document.createElement("span");
            modeSpacer.style.cssText = "flex:1;";

            modeRow.appendChild(btnModeP);
            modeRow.appendChild(btnModeI);
            modeRow.appendChild(imgLoadBtn);
            modeRow.appendChild(imgFileName);
            modeRow.appendChild(imgFileInput);
            modeRow.appendChild(modeSpacer);
            modeRow.appendChild(captureBtn);
            modeRow.appendChild(toggleRigBtn);
            modeRow.appendChild(resetBtn);
            modeRow.appendChild(cameraResetBtn);

            // ============================================================
            // --- 行1: 出力サイズ（Pモード時のみ） ---
            // ============================================================
            const sizeRow = document.createElement("div");
            sizeRow.style.cssText = "display:flex;gap:4px;margin-bottom:4px;align-items:center;flex-wrap:wrap;";

            const sizeLabel = document.createElement("span");
            sizeLabel.textContent = "Size:";
            sizeLabel.style.cssText = "color:#aaa;font-size:10px;white-space:nowrap;";

            const btnSizeStd = makeSmallButton("Std",   "#3a5a3a");
            const btnSizeBg  = makeSmallButton("BG",    "#555");
            const btnSizeCst = makeSmallButton("Custom","#555");

            const customSizeInput = document.createElement("div");
            customSizeInput.style.cssText = "display:none;gap:3px;align-items:center;";
            const wInput = makeNumberInput(600, 64, 4096);
            const hInput = makeNumberInput(600, 64, 4096);
            const xLabel = document.createElement("span");
            xLabel.textContent = "×";
            xLabel.style.cssText = "color:#aaa;font-size:10px;";
            customSizeInput.appendChild(wInput);
            customSizeInput.appendChild(xLabel);
            customSizeInput.appendChild(hInput);

            sizeRow.appendChild(sizeLabel);
            sizeRow.appendChild(btnSizeStd);
            sizeRow.appendChild(btnSizeBg);
            sizeRow.appendChild(btnSizeCst);
            sizeRow.appendChild(customSizeInput);

            // ============================================================
            // --- 行2: ボディ切り替え + テクスチャ（Pモード時のみ） ---
            // ============================================================
            const partsRow = document.createElement("div");
            partsRow.style.cssText = "display:flex;gap:4px;margin-bottom:4px;align-items:center;flex-wrap:wrap;";

            const btnToggleHead  = makeSmallButton("👤F", "#9c27b0", "Head: Front");
            const btnToggleBody  = makeSmallButton("👕F", "#9c27b0", "Body: Front");
            const btnToggleLHand = makeSmallButton("L✊",  "#ff9800", "Left: Closed");
            const btnToggleRHand = makeSmallButton("R✊",  "#ff9800", "Right: Closed");

            const texInput = document.createElement("input");
            texInput.type = "file";
            texInput.accept = "image/*";
            texInput.style.cssText = "display:none;";
            const texBtn = makeSmallButton("🖼 Tex", "#555", "Load Texture");
            texBtn.addEventListener("click", () => texInput.click());
            texInput.addEventListener("change", () => {
                texBtn.title = texInput.files[0]?.name ?? "Load Texture";
            });

            // 背景色ピッカー + クリア(透明化)ボタン
            const bgColorLbl = document.createElement("span");
            bgColorLbl.textContent = "🎨BG:";
            bgColorLbl.style.cssText = "color:#aaa;font-size:10px;white-space:nowrap;";
            const bgColorPick = document.createElement("input");
            bgColorPick.type = "color";
            bgColorPick.value = "#e0e0e0";
            bgColorPick.title = "Background color";
            bgColorPick.style.cssText = "width:28px;height:22px;border:none;cursor:pointer;background:none;padding:0;flex-shrink:0;";
            const bgColorClearBtn = makeSmallButton("✕", "#5a3a3a", "Clear background color (transparent)");
            bgColorClearBtn.style.padding = "3px 7px";

            // 背景画像ロード / クリア
            const bgImgInput = document.createElement("input");
            bgImgInput.type = "file";
            bgImgInput.accept = "image/*";
            bgImgInput.style.cssText = "display:none;";
            const bgImgBtn = makeSmallButton("📂 BG", "#3a5a3a", "Load background image");
            bgImgBtn.addEventListener("click", () => bgImgInput.click());
            const bgImgClearBtn = makeSmallButton("✕", "#5a3a3a", "Clear background image");
            bgImgClearBtn.style.display = "none";

            partsRow.appendChild(btnToggleHead);
            partsRow.appendChild(btnToggleBody);
            partsRow.appendChild(btnToggleLHand);
            partsRow.appendChild(btnToggleRHand);
            partsRow.appendChild(texBtn);
            partsRow.appendChild(texInput);
            partsRow.appendChild(bgColorLbl);
            partsRow.appendChild(bgColorPick);
            partsRow.appendChild(bgColorClearBtn);
            partsRow.appendChild(bgImgBtn);
            partsRow.appendChild(bgImgInput);
            partsRow.appendChild(bgImgClearBtn);

            // --- キャンバス（480px の80% = 384px） ---
            const CVS_DISPLAY = 384;
            const cvs = document.createElement("canvas");
            cvs.width = 600; cvs.height = 600;
            cvs.style.cssText =
                `width:${CVS_DISPLAY}px;height:${CVS_DISPLAY}px;` +
                "background:#e0e0e0;border-radius:6px;cursor:grab;" +
                "display:block;box-shadow:0 2px 8px rgba(0,0,0,0.5);";
            cvs.addEventListener("mousedown", () => { cvs.style.cursor = "grabbing"; });
            cvs.addEventListener("mouseup",   () => { cvs.style.cursor = "grab"; });
            cvs.addEventListener("mouseleave",() => { cvs.style.cursor = "grab"; });

            // --- アスペクト比フレームオーバーレイ ---
            const overlayCvs = document.createElement("canvas");
            overlayCvs.width = CVS_DISPLAY; overlayCvs.height = CVS_DISPLAY;
            overlayCvs.style.cssText =
                `position:absolute;top:0;left:0;width:${CVS_DISPLAY}px;height:${CVS_DISPLAY}px;` +
                "pointer-events:none;border-radius:6px;";

            const cvsWrapper = document.createElement("div");
            cvsWrapper.style.cssText =
                `position:relative;width:${CVS_DISPLAY}px;height:${CVS_DISPLAY}px;flex-shrink:0;`;
            cvsWrapper.appendChild(cvs);
            cvsWrapper.appendChild(overlayCvs);

            // --- Image Input Mode 用プレビューキャンバス ---
            const imgPreviewCvs = document.createElement("canvas");
            imgPreviewCvs.width = 600; imgPreviewCvs.height = 600;
            imgPreviewCvs.style.cssText =
                `width:${CVS_DISPLAY}px;` +
                "background:#333;border-radius:6px;display:none;" +
                "box-shadow:0 2px 8px rgba(0,0,0,0.5);";

            container.appendChild(modeRow);
            container.appendChild(sizeRow);
            container.appendChild(partsRow);
            container.appendChild(cvsWrapper);
            container.appendChild(imgPreviewCvs);

            // ============================================================
            // --- リギングエディタ初期化 ---
            // ============================================================
            let bgAspect = null;

            const editor = initPoseEditor(cvs, {
                btnToggleHead, btnToggleBody, btnToggleLHand, btnToggleRHand, texInput,
                bgColorPick, bgColorClearBtn, bgImgInput, bgImgClearBtn,
                onBgLoad: (aspect) => { bgAspect = aspect; drawOverlay(); },
            });

            // ---- アスペクト比フレーム計算 ----
            function getFrameRect() {
                let ar = 1;
                if (outputSizeMode === "Custom") {
                    ar = customW / customH;
                } else if (outputSizeMode === "Background" && bgAspect != null) {
                    ar = bgAspect;
                }
                let fw, fh;
                if (ar >= 1) {
                    fw = CVS_DISPLAY;
                    fh = Math.round(CVS_DISPLAY / ar);
                } else {
                    fh = CVS_DISPLAY;
                    fw = Math.round(CVS_DISPLAY * ar);
                }
                const fx = Math.round((CVS_DISPLAY - fw) / 2);
                const fy = Math.round((CVS_DISPLAY - fh) / 2);
                return { x: fx, y: fy, w: fw, h: fh };
            }

            function drawOverlay() {
                const oc = overlayCvs.getContext("2d");
                oc.clearRect(0, 0, CVS_DISPLAY, CVS_DISPLAY);
                const { x, y, w, h } = getFrameRect();
                if (x === 0 && y === 0 && w === CVS_DISPLAY && h === CVS_DISPLAY) return;
                oc.fillStyle = "rgba(0,0,0,0.75)";
                if (y > 0)                  oc.fillRect(0, 0, CVS_DISPLAY, y);
                if (y + h < CVS_DISPLAY)    oc.fillRect(0, y + h, CVS_DISPLAY, CVS_DISPLAY - (y + h));
                if (x > 0)                  oc.fillRect(0, y, x, h);
                if (x + w < CVS_DISPLAY)    oc.fillRect(x + w, y, CVS_DISPLAY - (x + w), h);
                oc.strokeStyle = "rgba(255,255,255,0.4)";
                oc.lineWidth = 1;
                oc.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
            }
            drawOverlay();

            // ============================================================
            // --- applyMode: UI の表示/非表示切り替え ---
            // ============================================================
            function applyMode() {
                if (imageInputMode) {
                    // Image Input Mode
                    sizeRow.style.display        = "none";
                    partsRow.style.display       = "none";
                    cvsWrapper.style.display     = "none";
                    captureBtn.style.display     = "none";
                    resetBtn.style.display       = "none";
                    cameraResetBtn.style.display = "none";
                    toggleRigBtn.style.display   = "none";
                    imgPreviewCvs.style.display  = "block";
                    imgLoadBtn.style.display     = "inline-flex";
                    imgFileName.style.display    = "inline";
                    modeSpacer.style.display     = "none";
                    btnModeP.style.background    = "#555";
                    btnModeI.style.background    = "#2a6a4a";
                } else {
                    // Pose Editor Mode
                    sizeRow.style.display        = "flex";
                    partsRow.style.display       = "flex";
                    cvsWrapper.style.display     = "";
                    captureBtn.style.display     = "";
                    resetBtn.style.display       = "";
                    cameraResetBtn.style.display = "";
                    toggleRigBtn.style.display   = "";
                    imgPreviewCvs.style.display  = "none";
                    imgLoadBtn.style.display     = "none";
                    imgFileName.style.display    = "none";
                    modeSpacer.style.display     = "";
                    btnModeP.style.background    = "#4a90d9";
                    btnModeI.style.background    = "#555";
                }
                syncBackendWidgets();
            }

            // ============================================================
            // --- バックエンドウィジェット同期 ---
            // ============================================================
            function syncBackendWidgets() {
                const modeW = node.widgets?.find(w => w.name === "output_size_mode");
                const wW    = node.widgets?.find(w => w.name === "custom_width");
                const hW    = node.widgets?.find(w => w.name === "custom_height");
                if (modeW) modeW.value = outputSizeMode;
                if (wW)    wW.value    = customW;
                if (hW)    hW.value    = customH;
            }

            // ============================================================
            // --- P / I ボタン ---
            // ============================================================
            btnModeP.addEventListener("click", () => {
                if (imageInputMode) { imageInputMode = false; applyMode(); }
            });
            btnModeI.addEventListener("click", () => {
                const hasBg = node.inputs?.some(inp => inp.name === "background_image" && inp.link != null);
                if (hasBg) return; // 外部入力あり時は切り替え不可
                if (!imageInputMode) { imageInputMode = true; applyMode(); }
            });

            // --- 画像読込（Image Input Mode） ---
            let loadedImageData = "";

            function loadImageFile(file) {
                if (!file || !file.type.startsWith("image/")) return;
                imgFileName.textContent = file.name;
                const reader = new FileReader();
                reader.onload = (ev) => {
                    loadedImageData = ev.target.result;
                    const img = new Image();
                    img.onload = () => {
                        // 常に CVS_DISPLAY×CVS_DISPLAY の正方形キャンバスに letterbox 描画
                        const ar = img.naturalWidth / img.naturalHeight;
                        let dw, dh;
                        if (ar >= 1) { dw = CVS_DISPLAY; dh = Math.round(CVS_DISPLAY / ar); }
                        else         { dh = CVS_DISPLAY; dw = Math.round(CVS_DISPLAY * ar); }
                        imgPreviewCvs.width  = CVS_DISPLAY;
                        imgPreviewCvs.height = CVS_DISPLAY;
                        imgPreviewCvs.style.width  = `${CVS_DISPLAY}px`;
                        imgPreviewCvs.style.height = `${CVS_DISPLAY}px`;
                        const pCtx = imgPreviewCvs.getContext("2d");
                        pCtx.clearRect(0, 0, CVS_DISPLAY, CVS_DISPLAY);
                        pCtx.drawImage(img,
                            Math.round((CVS_DISPLAY - dw) / 2),
                            Math.round((CVS_DISPLAY - dh) / 2), dw, dh);
                        const imgWidget = node.widgets?.find(w => w.name === "image_data");
                        if (imgWidget) imgWidget.value = loadedImageData;
                    };
                    img.src = ev.target.result;
                };
                reader.readAsDataURL(file);
            }

            imgLoadBtn.addEventListener("click", () => imgFileInput.click());
            imgFileInput.addEventListener("change", () => loadImageFile(imgFileInput.files[0]));

            // --- ドラッグ＆ドロップ（Image Input Mode 時） ---
            container.addEventListener("dragover", (e) => {
                if (!imageInputMode) return;
                e.preventDefault();
                e.dataTransfer.dropEffect = "copy";
                imgPreviewCvs.style.outline = "3px dashed #4a90d9";
            });
            container.addEventListener("dragleave", () => {
                imgPreviewCvs.style.outline = "";
            });
            container.addEventListener("drop", (e) => {
                if (!imageInputMode) return;
                e.preventDefault();
                e.stopPropagation();
                imgPreviewCvs.style.outline = "";
                const file = e.dataTransfer.files[0];
                if (file) loadImageFile(file);
            });

            // ============================================================
            // --- 出力サイズモード切り替え ---
            // ============================================================
            function setSizeMode(mode) {
                outputSizeMode = mode;
                btnSizeStd.style.background = mode === "Standard"   ? "#3a5a3a" : "#555";
                btnSizeBg.style.background  = mode === "Background" ? "#3a5a3a" : "#555";
                btnSizeCst.style.background = mode === "Custom"     ? "#3a5a3a" : "#555";
                customSizeInput.style.display = mode === "Custom" ? "flex" : "none";
                syncBackendWidgets();
                drawOverlay();
            }
            btnSizeStd.addEventListener("click", () => setSizeMode("Standard"));
            btnSizeBg.addEventListener("click",  () => setSizeMode("Background"));
            btnSizeCst.addEventListener("click", () => setSizeMode("Custom"));

            wInput.addEventListener("change", () => { customW = parseInt(wInput.value) || 600; syncBackendWidgets(); drawOverlay(); });
            hInput.addEventListener("change", () => { customH = parseInt(hInput.value) || 600; syncBackendWidgets(); drawOverlay(); });

            // ============================================================
            // --- リグ表示切り替え ---
            // ============================================================
            toggleRigBtn.addEventListener("click", () => {
                const visible = editor.toggleRig();
                toggleRigBtn.textContent  = visible ? "🦴 Hide Rig" : "🦴 Show Rig";
                toggleRigBtn.style.background = visible ? "#4a7a6a" : "#2a5a4a";
            });

            // --- キャプチャ ---
            captureBtn.addEventListener("click", () => {
                const imgWidget = node.widgets?.find(w => w.name === "image_data");
                if (imgWidget) {
                    const { x, y, w, h } = getFrameRect();
                    const isSquare = x === 0 && y === 0 && w === CVS_DISPLAY && h === CVS_DISPLAY;

                    let outW = 600, outH = 600;
                    if (outputSizeMode === "Custom") {
                        outW = customW; outH = customH;
                    } else if (outputSizeMode === "Background" && bgAspect != null) {
                        if (bgAspect >= 1) { outW = 600; outH = Math.round(600 / bgAspect); }
                        else               { outH = 600; outW = Math.round(600 * bgAspect); }
                    }

                    imgWidget.value = isSquare
                        ? editor.captureWithoutRig()
                        : editor.captureWithoutRig({
                            cropRect: { x, y, w, h, outW, outH, displaySize: CVS_DISPLAY },
                          });
                }
                captureBtn.textContent = "✅ Captured!";
                captureBtn.style.background = "#28a745";
                setTimeout(() => {
                    captureBtn.textContent = "📸 Capture";
                    captureBtn.style.background = "#4a90d9";
                }, 1800);
            });

            // --- リセット ---
            resetBtn.addEventListener("click", () => editor.resetPose());
            cameraResetBtn.addEventListener("click", () => editor.resetCamera());

            // --- DOM ウィジェット ---
            // getValue はワークフロー保存時にも呼ばれるため、
            // 大きな base64 データを返すと "Failed to save workflow draft" が発生する。
            // シリアライズ時は空文字を返し、実行時は image_data ウィジェット経由で渡す。
            node.addDOMWidget("pose_editor_widget", "pose_editor", container, {
                getValue() { return ""; },
                setValue() {},
                computeSize() { return [410, 490]; },
            });

            // ノードサイズ固定
            const FIXED_SIZE = [430, 560];
            node.size = [...FIXED_SIZE];
            node.resizable = false;
            node.onResize = function () { this.size = [...FIXED_SIZE]; };

            // 初期同期
            syncBackendWidgets();

            return ret;
        };
    },
});

// ---- ボタン生成ヘルパー ----
function makeSmallButton(label, bg, title = "") {
    const btn = document.createElement("button");
    btn.textContent = label;
    if (title) btn.title = title;
    btn.style.cssText =
        `padding:3px 8px;background:${bg};color:#fff;border:none;` +
        "border-radius:4px;cursor:pointer;font-size:11px;font-weight:bold;" +
        "transition:opacity 0.15s;white-space:nowrap;";
    btn.addEventListener("mouseover", () => { btn.style.opacity = "0.8"; });
    btn.addEventListener("mouseout",  () => { btn.style.opacity = "1"; });
    return btn;
}

function makeNumberInput(defaultVal, min, max) {
    const inp = document.createElement("input");
    inp.type = "number";
    inp.value = defaultVal;
    inp.min = min;
    inp.max = max;
    inp.style.cssText =
        "width:60px;padding:3px 5px;background:#444;color:#fff;border:1px solid #666;" +
        "border-radius:4px;font-size:11px;text-align:center;";
    return inp;
}

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
function initPoseEditor(canvas, { btnToggleHead, btnToggleBody, btnToggleLHand, btnToggleRHand, texInput, bgColorPick, bgColorClearBtn, bgImgInput, bgImgClearBtn, onBgLoad }) {
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
    // 腕・前腕・手・足・脛は L（左カラム）/ R（右カラム）で左右別
    const UV_BASE_W = 1024;
    const UV_BASE_H = 1024;
    const uvMap = {
        // ---- ROW1 (y:0) 頭・胴体 ----
        head:         { x:   0, y:   0, w: 110, h: 170 },
        neck:         { x: 120, y:   0, w:  52, h:  80 },
        chest:        { x: 180, y:   0, w: 170, h: 170 },
        abdomen:      { x: 360, y:   0, w: 150, h: 150 },
        // ---- ROW2 (y:180) 腕・手・足 ----
        armL:         { x:   0, y: 180, w:  60, h: 180 },
        armR:         { x:  70, y: 180, w:  60, h: 180 },
        foreArmL:     { x: 140, y: 180, w:  52, h: 160 },
        foreArmR:     { x: 200, y: 180, w:  52, h: 160 },
        handClosedL:  { x: 260, y: 180, w:  52, h:  64 },
        handClosedR:  { x: 320, y: 180, w:  52, h:  64 },
        handOpenL:    { x: 380, y: 180, w:  68, h:  76 },
        handOpenR:    { x: 456, y: 180, w:  68, h:  76 },
        footL:        { x: 540, y: 180, w:  72, h:  90 },
        footR:        { x: 620, y: 180, w:  72, h:  90 },
        // ---- ROW3 (y:370) 脚 ----
        legL:         { x:   0, y: 370, w:  80, h: 220 },
        legR:         { x:  90, y: 370, w:  80, h: 220 },
        shinL:        { x: 180, y: 370, w:  68, h: 210 },
        shinR:        { x: 258, y: 370, w:  68, h: 210 },
        // ---- ROW4 (y:610) 背面 ----
        headBack:     { x:   0, y: 610, w: 110, h: 170 },
        chestBack:    { x: 120, y: 610, w: 170, h: 170 },
        abdomenBack:  { x: 300, y: 610, w: 150, h: 150 },
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
            head: "#f5c8a0", neck: "#e8b890", chest: "#7fc8c8", abdomen: "#6ab8b8",
            headBack: "#d4a878", chestBack: "#5aa8a8", abdomenBack: "#4a9898",
            armL: "#7fc8c8", armR: "#6ab8b8",
            foreArmL: "#9ad0a0", foreArmR: "#88c490",
            handClosedL: "#f5c8a0", handClosedR: "#e8b890",
            handOpenL:   "#f5c8a0", handOpenR:   "#e8b890",
            legL: "#f5c8a0", legR: "#e8b890",
            shinL: "#7fc8c8", shinR: "#6ab8b8",
            footL: "#d4a878", footR: "#c89868",
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
        // texOffset: テクスチャを骨方向にずらすpx（正=先端方向、負=根元方向に潜り込む）
        constructor(name, length, localAngle, uv, width, parent = null,
                    isSlidable = false, minLen = 10, maxLen = 100, flipTex = false, texOffset = 0) {
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
            this.texOffset   = texOffset;
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
        abdomenBone = new Bone("Abdomen", 65, -Math.PI / 2, uvMap.abdomen,  80, root,        false, 10, 100, false, -14);
        chestBone   = new Bone("Chest",   65, 0,            uvMap.chest,    90, abdomenBone, false, 10, 100, false, -14);
        const neck  = new Bone("Neck",    28, 0,            uvMap.neck,     26, chestBone,   false, 10, 100, false, -12);
        headBone    = new Bone("Head",    58, 0,            uvMap.head,     55, neck,         false, 10, 100, false, -14);

        const lEyeBase  = new Bone("LeftEyeBase",  28, -0.4, null, 0, neck);
        const rEyeBase  = new Bone("RightEyeBase", 28,  0.4, null, 0, neck);
        leftEyeBone  = new Bone("LeftEye",  2, 0, null, 0, lEyeBase,  true, 0, 7);
        rightEyeBone = new Bone("RightEye", 2, 0, null, 0, rEyeBase,  true, 0, 7);

        const lShoulder = new Bone("LeftShoulder",  35, -Math.PI / 2,       null,               0,  chestBone,  true, 15, 80);
        const rShoulder = new Bone("RightShoulder", 35,  Math.PI / 2,       null,               0,  chestBone,  true, 15, 80);
        const lArm      = new Bone("LeftArm",       55, -Math.PI / 2 + 0.3, uvMap.armL,        30,  lShoulder,  false, 10, 100, false, -10);
        const lForeArm  = new Bone("LeftForeArm",   75,  0,                 uvMap.foreArmL,    26,  lArm,       false, 10, 100, true,  -14);
        leftHandBone    = new Bone("LeftHand",      28,  0,                 uvMap.handClosedL, 28,  lForeArm,   false, 10, 100, true,  -12);
        const rArm      = new Bone("RightArm",      55,  Math.PI / 2 - 0.3, uvMap.armR,        30,  rShoulder,  false, 10, 100, false, -10);
        const rForeArm  = new Bone("RightForeArm",  75,  0,                 uvMap.foreArmR,    26,  rArm,       false, 10, 100, true,  -14);
        rightHandBone   = new Bone("RightHand",     28,  0,                 uvMap.handClosedR, 28,  rForeArm,   false, 10, 100, true,  -12);

        const lHip  = new Bone("LeftHip",   25,  Math.PI,           null,        0,  root,  true, 10, 60);
        const rHip  = new Bone("RightHip",  25,  0,                 null,        0,  root,  true, 10, 60);
        const lLeg  = new Bone("LeftLeg",   72, -Math.PI / 2 + 0.1, uvMap.legL,  40, lHip,  false, 10, 100, false);
        const lShin = new Bone("LeftShin", 103,  0,                 uvMap.shinL, 34, lLeg,  false, 10, 100, true,  -16);
        const lFoot = new Bone("LeftFoot",  30,  Math.PI / 2,       uvMap.footL, 36, lShin, false, 10, 100, true,  -16);
        const rLeg  = new Bone("RightLeg",  72,  Math.PI / 2 - 0.1, uvMap.legR,  40, rHip,  false, 10, 100, false);
        const rShin = new Bone("RightShin",103,  0,                 uvMap.shinR, 34, rLeg,  false, 10, 100, true,  -16);
        const rFoot = new Bone("RightFoot", 30,  Math.PI / 2,       uvMap.footR, 36, rShin, false, 10, 100, true,  -16);

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

    // ---- 背景画像 ----
    let bgImage = null;

    bgImgInput?.addEventListener("change", (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (ev) => {
            const img = new Image();
            img.onload = () => {
                bgImage = img;
                if (bgImgClearBtn) bgImgClearBtn.style.display = "";
                onBgLoad?.(img.naturalWidth / img.naturalHeight);
                draw();
            };
            img.src = ev.target.result;
        };
        reader.readAsDataURL(file);
    });

    bgImgClearBtn?.addEventListener("click", () => {
        bgImage = null;
        if (bgImgInput) bgImgInput.value = "";
        bgImgClearBtn.style.display = "none";
        onBgLoad?.(null);
        draw();
    });

    // ---- 背景色 有効/無効フラグ ----
    let bgColorEnabled = true;

    bgColorClearBtn?.addEventListener("click", () => {
        bgColorEnabled = false;
        bgColorClearBtn.style.background = "#2a2a2a";
        bgColorClearBtn.style.color = "#888";
        draw();
    });

    // 背景色変更時に再描画（色を選び直したら有効化に戻す）
    bgColorPick?.addEventListener("input", () => {
        bgColorEnabled = true;
        if (bgColorClearBtn) {
            bgColorClearBtn.style.background = "#5a3a3a";
            bgColorClearBtn.style.color = "#fff";
        }
        draw();
    });

    // ---- 描画 ----
    function draw() {
        ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
        if (bgColorPick && bgColorEnabled) {
            ctx.fillStyle = bgColorPick.value;
            ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);
        }
        if (bgImage) {
            const imgAr = bgImage.naturalWidth / bgImage.naturalHeight;
            let dw, dh;
            if (imgAr >= 1) { dw = CANVAS_W; dh = Math.round(CANVAS_W / imgAr); }
            else             { dh = CANVAS_H; dw = Math.round(CANVAS_H * imgAr); }
            ctx.drawImage(bgImage,
                Math.round((CANVAS_W - dw) / 2), Math.round((CANVAS_H - dh) / 2), dw, dh);
        }
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
                const r   = bone.width / 2;
                const len = bone.length;

                ctx.save();
                const off = bone.texOffset ?? 0;
                if (bone.flipTex) {
                    // 根元から先端方向：負のoffsetで根元側（親の下）に潜り込む
                    ctx.translate(bone.gx, bone.gy);
                    ctx.rotate(bone.gAngle - Math.PI / 2);
                    ctx.translate(0, off);
                } else {
                    // 先端から根元方向：正のoffsetで先端側（親の下）に潜り込む
                    ctx.translate(bone.endX, bone.endY);
                    ctx.rotate(bone.gAngle + Math.PI / 2);
                    ctx.translate(0, -off);
                }

                // スタジアム形（長方形＋両端半円）をクリップパスとして設定
                ctx.beginPath();
                ctx.arc(0,   0,   r, Math.PI, 0);
                ctx.lineTo(r, len);
                ctx.arc(0,   len, r, 0,       Math.PI);
                ctx.lineTo(-r, 0);
                ctx.closePath();
                ctx.clip();

                // テクスチャを矩形で描画（クリップにより両端が丸くなる）
                ctx.drawImage(
                    atlasImage,
                    suv.x, suv.y, suv.w, suv.h,
                    -r, 0, bone.width, len
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
            // B. スタジアム形アウトライン（各ボーンの形状を可視化）
            for (const bone of drawOrder) {
                if (!bone.visible || !bone.uv) continue;
                const r   = bone.width / 2;
                const len = bone.length;
                const off = bone.texOffset ?? 0;

                ctx.save();
                if (bone.flipTex) {
                    ctx.translate(bone.gx, bone.gy);
                    ctx.rotate(bone.gAngle - Math.PI / 2);
                    ctx.translate(0, off);
                } else {
                    ctx.translate(bone.endX, bone.endY);
                    ctx.rotate(bone.gAngle + Math.PI / 2);
                    ctx.translate(0, -off);
                }

                ctx.beginPath();
                ctx.arc(0,   0,   r, Math.PI, 0);
                ctx.lineTo(r, len);
                ctx.arc(0,   len, r, 0,       Math.PI);
                ctx.lineTo(-r, 0);
                ctx.closePath();
                ctx.strokeStyle = "rgba(60,60,60,0.7)";
                ctx.lineWidth = 1.5 / camera.zoom;
                ctx.stroke();
                ctx.restore();
            }

            // C. 骨格ライン
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

            // D. 関節ポイント
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
            btnToggleHead.textContent = "👤B";
            btnToggleHead.title = "Head: Back";
        } else {
            headBone.uv = uvMap.head;
            leftEyeBone.visible = true;
            rightEyeBone.visible = true;
            btnToggleHead.textContent = "👤F";
            btnToggleHead.title = "Head: Front";
        }
        draw();
    });

    // ---- 体の切り替えボタン ----
    btnToggleBody.addEventListener("click", () => {
        isBodyBack = !isBodyBack;
        if (isBodyBack) {
            chestBone.uv   = uvMap.chestBack;
            abdomenBone.uv = uvMap.abdomenBack;
            btnToggleBody.textContent = "👕B";
            btnToggleBody.title = "Body: Back";
        } else {
            chestBone.uv   = uvMap.chest;
            abdomenBone.uv = uvMap.abdomen;
            btnToggleBody.textContent = "👕F";
            btnToggleBody.title = "Body: Front";
        }
        draw();
    });

    // ---- 手の切り替えボタン ----
    // ボタンの Left/Right はユーザー視点（画面左=Left ボタン）
    // 画面左側はキャラの右手（rightHandBone）、画面右側はキャラの左手（leftHandBone）
    btnToggleLHand.addEventListener("click", () => {
        isLeftOpen = !isLeftOpen;
        if (isLeftOpen) {
            rightHandBone.uv = uvMap.handOpenR; rightHandBone.width = 36; rightHandBone.length = 34;
            btnToggleLHand.textContent = "L🖐";
            btnToggleLHand.title = "Left: Open";
        } else {
            rightHandBone.uv = uvMap.handClosedR; rightHandBone.width = 28; rightHandBone.length = 28;
            btnToggleLHand.textContent = "L✊";
            btnToggleLHand.title = "Left: Closed";
        }
        root.update(ROOT_X, ROOT_Y, ROOT_A);
        draw();
    });

    btnToggleRHand.addEventListener("click", () => {
        isRightOpen = !isRightOpen;
        if (isRightOpen) {
            leftHandBone.uv = uvMap.handOpenL; leftHandBone.width = 36; leftHandBone.length = 34;
            btnToggleRHand.textContent = "R🖐";
            btnToggleRHand.title = "Right: Open";
        } else {
            leftHandBone.uv = uvMap.handClosedL; leftHandBone.width = 28; leftHandBone.length = 28;
            btnToggleRHand.textContent = "R✊";
            btnToggleRHand.title = "Right: Closed";
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
        btnToggleHead.textContent  = "👤F"; btnToggleHead.title  = "Head: Front";
        btnToggleBody.textContent  = "👕F"; btnToggleBody.title  = "Body: Front";
        btnToggleLHand.textContent = "L✊";  btnToggleLHand.title = "Left: Closed";
        btnToggleRHand.textContent = "R✊";  btnToggleRHand.title = "Right: Closed";
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

    // ---- リグ非表示でキャプチャ（dataURL を返す） ----
    // opts.cropRect = { x, y, w, h, outW, outH, displaySize }
    //   x/y/w/h    : overlayCvs 座標系（displaySize ピクセル正方形内）
    //   outW/outH  : 出力画像サイズ
    //   displaySize: CVS_DISPLAY 値（スケール計算用）
    function captureWithoutRig(opts = {}) {
        const wasShowRig = showRig;
        showRig = false;
        draw();

        let dataUrl;
        if (opts.cropRect) {
            const { x, y, w, h, outW, outH, displaySize } = opts.cropRect;
            const scale = CANVAS_W / displaySize;
            const offCanvas = document.createElement("canvas");
            offCanvas.width  = outW;
            offCanvas.height = outH;
            offCanvas.getContext("2d").drawImage(canvas,
                Math.round(x * scale), Math.round(y * scale),
                Math.round(w * scale), Math.round(h * scale),
                0, 0, outW, outH);
            dataUrl = offCanvas.toDataURL("image/png");
        } else {
            dataUrl = canvas.toDataURL("image/png");
        }

        showRig = wasShowRig;
        draw();
        return dataUrl;
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

    return { resetPose, resetCamera, toggleRig, captureWithoutRig };
}
