// ============================================================
// MetaCleaner Pro — Full App (Image + Video + Vector Support)
// ============================================================

// State
let filesList = [];
let activeFileId = null;

// DOM Elements
const dropZone = document.getElementById('dropZone');
const fileInput = document.getElementById('fileInput');
const workspace = document.getElementById('workspace');
const fileListEl = document.getElementById('fileList');
const fileCountEl = document.getElementById('fileCount');
const inspectorContent = document.getElementById('inspectorContent');
const selectedFileName = document.getElementById('selectedFileName');
const btnDownloadAll = document.getElementById('btn-download-all');

// Quick Action Buttons
const btnClearAll = document.getElementById('btn-clear-all');
const btnKeepStock = document.getElementById('btn-keep-stock');

// Secret Code Elements
const secretCodeInput = document.getElementById('secretCodeInput');
const spoofPresets = document.getElementById('spoofPresets');
const btnPresetWin10 = document.getElementById('btn-preset-win10');
const btnPresetWin10_23 = document.getElementById('btn-preset-win10-23');
const btnPresetWin11_24 = document.getElementById('btn-preset-win11-24');

// ============================================================
// FILE TYPE DETECTION
// ============================================================

const SUPPORTED_TYPES = {
    // Images
    'image/jpeg': 'image',
    'image/png': 'image',
    'image/webp': 'image',
    // Videos
    'video/mp4': 'video',
    'video/quicktime': 'video',
    'video/webm': 'video',
    'video/x-matroska': 'video',
    'video/x-msvideo': 'video',
    // Vectors
    'image/svg+xml': 'vector',
    'application/postscript': 'vector',
    'application/illustrator': 'vector',
};

// Extension fallback for files without proper MIME types
const EXT_MAP = {
    'jpg': 'image', 'jpeg': 'image', 'png': 'image', 'webp': 'image',
    'mp4': 'video', 'mov': 'video', 'webm': 'video', 'mkv': 'video', 'avi': 'video',
    'svg': 'vector', 'eps': 'vector', 'ai': 'vector',
};

function getFileCategory(file) {
    if (SUPPORTED_TYPES[file.type]) return SUPPORTED_TYPES[file.type];
    const ext = file.name.split('.').pop().toLowerCase();
    return EXT_MAP[ext] || null;
}

function getFileExtension(name) {
    return name.split('.').pop().toLowerCase();
}

function isEpsOrAi(file) {
    const ext = getFileExtension(file.name);
    return ext === 'eps' || ext === 'ai' || file.type === 'application/postscript' || file.type === 'application/illustrator';
}

function isSvg(file) {
    const ext = getFileExtension(file.name);
    return ext === 'svg' || file.type === 'image/svg+xml';
}

// ============================================================
// INITIALIZATION
// ============================================================

function init() {
    // Drag and Drop
    dropZone.addEventListener('dragover', (e) => {
        e.preventDefault();
        dropZone.classList.add('drag-active');
    });

    dropZone.addEventListener('dragleave', () => {
        dropZone.classList.remove('drag-active');
    });

    dropZone.addEventListener('drop', (e) => {
        e.preventDefault();
        dropZone.classList.remove('drag-active');
        handleFiles(e.dataTransfer.files);
    });

    fileInput.addEventListener('change', (e) => {
        handleFiles(e.target.files);
    });

    // Helper for button feedback
    function attachButtonAction(btn, mode, text, icon) {
        if (!btn) return;
        btn.addEventListener('click', async function() {
            const originalHtml = this.innerHTML;
            this.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Applying...`;
            await processFiles(mode);
            this.innerHTML = originalHtml;
        });
    }

    // Actions
    attachButtonAction(btnClearAll, 'ALL');
    attachButtonAction(btnKeepStock, 'STOCK');
    
    // Secret Code Logic
    if(secretCodeInput) {
        secretCodeInput.addEventListener('input', (e) => {
            const val = e.target.value.toLowerCase().trim();
            if(['js', 'p1', 'mr'].includes(val)) {
                spoofPresets.style.display = 'block';
            } else {
                spoofPresets.style.display = 'none';
            }
        });
    }

    attachButtonAction(btnPresetWin10, 'PRESET_WIN10');
    attachButtonAction(btnPresetWin10_23, 'PRESET_WIN10_23');
    attachButtonAction(btnPresetWin11_24, 'PRESET_WIN11_24');
    
    btnDownloadAll.addEventListener('click', downloadAllZip);
}

// ============================================================
// FILE HANDLING — UNIFIED PIPELINE
// ============================================================

async function handleFiles(files) {
    if (files.length === 0) return;

    dropZone.style.display = 'none';
    workspace.style.display = 'block';

    for (let file of files) {
        const category = getFileCategory(file);
        if (!category) continue; // Skip unsupported

        const id = 'file_' + Math.random().toString(36).substr(2, 9);
        const arrayBuffer = await file.arrayBuffer();

        let metadata = {};
        let previewURL = null;

        // Branch by file category
        if (category === 'image') {
            previewURL = await readFileAsDataURL(file);
            metadata = await extractImageMetadata(arrayBuffer, file);
        } else if (category === 'video') {
            previewURL = await generateVideoThumbnail(file);
            metadata = await extractVideoMetadata(arrayBuffer, file);
        } else if (category === 'vector') {
            if (isSvg(file)) {
                const text = new TextDecoder('utf-8').decode(arrayBuffer);
                previewURL = await readFileAsDataURL(file); // SVGs render as <img>
                metadata = extractSvgMetadata(text);
            } else {
                // EPS / AI — extract metadata safely from header & XMP bytes without corrupting binary data
                previewURL = null; // Can't preview PostScript in browser
                metadata = extractEpsMetadata(arrayBuffer);
            }
        }

        const fileObj = {
            id,
            originalFile: file,
            originalArrayBuffer: arrayBuffer,
            name: file.name,
            size: file.size,
            type: file.type,
            category: category,
            previewURL: previewURL,
            cleanBlob: null,
            status: 'pending',
            metadata: metadata || {}
        };

        filesList.push(fileObj);
        renderFileItem(fileObj);
    }

    updateQueueStats();

    if (filesList.length > 0 && !activeFileId) {
        selectFile(filesList[0].id);
    }
}

// ============================================================
// C2PA / CONTENT CREDENTIALS ENGINE (Detection, Parsing, Stripping)
// ============================================================

const C2PA_MP4_UUID = [0xd8, 0xfe, 0xc3, 0xd6, 0x1b, 0x0e, 0x48, 0x3c, 0x92, 0x97, 0x58, 0x28, 0x87, 0x7e, 0xc4, 0x81];

// Master C2PA detection and extraction function
function detectAndExtractC2PA(arrayBuffer, fileType, fileName) {
    const ext = (fileName || '').split('.').pop().toLowerCase();
    let result = {
        found: false,
        format: null,
        totalSize: 0,
        boxTree: [],
        generator: null,
        actions: [],
        isAiGenerated: false,
        aiPrompt: null,
        signer: null,
        signatureAlgo: null,
        timestamp: null,
        rawStrings: [],
        manifestData: null
    };

    if (!arrayBuffer || arrayBuffer.byteLength < 16) return result;

    const uint8 = new Uint8Array(arrayBuffer);

    // 1. JPEG Detection (APP11 markers containing JUMBF 'jumb' / 'JP' / C2PA)
    if (ext === 'jpg' || ext === 'jpeg' || fileType === 'image/jpeg') {
        const jpegRes = scanJpegForC2PA(uint8);
        if (jpegRes.found) {
            result.found = true;
            result.format = 'JPEG APP11 (JUMBF)';
            result.totalSize = jpegRes.totalBytes;
            result.manifestData = jpegRes.combinedData;
        }
    }
    // 2. PNG Detection (caBX chunk)
    else if (ext === 'png' || fileType === 'image/png') {
        const pngRes = scanPngForC2PA(uint8);
        if (pngRes.found) {
            result.found = true;
            result.format = 'PNG caBX Chunk (JUMBF)';
            result.totalSize = pngRes.totalBytes;
            result.manifestData = pngRes.data;
        }
    }
    // 3. WebP Detection (RIFF c2pa chunk)
    else if (ext === 'webp' || fileType === 'image/webp') {
        const webpRes = scanWebpForC2PA(uint8);
        if (webpRes.found) {
            result.found = true;
            result.format = 'WebP RIFF c2pa Chunk (JUMBF)';
            result.totalSize = webpRes.totalBytes;
            result.manifestData = webpRes.data;
        }
    }
    // 4. MP4 / MOV Detection (UUID box with C2PA UUID or 'c2pa' atom)
    else if (['mp4', 'mov', 'm4v'].includes(ext) || fileType === 'video/mp4' || fileType === 'video/quicktime') {
        const mp4Res = scanMp4ForC2PA(uint8);
        if (mp4Res.found) {
            result.found = true;
            result.format = 'MP4/MOV c2pa UUID Box (JUMBF)';
            result.totalSize = mp4Res.totalBytes;
            result.manifestData = mp4Res.data;
        }
    }

    // 5. Generic scan fallback
    if (!result.found) {
        const genericRes = scanGenericForC2PA(uint8);
        if (genericRes.found) {
            result.found = true;
            result.format = genericRes.format || 'Embedded C2PA / JUMBF';
            result.totalSize = genericRes.totalBytes;
            result.manifestData = genericRes.data;
        }
    }

    // Parse JUMBF boxes and extract assertion metadata
    if (result.found) {
        const parseRes = parseJumbfAndAssertions(result.manifestData || uint8);
        result.boxTree = parseRes.boxTree;
        result.generator = parseRes.generator;
        result.actions = parseRes.actions;
        result.isAiGenerated = parseRes.isAiGenerated;
        result.aiPrompt = parseRes.aiPrompt;
        result.signer = parseRes.signer;
        result.signatureAlgo = parseRes.signatureAlgo;
        result.timestamp = parseRes.timestamp;
        result.rawStrings = parseRes.rawStrings;
    }

    return result;
}

// --- JPEG APP11 Scanner ---
function scanJpegForC2PA(uint8) {
    if (uint8[0] !== 0xFF || uint8[1] !== 0xD8) return { found: false };

    let offset = 2;
    let found = false;
    let totalBytes = 0;
    const payloads = [];

    while (offset < uint8.length - 4) {
        if (uint8[offset] !== 0xFF) {
            offset++;
            continue;
        }
        while (offset < uint8.length && uint8[offset] === 0xFF) offset++;
        if (offset >= uint8.length) break;

        const marker = uint8[offset++];
        if (marker === 0xDA || marker === 0xD9) break; // SOS or EOI
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD7)) continue;

        if (offset + 2 > uint8.length) break;
        const len = (uint8[offset] << 8) | uint8[offset + 1];
        if (len < 2 || offset + len > uint8.length) break;

        const segDataOffset = offset + 2;
        const segDataLen = len - 2;

        if (marker === 0xEB) { // APP11
            const isJumb = isJumbfData(uint8, segDataOffset, segDataLen);
            if (isJumb) {
                found = true;
                totalBytes += len + 2;
                payloads.push(uint8.slice(segDataOffset, segDataOffset + segDataLen));
            }
        }

        offset += len;
    }

    let combinedData = null;
    if (payloads.length === 1) {
        combinedData = payloads[0];
    } else if (payloads.length > 1) {
        const totalLen = payloads.reduce((acc, p) => acc + p.length, 0);
        combinedData = new Uint8Array(totalLen);
        let pos = 0;
        for (const p of payloads) {
            combinedData.set(p, pos);
            pos += p.length;
        }
    }

    return { found, totalBytes, combinedData };
}

function isJumbfData(uint8, offset, len) {
    if (len < 8) return false;
    // Direct JUMBF SuperBox: [LBox 4b][jumb]
    if (uint8[offset + 4] === 0x6A && uint8[offset + 5] === 0x75 && uint8[offset + 6] === 0x6D && uint8[offset + 7] === 0x62) {
        return true;
    }
    // ISO 19566-5 APP11 encapsulation (starts with 'JP' = 0x4A, 0x50)
    if (uint8[offset] === 0x4A && uint8[offset + 1] === 0x50) {
        return true;
    }
    // Scan first 40 bytes for 'jumb' or 'c2pa'
    const limit = Math.min(offset + len - 4, offset + 40);
    for (let i = offset; i < limit; i++) {
        if ((uint8[i] === 0x6A && uint8[i + 1] === 0x75 && uint8[i + 2] === 0x6D && uint8[i + 3] === 0x62) || // jumb
            (uint8[i] === 0x63 && uint8[i + 1] === 0x32 && uint8[i + 2] === 0x70 && uint8[i + 3] === 0x61)) {  // c2pa
            return true;
        }
    }
    return false;
}

// --- PNG caBX Scanner ---
function scanPngForC2PA(uint8) {
    if (uint8.length < 8) return { found: false };
    const sig = [137, 80, 78, 71, 13, 10, 26, 10];
    for (let i = 0; i < 8; i++) {
        if (uint8[i] !== sig[i]) return { found: false };
    }

    let offset = 8;
    while (offset < uint8.length - 12) {
        const len = (uint8[offset] << 24) | (uint8[offset + 1] << 16) | (uint8[offset + 2] << 8) | uint8[offset + 3];
        const type = String.fromCharCode(uint8[offset + 4], uint8[offset + 5], uint8[offset + 6], uint8[offset + 7]);

        if (type === 'caBX') {
            const data = uint8.slice(offset + 8, offset + 8 + len);
            return { found: true, totalBytes: len + 12, data };
        }

        offset += 12 + len;
        if (type === 'IEND') break;
    }

    return { found: false };
}

// --- WebP RIFF c2pa Scanner ---
function scanWebpForC2PA(uint8) {
    if (uint8.length < 16) return { found: false };
    const riff = String.fromCharCode(uint8[0], uint8[1], uint8[2], uint8[3]);
    const webp = String.fromCharCode(uint8[8], uint8[9], uint8[10], uint8[11]);
    if (riff !== 'RIFF' || webp !== 'WEBP') return { found: false };

    let offset = 12;
    while (offset < uint8.length - 8) {
        const fourCC = String.fromCharCode(uint8[offset], uint8[offset + 1], uint8[offset + 2], uint8[offset + 3]);
        const size = (uint8[offset + 4]) | (uint8[offset + 5] << 8) | (uint8[offset + 6] << 16) | (uint8[offset + 7] << 24);

        if (fourCC === 'c2pa') {
            const data = uint8.slice(offset + 8, offset + 8 + size);
            return { found: true, totalBytes: size + 8, data };
        }

        offset += 8 + size + (size % 2);
    }

    return { found: false };
}

// --- MP4 / MOV UUID Box Scanner ---
function scanMp4ForC2PA(uint8) {
    if (uint8.length < 16) return { found: false };
    const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);

    function scanBoxes(start, end) {
        let offset = start;
        while (offset < end - 8) {
            let size = view.getUint32(offset);
            const type = String.fromCharCode(
                uint8[offset + 4], uint8[offset + 5], uint8[offset + 6], uint8[offset + 7]
            );

            if (size === 0) size = end - offset;
            if (size === 1 && offset + 16 <= end) {
                const hi = view.getUint32(offset + 8);
                const lo = view.getUint32(offset + 12);
                size = hi * 0x100000000 + lo;
            }
            if (size < 8 || offset + size > end) break;

            if (type === 'c2pa') {
                return { found: true, totalBytes: size, data: uint8.slice(offset + 8, offset + size) };
            }

            if (type === 'uuid' && size >= 24) {
                let match = true;
                for (let i = 0; i < 16; i++) {
                    if (uint8[offset + 8 + i] !== C2PA_MP4_UUID[i]) {
                        match = false;
                        break;
                    }
                }
                if (match) {
                    return { found: true, totalBytes: size, data: uint8.slice(offset + 24, offset + size) };
                }
            }

            if (['moov', 'meta', 'trak', 'udta'].includes(type)) {
                let innerStart = offset + 8;
                if (type === 'meta') innerStart += 4;
                const innerRes = scanBoxes(innerStart, offset + size);
                if (innerRes.found) return innerRes;
            }

            offset += size;
        }
        return { found: false };
    }

    return scanBoxes(0, uint8.length);
}

// --- Generic JUMBF / C2PA String Scanner (fallback) ---
function scanGenericForC2PA(uint8) {
    if (uint8.length < 32) return { found: false };
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const sample = decoder.decode(uint8.slice(0, Math.min(uint8.length, 65536)));

    if (sample.includes('c2pa.assertions') || sample.includes('c2pa.claim') || sample.includes('c2pa.signature') || sample.includes('c2pa_manifest')) {
        return { found: true, totalBytes: uint8.length, format: 'Embedded C2PA Provenance', data: uint8 };
    }
    return { found: false };
}

// --- JUMBF Box & Assertion Parser ---
function parseJumbfAndAssertions(uint8) {
    const res = {
        boxTree: [],
        generator: null,
        actions: [],
        isAiGenerated: false,
        aiPrompt: null,
        signer: null,
        signatureAlgo: null,
        timestamp: null,
        rawStrings: []
    };

    if (!uint8 || uint8.length < 8) return res;

    // 1. Box traversal
    function traverseBoxes(bytes, start, end, depth) {
        if (depth > 6) return;
        let pos = start;
        while (pos < end - 8) {
            let lbox = (bytes[pos] << 24) | (bytes[pos + 1] << 16) | (bytes[pos + 2] << 8) | bytes[pos + 3];
            let tbox = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7]);

            if (tbox !== 'jumb' && tbox !== 'jumd' && tbox !== 'cbor' && tbox !== 'json' && tbox !== 'c2pa') {
                const nextIdx = findAsciiSubstring(bytes, ['jumb', 'jumd', 'cbor'], pos, Math.min(pos + 64, end));
                if (nextIdx !== -1 && nextIdx >= 4) {
                    pos = nextIdx - 4;
                    continue;
                } else {
                    break;
                }
            }

            if (lbox < 8 || pos + lbox > end) {
                lbox = end - pos;
            }

            let boxLabel = null;

            if (tbox === 'jumb' && pos + 8 < end) {
                const innerEnd = pos + lbox;
                let jumdPos = pos + 8;
                if (jumdPos + 8 <= innerEnd) {
                    const jumdType = String.fromCharCode(bytes[jumdPos + 4], bytes[jumdPos + 5], bytes[jumdPos + 6], bytes[jumdPos + 7]);
                    if (jumdType === 'jumd') {
                        const jumdLen = (bytes[jumdPos] << 24) | (bytes[jumdPos + 1] << 16) | (bytes[jumdPos + 2] << 8) | bytes[jumdPos + 3];
                        if (jumdPos + 25 < jumdPos + jumdLen) {
                            let labelBytes = [];
                            let lPos = jumdPos + 25;
                            while (lPos < jumdPos + jumdLen && bytes[lPos] !== 0 && labelBytes.length < 64) {
                                labelBytes.push(bytes[lPos++]);
                            }
                            if (labelBytes.length > 0) {
                                boxLabel = new TextDecoder('latin1').decode(new Uint8Array(labelBytes));
                            }
                        }
                    }
                }
                res.boxTree.push({ type: 'jumb', label: boxLabel || 'c2pa', size: lbox });
                traverseBoxes(bytes, pos + 8, innerEnd, depth + 1);
            } else {
                res.boxTree.push({ type: tbox, label: boxLabel || tbox, size: lbox });
            }

            pos += lbox;
        }
    }

    try {
        traverseBoxes(uint8, 0, uint8.length, 0);
    } catch (e) {
        console.log("JUMBF box traversal:", e);
    }

    // 2. Deep UTF-8 & CBOR String Extraction
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const fullText = decoder.decode(uint8);

    // Extract Claim Generator / Tool
    const genPatterns = [
        /(?:claim_generator|claim_generator_info|softwareAgent|generator)["'\s:]+([a-zA-Z0-9_\-\.\s\(\)\/]{3,40}?)(?=[,\r\n\x00"]|$)/i,
        /(Adobe\s+Firefly(?:\s+[\d\.]+)?)/i,
        /(Adobe\s+Photoshop(?:\s+[\d\.]+)?)/i,
        /(Midjourney(?:\s+v?[\d\.]+)?)/i,
        /(DALL[·\- ]?E(?:\s+[\d\.]+)?)/i,
        /(ChatGPT)/i,
        /(Stable\s+Diffusion(?:\s+[\w\.\-]+)?)/i,
        /(Google\s+Imagen(?:\s+[\d\.]+)?)/i,
        /(Canva)/i,
        /(Truepic[^\r\n,\x00"]*)/i,
        /(Leica[^\r\n,\x00"]*)/i,
        /(Nikon[^\r\n,\x00"]*)/i,
        /(Sony[^\r\n,\x00"]*)/i
    ];

    for (const pat of genPatterns) {
        const m = fullText.match(pat);
        if (m && m[1] && m[1].trim().length > 2) {
            let val = m[1].trim();
            val = val.replace(/^[":\s]+|[",\s]+$/g, '').split(/[\r\n]/)[0].trim();
            if (val && !res.generator) {
                res.generator = val;
                break;
            }
        }
    }

    // Extract Actions
    const actionMap = {
        'c2pa.created': 'Created',
        'c2pa.edited': 'Edited',
        'c2pa.placed': 'Placed (Composite)',
        'c2pa.filtered': 'Filtered',
        'c2pa.resized': 'Resized',
        'c2pa.cropped': 'Cropped',
        'c2pa.color_adjustments': 'Color Adjusted',
        'c2pa.drawing': 'Drawing',
        'c2pa.opened': 'Opened',
        'c2pa.repackaged': 'Repackaged',
        'c2pa.ai_generative_variation': 'AI Generative Variation',
        'c2pa.ai_generative': 'AI Generative Content'
    };

    const detectedActions = new Set();
    for (const [key, label] of Object.entries(actionMap)) {
        if (fullText.includes(key)) {
            detectedActions.add(label);
        }
    }
    res.actions = Array.from(detectedActions);

    // AI Generated Check
    if (res.actions.some(a => a.includes('AI')) ||
        fullText.includes('c2pa.ai_generative') ||
        fullText.includes('trained_algorithmic_media') ||
        fullText.includes('ai_metadata') ||
        (res.generator && /(firefly|midjourney|dall|diffus|generat|openai)/i.test(res.generator))) {
        res.isAiGenerated = true;
    }

    // Extract AI Prompt
    const promptMatch = fullText.match(/(?:prompt|user_prompt|positive_prompt)["'\s:]+([^\x00-\x1f"'\\]{5,300})/i);
    if (promptMatch && promptMatch[1]) {
        res.aiPrompt = promptMatch[1].replace(/^[":\s]+|[",\s]+$/g, '').split(/[\r\n]/)[0].trim();
    }

    // Extract Signer (X.509 Common Name or Organization)
    const signerPatterns = [
        /(?:CN|O)\s*=\s*([a-zA-Z0-9_\-\.\s&]{3,40}?)(?=[,\r\n\x00"\/]|$)/i,
        /(Adobe\s+Inc\.[^\r\n,\/\\<>"\x00]*)/i,
        /(Truepic\s+Inc\.[^\r\n,\/\\<>"\x00]*)/i,
        /(OpenAI[^\r\n,\/\\<>"\x00]*)/i,
        /(Microsoft\s+Corporation[^\r\n,\/\\<>"\x00]*)/i,
        /(Google\s+LLC[^\r\n,\/\\<>"\x00]*)/i,
        /(DigiCert[^\r\n,\/\\<>"\x00]*)/i
    ];

    for (const pat of signerPatterns) {
        const m = fullText.match(pat);
        if (m && m[1] && m[1].trim().length > 2) {
            let val = m[1].trim();
            val = val.replace(/^[":\s=]+|[",\s]+$/g, '').split(/[\r\n]/)[0].trim();
            if (val && !res.signer && !val.includes('http')) {
                res.signer = val;
                break;
            }
        }
    }

    // Signature Algorithm
    const algoMatch = fullText.match(/(es256|ps256|ed25519|rs256|es384|es512)/i);
    if (algoMatch) {
        res.signatureAlgo = algoMatch[1].toUpperCase();
    }

    // Timestamp
    const dateMatch = fullText.match(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})/);
    if (dateMatch) {
        res.timestamp = dateMatch[0];
    }

    // Collect interesting C2PA strings
    const interesting = fullText.match(/(c2pa\.[a-zA-Z0-9_\.\-]+)/g);
    if (interesting) {
        res.rawStrings = Array.from(new Set(interesting)).slice(0, 12);
    }

    return res;
}

function findAsciiSubstring(bytes, targets, start, end) {
    for (let i = start; i < end - 4; i++) {
        for (const target of targets) {
            let match = true;
            for (let j = 0; j < target.length; j++) {
                if (bytes[i + j] !== target.charCodeAt(j)) {
                    match = false;
                    break;
                }
            }
            if (match) return i;
        }
    }
    return -1;
}

// --- Stripper Functions ---

// Strip APP11 (JUMBF / C2PA) markers from JPEG ArrayBuffer
function stripJpegC2pa(arrayBuffer) {
    const uint8 = new Uint8Array(arrayBuffer);
    if (uint8[0] !== 0xFF || uint8[1] !== 0xD8) return arrayBuffer;

    const chunks = [];
    chunks.push({ start: 0, end: 2 }); // SOI

    let offset = 2;
    while (offset < uint8.length - 4) {
        if (uint8[offset] !== 0xFF) {
            chunks.push({ start: offset, end: offset + 1 });
            offset++;
            continue;
        }
        let markerStart = offset;
        while (offset < uint8.length && uint8[offset] === 0xFF) offset++;
        if (offset >= uint8.length) break;

        const marker = uint8[offset++];
        if (marker === 0xDA) { // SOS (Start of Scan)
            chunks.push({ start: markerStart, end: uint8.length });
            break;
        }
        if (marker === 0xD9) { // EOI
            chunks.push({ start: markerStart, end: offset });
            break;
        }
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD7)) {
            chunks.push({ start: markerStart, end: offset });
            continue;
        }

        if (offset + 2 > uint8.length) {
            chunks.push({ start: markerStart, end: uint8.length });
            break;
        }

        const len = (uint8[offset] << 8) | uint8[offset + 1];
        const segEnd = offset + len;

        if (marker === 0xEB) { // APP11 (JUMBF / C2PA)
            // Skip this entire APP11 segment
            offset = segEnd;
            continue;
        }

        chunks.push({ start: markerStart, end: segEnd });
        offset = segEnd;
    }

    const totalLen = chunks.reduce((acc, c) => acc + (c.end - c.start), 0);
    const output = new Uint8Array(totalLen);
    let writePos = 0;
    for (const chunk of chunks) {
        const slice = uint8.slice(chunk.start, chunk.end);
        output.set(slice, writePos);
        writePos += slice.length;
    }

    return output.buffer;
}

// Helper: Spoof XMP string with authentic Adobe CreatorTool, xmptk, softwareAgent, and pdf:Producer while removing Topaz/AI upscalers
function spoofXmpStringWithAdobeMeta(xmpStr, creatorTool, xmptk, pdfProducer, ownerName) {
    if (!xmpStr) return xmpStr;

    // 1. Remove Topaz / Gigapixel / AI upscaler references
    let updated = xmpStr.replace(/<(?:topaz|Topaz):[^>]*>[\s\S]*?<\/(?:topaz|Topaz):[^>]*>/gi, '');
    updated = updated.replace(/<(?:topaz|Topaz):[^>]*\/>/gi, '');
    updated = updated.replace(/Topaz[^\r\n<"']*/gi, '');
    updated = updated.replace(/Gigapixel[^\r\n<"']*/gi, '');

    // 2. Update x:xmptk attribute on <x:xmpmeta>
    if (xmptk) {
        if (/x:xmptk\s*=\s*["'][^"']*["']/i.test(updated)) {
            updated = updated.replace(/x:xmptk\s*=\s*["'][^"']*["']/i, `x:xmptk="${xmptk}"`);
        } else {
            updated = updated.replace(/<x:xmpmeta\b/i, `<x:xmpmeta x:xmptk="${xmptk}"`);
        }
    }

    // 3. Update CreatorTool (both element and attribute forms)
    if (creatorTool) {
        let foundCreatorTool = false;
        if (/<xmp:CreatorTool>[\s\S]*?<\/xmp:CreatorTool>/i.test(updated)) {
            updated = updated.replace(/<xmp:CreatorTool>[\s\S]*?<\/xmp:CreatorTool>/gi, `<xmp:CreatorTool>${creatorTool}</xmp:CreatorTool>`);
            foundCreatorTool = true;
        }
        if (/xmp:CreatorTool\s*=\s*["'][^"']*["']/i.test(updated)) {
            updated = updated.replace(/xmp:CreatorTool\s*=\s*["'][^"']*["']/gi, `xmp:CreatorTool="${creatorTool}"`);
            foundCreatorTool = true;
        }
        if (!foundCreatorTool) {
            updated = updated.replace(/(<rdf:Description\b[^>]*>)/i, `$1\n         <xmp:CreatorTool>${creatorTool}</xmp:CreatorTool>`);
        }

        // 4. Update stEvt:softwareAgent in xmpMM:History (both element and attribute forms)
        updated = updated.replace(/<stEvt:softwareAgent>[\s\S]*?<\/stEvt:softwareAgent>/gi, `<stEvt:softwareAgent>${creatorTool}</stEvt:softwareAgent>`);
        updated = updated.replace(/stEvt:softwareAgent\s*=\s*["'][^"']*["']/gi, `stEvt:softwareAgent="${creatorTool}"`);

        // 5. Update tiff:Software if present
        updated = updated.replace(/<tiff:Software>[\s\S]*?<\/tiff:Software>/gi, `<tiff:Software>${creatorTool}</tiff:Software>`);
        updated = updated.replace(/tiff:Software\s*=\s*["'][^"']*["']/gi, `tiff:Software="${creatorTool}"`);
    }

    // 6. Update pdf:Producer if provided and present
    if (pdfProducer) {
        updated = updated.replace(/<pdf:Producer>[\s\S]*?<\/pdf:Producer>/gi, `<pdf:Producer>${pdfProducer}</pdf:Producer>`);
        updated = updated.replace(/pdf:Producer\s*=\s*["'][^"']*["']/gi, `pdf:Producer="${pdfProducer}"`);
    }

    // 7. Update existing dc:creator if present and ownerName is provided
    if (ownerName && /<dc:creator>[\s\S]*?<\/dc:creator>/i.test(updated)) {
        const safeOwner = ownerName.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        updated = updated.replace(/(<dc:creator>[\s\S]*?<rdf:li>)[\s\S]*?(<\/rdf:li>[\s\S]*?<\/dc:creator>)/i, `$1${safeOwner}$2`);
    }

    return updated;
}

// Helper: Clean XMP string in-place or via XML to remove software/creatorTool/topaz references while preserving title, keywords, copyright
function cleanXmpStringPreservingStock(xmpStr) {
    if (!xmpStr) return xmpStr;

    // 1. Remove standalone Software/CreatorTool/softwareAgent attributes from rdf:Description
    let cleaned = xmpStr.replace(/\s+(?:[a-zA-Z0-9_-]+:)?(?:CreatorTool|Software|softwareAgent|SoftwareAgent)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '');

    // 2. Remove element-based CreatorTool, Software, and softwareAgent tags
    cleaned = cleaned.replace(/<(?:[a-zA-Z0-9_-]+:)?(?:CreatorTool|Software|softwareAgent|SoftwareAgent)[\s\S]*?<\/(?:[a-zA-Z0-9_-]+:)?(?:CreatorTool|Software|softwareAgent|SoftwareAgent)>/gi, '');
    cleaned = cleaned.replace(/<(?:[a-zA-Z0-9_-]+:)?(?:CreatorTool|Software|softwareAgent|SoftwareAgent)[^>]*\/>/gi, '');

    // 3. Remove Topaz specific tags / namespaces
    cleaned = cleaned.replace(/<(?:topaz|Topaz):[^>]*>[\s\S]*?<\/(?:topaz|Topaz):[^>]*>/gi, '');
    cleaned = cleaned.replace(/<(?:topaz|Topaz):[^>]*\/>/gi, '');

    // 4. Blank out any remaining mentions of Topaz, Gigapixel, or AI upscaler strings
    cleaned = cleaned.replace(/Topaz[^\r\n<"']*/gi, '');
    cleaned = cleaned.replace(/Gigapixel[^\r\n<"']*/gi, '');

    return cleaned;
}

// Clean or Spoof JPEG XMP APP1 segment bytes
function cleanXmpSegmentBytesPreservingStock(segBytes, spoofMeta = null) {
    // segBytes includes: [0xFF, 0xE1, len_hi, len_lo, ...payload...]
    const segLen = segBytes.length;
    const headerPrefix = 'http://ns.adobe.com/xap/1.0/\0';
    const headerLen = 4 + headerPrefix.length; // marker(2) + len(2) + headerPrefix
    if (segLen <= headerLen) return segBytes;

    const xmlBytes = segBytes.subarray(headerLen);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const xmlStr = decoder.decode(xmlBytes);

    const updatedXmlStr = spoofMeta
        ? spoofXmpStringWithAdobeMeta(xmlStr, spoofMeta.creatorTool, spoofMeta.xmptk, null, spoofMeta.ownerName)
        : cleanXmpStringPreservingStock(xmlStr);
    const encodedCleaned = new TextEncoder().encode(updatedXmlStr);

    if (encodedCleaned.length <= xmlBytes.length) {
        // Pad the remainder with spaces (0x20) so the segment length stays 100% identical!
        const result = new Uint8Array(segBytes);
        result.set(encodedCleaned, headerLen);
        for (let i = headerLen + encodedCleaned.length; i < segLen; i++) {
            result[i] = 0x20; // ASCII space padding
        }
        return result;
    } else if (spoofMeta && (headerPrefix.length + encodedCleaned.length + 2) <= 65535) {
        // Rebuild APP1 segment with updated 2-byte big-endian length
        const newPayloadLen = 2 + headerPrefix.length + encodedCleaned.length;
        const result = new Uint8Array(2 + newPayloadLen);
        result[0] = 0xFF;
        result[1] = 0xE1;
        result[2] = (newPayloadLen >> 8) & 0xFF;
        result[3] = newPayloadLen & 0xFF;
        for (let i = 0; i < headerPrefix.length; i++) {
            result[4 + i] = headerPrefix.charCodeAt(i);
        }
        result.set(encodedCleaned, 4 + headerPrefix.length);
        return result;
    }

    // Fallback: return original if encoded length exceeded
    return segBytes;
}

// Build a fresh authentic Adobe Photoshop XMP APP1 segment for JPEGs that lacked XMP
function buildAuthenticJpegXmpSegment(creatorTool, xmptk) {
    const iid = generateXmpUUID();
    const did = generateXmpUUID();
    const origDid = generateXmpUUID();
    const now = new Date();
    const isoDate = now.toISOString().replace(/\.\d{3}Z$/, '+06:00');
    const tk = xmptk || "Adobe XMP Core 9.1-c002 79.f3a8c9b, 2024/03/12-14:22:10        ";

    const xmpStr = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>\n<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${tk}">\n   <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">\n      <rdf:Description rdf:about=""\n            xmlns:xmp="http://ns.adobe.com/xap/1.0/"\n            xmlns:dc="http://purl.org/dc/elements/1.1/"\n            xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"\n            xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"\n            xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"\n            xmp:CreatorTool="${creatorTool}"\n            xmp:CreateDate="${isoDate}"\n            xmp:ModifyDate="${isoDate}"\n            xmp:MetadataDate="${isoDate}"\n            dc:format="image/jpeg"\n            photoshop:ColorMode="3"\n            photoshop:ICCProfile="sRGB IEC61966-2.1"\n            xmpMM:InstanceID="xmp.iid:${iid}"\n            xmpMM:DocumentID="adobe:docid:photoshop:${did}"\n            xmpMM:OriginalDocumentID="xmp.did:${origDid}">\n         <xmpMM:History>\n            <rdf:Seq>\n               <rdf:li\n                  stEvt:action="created"\n                  stEvt:instanceID="xmp.iid:${origDid}"\n                  stEvt:when="${isoDate}"\n                  stEvt:softwareAgent="${creatorTool}"/>\n               <rdf:li\n                  stEvt:action="saved"\n                  stEvt:instanceID="xmp.iid:${iid}"\n                  stEvt:when="${isoDate}"\n                  stEvt:softwareAgent="${creatorTool}"\n                  stEvt:changed="/"/>\n            </rdf:Seq>\n         </xmpMM:History>\n      </rdf:Description>\n   </rdf:RDF>\n</x:xmpmeta>\n<?xpacket end="w"?>`;

    const headerPrefix = 'http://ns.adobe.com/xap/1.0/\0';
    const xmpBytes = new TextEncoder().encode(xmpStr);
    const payloadLen = 2 + headerPrefix.length + xmpBytes.length;
    const seg = new Uint8Array(2 + payloadLen);
    seg[0] = 0xFF;
    seg[1] = 0xE1;
    seg[2] = (payloadLen >> 8) & 0xFF;
    seg[3] = payloadLen & 0xFF;
    for (let i = 0; i < headerPrefix.length; i++) {
        seg[4 + i] = headerPrefix.charCodeAt(i);
    }
    seg.set(xmpBytes, 4 + headerPrefix.length);
    return seg;
}

// Stock Safe / Profile JPEG cleaner:
// Keeps APP1 (XMP) and APP13 (Photoshop IPTC containing title, keywords, copyright)
// Strips APP11 (C2PA) and removes GPS / camera private tags
function stripJpegForStockSafe(arrayBuffer, spoofMeta = null) {
    if (!arrayBuffer || arrayBuffer.byteLength < 4) return arrayBuffer;
    let uint8 = new Uint8Array(arrayBuffer);
    if (uint8[0] !== 0xFF || uint8[1] !== 0xD8) return arrayBuffer;

    // Pass 1: Strip Software, HostComputer, GPS & sensitive private camera tags via piexif
    try {
        const fullStr = uint8ToBinaryString(uint8);
        const exifObj = piexif.load(fullStr);
        let modified = false;

        if (exifObj["0th"]) {
            delete exifObj["0th"][piexif.ImageIFD.Software];
            delete exifObj["0th"][piexif.ImageIFD.HostComputer];
            delete exifObj["0th"][piexif.ImageIFD.ProcessingSoftware];
            modified = true;
        }
        if (exifObj.GPS && Object.keys(exifObj.GPS).length > 0) {
            exifObj.GPS = {};
            modified = true;
        }
        if (exifObj.Exif) {
            delete exifObj.Exif[piexif.ExifIFD.MakerNote];
            delete exifObj.Exif[piexif.ExifIFD.DeviceSettingDescription];
            delete exifObj.Exif[piexif.ExifIFD.BodySerialNumber];
            delete exifObj.Exif[piexif.ExifIFD.LensSerialNumber];
            delete exifObj.Exif[piexif.ExifIFD.CameraOwnerName];
            modified = true;
        }

        if (modified) {
            const dumped = piexif.dump(exifObj);
            const inserted = piexif.insert(dumped, fullStr);
            const newBytes = new Uint8Array(inserted.length);
            for (let i = 0; i < inserted.length; i++) {
                newBytes[i] = inserted.charCodeAt(i) & 0xFF;
            }
            uint8 = newBytes;
        }
    } catch (e) {
        console.warn("piexif EXIF clean warning:", e);
    }

    // Pass 2: Strip C2PA APP11 markers and clean/spoof XMP in-place
    const chunks = [];
    chunks.push({ start: 0, end: 2 }); // SOI
    const xmpPrefix = 'http://ns.adobe.com/xap/1.0/\0';
    let foundXmpSegment = false;

    let offset = 2;
    while (offset < uint8.length - 4) {
        if (uint8[offset] !== 0xFF) {
            chunks.push({ start: offset, end: offset + 1 });
            offset++;
            continue;
        }
        let markerStart = offset;
        while (offset < uint8.length && uint8[offset] === 0xFF) offset++;
        if (offset >= uint8.length) break;

        const marker = uint8[offset++];
        if (marker === 0xDA) { // SOS
            if (spoofMeta && !foundXmpSegment) {
                chunks.push({ customBytes: buildAuthenticJpegXmpSegment(spoofMeta.creatorTool, spoofMeta.xmptk) });
                foundXmpSegment = true;
            }
            chunks.push({ start: markerStart, end: uint8.length });
            break;
        }
        if (marker === 0xD9) { // EOI
            chunks.push({ start: markerStart, end: offset });
            break;
        }
        if (marker === 0x00 || (marker >= 0xD0 && marker <= 0xD7)) {
            chunks.push({ start: markerStart, end: offset });
            continue;
        }

        if (offset + 2 > uint8.length) {
            chunks.push({ start: markerStart, end: uint8.length });
            break;
        }

        const len = (uint8[offset] << 8) | uint8[offset + 1];
        const segEnd = offset + len;

        // Skip C2PA APP11 markers
        if (marker === 0xEB && isJumbfData(uint8, offset + 2, len - 2)) {
            offset = segEnd;
            continue;
        }

        // Clean or Spoof XMP APP1 in-place (preserves Title / Keywords / Copyright)
        if (marker === 0xE1) {
            const segDataOffset = offset + 2;
            const headerStr = String.fromCharCode.apply(null, uint8.subarray(segDataOffset, Math.min(segDataOffset + 32, segEnd)));
            if (headerStr.startsWith(xmpPrefix)) {
                foundXmpSegment = true;
                try {
                    const segBytes = uint8.slice(markerStart, segEnd);
                    const cleanedSegBytes = cleanXmpSegmentBytesPreservingStock(segBytes, spoofMeta);
                    chunks.push({ customBytes: cleanedSegBytes });
                    offset = segEnd;
                    continue;
                } catch (e) {
                    console.warn("XMP segment clean error:", e);
                }
            }
        }

        // Keep all other segments (IPTC, ICC, Tables, Scan data)
        chunks.push({ start: markerStart, end: segEnd });
        offset = segEnd;
    }

    let totalLen = 0;
    for (const c of chunks) {
        totalLen += c.customBytes ? c.customBytes.length : (c.end - c.start);
    }
    const output = new Uint8Array(totalLen);
    let writePos = 0;
    for (const chunk of chunks) {
        if (chunk.customBytes) {
            output.set(chunk.customBytes, writePos);
            writePos += chunk.customBytes.length;
        } else {
            const slice = uint8.slice(chunk.start, chunk.end);
            output.set(slice, writePos);
            writePos += slice.length;
        }
    }

    return output.buffer;
}

// Strip caBX chunk from PNG ArrayBuffer
function stripPngC2pa(arrayBuffer, removeExistingXmp = false) {
    const uint8 = new Uint8Array(arrayBuffer);
    if (uint8.length < 8) return arrayBuffer;

    const chunks = [];
    chunks.push({ start: 0, end: 8 }); // Header

    let offset = 8;
    while (offset < uint8.length - 12) {
        const len = (uint8[offset] << 24) | (uint8[offset + 1] << 16) | (uint8[offset + 2] << 8) | uint8[offset + 3];
        const type = String.fromCharCode(uint8[offset + 4], uint8[offset + 5], uint8[offset + 6], uint8[offset + 7]);
        const chunkTotal = 12 + len;
        const chunkEnd = offset + chunkTotal;

        if (type === 'caBX') {
            offset = chunkEnd;
            continue;
        }

        // Filter Software / Topaz / Creator metadata from tEXt or zTXt chunks
        if (type === 'tEXt' || type === 'zTXt') {
            const chunkData = uint8.subarray(offset + 8, chunkEnd - 4);
            const nullIdx = chunkData.indexOf(0);
            if (nullIdx !== -1) {
                const keyword = new TextDecoder('latin1').decode(chunkData.subarray(0, nullIdx));
                if (['Software', 'Creator', 'Author', 'Comment', 'Source'].includes(keyword)) {
                    offset = chunkEnd;
                    continue;
                }
            }
        }

        if (type === 'iTXt' && len > 4) {
            const chunkData = uint8.subarray(offset + 8, chunkEnd - 4);
            const nullIdx = chunkData.indexOf(0);
            const keyword = nullIdx !== -1 ? new TextDecoder('latin1').decode(chunkData.subarray(0, nullIdx)) : '';
            if (keyword.startsWith('c2pa') || keyword.startsWith('caBX') || keyword === 'Software' || keyword === 'Author') {
                offset = chunkEnd;
                continue;
            }
            // If iTXt contains XMP (keyword XML:com.adobe.xmp), either remove (if re-injecting custom profile XMP) or clean Software/CreatorTool
            if (keyword === 'XML:com.adobe.xmp') {
                if (removeExistingXmp) {
                    offset = chunkEnd;
                    continue;
                }
                try {
                    let pos = nullIdx + 1;
                    const isCompressed = chunkData[pos] === 1;
                    if (!isCompressed) {
                        pos += 2;
                        while (pos < chunkData.length && chunkData[pos] !== 0) pos++; // skip lang tag
                        pos++;
                        while (pos < chunkData.length && chunkData[pos] !== 0) pos++; // skip trans keyword
                        pos++;
                        const xmpRaw = new TextDecoder('utf-8', { fatal: false }).decode(chunkData.subarray(pos));
                        const cleanedXmp = cleanXmpStringPreservingStock(xmpRaw);
                        const encodedCleaned = new TextEncoder().encode(cleanedXmp);
                        if (encodedCleaned.length <= (chunkData.length - pos)) {
                            // Pad remainder with spaces
                            chunkData.set(encodedCleaned, pos);
                            for (let p = pos + encodedCleaned.length; p < chunkData.length; p++) {
                                chunkData[p] = 0x20;
                            }
                            // Recalculate CRC32
                            const crc = crc32(uint8.subarray(offset + 4, chunkEnd - 4));
                            uint8[chunkEnd - 4] = (crc >> 24) & 0xff;
                            uint8[chunkEnd - 3] = (crc >> 16) & 0xff;
                            uint8[chunkEnd - 2] = (crc >> 8) & 0xff;
                            uint8[chunkEnd - 1] = crc & 0xff;
                        }
                    }
                } catch (e) { /* ignore */ }
            }
        }

        chunks.push({ start: offset, end: chunkEnd });
        offset = chunkEnd;
        if (type === 'IEND') break;
    }

    const totalLen = chunks.reduce((acc, c) => acc + (c.end - c.start), 0);
    const output = new Uint8Array(totalLen);
    let writePos = 0;
    for (const chunk of chunks) {
        const slice = uint8.slice(chunk.start, chunk.end);
        output.set(slice, writePos);
        writePos += slice.length;
    }

    return output.buffer;
}

// Strip c2pa RIFF chunk from WebP ArrayBuffer
function stripWebpC2pa(arrayBuffer) {
    const uint8 = new Uint8Array(arrayBuffer);
    if (uint8.length < 16) return arrayBuffer;

    const riff = String.fromCharCode(uint8[0], uint8[1], uint8[2], uint8[3]);
    const webp = String.fromCharCode(uint8[8], uint8[9], uint8[10], uint8[11]);
    if (riff !== 'RIFF' || webp !== 'WEBP') return arrayBuffer;

    const chunks = [];
    chunks.push({ start: 0, end: 12 }); // RIFF header

    let offset = 12;
    while (offset < uint8.length - 8) {
        const fourCC = String.fromCharCode(uint8[offset], uint8[offset + 1], uint8[offset + 2], uint8[offset + 3]);
        const size = (uint8[offset + 4]) | (uint8[offset + 5] << 8) | (uint8[offset + 6] << 16) | (uint8[offset + 7] << 24);
        const chunkTotal = 8 + size + (size % 2);
        const chunkEnd = Math.min(offset + chunkTotal, uint8.length);

        if (fourCC === 'c2pa') {
            offset = chunkEnd;
            continue;
        }

        // Clean XMP chunk in WebP
        if (fourCC === 'XMP ') {
            try {
                const xmpBytes = uint8.subarray(offset + 8, offset + 8 + size);
                const xmpText = new TextDecoder('utf-8', { fatal: false }).decode(xmpBytes);
                const cleanedXmp = cleanXmpStringPreservingStock(xmpText);
                const encodedCleaned = new TextEncoder().encode(cleanedXmp);
                if (encodedCleaned.length <= size) {
                    const customChunk = new Uint8Array(chunkTotal);
                    customChunk.set(uint8.subarray(offset, offset + 8), 0);
                    customChunk.set(encodedCleaned, 8);
                    for (let p = 8 + encodedCleaned.length; p < 8 + size; p++) {
                        customChunk[p] = 0x20;
                    }
                    if (size % 2 === 1) customChunk[chunkTotal - 1] = 0;
                    chunks.push({ customBytes: customChunk });
                    offset = chunkEnd;
                    continue;
                }
            } catch (e) { /* fallback */ }
        }

        // Clean EXIF chunk in WebP
        if (fourCC === 'EXIF') {
            try {
                const exifBytes = uint8.subarray(offset + 8, offset + 8 + size);
                const fullStr = uint8ToBinaryString(exifBytes);
                const exifObj = piexif.load(fullStr);
                if (exifObj['0th']) {
                    delete exifObj['0th'][piexif.ImageIFD.Software];
                    delete exifObj['0th'][piexif.ImageIFD.HostComputer];
                    delete exifObj['0th'][piexif.ImageIFD.ProcessingSoftware];
                }
                if (exifObj.GPS) exifObj.GPS = {};
                if (exifObj.Exif) {
                    delete exifObj.Exif[piexif.ExifIFD.MakerNote];
                    delete exifObj.Exif[piexif.ExifIFD.DeviceSettingDescription];
                    delete exifObj.Exif[piexif.ExifIFD.BodySerialNumber];
                    delete exifObj.Exif[piexif.ExifIFD.LensSerialNumber];
                    delete exifObj.Exif[piexif.ExifIFD.CameraOwnerName];
                }
                const dumped = piexif.dump(exifObj);
                const newExifLen = dumped.length;
                const newChunkTotal = 8 + newExifLen + (newExifLen % 2);
                const customChunk = new Uint8Array(newChunkTotal);
                for (let i = 0; i < 4; i++) customChunk[i] = fourCC.charCodeAt(i);
                customChunk[4] = newExifLen & 0xFF;
                customChunk[5] = (newExifLen >> 8) & 0xFF;
                customChunk[6] = (newExifLen >> 16) & 0xFF;
                customChunk[7] = (newExifLen >> 24) & 0xFF;
                for (let i = 0; i < newExifLen; i++) customChunk[8 + i] = dumped.charCodeAt(i) & 0xFF;
                chunks.push({ customBytes: customChunk });
                offset = chunkEnd;
                continue;
            } catch (e) { /* fallback */ }
        }

        chunks.push({ start: offset, end: chunkEnd });
        offset = chunkEnd;
    }

    const totalLen = chunks.reduce((acc, c) => acc + (c.end - c.start), 0);
    const output = new Uint8Array(totalLen);
    let writePos = 0;
    for (const chunk of chunks) {
        const slice = uint8.slice(chunk.start, chunk.end);
        output.set(slice, writePos);
        writePos += slice.length;
    }

    const newRiffSize = totalLen - 8;
    output[4] = newRiffSize & 0xFF;
    output[5] = (newRiffSize >> 8) & 0xFF;
    output[6] = (newRiffSize >> 16) & 0xFF;
    output[7] = (newRiffSize >> 24) & 0xFF;

    return output.buffer;
}

// ============================================================
// IMAGE METADATA
// ============================================================

async function extractImageMetadata(arrayBuffer, file) {
    let metadata = {};

    // 1. exifr
    try {
        metadata = await exifr.parse(new Blob([arrayBuffer], { type: file.type }), {
            xmp: true, iptc: true, exif: true, gps: true,
            icc: true, ihdr: true, tiff: true,
            mergeOutput: true
        }) || {};
    } catch (e) {
        console.log("No metadata or error reading:", e);
    }

    // 2. PNG text chunks
    if (file.type === 'image/png') {
        try {
            const pngText = extractPngTextChunks(arrayBuffer);
            if (Object.keys(pngText).length > 0) {
                metadata = { ...metadata, ...pngText };
            }
        } catch (e) {
            console.error("PNG Parse error", e);
        }
    }

    // 3. Deep XMP scan
    try {
        const xmpParsed = extractXmpFromBytes(arrayBuffer);
        if (xmpParsed && Object.keys(xmpParsed).length > 0) {
            for (const [key, val] of Object.entries(xmpParsed)) {
                if (!metadata[key]) metadata[key] = val;
            }
        }
    } catch (e) {
        console.error("XMP scan error", e);
    }

    // 4. C2PA / Content Credentials Detection
    try {
        const c2paData = detectAndExtractC2PA(arrayBuffer, file.type, file.name);
        if (c2paData && c2paData.found) {
            metadata.__c2pa = c2paData;
        }
    } catch (e) {
        console.error("C2PA detection error:", e);
    }

    return metadata;
}

// ============================================================
// VIDEO METADATA ENGINE
// ============================================================

async function extractVideoMetadata(arrayBuffer, file) {
    const metadata = {};
    const ext = getFileExtension(file.name);

    // 1. Try MP4/MOV atom parsing
    if (['mp4', 'mov', 'm4v'].includes(ext) || file.type === 'video/mp4' || file.type === 'video/quicktime') {
        try {
            const mp4Meta = parseMp4Atoms(arrayBuffer);
            Object.assign(metadata, mp4Meta);
        } catch (e) {
            console.error("MP4 atom parse error:", e);
        }
    }

    // 2. Deep XMP scan (works for all containers — XMP is embedded as raw XML)
    try {
        const xmpParsed = extractXmpFromBytes(arrayBuffer);
        if (xmpParsed && Object.keys(xmpParsed).length > 0) {
            for (const [key, val] of Object.entries(xmpParsed)) {
                if (!metadata[key]) metadata[key] = val;
            }
        }
    } catch (e) {
        console.error("Video XMP scan error:", e);
    }

    // 3. WebM/MKV EBML tag scan
    if (['webm', 'mkv'].includes(ext) || file.type === 'video/webm' || file.type === 'video/x-matroska') {
        try {
            const ebmlMeta = parseEbmlTags(arrayBuffer);
            Object.assign(metadata, ebmlMeta);
        } catch (e) {
            console.error("EBML parse error:", e);
        }
    }

    // 4. C2PA / Content Credentials Detection
    try {
        const c2paData = detectAndExtractC2PA(arrayBuffer, file.type, file.name);
        if (c2paData && c2paData.found) {
            metadata.__c2pa = c2paData;
        }
    } catch (e) {
        console.error("Video C2PA detection error:", e);
    }

    return metadata;
}

// --- MP4 Atom Parser ---
function parseMp4Atoms(arrayBuffer) {
    const view = new DataView(arrayBuffer);
    const result = {};
    const decoder = new TextDecoder('utf-8', { fatal: false });

    function readAtoms(start, end, depth) {
        let offset = start;
        while (offset < end - 8) {
            let size = view.getUint32(offset);
            const type = String.fromCharCode(
                view.getUint8(offset + 4),
                view.getUint8(offset + 5),
                view.getUint8(offset + 6),
                view.getUint8(offset + 7)
            );

            if (size === 0) break; // atom extends to end of file
            if (size === 1 && offset + 16 <= end) {
                // 64-bit extended size
                const hi = view.getUint32(offset + 8);
                const lo = view.getUint32(offset + 12);
                size = hi * 0x100000000 + lo;
                if (size < 16) break;
            }
            if (size < 8 || offset + size > end) break;

            const atomData = offset + 8;
            const atomEnd = offset + size;

            // Container atoms — recurse into
            if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'ilst'].includes(type)) {
                let innerStart = atomData;
                // 'meta' atom has a 4-byte version/flags before children
                if (type === 'meta' && atomEnd - atomData > 4) {
                    innerStart = atomData + 4;
                }
                readAtoms(innerStart, atomEnd, depth + 1);
            }

            // mvhd — Movie Header (contains creation/modification date, duration, timescale)
            if (type === 'mvhd' && size >= 20) {
                try {
                    const version = view.getUint8(atomData);
                    let creationTime, modTime, timescale, duration;
                    if (version === 0) {
                        creationTime = view.getUint32(atomData + 4);
                        modTime = view.getUint32(atomData + 8);
                        timescale = view.getUint32(atomData + 12);
                        duration = view.getUint32(atomData + 16);
                    } else {
                        // version 1: 64-bit times
                        creationTime = view.getUint32(atomData + 8); // lower 32 bits
                        modTime = view.getUint32(atomData + 16);
                        timescale = view.getUint32(atomData + 20);
                        duration = view.getUint32(atomData + 28);
                    }
                    if (creationTime > 0) {
                        // MP4 epoch: 1904-01-01
                        const mp4Epoch = new Date('1904-01-01T00:00:00Z');
                        const date = new Date(mp4Epoch.getTime() + creationTime * 1000);
                        if (date.getFullYear() > 1970 && date.getFullYear() < 2100) {
                            result['Creation Date'] = date.toISOString();
                        }
                    }
                    if (modTime > 0) {
                        const mp4Epoch = new Date('1904-01-01T00:00:00Z');
                        const date = new Date(mp4Epoch.getTime() + modTime * 1000);
                        if (date.getFullYear() > 1970 && date.getFullYear() < 2100) {
                            result['Modification Date'] = date.toISOString();
                        }
                    }
                    if (timescale > 0 && duration > 0) {
                        result['Duration'] = (duration / timescale).toFixed(2) + 's';
                    }
                } catch (e) { /* ignore */ }
            }

            // hdlr — Handler Reference (identifies track type)
            if (type === 'hdlr' && size > 16) {
                try {
                    const handlerType = String.fromCharCode(
                        view.getUint8(atomData + 8),
                        view.getUint8(atomData + 9),
                        view.getUint8(atomData + 10),
                        view.getUint8(atomData + 11)
                    );
                    // Get name string after handler type
                    if (size > 24) {
                        const nameBytes = new Uint8Array(arrayBuffer, atomData + 24, Math.min(size - 32, 100));
                        const handlerName = decoder.decode(nameBytes).replace(/\0/g, '').trim();
                        if (handlerName && handlerType === 'mdir') {
                            // metadata handler
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            // Extract iTunes-style metadata from ilst
            // Common keys: ©nam (title), ©ART (artist), ©cmt (comment), ©too (encoder), ©day (date), ©gen (genre)
            if (type.startsWith('\xA9') || ['aART', 'covr', 'cprt', 'desc', 'ldes', 'purd', 'gnre'].includes(type)) {
                try {
                    // ilst entry contains 'data' sub-atom
                    if (atomEnd - atomData > 16) {
                        const dataSize = view.getUint32(atomData);
                        const dataType = String.fromCharCode(
                            view.getUint8(atomData + 4),
                            view.getUint8(atomData + 5),
                            view.getUint8(atomData + 6),
                            view.getUint8(atomData + 7)
                        );
                        if (dataType === 'data' && dataSize > 16) {
                            const textBytes = new Uint8Array(arrayBuffer, atomData + 16, Math.min(dataSize - 16, 500));
                            const textVal = decoder.decode(textBytes).replace(/\0/g, '').trim();
                            if (textVal) {
                                const keyMap = {
                                    '\xA9nam': 'Title',
                                    '\xA9ART': 'Artist',
                                    '\xA9alb': 'Album',
                                    '\xA9cmt': 'Comment',
                                    '\xA9too': 'Encoder/Software',
                                    '\xA9day': 'Date',
                                    '\xA9gen': 'Genre',
                                    'cprt': 'Copyright',
                                    'desc': 'Description',
                                    'ldes': 'Long Description',
                                    'aART': 'Album Artist',
                                };
                                const label = keyMap[type] || type;
                                result[label] = textVal;
                            }
                        }
                    }
                } catch (e) { /* ignore */ }
            }

            // GPS data in MP4 (stored in various ways)
            if (type === '\xA9xyz' || type === 'loci') {
                try {
                    const gpsBytes = new Uint8Array(arrayBuffer, atomData, Math.min(size - 8, 200));
                    const gpsStr = decoder.decode(gpsBytes).replace(/\0/g, '').trim();
                    if (gpsStr) result['GPS Location'] = gpsStr;
                } catch (e) { /* ignore */ }
            }

            offset = atomEnd;
        }
    }

    try {
        readAtoms(0, arrayBuffer.byteLength, 0);
    } catch (e) {
        console.error("MP4 atom traversal error:", e);
    }

    return result;
}

// --- EBML/WebM/MKV Tag Parser ---
function parseEbmlTags(arrayBuffer) {
    const result = {};
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const bytes = new Uint8Array(arrayBuffer);

    // Simple text scan for common EBML string tags
    // WebM/MKV stores tags as UTF-8 strings near identifiable EBML element IDs
    // We do a pragmatic text search for known patterns
    const fullText = decoder.decode(bytes);

    // Look for common WebM muxer/encoder strings
    const muxerPatterns = [
        { regex: /WritingApp[^\x00-\x1f]*?([\x20-\x7e]{3,100})/i, key: 'Writing App' },
        { regex: /MuxingApp[^\x00-\x1f]*?([\x20-\x7e]{3,100})/i, key: 'Muxing App' },
    ];

    // Scan for text near EBML tag element IDs
    // Element 0x4487 = DateUTC (segment info)
    // Element 0x4D80 = MuxingApp
    // Element 0x5741 = WritingApp
    const segmentInfo = fullText.substring(0, Math.min(fullText.length, 10000));
    
    for (const { regex, key } of muxerPatterns) {
        const match = segmentInfo.match(regex);
        if (match && match[1]) {
            result[key] = match[1].trim();
        }
    }

    // Also try XMP embedded in WebM (some tools do this)
    // Already handled by extractXmpFromBytes

    return result;
}

// --- Video Thumbnail Generator ---
function generateVideoThumbnail(file) {
    return new Promise((resolve) => {
        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        video.playsInline = true;

        const url = URL.createObjectURL(file);
        video.src = url;

        video.onloadeddata = () => {
            // Seek to 1 second or 10% of duration
            video.currentTime = Math.min(1, video.duration * 0.1);
        };

        video.onseeked = () => {
            try {
                const canvas = document.createElement('canvas');
                canvas.width = 120;
                canvas.height = 80;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
                const dataURL = canvas.toDataURL('image/jpeg', 0.7);
                URL.revokeObjectURL(url);
                resolve(dataURL);
            } catch (e) {
                URL.revokeObjectURL(url);
                resolve(null);
            }
        };

        video.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(null);
        };

        // Timeout fallback
        setTimeout(() => {
            URL.revokeObjectURL(url);
            resolve(null);
        }, 5000);
    });
}

// ============================================================
// VECTOR METADATA ENGINE — SVG
// ============================================================

function extractSvgMetadata(svgText) {
    const metadata = {};

    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svg = doc.documentElement;

        // 1. SVG root attributes
        const rootAttrs = ['width', 'height', 'viewBox', 'version', 'xmlns'];
        for (const attr of rootAttrs) {
            const val = svg.getAttribute(attr);
            if (val) metadata['svg:' + attr] = val;
        }

        // 2. Inkscape / Sodipodi namespace attrs
        const inkscapeAttrs = [];
        for (const attr of svg.attributes) {
            if (attr.name.startsWith('inkscape:') || attr.name.startsWith('sodipodi:')) {
                metadata[attr.name] = attr.value;
                inkscapeAttrs.push(attr.name);
            }
        }

        // 3. <metadata> element
        const metaEls = doc.getElementsByTagName('metadata');
        if (metaEls.length > 0) {
            const metaContent = metaEls[0].innerHTML || metaEls[0].textContent;
            if (metaContent && metaContent.trim()) {
                metadata['SVG <metadata>'] = metaContent.trim().substring(0, 2000);
            }
        }

        // 4. <desc> and <title> elements
        const descEls = doc.getElementsByTagName('desc');
        if (descEls.length > 0 && descEls[0].textContent.trim()) {
            metadata['SVG Description'] = descEls[0].textContent.trim();
        }
        const titleEls = doc.getElementsByTagName('title');
        if (titleEls.length > 0 && titleEls[0].textContent.trim()) {
            metadata['SVG Title'] = titleEls[0].textContent.trim();
        }

        // 5. RDF / Dublin Core inside metadata
        const rdfDescs = doc.getElementsByTagNameNS('http://purl.org/dc/elements/1.1/', '*');
        for (let i = 0; i < rdfDescs.length; i++) {
            const el = rdfDescs[i];
            const tag = el.localName;
            const val = el.textContent.trim();
            if (val) metadata['dc:' + tag] = val;
        }

        // 6. XMP embedded inside SVG
        const xmpMeta = svgText.match(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/i);
        if (xmpMeta) {
            metadata['Embedded XMP'] = xmpMeta[0].substring(0, 2000);
        }

        // 7. Comments (often contain creator info)
        const commentRegex = /<!--([\s\S]*?)-->/g;
        let match;
        let commentIdx = 0;
        while ((match = commentRegex.exec(svgText)) !== null) {
            const comment = match[1].trim();
            if (comment && comment.length > 2 && comment.length < 1000) {
                commentIdx++;
                metadata['Comment #' + commentIdx] = comment;
            }
            if (commentIdx >= 10) break;
        }

        // 8. Namespaced elements count (Inkscape, Illustrator, Sketch, etc.)
        const nsElements = doc.querySelectorAll('[*|label], [*|docname], [*|export-filename]');
        // Count Inkscape-specific elements
        const allEls = doc.getElementsByTagName('*');
        let inkscapeCount = 0;
        let sodipodiCount = 0;
        for (let i = 0; i < allEls.length; i++) {
            const tag = allEls[i].tagName || '';
            if (tag.startsWith('inkscape:')) inkscapeCount++;
            if (tag.startsWith('sodipodi:')) sodipodiCount++;
            // Check attributes too
            for (const attr of allEls[i].attributes) {
                if (attr.name.startsWith('inkscape:')) inkscapeCount++;
                if (attr.name.startsWith('sodipodi:')) sodipodiCount++;
            }
        }
        if (inkscapeCount > 0) metadata['Inkscape Data Points'] = inkscapeCount;
        if (sodipodiCount > 0) metadata['Sodipodi Data Points'] = sodipodiCount;

        // 9. Exact Generator & Creator detection
        const genCommentMatch = svgText.match(/<!--\s*Generator:\s*([^\r\n>]+)-->/i);
        if (genCommentMatch) {
            metadata['Creator (Generator)'] = genCommentMatch[1].trim();
        }

        const metaGen = doc.querySelector('meta[name="generator"]');
        if (metaGen && metaGen.getAttribute('content')) {
            metadata['Creator (Generator Tag)'] = metaGen.getAttribute('content').trim();
        }

        const metaAuthor = doc.querySelector('meta[name="author"]');
        if (metaAuthor && metaAuthor.getAttribute('content')) {
            metadata['For (Author)'] = metaAuthor.getAttribute('content').trim();
        }

        // Summary Creator Tool
        if (metadata['Creator (Generator Tag)']) {
            metadata['Creator Tool'] = metadata['Creator (Generator Tag)'];
        } else if (metadata['Creator (Generator)']) {
            metadata['Creator Tool'] = metadata['Creator (Generator)'];
        } else if (svgText.includes('Illustrator') || svgText.includes('adobe:ns:meta')) {
            metadata['Creator Tool'] = 'Adobe Illustrator';
        } else if (inkscapeCount > 0 || svgText.includes('inkscape')) {
            metadata['Creator Tool'] = 'Inkscape';
        } else if (svgText.includes('Sketch') || svgText.includes('sketch:')) {
            metadata['Creator Tool'] = 'Sketch';
        } else if (svgText.includes('Figma')) {
            metadata['Creator Tool'] = 'Figma';
        }

    } catch (e) {
        console.error("SVG metadata extraction error:", e);
    }

    return metadata;
}

function cleanSvgFile(svgText, mode) {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(svgText, 'image/svg+xml');
        const svg = doc.documentElement;

        if (mode === 'ALL') {
            // Remove <metadata> elements
            const metaEls = doc.getElementsByTagName('metadata');
            while (metaEls.length > 0) metaEls[0].parentNode.removeChild(metaEls[0]);

            // Remove <desc> and <title> elements
            const descEls = doc.getElementsByTagName('desc');
            while (descEls.length > 0) descEls[0].parentNode.removeChild(descEls[0]);
            const titleEls = doc.getElementsByTagName('title');
            while (titleEls.length > 0) titleEls[0].parentNode.removeChild(titleEls[0]);

            // Remove all namespaced editor attributes & elements
            const attrsToRemove = [];
            for (const attr of svg.attributes) {
                if (attr.name.startsWith('inkscape:') || attr.name.startsWith('sodipodi:') ||
                    attr.name.startsWith('xmlns:inkscape') || attr.name.startsWith('xmlns:sodipodi') ||
                    attr.name.startsWith('xmlns:sketch') || attr.name.startsWith('sketch:')) {
                    attrsToRemove.push(attr.name);
                }
            }
            for (const name of attrsToRemove) svg.removeAttribute(name);

            const removeTagPrefixes = ['inkscape:', 'sodipodi:', 'sketch:'];
            const allEls = Array.from(doc.getElementsByTagName('*'));
            for (const el of allEls) {
                const tag = el.tagName || '';
                if (removeTagPrefixes.some(p => tag.startsWith(p))) {
                    el.parentNode.removeChild(el);
                    continue;
                }
                const elAttrsToRemove = [];
                for (const attr of el.attributes) {
                    if (attr.name.startsWith('inkscape:') || attr.name.startsWith('sodipodi:') ||
                        attr.name.startsWith('sketch:')) {
                        elAttrsToRemove.push(attr.name);
                    }
                }
                for (const name of elAttrsToRemove) el.removeAttribute(name);
            }

            // Remove RDF namespace in ALL mode
            svg.removeAttribute('xmlns:rdf');
            svg.removeAttribute('xmlns:dc');
            svg.removeAttribute('xmlns:cc');
        } else if (mode === 'STOCK' || mode === 'CUSTOM') {
            // STOCK SAFE / CUSTOM PROFILE: Remove only private/editor namespaces (Inkscape/Sodipodi/Sketch),
            // but KEEP <title>, <desc>, and Dublin Core stock tags
            const attrsToRemove = [];
            for (const attr of svg.attributes) {
                if (attr.name.startsWith('inkscape:') || attr.name.startsWith('sodipodi:') ||
                    attr.name.startsWith('xmlns:inkscape') || attr.name.startsWith('xmlns:sodipodi') ||
                    attr.name.startsWith('xmlns:sketch') || attr.name.startsWith('sketch:')) {
                    attrsToRemove.push(attr.name);
                }
            }
            for (const name of attrsToRemove) svg.removeAttribute(name);

            const removeTagPrefixes = ['inkscape:', 'sodipodi:', 'sketch:'];
            const allEls = Array.from(doc.getElementsByTagName('*'));
            for (const el of allEls) {
                const tag = el.tagName || '';
                if (removeTagPrefixes.some(p => tag.startsWith(p))) {
                    el.parentNode.removeChild(el);
                    continue;
                }
                const elAttrsToRemove = [];
                for (const attr of el.attributes) {
                    if (attr.name.startsWith('inkscape:') || attr.name.startsWith('sodipodi:') ||
                        attr.name.startsWith('sketch:')) {
                        elAttrsToRemove.push(attr.name);
                    }
                }
                for (const name of elAttrsToRemove) el.removeAttribute(name);
            }
        }

        // Serialize back
        const serializer = new XMLSerializer();
        let cleanSvg = serializer.serializeToString(doc);

        // Remove XML comments if mode is ALL
        if (mode === 'ALL') {
            cleanSvg = cleanSvg.replace(/<!--[\s\S]*?-->/g, '');
            cleanSvg = cleanSvg.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/gi, '');
        } else if (mode === 'STOCK') {
            cleanSvg = cleanXmpStringPreservingStock(cleanSvg);
        }

        return cleanSvg;
    } catch (e) {
        console.error("SVG cleaning error:", e);
        return svgText; // Return original on error
    }
}

// ============================================================
// VECTOR METADATA ENGINE — EPS / AI (100% Byte-Safe & Non-Destructive)
// ============================================================

// Helper: Decode a Uint8Array slice as true 1:1 ISO-8859-1 (unlike TextDecoder('latin1') which uses Windows-1252)
function uint8ToBinaryString(uint8, start = 0, end = uint8.length) {
    const limit = Math.min(end, uint8.length);
    let str = '';
    const chunkSize = 8192;
    for (let i = start; i < limit; i += chunkSize) {
        const sub = uint8.subarray(i, Math.min(i + chunkSize, limit));
        str += String.fromCharCode.apply(null, sub);
    }
    return str;
}

// Helper: Check if EPS file has a 30-byte DOS EPS Binary Header (0xC5 0xD0 0xD3 0xC6)
function getDosEpsHeader(uint8) {
    if (uint8.length >= 30 &&
        uint8[0] === 0xC5 && uint8[1] === 0xD0 &&
        uint8[2] === 0xD3 && uint8[3] === 0xC6) {
        const view = new DataView(uint8.buffer, uint8.byteOffset, uint8.byteLength);
        const psOffset = view.getUint32(4, true);
        const psLength = view.getUint32(8, true);
        const wmfOffset = view.getUint32(12, true);
        const wmfLength = view.getUint32(16, true);
        const tiffOffset = view.getUint32(20, true);
        const tiffLength = view.getUint32(24, true);
        return { isDosEps: true, psOffset, psLength, wmfOffset, wmfLength, tiffOffset, tiffLength };
    }
    return { isDosEps: false, psOffset: 0, psLength: uint8.length };
}

function extractEpsMetadata(arrayBuffer) {
    const metadata = {};
    if (!arrayBuffer || arrayBuffer.byteLength < 8) return metadata;

    const uint8 = new Uint8Array(arrayBuffer);
    const dosInfo = getDosEpsHeader(uint8);

    // Read up to 64 KB from the start of the PostScript/PDF header for DSC inspection
    const headerStart = (dosInfo.isDosEps && dosInfo.psOffset < uint8.length) ? dosInfo.psOffset : 0;
    const headerLen = Math.min(uint8.length - headerStart, 65536);
    const headerText = uint8ToBinaryString(uint8, headerStart, headerStart + headerLen);

    // 1. Detect Format (DOS EPS, Standard EPS, or PDF-based AI)
    if (dosInfo.isDosEps) {
        metadata['Container'] = 'DOS EPS Binary Header (TIFF/WMF Preview)';
    }
    if (headerText.startsWith('%PDF-')) {
        const pdfVer = headerText.match(/^%PDF-[\d.]+/);
        metadata['Format'] = pdfVer ? `Adobe Illustrator PDF (${pdfVer[0]})` : 'PDF-Based Vector';
    } else if (headerText.includes('%!PS-Adobe')) {
        const epsMatch = headerText.match(/^(%!PS-Adobe-[\d.]+ EPSF-[\d.]+)/m);
        const psMatch = headerText.match(/^(%!PS-Adobe-[\d.]+)/m);
        metadata['Format'] = epsMatch ? epsMatch[1].trim() : (psMatch ? psMatch[1].trim() : 'PostScript / EPS');
    }

    // 2. DSC (Document Structuring Convention) comments
    const dscPatterns = [
        { regex: /^%%Creator:\s*(.+)$/m, key: 'Creator' },
        { regex: /^%%Title:\s*(.+)$/m, key: 'Title' },
        { regex: /^%%CreationDate:\s*(.+)$/m, key: 'Creation Date' },
        { regex: /^%%For:\s*(.+)$/m, key: 'For (Author)' },
        { regex: /^%%Routing:\s*(.+)$/m, key: 'Routing' },
        { regex: /^%%Copyright:\s*(.+)$/m, key: 'Copyright' },
        { regex: /^%%DocumentData:\s*(.+)$/m, key: 'Document Data' },
        { regex: /^%%LanguageLevel:\s*(.+)$/m, key: 'Language Level' },
        { regex: /^%%BoundingBox:\s*(.+)$/m, key: 'Bounding Box' },
        { regex: /^%%HiResBoundingBox:\s*(.+)$/m, key: 'HiRes Bounding Box' },
        { regex: /^%%Pages:\s*(.+)$/m, key: 'Pages' },
        { regex: /^%%DocumentProcessColors:\s*(.+)$/m, key: 'Process Colors' },
    ];

    for (const { regex, key } of dscPatterns) {
        const match = headerText.match(regex);
        if (match) {
            const val = match[1].trim();
            if (val && !/^\s*\(\s*\)\s*$/.test(val)) {
                metadata[key] = val;
            }
        }
    }

    // PDF Info Dictionary (For modern .ai files and PDF-based EPS)
    const pdfCreatorMatch = headerText.match(/\/Creator\s*\(([^)]+)\)/);
    if (pdfCreatorMatch && !metadata['Creator']) {
        metadata['Creator'] = pdfCreatorMatch[1].trim();
    }
    const pdfAuthorMatch = headerText.match(/\/Author\s*\(([^)]+)\)/);
    if (pdfAuthorMatch && !metadata['For (Author)']) {
        metadata['For (Author)'] = pdfAuthorMatch[1].trim();
    }
    const pdfProducerMatch = headerText.match(/\/Producer\s*\(([^)]+)\)/);
    if (pdfProducerMatch) {
        metadata['PDF Producer'] = pdfProducerMatch[1].trim();
    }
    const aiCreatorVerMatch = headerText.match(/%+AI\d+_CreatorVersion:\s*([^\r\n]+)/);
    if (aiCreatorVerMatch) {
        metadata['AI Creator Version'] = aiCreatorVerMatch[1].trim();
    }
    const adoBuildMatch = headerText.match(/^%ADO_BuildNumber:\s*([^\r\n]+)/m);
    if (adoBuildMatch) {
        metadata['ADO Build Number'] = adoBuildMatch[1].trim();
    }

    // Check %AI9_PrivateDataBegin block near the end of the PostScript stream
    const psMaxEnd = (dosInfo.isDosEps && dosInfo.psLength > 0)
        ? Math.min(uint8.length, headerStart + dosInfo.psLength)
        : uint8.length;
    const privIdx = indexOfAsciiBytes(uint8, '%AI9_PrivateDataBegin', headerStart, psMaxEnd);
    if (privIdx !== -1) {
        const privSliceText = uint8ToBinaryString(uint8, privIdx, Math.min(psMaxEnd, privIdx + 512));
        const privVerMatch = privSliceText.match(/%+AI8_CreatorVersion:\s*([^\r\n]+)/);
        if (privVerMatch) {
            metadata['Private Data Version'] = privVerMatch[1].trim();
        }
        const privForMatch = privSliceText.match(/^%%For:\s*([^\r\n]+)/m);
        if (privForMatch) {
            const val = privForMatch[1].trim();
            if (val && !/^\(\s*\)\s*\(\s*\)$/.test(val)) {
                metadata['Private Data Author'] = val;
            }
        }
    }

    // 3. AI-specific structural info (read-only informational)
    const aiPatterns = [
        { regex: /^%AI\d+_ColorModel:\s*(\d+)/m, key: 'AI Color Model' },
        { regex: /^%AI\d+_TargetResolution:\s*(\d+)/m, key: 'AI Target Resolution' },
        { regex: /^%AI\d+_NumLayers:\s*(\d+)/m, key: 'AI Num Layers' },
    ];
    for (const { regex, key } of aiPatterns) {
        const match = headerText.match(regex);
        if (match) metadata[key] = match[1].trim();
    }

    // 4. XMP block in EPS/AI
    try {
        const xmpParsed = extractXmpFromBytes(arrayBuffer);
        if (xmpParsed && Object.keys(xmpParsed).length > 0) {
            for (const [key, val] of Object.entries(xmpParsed)) {
                if (!metadata[key]) metadata[key] = val;
            }
        }
    } catch (e) {
        console.error("EPS/AI XMP scan error:", e);
    }

    return metadata;
}

// Helper: Find ASCII byte pattern inside Uint8Array
function indexOfAsciiBytes(uint8, patternStr, fromIndex = 0, maxIndex = uint8.length) {
    const patLen = patternStr.length;
    const limit = Math.min(maxIndex, uint8.length) - patLen;
    if (patLen === 0 || limit < fromIndex) return -1;
    const firstByte = patternStr.charCodeAt(0);

    for (let i = fromIndex; i <= limit; i++) {
        if (uint8[i] !== firstByte) continue;
        let matched = true;
        for (let j = 1; j < patLen; j++) {
            if (uint8[i + j] !== patternStr.charCodeAt(j)) {
                matched = false;
                break;
            }
        }
        if (matched) return i;
    }
    return -1;
}

// Byte-Safe In-Place EPS / AI Cleaner
// Guarantees 0% file corruption:
// - Never converts binary data via TextDecoder('latin1')
// - Never changes file byte length or shifts byte offsets (preserves DOS EPS headers, TIFF previews, PDF xref tables, and PostScript stream lengths)
// - Never deletes structural %AI... comments required by Adobe Illustrator
function cleanEpsBuffer(arrayBuffer, mode) {
    if (!arrayBuffer || arrayBuffer.byteLength < 8) return arrayBuffer;

    // Work on a direct byte-for-byte copy of the original file
    const output = new Uint8Array(arrayBuffer.slice(0));
    const dosInfo = getDosEpsHeader(output);

    const psStart = (dosInfo.isDosEps && dosInfo.psOffset < output.length) ? dosInfo.psOffset : 0;
    const psMaxEnd = (dosInfo.isDosEps && dosInfo.psLength > 0)
        ? Math.min(output.length, psStart + dosInfo.psLength)
        : output.length;

    // 1. Clean DSC Header Metadata Comments In-Place (within the first 64 KB of PostScript header)
    const headerScanLimit = Math.min(psMaxEnd, psStart + 65536);

    // Determine which DSC metadata prefixes to blank out based on mode
    // IMPORTANT: Structural %AI... comments (%AI5_FileFormat, %AI8_CreatorVersion, %AI9_PrivateDataBegin, etc.) are NEVER touched!
    let targetPrefixes = [];
    if (mode === 'ALL') {
        targetPrefixes = [
            '%%Creator:',
            '%%Title:',
            '%%CreationDate:',
            '%%For:',
            '%%Copyright:',
            '%%Routing:',
            '%AI5_DirectBurn:',
            '%AI3_Timing:'
        ];
    } else if (mode === 'PRIVATE') {
        targetPrefixes = [
            '%%Creator:',
            '%%For:',
            '%%CreationDate:',
            '%%Routing:',
            '%AI5_DirectBurn:',
            '%AI3_Timing:'
        ];
    } else if (mode === 'STOCK') {
        // In STOCK mode, preserve %%CreationDate: and %%Creator: so the EPS header remains authentic
        targetPrefixes = [
            '%%For:',
            '%%Routing:',
            '%AI5_DirectBurn:',
            '%AI3_Timing:'
        ];
    }

    // Scan line-by-line in the header region and overwrite matching DSC comment values with spaces
    // (Preserves exact byte count and original \r / \n line endings!)
    let pos = psStart;
    while (pos < headerScanLimit) {
        let lineEnd = pos;
        while (lineEnd < headerScanLimit && output[lineEnd] !== 0x0A && output[lineEnd] !== 0x0D) {
            lineEnd++;
        }

        const lineLen = lineEnd - pos;
        if (lineLen > 2 && output[pos] === 0x25) { // Starts with '%'
            const lineStr = uint8ToBinaryString(output, pos, lineEnd);

            // Stop header DSC scanning once we hit %%EndComments or %%BeginProlog or %%BeginPreview
            if (lineStr.startsWith('%%EndComments') || lineStr.startsWith('%%BeginProlog') || lineStr.startsWith('%%BeginSetup')) {
                break;
            }

            if (lineStr.toLowerCase().includes('topaz') || lineStr.toLowerCase().includes('gigapixel')) {
                for (let k = pos + 1; k < lineEnd; k++) {
                    output[k] = 0x20;
                }
            } else {
                for (const prefix of targetPrefixes) {
                    if (lineStr.startsWith(prefix)) {
                        const startBlank = (prefix === '%%For:' && mode !== 'ALL') ? (pos + prefix.length) : (pos + 1);
                        for (let k = startBlank; k < lineEnd; k++) {
                            output[k] = 0x20; // ASCII space
                        }
                        break;
                    }
                }
            }
        }

        // Advance past \r and/or \n
        pos = lineEnd;
        while (pos < headerScanLimit && (output[pos] === 0x0A || output[pos] === 0x0D)) {
            pos++;
        }
    }

    // 1b. Also clean %%For: inside %AI9_PrivateDataBegin near the end of the PostScript stream
    const privStart = indexOfAsciiBytes(output, '%AI9_PrivateDataBegin', psStart, psMaxEnd);
    if (privStart !== -1) {
        const privScanLimit = Math.min(psMaxEnd, privStart + 512);
        const privForIdx = indexOfAsciiBytes(output, '%%For:', privStart, privScanLimit);
        if (privForIdx !== -1) {
            let lineEnd = privForIdx;
            while (lineEnd < privScanLimit && output[lineEnd] !== 0x0A && output[lineEnd] !== 0x0D) {
                lineEnd++;
            }
            const valStart = privForIdx + 6; // after '%%For:'
            const emptyFor = ' () ()';
            if (lineEnd - valStart >= emptyFor.length) {
                for (let i = 0; i < emptyFor.length; i++) {
                    output[valStart + i] = emptyFor.charCodeAt(i);
                }
                for (let i = valStart + emptyFor.length; i < lineEnd; i++) {
                    output[i] = 0x20;
                }
            }
        }
    }

    // 2. Clean Embedded XMP Metadata Packet In-Place (Byte-Length Preserving)
    // In 'ALL' mode: replace XMP contents with minimal empty XMP skeleton padded with spaces
    // In 'STOCK' mode: KEEP embedded XMP packet intact so Title, Keywords, and Stock Tags are preserved
    if (mode === 'ALL') {
        const openTag = '<x:xmpmeta';
        const closeTag = '</x:xmpmeta>';
        const minimalXmp = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>';

        let searchFrom = 0;
        while (searchFrom < output.length) {
            const xmpStart = indexOfAsciiBytes(output, openTag, searchFrom, output.length);
            if (xmpStart === -1) break;

            const closePos = indexOfAsciiBytes(output, closeTag, xmpStart, output.length);
            if (closePos === -1) break;

            const xmpEnd = closePos + closeTag.length;
            const totalXmpLen = xmpEnd - xmpStart;

            if (totalXmpLen >= minimalXmp.length) {
                // Write minimal clean XMP header, pad middle with spaces, and close with </x:xmpmeta>
                const headPart = '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/>';
                const tailPart = '</x:xmpmeta>';

                // Fill entire old XMP region with spaces first
                for (let i = xmpStart; i < xmpEnd; i++) {
                    output[i] = 0x20;
                }
                // Write headPart at start
                for (let i = 0; i < headPart.length; i++) {
                    output[xmpStart + i] = headPart.charCodeAt(i);
                }
                // Write tailPart at end
                const tailStart = xmpEnd - tailPart.length;
                for (let i = 0; i < tailPart.length; i++) {
                    output[tailStart + i] = tailPart.charCodeAt(i);
                }
            } else {
                // Fallback if unusually tiny XMP block: fill with spaces
                for (let i = xmpStart; i < xmpEnd; i++) {
                    output[i] = 0x20;
                }
            }

            searchFrom = xmpEnd;
        }
    } else if (mode === 'STOCK') {
        // STOCK SAFE: Preserve stock Title/Keywords/Copyright in XMP, but remove CreatorTool and Topaz references
        const openTag = '<x:xmpmeta';
        const closeTag = '</x:xmpmeta>';
        let searchFrom = 0;
        while (searchFrom < output.length) {
            const xmpStart = indexOfAsciiBytes(output, openTag, searchFrom, output.length);
            if (xmpStart === -1) break;
            const closePos = indexOfAsciiBytes(output, closeTag, xmpStart, output.length);
            if (closePos === -1) break;

            const xmpEnd = closePos + closeTag.length;
            const totalXmpLen = xmpEnd - xmpStart;

            try {
                const rawXmp = uint8ToBinaryString(output, xmpStart, xmpEnd);
                const cleanedXmp = cleanXmpStringPreservingStock(rawXmp);
                const encoded = new TextEncoder().encode(cleanedXmp);
                if (encoded.length <= totalXmpLen) {
                    for (let i = xmpStart; i < xmpEnd; i++) output[i] = 0x20;
                    output.set(encoded, xmpStart);
                }
            } catch (e) { /* ignore */ }

            searchFrom = xmpEnd;
        }
    }

    return output.buffer;
}

// ============================================================
// VIDEO CLEANING ENGINE
// ============================================================

function cleanVideoFile(arrayBuffer, file, mode) {
    const ext = getFileExtension(file.name);

    if (['mp4', 'mov', 'm4v'].includes(ext) || file.type === 'video/mp4' || file.type === 'video/quicktime') {
        const cleanedMp4 = cleanMp4File(arrayBuffer, mode);
        return cleanGenericVideoXmp(cleanedMp4, mode);
    }

    if (['webm', 'mkv'].includes(ext) || file.type === 'video/webm' || file.type === 'video/x-matroska') {
        return cleanWebmFile(arrayBuffer, mode);
    }

    // For AVI and other formats: strip XMP only
    return cleanGenericVideoXmp(arrayBuffer, mode);
}

function cleanMp4File(arrayBuffer, mode) {
    // Strategy: Rebuild the file, excluding metadata atoms (udta, meta in moov) and C2PA uuid/c2pa boxes
    const view = new DataView(arrayBuffer);
    const chunks = []; // Ranges to keep

    function collectAtoms(start, end, depth, parentType) {
        let offset = start;
        while (offset < end - 8) {
            let size = view.getUint32(offset);
            const type = String.fromCharCode(
                view.getUint8(offset + 4),
                view.getUint8(offset + 5),
                view.getUint8(offset + 6),
                view.getUint8(offset + 7)
            );

            if (size === 0) {
                // atom extends to EOF
                size = end - offset;
            }
            if (size === 1 && offset + 16 <= end) {
                const hi = view.getUint32(offset + 8);
                const lo = view.getUint32(offset + 12);
                size = hi * 0x100000000 + lo;
                if (size < 16) break;
            }
            if (size < 8 || offset + size > end) break;

            const atomEnd = offset + size;

            // Check if C2PA UUID box
            let isC2paUuidBox = false;
            if (type === 'uuid' && size >= 24) {
                let match = true;
                for (let i = 0; i < 16; i++) {
                    if (view.getUint8(offset + 8 + i) !== C2PA_MP4_UUID[i]) {
                        match = false;
                        break;
                    }
                }
                isC2paUuidBox = match;
            }

            const isC2paAtom = (type === 'c2pa' || isC2paUuidBox);

            if (mode === 'ALL') {
                const isMetaAtom = (type === 'udta' || (type === 'meta' && parentType === 'moov') || isC2paAtom);
                if (isMetaAtom) {
                    offset = atomEnd;
                    continue;
                }
            } else if (mode === 'STOCK') {
                // In Stock Safe:
                // 1. Always strip C2PA
                if (isC2paAtom) {
                    offset = atomEnd;
                    continue;
                }
                // 2. Strip encoder/software tags (©too, ©swr, ©enc), GPS (©xyz, loci), and authoring tool atoms
                if (type === '\xA9too' || type === '\xA9swr' || type === '\xA9enc' || type === '\xA9xyz' || type === 'loci') {
                    offset = atomEnd;
                    continue;
                }
            }

            // Container atoms: recurse to selectively clean children
            if (['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'ilst'].includes(type)) {
                let headerSize = 8;
                if (type === 'meta' && size > 12) {
                    headerSize = 12; // meta atom has 4 bytes version/flags
                }
                chunks.push({ start: offset, end: offset + headerSize });
                collectAtoms(offset + headerSize, atomEnd, depth + 1, type);
                offset = atomEnd;
                continue;
            }

            // Keep this atom as-is
            chunks.push({ start: offset, end: atomEnd });
            offset = atomEnd;
        }
    }

    collectAtoms(0, arrayBuffer.byteLength, 0, 'root');

    // Rebuild file from chunks
    const totalSize = chunks.reduce((sum, c) => sum + (c.end - c.start), 0);
    const output = new Uint8Array(totalSize);
    let writeOffset = 0;

    for (const chunk of chunks) {
        const src = new Uint8Array(arrayBuffer, chunk.start, chunk.end - chunk.start);
        output.set(src, writeOffset);
        writeOffset += src.length;
    }

    // Fix container atom sizes (moov, trak, etc.)
    fixMp4ContainerSizes(output);

    return output.buffer;
}

function fixMp4ContainerSizes(bytes) {
    const view = new DataView(bytes.buffer);
    const containerTypes = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'udta', 'meta', 'ilst']);

    function fixAtoms(start, end) {
        let offset = start;
        while (offset < end - 8) {
            const origSize = view.getUint32(offset);
            const type = String.fromCharCode(
                view.getUint8(offset + 4),
                view.getUint8(offset + 5),
                view.getUint8(offset + 6),
                view.getUint8(offset + 7)
            );

            if (origSize < 8 || offset + origSize > end) break;

            if (containerTypes.has(type)) {
                fixAtoms(offset + 8, offset + origSize);
                let childEnd = offset + 8;
                while (childEnd < offset + origSize) {
                    const childSize = view.getUint32(childEnd);
                    if (childSize < 8) break;
                    childEnd += childSize;
                }
            }

            offset += origSize;
        }
    }

    try {
        fixAtoms(0, bytes.length);
    } catch (e) {
        console.log("MP4 size fix (non-critical):", e);
    }
}

function cleanWebmFile(arrayBuffer, mode) {
    const cleaned = cleanGenericVideoXmp(arrayBuffer, mode);
    const uint8 = new Uint8Array(cleaned);
    const scanLimit = Math.min(uint8.length, 65536);
    // Blank out any Topaz or Gigapixel occurrences in EBML header
    for (let i = 0; i < scanLimit - 5; i++) {
        if (uint8[i] === 0x54 && uint8[i+1] === 0x6F && uint8[i+2] === 0x70 && uint8[i+3] === 0x61 && uint8[i+4] === 0x7A) {
            // "Topaz" found
            let end = i + 5;
            while (end < scanLimit && uint8[end] >= 0x20 && uint8[end] <= 0x7E) end++;
            for (let k = i; k < end; k++) uint8[k] = 0x20;
        }
    }
    return uint8.buffer;
}

function cleanGenericVideoXmp(arrayBuffer, mode) {
    if (!arrayBuffer || arrayBuffer.byteLength < 20) return arrayBuffer;
    const output = new Uint8Array(arrayBuffer.slice(0));
    const openTag = [0x3C, 0x78, 0x3A, 0x78, 0x6D, 0x70, 0x6D, 0x65, 0x74, 0x61]; // '<x:xmpmeta'
    const closeTag = [0x3C, 0x2F, 0x78, 0x3A, 0x78, 0x6D, 0x70, 0x6D, 0x65, 0x74, 0x61, 0x3E]; // '</x:xmpmeta>'

    let searchPos = 0;
    while (searchPos < output.length - 20) {
        let xmpStart = -1;
        for (let i = searchPos; i <= output.length - 10; i++) {
            if (output[i] === 0x3C && output[i + 1] === 0x78 && output[i + 2] === 0x3A) {
                let match = true;
                for (let k = 3; k < 10; k++) {
                    if (output[i + k] !== openTag[k]) { match = false; break; }
                }
                if (match) { xmpStart = i; break; }
            }
        }
        if (xmpStart === -1) break;

        let xmpEnd = -1;
        for (let i = xmpStart + 10; i <= output.length - 12; i++) {
            if (output[i] === 0x3C && output[i + 1] === 0x2F && output[i + 2] === 0x78) {
                let match = true;
                for (let k = 3; k < 12; k++) {
                    if (output[i + k] !== closeTag[k]) { match = false; break; }
                }
                if (match) { xmpEnd = i; break; }
            }
        }
        if (xmpEnd === -1) break;

        const xmpBlockEnd = xmpEnd + 12;
        const origLen = xmpBlockEnd - xmpStart;

        if (mode === 'ALL') {
            for (let i = xmpStart; i < xmpBlockEnd; i++) {
                output[i] = 0x20;
            }
        } else if (mode === 'STOCK') {
            try {
                const xmpBytes = output.subarray(xmpStart, xmpBlockEnd);
                const xmpBlock = new TextDecoder('utf-8', { fatal: false }).decode(xmpBytes);
                const cleanedXmp = cleanXmpStringPreservingStock(xmpBlock);
                const encodedCleaned = new TextEncoder().encode(cleanedXmp);
                if (encodedCleaned.length <= origLen) {
                    output.set(encodedCleaned, xmpStart);
                    for (let i = xmpStart + encodedCleaned.length; i < xmpBlockEnd; i++) {
                        output[i] = 0x20;
                    }
                }
            } catch (e) {
                console.warn("Video XMP cleaning error:", e);
            }
        }

        searchPos = xmpBlockEnd;
    }

    return output.buffer;
}

// ============================================================
// PROCESSING PIPELINE (unified)
// ============================================================

async function processFiles(mode) {
    // Set all to processing (UI update)
    filesList.forEach(f => {
        f.status = 'processing';
        const el = document.getElementById(f.id);
        if (el) {
            const statusDiv = el.querySelector('.status-badge');
            if (statusDiv) {
                statusDiv.innerHTML = '<i class="bx bx-loader-alt bx-spin"></i> Processing...';
                statusDiv.className = 'status-badge status-processing';
            }
        }
    });

    for (let fileObj of filesList) {
        let cleanBlob = null;

        if (fileObj.category === 'image') {
            cleanBlob = await processImage(fileObj, mode);
        } else if (fileObj.category === 'video') {
            cleanBlob = await processVideo(fileObj, mode);
        } else if (fileObj.category === 'vector') {
            cleanBlob = processVector(fileObj, mode);
        }

        if (cleanBlob) {
            fileObj.cleanBlob = cleanBlob;
            fileObj.status = 'cleaned';

            // Re-extract metadata to verify cleaning
            try {
                const newBuffer = await cleanBlob.arrayBuffer();
                if (fileObj.category === 'image') {
                    fileObj.metadata = await extractImageMetadata(newBuffer, fileObj);
                } else if (fileObj.category === 'video') {
                    fileObj.metadata = await extractVideoMetadata(newBuffer, fileObj.originalFile);
                } else if (fileObj.category === 'vector') {
                    if (isSvg(fileObj.originalFile)) {
                        const text = new TextDecoder('utf-8').decode(newBuffer);
                        fileObj.metadata = extractSvgMetadata(text);
                    } else {
                        fileObj.metadata = extractEpsMetadata(newBuffer);
                    }
                }
            } catch (e) {
                fileObj.metadata = {};
            }

            // Update UI
            const el = document.getElementById(fileObj.id);
            if (el) {
                const statusDiv = el.querySelector('.status-badge');
                if (statusDiv) {
                    statusDiv.className = 'status-badge status-cleaned';
                    statusDiv.innerHTML = 'Cleaned';
                }
            }
        }
    }

    updateQueueStats();
    if (activeFileId) selectFile(activeFileId);

    // Notify Telegram tracker of clean action
    if (window.triggerCleanActionAlert && filesList.length > 0) {
        window.triggerCleanActionAlert(mode, filesList.length);
    }
}
window.processFiles = processFiles;

async function processImage(fileObj, mode) {
    let finalDataURL = fileObj.previewURL;

    if (mode === 'ALL') {
        finalDataURL = await cleanViaCanvas(fileObj);
    } else if (mode === 'STOCK') {
        const ext = getFileExtension(fileObj.name);
        const isJpeg = fileObj.type === 'image/jpeg' || fileObj.type === 'image/jpg' || ext === 'jpg' || ext === 'jpeg';
        const isPng = fileObj.type === 'image/png' || ext === 'png';
        const isWebp = fileObj.type === 'image/webp' || ext === 'webp';

        if (isJpeg) {
            try {
                // In Stock Safe mode: strip GPS/camera private data, Software/CreatorTool & C2PA, but KEEP Title/Keywords/IPTC/XMP
                const strippedBuf = stripJpegForStockSafe(fileObj.originalArrayBuffer);
                return new Blob([strippedBuf], { type: 'image/jpeg' });
            } catch (e) {
                console.error("Stock Safe JPEG processing error:", e);
                finalDataURL = await cleanViaCanvas(fileObj);
            }
        } else if (isPng) {
            // PNG Stock Safe: strip C2PA chunk & Software, preserve text chunks
            try {
                const strippedBuf = stripPngC2pa(fileObj.originalArrayBuffer);
                return new Blob([strippedBuf], { type: 'image/png' });
            } catch (e) {
                finalDataURL = await cleanViaCanvas(fileObj);
            }
        } else if (isWebp) {
            // WebP Stock Safe: strip C2PA chunk, clean Software from EXIF/XMP
            try {
                const strippedBuf = stripWebpC2pa(fileObj.originalArrayBuffer);
                return new Blob([strippedBuf], { type: 'image/webp' });
            } catch (e) {
                finalDataURL = await cleanViaCanvas(fileObj);
            }
        } else {
            finalDataURL = await cleanViaCanvas(fileObj);
        }
    } else if (mode.startsWith('PRESET_')) {
        let softwareStr = "";
        let osStr = "";
        if (mode === 'PRESET_WIN10') {
            softwareStr = "Adobe Photoshop 21.0 (Windows)";
            osStr = "Windows 10";
        } else if (mode === 'PRESET_WIN10_23') {
            softwareStr = "Adobe Photoshop 24.0 (Windows)";
            osStr = "Windows 10";
        } else if (mode === 'PRESET_WIN11_24') {
            softwareStr = "Adobe Photoshop 25.0 (Windows)";
            osStr = "Windows 11";
        }

        if (fileObj.type === 'image/jpeg') {
            try {
                // First canvas clean to wipe ALL original C2PA/EXIF metadata
                let cleanCanvasURL = await cleanViaCanvas(fileObj);
                
                const zeroth = {};
                zeroth[piexif.ImageIFD.Software] = softwareStr;
                zeroth[piexif.ImageIFD.HostComputer] = osStr;
                const exifObj = {"0th": zeroth};
                const exifBytes = piexif.dump(exifObj);
                finalDataURL = piexif.insert(exifBytes, cleanCanvasURL);
            } catch(e) {
                console.error("EXIF spoof error", e);
            }
        } else if (fileObj.type === 'image/png') {
            try {
                let cleanDataURL = await cleanViaCanvas(fileObj);
                const res = await fetch(cleanDataURL);
                let buf = await res.arrayBuffer();
                // Inject tEXt Software chunk
                const withSoftware = await injectPngTextChunk(buf, "Software", softwareStr);
                // Now inject XMP iTXt chunk with realistic Photoshop metadata
                const res2 = await fetch(withSoftware);
                const buf2 = await res2.arrayBuffer();
                finalDataURL = await injectPngXmpChunk(buf2, softwareStr, osStr);
            } catch (e) {
                console.error("PNG spoof error", e);
            }
        }
    } else if (mode.startsWith('CUSTOM_PROFILE_')) {
        const profKey = mode.replace('CUSTOM_', '').toLowerCase();
        const prof = window.getCustomProfile ? window.getCustomProfile(profKey) : null;
        const psVersion = prof ? (prof.psVersion || prof.version || "2024") : "2024";
        const osStr = prof ? (prof.os || "Windows 11") : "Windows 11";
        const ownerName = prof ? (prof.name || "").trim() : "";
        const psMeta = window.getPhotoshopAuthenticMeta
            ? window.getPhotoshopAuthenticMeta(psVersion)
            : {
                softwareStr: window.getSoftwareString ? window.getSoftwareString("Photoshop", psVersion) : "Adobe Photoshop 25.9 (Windows)",
                xmptk: "Adobe XMP Core 9.1-c002 79.f3a8c9b, 2024/03/12-14:22:10        "
            };
        const softwareStr = psMeta.softwareStr;
        const xmptk = psMeta.xmptk;

        const ext = getFileExtension(fileObj.name);
        const isJpeg = fileObj.type === 'image/jpeg' || fileObj.type === 'image/jpg' || ext === 'jpg' || ext === 'jpeg';
        const isPng = fileObj.type === 'image/png' || ext === 'png';
        const isWebp = fileObj.type === 'image/webp' || ext === 'webp';

        if (isJpeg) {
            try {
                // Clean private EXIF & C2PA while spoofing or injecting authentic Photoshop XMP APP1 packet
                const strippedBuf = stripJpegForStockSafe(fileObj.originalArrayBuffer, {
                    creatorTool: softwareStr,
                    xmptk: xmptk,
                    ownerName: ownerName
                });
                const fullStr = uint8ToBinaryString(new Uint8Array(strippedBuf));
                let exifObj = {};
                try {
                    exifObj = piexif.load(fullStr);
                } catch(e) {
                    exifObj = {"0th": {}, "Exif": {}, "GPS": {}};
                }
                if (!exifObj["0th"]) exifObj["0th"] = {};
                exifObj["0th"][piexif.ImageIFD.Software] = softwareStr;
                exifObj["0th"][piexif.ImageIFD.HostComputer] = osStr;
                if (ownerName) {
                    exifObj["0th"][piexif.ImageIFD.Artist] = ownerName;
                }
                const exifBytes = piexif.dump(exifObj);
                const inserted = piexif.insert(exifBytes, fullStr);
                const newBytes = new Uint8Array(inserted.length);
                for (let i = 0; i < inserted.length; i++) {
                    newBytes[i] = inserted.charCodeAt(i) & 0xFF;
                }
                return new Blob([newBytes], { type: 'image/jpeg' });
            } catch(e) {
                console.error("Custom profile JPEG spoof error:", e);
                let cleanCanvasURL = await cleanViaCanvas(fileObj);
                const zeroth = {};
                zeroth[piexif.ImageIFD.Software] = softwareStr;
                zeroth[piexif.ImageIFD.HostComputer] = osStr;
                if (ownerName) {
                    zeroth[piexif.ImageIFD.Artist] = ownerName;
                }
                const exifObj = {"0th": zeroth};
                const exifBytes = piexif.dump(exifObj);
                finalDataURL = piexif.insert(exifBytes, cleanCanvasURL);
            }
        } else if (isPng) {
            try {
                // Strip C2PA and remove old Software/Author/XMP chunks before injecting fresh authentic chunks
                const strippedBuf = stripPngC2pa(fileObj.originalArrayBuffer, true);
                let currentDataURL = await injectPngTextChunk(strippedBuf, "Software", softwareStr);
                if (ownerName) {
                    const resAuthor = await fetch(currentDataURL);
                    const bufAuthor = await resAuthor.arrayBuffer();
                    currentDataURL = await injectPngTextChunk(bufAuthor, "Author", ownerName);
                }
                const res = await fetch(currentDataURL);
                const buf = await res.arrayBuffer();
                finalDataURL = await injectPngXmpChunk(buf, softwareStr, osStr, xmptk);
            } catch (e) {
                console.error("Custom profile PNG spoof error:", e);
                let cleanDataURL = await cleanViaCanvas(fileObj);
                const res = await fetch(cleanDataURL);
                let buf = await res.arrayBuffer();
                let currentDataURL = await injectPngTextChunk(buf, "Software", softwareStr);
                if (ownerName) {
                    const resAuthor = await fetch(currentDataURL);
                    const bufAuthor = await resAuthor.arrayBuffer();
                    currentDataURL = await injectPngTextChunk(bufAuthor, "Author", ownerName);
                }
                const res2 = await fetch(currentDataURL);
                const buf2 = await res2.arrayBuffer();
                finalDataURL = await injectPngXmpChunk(buf2, softwareStr, osStr, xmptk);
            }
        } else if (isWebp) {
            try {
                const strippedBuf = stripWebpC2pa(fileObj.originalArrayBuffer);
                return new Blob([strippedBuf], { type: 'image/webp' });
            } catch (e) {
                finalDataURL = await cleanViaCanvas(fileObj);
            }
        } else {
            finalDataURL = await cleanViaCanvas(fileObj);
        }
    }

    return dataURLtoBlob(finalDataURL);
}

async function injectPngTextChunk(arrayBuffer, keyword, text) {
    const uint8 = new Uint8Array(arrayBuffer);
    const insertionPoint = 33;
    const keyData = new TextEncoder().encode(keyword);
    const valData = new TextEncoder().encode(text);
    const dataLen = keyData.length + 1 + valData.length;
    const chunkSize = 4 + 4 + dataLen + 4;
    const newBuf = new Uint8Array(uint8.length + chunkSize);
    
    newBuf.set(uint8.slice(0, insertionPoint), 0);
    let offset = insertionPoint;
    
    newBuf[offset++] = (dataLen >> 24) & 0xff;
    newBuf[offset++] = (dataLen >> 16) & 0xff;
    newBuf[offset++] = (dataLen >> 8) & 0xff;
    newBuf[offset++] = dataLen & 0xff;
    
    const typeStr = 'tEXt';
    for(let i=0; i<4; i++) newBuf[offset++] = typeStr.charCodeAt(i);
    
    const dataStart = offset;
    newBuf.set(keyData, offset);
    offset += keyData.length;
    newBuf[offset++] = 0;
    newBuf.set(valData, offset);
    offset += valData.length;
    
    const crc = crc32(newBuf.slice(dataStart - 4, offset));
    newBuf[offset++] = (crc >> 24) & 0xff;
    newBuf[offset++] = (crc >> 16) & 0xff;
    newBuf[offset++] = (crc >> 8) & 0xff;
    newBuf[offset++] = crc & 0xff;
    
    newBuf.set(uint8.slice(insertionPoint), offset);
    
    const blob = new Blob([newBuf], {type: 'image/png'});
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}

function crc32(buf) {
    let crc = -1;
    for (let i = 0; i < buf.length; i++) {
        crc ^= buf[i];
        for (let j = 0; j < 8; j++) {
            crc = (crc >>> 1) ^ (crc & 1 ? 0xEDB88320 : 0);
        }
    }
    return (crc ^ -1) >>> 0;
}

function generateXmpUUID() {
    // Generate a realistic xmp.iid / xmp.did style UUID
    const hex = '0123456789ABCDEF';
    let id = '';
    for (let i = 0; i < 32; i++) id += hex[Math.floor(Math.random() * 16)];
    return id;
}

async function injectPngXmpChunk(arrayBuffer, softwareStr, osStr, customXmptk = null) {
    const uint8 = new Uint8Array(arrayBuffer);
    
    // Generate realistic Photoshop XMP UUIDs
    const iid = generateXmpUUID();
    const did = generateXmpUUID();
    const origDid = generateXmpUUID();
    const origIid = generateXmpUUID();
    
    // Create a realistic date string
    const now = new Date();
    const isoDate = now.toISOString().replace(/\.\d{3}Z$/, '+06:00');
    const tk = customXmptk || "Adobe XMP Core 9.1-c002 79.f3a8c9b, 2024/03/12-14:22:10        ";
    
    // Build XMP packet that looks like real Photoshop output
    const xmpStr = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/" x:xmptk="${tk}">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmlns:dc="http://purl.org/dc/elements/1.1/"
    xmlns:xmpMM="http://ns.adobe.com/xap/1.0/mm/"
    xmlns:stEvt="http://ns.adobe.com/xap/1.0/sType/ResourceEvent#"
    xmlns:stRef="http://ns.adobe.com/xap/1.0/sType/ResourceRef#"
    xmlns:photoshop="http://ns.adobe.com/photoshop/1.0/"
   xmp:CreatorTool="${softwareStr}"
   xmp:CreateDate="${isoDate}"
   xmp:ModifyDate="${isoDate}"
   xmp:MetadataDate="${isoDate}"
   dc:format="image/png"
   xmpMM:InstanceID="xmp.iid:${iid}"
   xmpMM:DocumentID="adobe:docid:photoshop:${did}"
   xmpMM:OriginalDocumentID="xmp.did:${origDid}"
   photoshop:ColorMode="3"
   photoshop:ICCProfile="sRGB IEC61966-2.1">
   <xmpMM:History>
    <rdf:Seq>
     <rdf:li
      stEvt:action="created"
      stEvt:instanceID="xmp.iid:${origIid}"
      stEvt:when="${isoDate}"
      stEvt:softwareAgent="${softwareStr}"/>
     <rdf:li
      stEvt:action="saved"
      stEvt:instanceID="xmp.iid:${iid}"
      stEvt:when="${isoDate}"
      stEvt:softwareAgent="${softwareStr}"
      stEvt:changed="/"/>
    </rdf:Seq>
   </xmpMM:History>
   <xmpMM:DerivedFrom
    stRef:instanceID="xmp.iid:${origIid}"
    stRef:documentID="xmp.did:${origDid}"/>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

    // Encode as iTXt chunk (keyword = "XML:com.adobe.xmp")
    const keyword = "XML:com.adobe.xmp";
    const keyBytes = new TextEncoder().encode(keyword);
    const xmpBytes = new TextEncoder().encode(xmpStr);
    
    // iTXt chunk data: keyword + null + compressionFlag(0) + compressionMethod(0) + languageTag("") + null + translatedKeyword("") + null + text
    const dataLen = keyBytes.length + 1 + 1 + 1 + 0 + 1 + 0 + 1 + xmpBytes.length;
    const chunkSize = 4 + 4 + dataLen + 4; // length + type + data + crc
    
    // Find insertion point after IHDR (byte 33)
    const insertionPoint = 33;
    const newBuf = new Uint8Array(uint8.length + chunkSize);
    
    newBuf.set(uint8.slice(0, insertionPoint), 0);
    let offset = insertionPoint;
    
    // Data length (4 bytes big-endian)
    newBuf[offset++] = (dataLen >> 24) & 0xff;
    newBuf[offset++] = (dataLen >> 16) & 0xff;
    newBuf[offset++] = (dataLen >> 8) & 0xff;
    newBuf[offset++] = dataLen & 0xff;
    
    // Chunk type "iTXt"
    const typeStr = 'iTXt';
    for (let i = 0; i < 4; i++) newBuf[offset++] = typeStr.charCodeAt(i);
    
    const dataStart = offset;
    
    // Keyword
    newBuf.set(keyBytes, offset);
    offset += keyBytes.length;
    newBuf[offset++] = 0; // null separator
    
    // Compression flag (0 = uncompressed)
    newBuf[offset++] = 0;
    // Compression method (0)
    newBuf[offset++] = 0;
    // Language tag (empty string + null)
    newBuf[offset++] = 0;
    // Translated keyword (empty string + null)  
    newBuf[offset++] = 0;
    
    // XMP text
    newBuf.set(xmpBytes, offset);
    offset += xmpBytes.length;
    
    // CRC32
    const crc = crc32(newBuf.slice(dataStart - 4, offset));
    newBuf[offset++] = (crc >> 24) & 0xff;
    newBuf[offset++] = (crc >> 16) & 0xff;
    newBuf[offset++] = (crc >> 8) & 0xff;
    newBuf[offset++] = crc & 0xff;
    
    // Rest of the file
    newBuf.set(uint8.slice(insertionPoint), offset);
    
    const blob = new Blob([newBuf], {type: 'image/png'});
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.readAsDataURL(blob);
    });
}
async function processVideo(fileObj, mode) {
    const cleanedBuffer = cleanVideoFile(fileObj.originalArrayBuffer, fileObj.originalFile, mode);
    return new Blob([cleanedBuffer], { type: fileObj.type || 'video/mp4' });
}

function getLocalIllustratorAuthenticMeta(versionYear) {
    if (window.getIllustratorAuthenticMeta) return window.getIllustratorAuthenticMeta(versionYear);
    const v = String(versionYear || "2024").trim();
    const map = {
        "2026": {
            shortVer: "30.4", fullVer: "30.4.0",
            dscCreator: "Adobe Illustrator(R) 30.4",
            xmpCreatorTool: "Adobe Illustrator 30.4 (Windows)",
            buildNumber: "Adobe Illustrator(R) 30.4.0 x226 R agm 8.0 ct 11.7",
            xmptk: "Adobe XMP Core 10.0-c000 1.000000, 0000/00/00-00:00:00        ",
            pdfProducer: "Adobe PDF library 18.00"
        },
        "2025": {
            shortVer: "29.5", fullVer: "29.5.0",
            dscCreator: "Adobe Illustrator(R) 29.5",
            xmpCreatorTool: "Adobe Illustrator 29.5 (Windows)",
            buildNumber: "Adobe Illustrator(R) 29.5.0 x134 R agm 7.1 ct 11.5",
            xmptk: "Adobe XMP Core 9.1-c002 79.a1cd12f, 2024/11/15-19:08:22        ",
            pdfProducer: "Adobe PDF library 17.00"
        },
        "2024": {
            shortVer: "28.5", fullVer: "28.5.0",
            dscCreator: "Adobe Illustrator(R) 28.5",
            xmpCreatorTool: "Adobe Illustrator 28.5 (Windows)",
            buildNumber: "Adobe Illustrator(R) 28.5.0 x132 R agm 7.0 ct 11.4",
            xmptk: "Adobe XMP Core 9.1-c001 79.675d0f7, 2023/06/11-19:21:16        ",
            pdfProducer: "Adobe PDF library 17.00"
        },
        "2023": {
            shortVer: "27.9", fullVer: "27.9.0",
            dscCreator: "Adobe Illustrator(R) 27.9",
            xmpCreatorTool: "Adobe Illustrator 27.9 (Windows)",
            buildNumber: "Adobe Illustrator(R) 27.9.0 x80 R agm 5.1 ct 11.2",
            xmptk: "Adobe XMP Core 9.0-c001 79.14ecb42, 2022/12/02-19:12:44        ",
            pdfProducer: "Adobe PDF library 17.00"
        },
        "2022": {
            shortVer: "26.5", fullVer: "26.5.0",
            dscCreator: "Adobe Illustrator(R) 26.5",
            xmpCreatorTool: "Adobe Illustrator 26.5 (Windows)",
            buildNumber: "Adobe Illustrator(R) 26.5.0 x22 R agm 5.0 ct 11.0",
            xmptk: "Adobe XMP Core 7.1-c000 79.b0f8be9, 2021/12/08-19:11:22        ",
            pdfProducer: "Adobe PDF library 16.03"
        },
        "2021": {
            shortVer: "25.4", fullVer: "25.4.1",
            dscCreator: "Adobe Illustrator(R) 25.4",
            xmpCreatorTool: "Adobe Illustrator 25.4 (Windows)",
            buildNumber: "Adobe Illustrator(R) 25.4.1 x498 R agm 4.85 ct 5.75",
            xmptk: "Adobe XMP Core 7.0-c000 79.dabacbb, 2021/04/14-00:39:44        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2020": {
            shortVer: "24.3", fullVer: "24.3.0",
            dscCreator: "Adobe Illustrator(R) 24.3",
            xmpCreatorTool: "Adobe Illustrator 24.3 (Windows)",
            buildNumber: "Adobe Illustrator(R) 24.3.0 x569 R agm 4.7767 ct 5.4352",
            xmptk: "Adobe XMP Core 6.0-c002 79.164488, 2020/07/10-22:06:53        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2019": {
            shortVer: "23.1", fullVer: "23.1.0",
            dscCreator: "Adobe Illustrator(R) 23.1",
            xmpCreatorTool: "Adobe Illustrator CC 23.1 (Windows)",
            buildNumber: "Adobe Illustrator(R) 23.1.0 x670 R agm 4.72 ct 5.30",
            xmptk: "Adobe XMP Core 5.6-c145 79.163499, 2018/08/13-16:40:22        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2018": {
            shortVer: "22.1", fullVer: "22.1.0",
            dscCreator: "Adobe Illustrator(R) 22.1",
            xmpCreatorTool: "Adobe Illustrator CC 22.1 (Windows)",
            buildNumber: "Adobe Illustrator(R) 22.1.0 x312 R agm 4.67 ct 5.20",
            xmptk: "Adobe XMP Core 5.6-c143 79.161356, 2017/09/07-01:11:22        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2017": {
            shortVer: "21.1", fullVer: "21.1.0",
            dscCreator: "Adobe Illustrator(R) 21.1",
            xmpCreatorTool: "Adobe Illustrator CC 2017 (Windows)",
            buildNumber: "Adobe Illustrator(R) 21.1.0 x326 R agm 4.62 ct 5.10",
            xmptk: "Adobe XMP Core 5.6-c137 79.159768, 2016/08/11-13:24:42        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2016": {
            shortVer: "20.1", fullVer: "20.1.0",
            dscCreator: "Adobe Illustrator(R) 20.1",
            xmpCreatorTool: "Adobe Illustrator CC 2015.3 (Windows)",
            buildNumber: "Adobe Illustrator(R) 20.1.0 x174 R agm 4.58 ct 5.02",
            xmptk: "Adobe XMP Core 5.6-c132 79.159284, 2016/04/19-13:13:40        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2015": {
            shortVer: "19.2", fullVer: "19.2.1",
            dscCreator: "Adobe Illustrator(R) 19.2",
            xmpCreatorTool: "Adobe Illustrator CC 2015 (Windows)",
            buildNumber: "Adobe Illustrator(R) 19.2.1 x147 R agm 4.55 ct 5.00",
            xmptk: "Adobe XMP Core 5.6-c067 79.157747, 2015/03/30-23:40:42        ",
            pdfProducer: "Adobe PDF library 15.00"
        }
    };
    return map[v] || map["2024"];
}

function binaryStringToUint8(str) {
    const out = new Uint8Array(str.length);
    for (let i = 0; i < str.length; i++) {
        out[i] = str.charCodeAt(i) & 0xFF;
    }
    return out;
}

// Helper: Spoof all embedded XMP packets inside a Uint8Array in-place with 0-byte offset shift
// Absorbs any length delta into the standard Adobe XMP whitespace padding block before <?xpacket end="w"?>
function spoofXmpInUint8Buffer(uint8, xmpTool, xmptk, pdfProducer, ownerName) {
    const openTag = '<x:xmpmeta';
    const closeTag = '</x:xmpmeta>';
    const xpacketEndTag = '<?xpacket end=';

    let searchFrom = 0;
    while (searchFrom < uint8.length) {
        const xmpStart = indexOfAsciiBytes(uint8, openTag, searchFrom, uint8.length);
        if (xmpStart === -1) break;

        const closePos = indexOfAsciiBytes(uint8, closeTag, xmpStart, uint8.length);
        if (closePos === -1) break;

        const xmpXmlEnd = closePos + closeTag.length;

        // Check if standard Adobe whitespace padding + <?xpacket end= follows </x:xmpmeta>
        const xpacketPos = indexOfAsciiBytes(uint8, xpacketEndTag, xmpXmlEnd, Math.min(uint8.length, xmpXmlEnd + 4096));
        let regionEnd = xmpXmlEnd;
        let hasPaddingBlock = false;
        if (xpacketPos !== -1) {
            let allWs = true;
            for (let i = xmpXmlEnd; i < xpacketPos; i++) {
                const b = uint8[i];
                if (b !== 0x20 && b !== 0x0A && b !== 0x0D && b !== 0x09) {
                    allWs = false;
                    break;
                }
            }
            if (allWs) {
                regionEnd = xpacketPos;
                hasPaddingBlock = true;
            }
        }

        const totalRegionLen = regionEnd - xmpStart;

        try {
            const rawXml = new TextDecoder('utf-8', { fatal: false }).decode(uint8.subarray(xmpStart, xmpXmlEnd));
            const updatedXml = spoofXmpStringWithAdobeMeta(rawXml, xmpTool, xmptk, pdfProducer, ownerName);
            const encodedXml = new TextEncoder().encode(updatedXml);

            if (encodedXml.length <= totalRegionLen) {
                uint8.set(encodedXml, xmpStart);
                const padStart = xmpStart + encodedXml.length;
                const padLen = regionEnd - padStart;

                if (padLen > 0) {
                    if (hasPaddingBlock) {
                        // Format padding identically to Adobe XMP Core: \n followed by 100-space lines separated by \n, ending with \n
                        uint8[padStart] = 0x0A; // '\n' right after </x:xmpmeta>
                        let col = 0;
                        for (let p = padStart + 1; p < regionEnd - 1; p++) {
                            if (col === 100) {
                                uint8[p] = 0x0A;
                                col = 0;
                            } else {
                                uint8[p] = 0x20;
                                col++;
                            }
                        }
                        if (padLen >= 2) {
                            uint8[regionEnd - 1] = 0x0A; // '\n' right before <?xpacket end="w"?>
                        }
                    } else {
                        for (let p = padStart; p < regionEnd; p++) {
                            uint8[p] = 0x20;
                        }
                    }
                }
            }
        } catch (e) {
            console.warn("EPS/AI XMP spoof warning:", e);
        }

        searchFrom = regionEnd;
    }
}

// Forensically Authentic EPS / AI Metadata Spoofer
// Updates all 3 sections in real Adobe Illustrator EPS 10 files:
// 1. Top PostScript DSC Header (%%Creator, %%For, %%AI8_CreatorVersion, %ADO_BuildNumber) with zero trailing space padding
// 2. Embedded XMP Packet (x:xmptk, xmp:CreatorTool, stEvt:softwareAgent, pdf:Producer) with authentic 100-col padding
// 3. Bottom %AI9_PrivateDataBegin Header (keeps %%Creator: Adobe Illustrator(R) 10.0, updates %%AI8_CreatorVersion & %%For: (<Name>) ())
// 4. Updates DOS EPS Binary Header (psLength & tiffOffset) to match exact PostScript byte count
function spoofEpsBufferAuthentic(arrayBuffer, prof) {
    if (!arrayBuffer || arrayBuffer.byteLength < 16) return arrayBuffer;

    const aiVersion = prof ? (prof.aiVersion || prof.version || "2024") : "2024";
    const ownerName = prof ? (prof.name || "").trim() : "";
    const aiMeta = getLocalIllustratorAuthenticMeta(aiVersion);

    const uint8 = new Uint8Array(arrayBuffer.slice(0));
    const dosInfo = getDosEpsHeader(uint8);

    const psStart = (dosInfo.isDosEps && dosInfo.psOffset < uint8.length) ? dosInfo.psOffset : 0;
    const psMaxEnd = (dosInfo.isDosEps && dosInfo.psLength > 0)
        ? Math.min(uint8.length, psStart + dosInfo.psLength)
        : uint8.length;

    // Step 1: Update embedded XMP packets in-place (0-byte length delta)
    spoofXmpInUint8Buffer(uint8, aiMeta.xmpCreatorTool, aiMeta.xmptk, aiMeta.pdfProducer, ownerName);

    const probeText = uint8ToBinaryString(uint8, psStart, Math.min(psMaxEnd, psStart + 2048));
    const isPostScriptEps = dosInfo.isDosEps || probeText.includes('%!PS-Adobe');

    if (isPostScriptEps) {
        // Step 2: Update Section 1 (Top PostScript DSC Header) with exact line lengths (zero fake space padding)
        const topScanLimit = Math.min(psMaxEnd, psStart + 8192);
        let topHeaderEnd = -1;
        for (const marker of ['%%BeginData:', '%%BeginProlog', '%%BeginSetup', '%%EndComments']) {
            const idx = indexOfAsciiBytes(uint8, marker, psStart, topScanLimit);
            if (idx !== -1 && (topHeaderEnd === -1 || idx < topHeaderEnd)) {
                topHeaderEnd = idx;
            }
        }
        if (topHeaderEnd === -1) {
            topHeaderEnd = Math.min(psMaxEnd, psStart + 2048);
        }

        let topHeaderStr = uint8ToBinaryString(uint8, psStart, topHeaderEnd);

        // Update %%Creator: Adobe Illustrator(R) XX.X
        topHeaderStr = topHeaderStr.replace(/^%%Creator:[ \t]*[^\r\n]*/m, `%%Creator: ${aiMeta.dscCreator}`);

        // Update or insert %%For: <ownerName> (without parentheses in Top DSC Header!)
        if (ownerName) {
            if (/^%%For:[ \t]*[^\r\n]*/m.test(topHeaderStr)) {
                topHeaderStr = topHeaderStr.replace(/^%%For:[ \t]*[^\r\n]*/m, `%%For: ${ownerName}`);
            } else {
                topHeaderStr = topHeaderStr.replace(/^(%%Creator:[ \t]*[^\r\n]*\r?\n)/m, `$1%%For: ${ownerName}\r\n`);
            }
        }

        // Update %%AI8_CreatorVersion: XX.X.X
        topHeaderStr = topHeaderStr.replace(/^(%+AI8_CreatorVersion:)[ \t]*[^\r\n]*/m, `$1 ${aiMeta.fullVer}`);

        // Update %ADO_BuildNumber: Adobe Illustrator(R) XX.X.X ...
        topHeaderStr = topHeaderStr.replace(/^(%ADO_BuildNumber:)[ \t]*[^\r\n]*/m, `$1 ${aiMeta.buildNumber}`);

        const newTopBytes = binaryStringToUint8(topHeaderStr);

        // Step 3: Update Section 3 (%AI9_PrivateDataBegin near the end of the PostScript stream)
        const privStart = indexOfAsciiBytes(uint8, '%AI9_PrivateDataBegin', topHeaderEnd, psMaxEnd);
        let privEnd = -1;
        let newPrivBytes = null;

        if (privStart !== -1) {
            const privSearchLimit = Math.min(psMaxEnd, privStart + 2048);
            privEnd = indexOfAsciiBytes(uint8, '%AI9_DataStream', privStart, privSearchLimit);
            if (privEnd === -1) {
                privEnd = indexOfAsciiBytes(uint8, '%%EndData', privStart, privSearchLimit);
            }
            if (privEnd !== -1) {
                let privStr = uint8ToBinaryString(uint8, privStart, privEnd);
                // Ensure %%Creator inside %AI9_PrivateDataBegin stays Adobe Illustrator(R) 10.0
                privStr = privStr.replace(/^%%Creator:[ \t]*[^\r\n]*/m, '%%Creator: Adobe Illustrator(R) 10.0');
                // Update %%AI8_CreatorVersion: XX.X.X
                privStr = privStr.replace(/^(%+AI8_CreatorVersion:)[ \t]*[^\r\n]*/m, `$1 ${aiMeta.fullVer}`);
                // Update %%For: (<ownerName>) () (with parentheses and () in %AI9_PrivateDataBegin!)
                if (ownerName) {
                    if (/^%%For:[ \t]*[^\r\n]*/m.test(privStr)) {
                        privStr = privStr.replace(/^%%For:[ \t]*[^\r\n]*/m, `%%For: (${ownerName}) ()`);
                    } else {
                        privStr = privStr.replace(/^(%+AI8_CreatorVersion:[ \t]*[^\r\n]*\r?\n)/m, `$1%%For: (${ownerName}) ()\r\n`);
                    }
                }
                newPrivBytes = binaryStringToUint8(privStr);
            }
        }

        // Step 4: Reassemble PostScript stream & update DOS EPS 30-byte Binary Header offsets
        const prefixSlice = uint8.subarray(0, psStart);
        const suffixSlice = uint8.subarray(psMaxEnd, uint8.length);

        let psChunks;
        if (privStart !== -1 && privEnd !== -1 && newPrivBytes) {
            psChunks = [
                newTopBytes,
                uint8.subarray(topHeaderEnd, privStart),
                newPrivBytes,
                uint8.subarray(privEnd, psMaxEnd)
            ];
        } else {
            psChunks = [
                newTopBytes,
                uint8.subarray(topHeaderEnd, psMaxEnd)
            ];
        }

        const newPsLength = psChunks.reduce((acc, c) => acc + c.length, 0);
        const totalOutLen = prefixSlice.length + newPsLength + suffixSlice.length;
        const outUint8 = new Uint8Array(totalOutLen);

        let writePos = 0;
        outUint8.set(prefixSlice, writePos);
        writePos += prefixSlice.length;

        for (const chunk of psChunks) {
            outUint8.set(chunk, writePos);
            writePos += chunk.length;
        }

        outUint8.set(suffixSlice, writePos);

        // Update DOS EPS header pointers (psLength at byte 8, wmfOffset at byte 12, tiffOffset at byte 20)
        if (dosInfo.isDosEps && outUint8.length >= 30) {
            const deltaPs = newPsLength - dosInfo.psLength;
            const outView = new DataView(outUint8.buffer, outUint8.byteOffset, outUint8.byteLength);
            outView.setUint32(8, newPsLength, true);
            if (dosInfo.wmfOffset > dosInfo.psOffset) {
                outView.setUint32(12, dosInfo.wmfOffset + deltaPs, true);
            }
            if (dosInfo.tiffOffset > dosInfo.psOffset) {
                outView.setUint32(20, dosInfo.tiffOffset + deltaPs, true);
            }
        }

        return outUint8.buffer;
    }

    // Fallback for PDF-based .ai files (where xref tables require fixed byte offsets outside XMP)
    // XMP packet is already updated in-place above; also update in-place /Creator (...) and /Author (...) if present
    const pdfCreatorPrefix = '/Creator';
    const pdfIdx = indexOfAsciiBytes(uint8, pdfCreatorPrefix, 0, Math.min(uint8.length, 131072));
    if (pdfIdx !== -1) {
        let parenOpen = pdfIdx + pdfCreatorPrefix.length;
        while (parenOpen < uint8.length && uint8[parenOpen] !== 0x28 && (uint8[parenOpen] === 0x20 || uint8[parenOpen] === 0x0A || uint8[parenOpen] === 0x0D)) {
            parenOpen++;
        }
        if (parenOpen < uint8.length && uint8[parenOpen] === 0x28) {
            let parenClose = parenOpen + 1;
            while (parenClose < uint8.length && uint8[parenClose] !== 0x29 && uint8[parenClose] !== 0x0A && uint8[parenClose] !== 0x0D) {
                parenClose++;
            }
            if (parenClose < uint8.length && uint8[parenClose] === 0x29) {
                const valStart = parenOpen + 1;
                const availableSpace = parenClose - valStart;
                const candidates = [aiMeta.dscCreator, aiMeta.xmpCreatorTool, `Adobe Illustrator ${aiMeta.shortVer}`];
                for (const cand of candidates) {
                    const enc = binaryStringToUint8(cand);
                    if (enc.length <= availableSpace) {
                        uint8.set(enc, valStart);
                        for (let i = valStart + enc.length; i < parenClose; i++) uint8[i] = 0x20;
                        break;
                    }
                }
            }
        }
    }

    if (ownerName) {
        const pdfAuthorPrefix = '/Author';
        const pdfAuthIdx = indexOfAsciiBytes(uint8, pdfAuthorPrefix, 0, Math.min(uint8.length, 131072));
        if (pdfAuthIdx !== -1) {
            let parenOpen = pdfAuthIdx + pdfAuthorPrefix.length;
            while (parenOpen < uint8.length && uint8[parenOpen] !== 0x28 && (uint8[parenOpen] === 0x20 || uint8[parenOpen] === 0x0A || uint8[parenOpen] === 0x0D)) {
                parenOpen++;
            }
            if (parenOpen < uint8.length && uint8[parenOpen] === 0x28) {
                let parenClose = parenOpen + 1;
                while (parenClose < uint8.length && uint8[parenClose] !== 0x29 && uint8[parenClose] !== 0x0A && uint8[parenClose] !== 0x0D) {
                    parenClose++;
                }
                if (parenClose < uint8.length && uint8[parenClose] === 0x29) {
                    const valStart = parenOpen + 1;
                    const availableSpace = parenClose - valStart;
                    const enc = new TextEncoder().encode(ownerName.substring(0, availableSpace));
                    if (enc.length <= availableSpace) {
                        uint8.set(enc, valStart);
                        for (let i = valStart + enc.length; i < parenClose; i++) uint8[i] = 0x20;
                    }
                }
            }
        }
    }

    return uint8.buffer;
}

function processVector(fileObj, mode) {
    const isCustom = mode.startsWith('CUSTOM_PROFILE_');

    if (isSvg(fileObj.originalFile)) {
        const text = new TextDecoder('utf-8').decode(fileObj.originalArrayBuffer);
        let cleanText = cleanSvgFile(text, isCustom ? 'CUSTOM' : mode);

        if (isCustom) {
            const profKey = mode.replace('CUSTOM_', '').toLowerCase();
            const prof = window.getCustomProfile ? window.getCustomProfile(profKey) : null;
            const aiVersion = prof ? (prof.aiVersion || prof.version || "2024") : "2024";
            const ownerName = prof ? (prof.name || "").trim() : "";
            const aiMeta = getLocalIllustratorAuthenticMeta(aiVersion);
            const generatorComment = `<!-- Generator: Adobe Illustrator ${aiMeta.fullVer}, SVG Export Plug-In . SVG Version: 6.00 Build 0)  -->`;

            // 1. Replace or prepend authentic Illustrator Generator XML comment
            if (/<!--\s*Generator:[\s\S]*?-->/i.test(cleanText)) {
                cleanText = cleanText.replace(/<!--\s*Generator:[\s\S]*?-->/i, generatorComment);
            } else {
                cleanText = cleanText.replace(/(<svg\b)/i, `${generatorComment}\n$1`);
            }

            // 2. Update or insert <meta name="generator"> and <meta name="author">
            let metaElements = `<meta name="generator" content="${escapeHtml(aiMeta.xmpCreatorTool)}" />`;
            if (ownerName) {
                metaElements += `\n    <meta name="author" content="${escapeHtml(ownerName)}" />\n    <dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/"><rdf:Seq xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:li>${escapeHtml(ownerName)}</rdf:li></rdf:Seq></dc:creator>`;
            }

            if (cleanText.includes('<meta name="generator"')) {
                cleanText = cleanText.replace(/<meta\s+name=["']generator["'][^>]*>/gi, `<meta name="generator" content="${escapeHtml(aiMeta.xmpCreatorTool)}" />`);
            }
            if (ownerName && cleanText.includes('<meta name="author"')) {
                cleanText = cleanText.replace(/<meta\s+name=["']author["'][^>]*>/gi, `<meta name="author" content="${escapeHtml(ownerName)}" />`);
            }

            if (!cleanText.includes('<metadata>') && !cleanText.includes('<metadata ')) {
                cleanText = cleanText.replace(/<svg\b([^>]*)>/i, `<svg$1>\n  <metadata>\n    ${metaElements}\n  </metadata>`);
            } else if (!cleanText.includes('<meta name="generator"')) {
                cleanText = cleanText.replace(/<metadata\b([^>]*)>/i, `<metadata$1>\n    ${metaElements}`);
            }

            // 3. Update embedded XMP inside SVG if present
            if (cleanText.includes('<x:xmpmeta')) {
                cleanText = spoofXmpStringWithAdobeMeta(cleanText, aiMeta.xmpCreatorTool, aiMeta.xmptk, aiMeta.pdfProducer, ownerName);
            }
        }
        return new Blob([cleanText], { type: 'image/svg+xml' });
    } else {
        // EPS / AI
        if (isCustom) {
            const profKey = mode.replace('CUSTOM_', '').toLowerCase();
            const prof = window.getCustomProfile ? window.getCustomProfile(profKey) : null;
            const spoofedBuffer = spoofEpsBufferAuthentic(fileObj.originalArrayBuffer, prof);
            return new Blob([spoofedBuffer], { type: fileObj.type || 'application/postscript' });
        } else {
            const cleanedBuffer = cleanEpsBuffer(fileObj.originalArrayBuffer, mode);
            return new Blob([cleanedBuffer], { type: fileObj.type || 'application/postscript' });
        }
    }
}

// ============================================================
// CANVAS CLEANING (Images — Total Wipe)
// ============================================================

function cleanViaCanvas(fileObj) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            resolve(canvas.toDataURL(fileObj.type, 1.0));
        };
        img.src = fileObj.previewURL;
    });
}

// ============================================================
// UI RENDERING
// ============================================================

function renderFileItem(fileObj) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.id = fileObj.id;
    li.onclick = () => selectFile(fileObj.id);

    // Check for sensitive metadata and C2PA
    let hasSensitiveData = false;
    let hasC2pa = false;
    const m = fileObj.metadata;
    if (m) {
        if (m.__c2pa && m.__c2pa.found) {
            hasC2pa = true;
            hasSensitiveData = true;
        }
        if (fileObj.category === 'image') {
            if (m.latitude || m.longitude || m.Make || m.Model || m.ISO || m.FNumber) {
                hasSensitiveData = true;
            }
        } else if (fileObj.category === 'video') {
            if (m['GPS Location'] || m['Encoder/Software'] || m['Creation Date']) {
                hasSensitiveData = true;
            }
        } else if (fileObj.category === 'vector') {
            if (m['Creator'] || m['Detected Creator'] || m['For (Author)'] ||
                Object.keys(m).some(k => k.startsWith('inkscape:') || k.startsWith('sodipodi:'))) {
                hasSensitiveData = true;
            }
        }
    }

    let statusBadge = '';
    if (fileObj.status === 'cleaned') {
        statusBadge = `<span class="status-badge status-cleaned">Cleaned</span>`;
    } else {
        if (hasC2pa) {
            statusBadge = `<span class="status-badge c2pa-badge" title="C2PA Content Credentials Active"><i class='bx bx-shield-quarter'></i> C2PA Active</span>`;
        } else if (hasSensitiveData) {
            statusBadge = `<span class="status-badge" style="background: rgba(239, 68, 68, 0.2); color: var(--danger);"><i class='bx bx-error-circle'></i> Unsafe</span>`;
        } else {
            statusBadge = `<span class="status-badge status-pending">Pending</span>`;
        }
    }

    // Category badge
    const catBadgeMap = {
        image: `<span class="file-category-badge badge-image"><i class='bx bx-image'></i></span>`,
        video: `<span class="file-category-badge badge-video"><i class='bx bx-film'></i></span>`,
        vector: `<span class="file-category-badge badge-vector"><i class='bx bx-vector'></i></span>`,
    };
    const categoryBadge = catBadgeMap[fileObj.category] || '';

    // Preview element
    let previewHtml = '';
    if (fileObj.category === 'image' || (fileObj.category === 'vector' && isSvg(fileObj.originalFile))) {
        previewHtml = `<img src="${fileObj.previewURL}" class="file-preview" alt="Preview">`;
    } else if (fileObj.category === 'video' && fileObj.previewURL) {
        previewHtml = `<img src="${fileObj.previewURL}" class="file-preview" alt="Video Thumbnail">`;
    } else if (fileObj.category === 'video') {
        previewHtml = `<div class="file-type-icon video-icon"><i class='bx bx-film'></i></div>`;
    } else if (fileObj.category === 'vector') {
        const ext = getFileExtension(fileObj.name).toUpperCase();
        previewHtml = `<div class="file-type-icon vector-icon">${ext}</div>`;
    }

    li.innerHTML = `
        ${previewHtml}
        <div class="file-info">
            <div class="file-name" title="${escapeHtml(fileObj.name)}">${escapeHtml(fileObj.name)}</div>
            <div class="file-meta">
                <span>${categoryBadge}${formatBytes(fileObj.size)}</span>
                ${statusBadge}
            </div>
        </div>
    `;
    fileListEl.appendChild(li);
}

function updateQueueStats() {
    fileCountEl.textContent = filesList.length;
    const cleanedCount = filesList.filter(f => f.status === 'cleaned').length;
    btnDownloadAll.disabled = cleanedCount === 0;
}

function selectFile(id) {
    activeFileId = id;

    document.querySelectorAll('.file-item').forEach(el => el.classList.remove('active'));
    const activeEl = document.getElementById(id);
    if (activeEl) activeEl.classList.add('active');

    const fileObj = filesList.find(f => f.id === id);
    if (!fileObj) return;

    selectedFileName.textContent = fileObj.name;
    selectedFileName.title = fileObj.name;
    renderMetadataInspector(fileObj);
}

function renderMetadataInspector(fileObj) {
    if (Object.keys(fileObj.metadata).length === 0) {
        inspectorContent.innerHTML = `
            <div class="empty-state">
                <i class='bx bx-check-shield' style="color: var(--success); opacity: 1;"></i>
                <p>No metadata found. This file is completely clean!</p>
            </div>
            ${fileObj.status === 'cleaned' ? getDownloadButtonHtml(fileObj) : ''}
        `;
        return;
    }

    const m = fileObj.metadata;
    let html = '';

    // Route rendering by category
    if (fileObj.category === 'image') {
        html = renderImageMetadata(m, fileObj);
    } else if (fileObj.category === 'video') {
        html = renderVideoMetadata(m, fileObj);
    } else if (fileObj.category === 'vector') {
        html = renderVectorMetadata(m, fileObj);
    }

    // Add download button if cleaned
    if (fileObj.status === 'cleaned') {
        html += getDownloadButtonHtml(fileObj);
    }

    inspectorContent.innerHTML = html;
}

// --- C2PA Metadata Section Renderer ---
function renderC2paMetadataSection(c2pa) {
    if (!c2pa || !c2pa.found) return '';

    let rows = '';

    // Status & Format
    rows += `<tr><th>C2PA Manifest</th><td><span class="val-highlight font-weight-bold">${escapeHtml(c2pa.format || 'Detected')}</span> (${formatBytes(c2pa.totalSize || 0)})</td></tr>`;

    // Tool / Generator
    if (c2pa.generator) {
        rows += `<tr><th>Claim Generator / Tool</th><td class="val-warning"><strong>${escapeHtml(c2pa.generator)}</strong></td></tr>`;
    }

    // AI Content Classification
    if (c2pa.isAiGenerated) {
        rows += `<tr><th>AI Content Status</th><td><span class="c2pa-pill pill-danger"><i class='bx bx-bot'></i> AI Generated / Synthetic Media</span></td></tr>`;
    }

    // Actions
    if (c2pa.actions && c2pa.actions.length > 0) {
        const actionPills = c2pa.actions.map(act => {
            let cls = 'c2pa-pill';
            if (act.toLowerCase().includes('ai')) cls += ' pill-danger';
            else if (act.toLowerCase().includes('edit') || act.toLowerCase().includes('filter')) cls += ' pill-warning';
            else if (act.toLowerCase().includes('creat')) cls += ' pill-success';
            return `<span class="${cls}">${escapeHtml(act)}</span>`;
        }).join(' ');
        rows += `<tr><th>Action History</th><td>${actionPills}</td></tr>`;
    }

    // Signer / Certificate
    if (c2pa.signer) {
        rows += `<tr><th>Signed By (Issuer)</th><td class="val-highlight"><i class='bx bx-check-shield' style="color: var(--success);"></i> ${escapeHtml(c2pa.signer)}</td></tr>`;
    }

    // Signature Algorithm
    if (c2pa.signatureAlgo) {
        rows += `<tr><th>Signature Type</th><td><code>${escapeHtml(c2pa.signatureAlgo.toUpperCase())}</code> (COSE_Sign1 / X.509)</td></tr>`;
    }

    // Timestamp
    if (c2pa.timestamp) {
        rows += `<tr><th>Signing Timestamp</th><td>${escapeHtml(c2pa.timestamp)}</td></tr>`;
    }

    // AI Prompt / Description
    if (c2pa.aiPrompt) {
        rows += `<tr><th>Prompt / Description</th><td style="word-break: break-word; font-style: italic;">"${escapeHtml(c2pa.aiPrompt)}"</td></tr>`;
    }

    // JUMBF Box Hierarchy Tree
    if (c2pa.boxTree && c2pa.boxTree.length > 0) {
        const treeItems = c2pa.boxTree.map(box => {
            const icon = box.type === 'jumb' ? '📦' : (box.type === 'cbor' ? '📄' : '🏷️');
            return `${icon} <strong>${escapeHtml(box.label || box.type)}</strong> <span style="opacity: 0.6;">[${box.type}, ${formatBytes(box.size)}]</span>`;
        }).join('<br>');

        rows += `<tr><th>JUMBF Structure</th><td><div class="c2pa-tree-box">${treeItems}</div></td></tr>`;
    }

    // Raw strings extracted
    if (c2pa.rawStrings && c2pa.rawStrings.length > 0) {
        const displayStrings = c2pa.rawStrings.slice(0, 10).map(s => escapeHtml(s)).join('<br>');
        rows += `<tr><th>Extracted Identifiers</th><td><div class="c2pa-tree-box" style="max-height: 120px;">${displayStrings}</div></td></tr>`;
    }

    return `
    <div class="meta-category c2pa-category">
        <div class="meta-category-header c2pa-category-header">
            <div style="display: flex; align-items: center; gap: 8px;">
                <i class='bx bx-shield-quarter' style="font-size: 1.4rem; color: #f87171;"></i>
                <span>C2PA / Content Credentials</span>
            </div>
            <span class="c2pa-status-pill"><i class='bx bxs-lock-alt'></i> Active & Signed</span>
        </div>
        <table class="meta-table">
            ${rows}
        </table>
        <div class="c2pa-quick-strip">
            <span><i class='bx bx-info-circle'></i> Cryptographic provenance & history data embedded.</span>
            <button class="btn btn-danger btn-sm" onclick="cleanActiveFileC2PAOnly()">
                <i class='bx bx-trash'></i> Strip C2PA Only
            </button>
        </div>
    </div>`;
}

// Handler to strip C2PA only on the active file
window.cleanActiveFileC2PAOnly = async function() {
    if (!activeFileId) return;
    const fileObj = filesList.find(f => f.id === activeFileId);
    if (!fileObj) return;

    const btn = document.querySelector('.c2pa-quick-strip .btn');
    if (btn) btn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Stripping...`;

    try {
        let cleanBuffer = null;
        const currentBuf = fileObj.cleanBlob ? await fileObj.cleanBlob.arrayBuffer() : fileObj.originalArrayBuffer;
        const category = fileObj.category;
        const ext = getFileExtension(fileObj.name);

        if (category === 'image') {
            if (ext === 'jpg' || ext === 'jpeg' || fileObj.type === 'image/jpeg') {
                cleanBuffer = stripJpegC2pa(currentBuf);
            } else if (ext === 'png' || fileObj.type === 'image/png') {
                cleanBuffer = stripPngC2pa(currentBuf);
            } else if (ext === 'webp' || fileObj.type === 'image/webp') {
                cleanBuffer = stripWebpC2pa(currentBuf);
            } else {
                const cleanDataURL = await cleanViaCanvas(fileObj);
                const blob = dataURLtoBlob(cleanDataURL);
                cleanBuffer = await blob.arrayBuffer();
            }
        } else if (category === 'video') {
            cleanBuffer = cleanVideoFile(currentBuf, fileObj.originalFile, 'ALL');
        }

        if (cleanBuffer) {
            fileObj.cleanBlob = new Blob([cleanBuffer], { type: fileObj.type || 'image/jpeg' });
            fileObj.status = 'cleaned';

            // Re-extract metadata
            const newBuf = await fileObj.cleanBlob.arrayBuffer();
            if (category === 'image') {
                fileObj.metadata = await extractImageMetadata(newBuf, fileObj);
            } else if (category === 'video') {
                fileObj.metadata = await extractVideoMetadata(newBuf, fileObj.originalFile);
            }

            updateQueueStats();
            const el = document.getElementById(fileObj.id);
            if (el) {
                const statusDiv = el.querySelector('.status-badge');
                if (statusDiv) {
                    statusDiv.className = 'status-badge status-cleaned';
                    statusDiv.innerHTML = 'Cleaned';
                }
            }
            selectFile(fileObj.id);
        }
    } catch (e) {
        console.error("Strip C2PA error:", e);
        alert("Failed to strip C2PA: " + e.message);
    }
};

// --- Image metadata rendering ---
function renderImageMetadata(m, fileObj) {
    let html = '';

    // C2PA Section (Rendered first if present)
    if (m.__c2pa && m.__c2pa.found) {
        html += renderC2paMetadataSection(m.__c2pa);
    }

    // Camera Category
    if (m.Make || m.Model || m.LensModel || m.ISO || m.FNumber || m.Software || m.HostComputer || m.CreatorTool || m.Artist) {
        html += `
        <div class="meta-category">
            <div class="meta-category-header"><i class='bx bx-camera'></i> Camera & EXIF</div>
            <table class="meta-table">
                ${m.Make ? `<tr><th>Make</th><td class="val-warning">${m.Make}</td></tr>` : ''}
                ${m.Model ? `<tr><th>Model</th><td class="val-warning">${m.Model}</td></tr>` : ''}
                ${m.LensModel ? `<tr><th>Lens</th><td>${m.LensModel}</td></tr>` : ''}
                ${m.ISO ? `<tr><th>ISO</th><td>${m.ISO}</td></tr>` : ''}
                ${m.FNumber ? `<tr><th>Aperture</th><td>f/${m.FNumber}</td></tr>` : ''}
                ${m.ExposureTime ? `<tr><th>Shutter</th><td>1/${Math.round(1/m.ExposureTime)}s</td></tr>` : ''}
                ${m.Software ? `<tr><th>Software</th><td class="val-warning">${m.Software}</td></tr>` : ''}
                ${m.CreatorTool ? `<tr><th>CreatorTool</th><td class="val-warning">${m.CreatorTool}</td></tr>` : ''}
                ${m.HostComputer ? `<tr><th>Host Computer</th><td class="val-warning">${m.HostComputer}</td></tr>` : ''}
                ${m.Artist ? `<tr><th>Artist (Owner)</th><td class="val-warning">${m.Artist}</td></tr>` : ''}
            </table>
        </div>`;
    }

    // GPS Category
    if (m.latitude || m.longitude) {
        html += `
        <div class="meta-category" style="border-color: rgba(239, 68, 68, 0.3);">
            <div class="meta-category-header" style="color: var(--danger);"><i class='bx bx-map-pin'></i> GPS / Location</div>
            <table class="meta-table">
                <tr><th>Latitude</th><td class="val-highlight">${m.latitude}</td></tr>
                <tr><th>Longitude</th><td class="val-highlight">${m.longitude}</td></tr>
            </table>
        </div>`;
    }

    // IPTC / Stock Category
    if (m.ObjectName || m.Caption || m.Keywords || m.Copyright || m.Creator) {
        html += `
        <div class="meta-category" style="border-color: rgba(16, 185, 129, 0.3);">
            <div class="meta-category-header" style="color: var(--success);"><i class='bx bx-purchase-tag'></i> Stock Info (IPTC/XMP)</div>
            <table class="meta-table">
                ${m.ObjectName || m.title ? `<tr><th>Title</th><td class="val-highlight">${m.ObjectName || m.title}</td></tr>` : ''}
                ${m.Keywords || m.subject ? `<tr><th>Keywords</th><td>${Array.isArray(m.Keywords) ? m.Keywords.join(', ') : (m.subject ? m.subject.join(', ') : m.Keywords)}</td></tr>` : ''}
                ${m.Copyright || m.rights ? `<tr><th>Copyright</th><td>${m.Copyright || m.rights}</td></tr>` : ''}
                ${m.Creator || m.creator ? `<tr><th>Creator</th><td>${m.Creator || m.creator}</td></tr>` : ''}
            </table>
        </div>`;
    }

    // XMP / Creator Info
    const xmpKeys = ['xmp:CreatorTool', 'xmp:CreateDate', 'xmp:ModifyDate', 'xmp:MetadataDate',
        'photoshop:ColorMode', 'dc:format', 'tiff:ImageWidth', 'tiff:ImageLength',
        'tiff:PhotometricInterpretation', 'tiff:SamplesPerPixel', 'tiff:XResolution',
        'tiff:YResolution', 'tiff:ResolutionUnit', 'exif:ExifVersion', 'exif:ColorSpace',
        'exif:PixelXDimension', 'exif:PixelYDimension', 'xmpMM:InstanceID',
        'xmpMM:DocumentID', 'xmpMM:OriginalDocumentID'];

    let xmpRows = '';
    for (const key of xmpKeys) {
        if (m[key]) {
            const label = key.split(':').pop();
            xmpRows += `<tr><th>${label}</th><td class="val-highlight">${m[key]}</td></tr>`;
        }
    }
    if (xmpRows) {
        html += `
        <div class="meta-category" style="border-color: rgba(139, 92, 246, 0.3);">
            <div class="meta-category-header" style="color: var(--accent-primary);"><i class='bx bx-code-alt'></i> XMP / Creator Info</div>
            <table class="meta-table">${xmpRows}</table>
        </div>`;
    }

    // Raw data
    html += renderRawMetadata(m, new Set([...xmpKeys, '__c2pa', 'Make', 'Model', 'LensModel', 'ISO', 'FNumber', 'ExposureTime', 'Software', 'HostComputer', 'CreatorTool',
        'latitude', 'longitude', 'ObjectName', 'title', 'Keywords', 'subject', 'Copyright', 'rights', 'Creator', 'creator', 'Caption']));

    return html;
}

// --- Video metadata rendering ---
function renderVideoMetadata(m, fileObj) {
    let html = '';

    // C2PA Section (Rendered first if present)
    if (m.__c2pa && m.__c2pa.found) {
        html += renderC2paMetadataSection(m.__c2pa);
    }

    // Video Info
    const infoKeys = ['Duration', 'Creation Date', 'Modification Date', 'Format'];
    let infoRows = '';
    for (const key of infoKeys) {
        if (m[key]) infoRows += `<tr><th>${key}</th><td class="val-highlight">${m[key]}</td></tr>`;
    }
    if (infoRows) {
        html += `
        <div class="meta-category" style="border-color: rgba(6, 182, 212, 0.3);">
            <div class="meta-category-header" style="color: var(--accent-secondary);"><i class='bx bx-film'></i> Video Info</div>
            <table class="meta-table">${infoRows}</table>
        </div>`;
    }

    // Creator / Software
    const softwareKeys = ['Encoder/Software', 'Writing App', 'Muxing App'];
    let swRows = '';
    for (const key of softwareKeys) {
        if (m[key]) swRows += `<tr><th>${key}</th><td class="val-warning">${m[key]}</td></tr>`;
    }
    if (swRows) {
        html += `
        <div class="meta-category" style="border-color: rgba(245, 158, 11, 0.3);">
            <div class="meta-category-header" style="color: var(--warning);"><i class='bx bx-wrench'></i> Software / Encoder</div>
            <table class="meta-table">${swRows}</table>
        </div>`;
    }

    // iTunes/MP4 Tags
    const tagKeys = ['Title', 'Artist', 'Album', 'Album Artist', 'Comment', 'Date', 'Genre', 'Copyright', 'Description', 'Long Description'];
    let tagRows = '';
    for (const key of tagKeys) {
        if (m[key]) tagRows += `<tr><th>${key}</th><td>${m[key]}</td></tr>`;
    }
    if (tagRows) {
        html += `
        <div class="meta-category" style="border-color: rgba(16, 185, 129, 0.3);">
            <div class="meta-category-header" style="color: var(--success);"><i class='bx bx-purchase-tag'></i> Tags & Info</div>
            <table class="meta-table">${tagRows}</table>
        </div>`;
    }

    // GPS
    if (m['GPS Location']) {
        html += `
        <div class="meta-category" style="border-color: rgba(239, 68, 68, 0.3);">
            <div class="meta-category-header" style="color: var(--danger);"><i class='bx bx-map-pin'></i> GPS / Location</div>
            <table class="meta-table">
                <tr><th>GPS Data</th><td class="val-highlight">${m['GPS Location']}</td></tr>
            </table>
        </div>`;
    }

    // XMP from video
    const xmpKeys = ['xmp:CreatorTool', 'xmp:CreateDate', 'xmp:ModifyDate', 'xmpMM:InstanceID', 'xmpMM:DocumentID', 'dc:format'];
    let xmpRows = '';
    for (const key of xmpKeys) {
        if (m[key]) {
            const label = key.split(':').pop();
            xmpRows += `<tr><th>${label}</th><td class="val-highlight">${m[key]}</td></tr>`;
        }
    }
    if (xmpRows) {
        html += `
        <div class="meta-category" style="border-color: rgba(139, 92, 246, 0.3);">
            <div class="meta-category-header" style="color: var(--accent-primary);"><i class='bx bx-code-alt'></i> XMP Data</div>
            <table class="meta-table">${xmpRows}</table>
        </div>`;
    }

    // Raw remaining
    const shownKeys = new Set([...infoKeys, ...softwareKeys, ...tagKeys, ...xmpKeys, 'GPS Location']);
    html += renderRawMetadata(m, shownKeys);

    return html;
}

// --- Vector metadata rendering ---
function renderVectorMetadata(m, fileObj) {
    let html = '';

    // Creator / Software
    const creatorKeys = [
        'Creator',
        'AI Creator Version',
        'ADO Build Number',
        'xmp:CreatorTool',
        'x:xmptk',
        'pdf:Producer',
        'Creator Tool',
        'Creator (Generator)',
        'Creator (Generator Tag)',
        'Detected Creator',
        'For (Author)',
        'Private Data Author',
        'Private Data Version',
        'Creation Date'
    ];
    let creatorRows = '';
    for (const key of creatorKeys) {
        if (m[key]) creatorRows += `<tr><th>${key}</th><td class="val-warning">${escapeHtml(m[key])}</td></tr>`;
    }
    if (creatorRows) {
        html += `
        <div class="meta-category" style="border-color: rgba(245, 158, 11, 0.3);">
            <div class="meta-category-header" style="color: var(--warning);"><i class='bx bx-pen'></i> Creator &amp; Forensic Version Info</div>
            <table class="meta-table">${creatorRows}</table>
        </div>`;
    }

    // Document Info
    const docKeys = ['Format', 'Title', 'Bounding Box', 'HiRes Bounding Box', 'Pages', 'Language Level',
        'Process Colors', 'svg:width', 'svg:height', 'svg:viewBox', 'svg:version'];
    let docRows = '';
    for (const key of docKeys) {
        if (m[key]) docRows += `<tr><th>${key.replace('svg:', '')}</th><td class="val-highlight">${m[key]}</td></tr>`;
    }
    if (docRows) {
        html += `
        <div class="meta-category" style="border-color: rgba(6, 182, 212, 0.3);">
            <div class="meta-category-header" style="color: var(--accent-secondary);"><i class='bx bx-file'></i> Document Info</div>
            <table class="meta-table">${docRows}</table>
        </div>`;
    }

    // SVG-specific metadata
    const svgSpecific = ['SVG Title', 'SVG Description', 'SVG <metadata>'];
    let svgRows = '';
    for (const key of svgSpecific) {
        if (m[key]) {
            let val = m[key];
            if (val.length > 500) {
                val = `<div style="max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; line-height: 1.4;">${escapeHtml(val)}</div>`;
            }
            svgRows += `<tr><th>${key}</th><td style="word-break: break-word;">${val}</td></tr>`;
        }
    }
    if (svgRows) {
        html += `
        <div class="meta-category" style="border-color: rgba(16, 185, 129, 0.3);">
            <div class="meta-category-header" style="color: var(--success);"><i class='bx bx-vector'></i> SVG Metadata</div>
            <table class="meta-table">${svgRows}</table>
        </div>`;
    }

    // Inkscape/Sodipodi data
    const nsKeys = Object.keys(m).filter(k => k.startsWith('inkscape:') || k.startsWith('sodipodi:'));
    if (nsKeys.length > 0 || m['Inkscape Data Points'] || m['Sodipodi Data Points']) {
        let nsRows = '';
        if (m['Inkscape Data Points']) nsRows += `<tr><th>Inkscape Data Points</th><td class="val-warning">${m['Inkscape Data Points']}</td></tr>`;
        if (m['Sodipodi Data Points']) nsRows += `<tr><th>Sodipodi Data Points</th><td class="val-warning">${m['Sodipodi Data Points']}</td></tr>`;
        for (const key of nsKeys.slice(0, 20)) {
            nsRows += `<tr><th>${key}</th><td class="val-warning">${m[key]}</td></tr>`;
        }
        html += `
        <div class="meta-category" style="border-color: rgba(239, 68, 68, 0.3);">
            <div class="meta-category-header" style="color: var(--danger);"><i class='bx bx-data'></i> Inkscape / Editor Data</div>
            <table class="meta-table">${nsRows}</table>
        </div>`;
    }

    // Dublin Core
    const dcKeys = Object.keys(m).filter(k => k.startsWith('dc:'));
    if (dcKeys.length > 0) {
        let dcRows = '';
        for (const key of dcKeys) {
            dcRows += `<tr><th>${key}</th><td>${m[key]}</td></tr>`;
        }
        html += `
        <div class="meta-category" style="border-color: rgba(139, 92, 246, 0.3);">
            <div class="meta-category-header" style="color: var(--accent-primary);"><i class='bx bx-tag'></i> Dublin Core</div>
            <table class="meta-table">${dcRows}</table>
        </div>`;
    }

    // Comments
    const commentKeys = Object.keys(m).filter(k => k.startsWith('Comment #'));
    if (commentKeys.length > 0) {
        let commentRows = '';
        for (const key of commentKeys) {
            commentRows += `<tr><th>${key}</th><td style="word-break: break-word;">${escapeHtml(m[key])}</td></tr>`;
        }
        html += `
        <div class="meta-category">
            <div class="meta-category-header"><i class='bx bx-comment'></i> Embedded Comments</div>
            <table class="meta-table">${commentRows}</table>
        </div>`;
    }

    // Raw remaining
    const shownKeys = new Set([...creatorKeys, ...docKeys, ...svgSpecific, ...nsKeys, ...dcKeys, ...commentKeys,
        'Inkscape Data Points', 'Sodipodi Data Points', 'Embedded XMP',
        'AI Color Model', 'AI Target Resolution', 'AI Num Layers', 'Document Data', 'Needed Resources', 'AI Setting']);
    html += renderRawMetadata(m, shownKeys);

    return html;
}

// --- Shared: Raw metadata rendering ---
function renderRawMetadata(m, skipKeys) {
    let rawRows = '';
    for (const [key, value] of Object.entries(m)) {
        if (key === '__c2pa' || (skipKeys && skipKeys.has(key))) continue;

        let displayVal = value;

        if (key === 'RawXMP' || key === 'Embedded XMP') {
            displayVal = `<div style="max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; line-height: 1.4;">${escapeHtml(String(displayVal))}</div>`;
            rawRows += `<tr><th>${key}</th><td style="word-break: break-word;">${displayVal}</td></tr>`;
            continue;
        }

        if (typeof value === 'object' && value !== null) {
            try {
                displayVal = JSON.stringify(value);
            } catch (e) { displayVal = '[Object]'; }
        }
        if (typeof displayVal === 'string' && displayVal.length > 300) {
            displayVal = displayVal.substring(0, 300) + '...';
        }
        rawRows += `<tr><th>${key}</th><td style="word-break: break-word;">${displayVal}</td></tr>`;
    }

    if (rawRows !== '') {
        return `
        <div class="meta-category">
            <div class="meta-category-header"><i class='bx bx-list-ul'></i> All Raw Metadata</div>
            <table class="meta-table">${rawRows}</table>
        </div>`;
    }
    return '';
}

function escapeHtml(str) {
    return String(str).replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getDownloadButtonHtml(fileObj) {
    return `
    <div class="action-download-single">
        <button class="btn btn-primary" onclick="downloadSingleFile('${fileObj.id}')">
            <i class='bx bx-download'></i> Download Cleaned File
        </button>
    </div>`;
}

// ============================================================
// DOWNLOAD SYSTEM (unified — works with blobs now)
// ============================================================

window.downloadSingleFile = function (id) {
    const fileObj = filesList.find(f => f.id === id);
    if (!fileObj || !fileObj.cleanBlob) return;

    saveAs(fileObj.cleanBlob, fileObj.name);
}

async function downloadAllZip() {
    const zip = new JSZip();
    const cleanedFiles = filesList.filter(f => f.status === 'cleaned');

    if (cleanedFiles.length === 0) return;

    btnDownloadAll.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Zipping...`;
    btnDownloadAll.disabled = true;

    for (const fileObj of cleanedFiles) {
        // Convert blob to ArrayBuffer for JSZip
        const buffer = await fileObj.cleanBlob.arrayBuffer();
        zip.file(fileObj.name, buffer);
    }

    try {
        const content = await zip.generateAsync({ type: "blob" });
        saveAs(content, "Cleaned_Stock_Files.zip");
    } catch (e) {
        console.error("ZIP Generation failed", e);
        alert("Failed to generate ZIP file.");
    } finally {
        btnDownloadAll.innerHTML = `<i class='bx bxs-file-archive'></i> Download All ZIP`;
        btnDownloadAll.disabled = false;
    }
}

// ============================================================
// UTILITY FUNCTIONS (shared)
// ============================================================

function readFileAsDataURL(file) {
    return new Promise((resolve) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.readAsDataURL(file);
    });
}

function formatBytes(bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function dataURLtoBlob(dataurl) {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while (n--) {
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], { type: mime });
}

// PNG Text Chunk Extraction (For AI/ChatGPT metadata in tEXt/iTXt)
function extractPngTextChunks(arrayBuffer) {
    const data = new DataView(arrayBuffer);
    const textData = {};
    let offset = 8; // skip signature

    while (offset < data.byteLength) {
        if (offset + 8 > data.byteLength) break;
        const length = data.getUint32(offset);
        const type = String.fromCharCode(
            data.getUint8(offset + 4),
            data.getUint8(offset + 5),
            data.getUint8(offset + 6),
            data.getUint8(offset + 7)
        );
        offset += 8;

        if (type === 'tEXt') {
            const chunkData = new Uint8Array(arrayBuffer, offset, length);
            let nullIdx = chunkData.indexOf(0);
            if (nullIdx !== -1) {
                const keyword = new TextDecoder('latin1').decode(chunkData.slice(0, nullIdx));
                const text = new TextDecoder('latin1').decode(chunkData.slice(nullIdx + 1));
                textData[keyword] = text;
            }
        } else if (type === 'iTXt') {
            const chunkData = new Uint8Array(arrayBuffer, offset, length);
            let nullIdx = chunkData.indexOf(0);
            if (nullIdx !== -1) {
                const keyword = new TextDecoder('latin1').decode(chunkData.slice(0, nullIdx));
                let pos = nullIdx + 1;
                const isCompressed = chunkData[pos] === 1;
                pos += 2;
                while (pos < chunkData.length && chunkData[pos] !== 0) pos++;
                pos++;
                while (pos < chunkData.length && chunkData[pos] !== 0) pos++;
                pos++;

                let textBytes = chunkData.slice(pos);
                if (isCompressed) {
                    textData[keyword] = "[Compressed Text]";
                } else {
                    const text = new TextDecoder('utf-8').decode(textBytes);
                    textData[keyword] = text;
                }
            }
        }

        offset += length + 4; // length of data + CRC
    }
    return textData;
}

// Deep XMP extraction from raw file bytes (Byte-indexed for instant speed on 30MB+ EPS/Video files)
function extractXmpFromBytes(arrayBuffer) {
    const result = {};
    if (!arrayBuffer || arrayBuffer.byteLength < 20) return result;
    const bytes = new Uint8Array(arrayBuffer);

    const openTag = '<x:xmpmeta';
    const closeTag = '</x:xmpmeta>';

    const xmpStart = indexOfAsciiBytes(bytes, openTag, 0, bytes.length);
    if (xmpStart === -1) return result;

    const xmpEnd = indexOfAsciiBytes(bytes, closeTag, xmpStart, bytes.length);
    if (xmpEnd === -1) return result;

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const xmpString = decoder.decode(bytes.subarray(xmpStart, xmpEnd + closeTag.length));

    const xmptkMatch = xmpString.match(/x:xmptk\s*=\s*["']([^"']+)["']/i);
    if (xmptkMatch && xmptkMatch[1].trim()) {
        result['x:xmptk'] = xmptkMatch[1].trim();
    }

    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmpString, 'application/xml');

        const allElements = xmlDoc.getElementsByTagName('*');
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const tagName = el.localName || el.tagName;

            // Also extract attributes from rdf:Description (Adobe Illustrator/Photoshop often stores XMP properties as attributes)
            if (tagName === 'Description' && el.attributes) {
                for (let a = 0; a < el.attributes.length; a++) {
                    const attr = el.attributes[a];
                    if (attr.name.startsWith('xmlns') || attr.name === 'rdf:about' || attr.name === 'about') continue;
                    const val = attr.value.trim();
                    if (val && !result[attr.name]) {
                        result[attr.name] = val;
                    }
                }
                continue;
            }

            if (['RDF', 'Description', 'xmpmeta', 'Seq', 'Bag', 'Alt', 'li', 'image'].includes(tagName)) continue;

            const prefix = el.prefix || '';
            const displayKey = prefix ? `${prefix}:${tagName}` : tagName;

            let textContent = '';
            if (el.children.length === 0) {
                textContent = el.textContent.trim();
            } else {
                const liItems = el.getElementsByTagName('rdf:li');
                if (liItems.length === 0) {
                    const liItems2 = Array.from(el.children).filter(c => (c.localName || c.tagName) === 'li');
                    if (liItems2.length > 0) {
                        textContent = liItems2.map(li => li.textContent.trim()).join(', ');
                    }
                } else {
                    textContent = Array.from(liItems).map(li => li.textContent.trim()).join(', ');
                }
            }

            if (textContent && textContent.length > 0 && !result[displayKey]) {
                result[displayKey] = textContent;
            }
        }
    } catch (e) {
        console.error("XMP XML parsing error:", e);
    }

    // Only include RawXMP if actual metadata fields were found inside the XMP packet
    if (Object.keys(result).length > 0) {
        result['RawXMP'] = xmpString.replace(/<xmpGImg:image>[\s\S]*?<\/xmpGImg:image>/gi, '<xmpGImg:image>[Base64 Thumbnail]</xmpGImg:image>').replace(/\s{10,}/g, ' ');
    }

    return result;
}

// ============================================================
// BOOT
// ============================================================
init();
