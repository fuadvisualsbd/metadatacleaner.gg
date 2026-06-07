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
const btnClearPrivate = document.getElementById('btn-clear-private');
const btnKeepStock = document.getElementById('btn-keep-stock');

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

    // Actions
    btnClearAll.addEventListener('click', () => processFiles('ALL'));
    btnClearPrivate.addEventListener('click', () => processFiles('PRIVATE'));
    btnKeepStock.addEventListener('click', () => processFiles('STOCK'));
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
                // EPS / AI
                previewURL = null; // Can't preview PostScript in browser
                const text = new TextDecoder('latin1').decode(arrayBuffer);
                metadata = extractEpsMetadata(text, arrayBuffer);
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
// IMAGE METADATA (existing logic, refactored)
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

        // Detect creator tool from common patterns
        if (svgText.includes('Illustrator') || svgText.includes('adobe:ns:meta')) {
            metadata['Detected Creator'] = 'Adobe Illustrator';
        } else if (inkscapeCount > 0 || svgText.includes('inkscape')) {
            metadata['Detected Creator'] = 'Inkscape';
        } else if (svgText.includes('Sketch') || svgText.includes('sketch:')) {
            metadata['Detected Creator'] = 'Sketch';
        } else if (svgText.includes('Figma')) {
            metadata['Detected Creator'] = 'Figma';
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

        if (mode === 'ALL' || mode === 'PRIVATE') {
            // Remove <metadata> elements
            const metaEls = doc.getElementsByTagName('metadata');
            while (metaEls.length > 0) metaEls[0].parentNode.removeChild(metaEls[0]);

            // Remove <desc> elements
            const descEls = doc.getElementsByTagName('desc');
            while (descEls.length > 0) descEls[0].parentNode.removeChild(descEls[0]);

            // Remove Inkscape/Sodipodi namespace attributes from root
            const attrsToRemove = [];
            for (const attr of svg.attributes) {
                if (attr.name.startsWith('inkscape:') || attr.name.startsWith('sodipodi:') ||
                    attr.name.startsWith('xmlns:inkscape') || attr.name.startsWith('xmlns:sodipodi') ||
                    attr.name.startsWith('xmlns:sketch') || attr.name.startsWith('sketch:')) {
                    attrsToRemove.push(attr.name);
                }
            }
            for (const name of attrsToRemove) svg.removeAttribute(name);

            // Remove Inkscape/Sodipodi elements
            const removeTagPrefixes = ['inkscape:', 'sodipodi:', 'sketch:'];
            const allEls = Array.from(doc.getElementsByTagName('*'));
            for (const el of allEls) {
                const tag = el.tagName || '';
                if (removeTagPrefixes.some(p => tag.startsWith(p))) {
                    el.parentNode.removeChild(el);
                    continue;
                }
                // Remove namespaced attributes from all elements
                const elAttrsToRemove = [];
                for (const attr of el.attributes) {
                    if (attr.name.startsWith('inkscape:') || attr.name.startsWith('sodipodi:') ||
                        attr.name.startsWith('sketch:')) {
                        elAttrsToRemove.push(attr.name);
                    }
                }
                for (const name of elAttrsToRemove) el.removeAttribute(name);
            }

            // Remove RDF namespace
            svg.removeAttribute('xmlns:rdf');
            svg.removeAttribute('xmlns:dc');
            svg.removeAttribute('xmlns:cc');
        }

        if (mode === 'ALL') {
            // Also remove <title> and comments
            const titleEls = doc.getElementsByTagName('title');
            while (titleEls.length > 0) titleEls[0].parentNode.removeChild(titleEls[0]);
        }

        // Serialize back
        const serializer = new XMLSerializer();
        let cleanSvg = serializer.serializeToString(doc);

        // Remove XML comments if mode is ALL
        if (mode === 'ALL') {
            cleanSvg = cleanSvg.replace(/<!--[\s\S]*?-->/g, '');
        }

        // Remove embedded XMP blocks
        if (mode === 'ALL' || mode === 'PRIVATE') {
            cleanSvg = cleanSvg.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/gi, '');
        }

        return cleanSvg;
    } catch (e) {
        console.error("SVG cleaning error:", e);
        return svgText; // Return original on error
    }
}

// ============================================================
// VECTOR METADATA ENGINE — EPS / AI
// ============================================================

function extractEpsMetadata(text, arrayBuffer) {
    const metadata = {};

    // 1. DSC (Document Structuring Convention) comments
    const dscPatterns = [
        { regex: /^%%Creator:\s*(.+)$/m, key: 'Creator' },
        { regex: /^%%Title:\s*(.+)$/m, key: 'Title' },
        { regex: /^%%CreationDate:\s*(.+)$/m, key: 'Creation Date' },
        { regex: /^%%For:\s*(.+)$/m, key: 'For (Author)' },
        { regex: /^%%DocumentData:\s*(.+)$/m, key: 'Document Data' },
        { regex: /^%%LanguageLevel:\s*(.+)$/m, key: 'Language Level' },
        { regex: /^%%BoundingBox:\s*(.+)$/m, key: 'Bounding Box' },
        { regex: /^%%HiResBoundingBox:\s*(.+)$/m, key: 'HiRes Bounding Box' },
        { regex: /^%%Pages:\s*(.+)$/m, key: 'Pages' },
        { regex: /^%%DocumentProcessColors:\s*(.+)$/m, key: 'Process Colors' },
        { regex: /^%%DocumentNeededResources:\s*(.+)$/m, key: 'Needed Resources' },
        { regex: /^%AI\d+_(.+?):\s*(.+)$/m, key: 'AI Setting' },
    ];

    for (const { regex, key } of dscPatterns) {
        const match = text.match(regex);
        if (match) {
            metadata[key] = match[1].trim();
        }
    }

    // 2. AI-specific metadata
    const aiPatterns = [
        { regex: /%AI\d+_ColorModel:\s*(\d+)/m, key: 'AI Color Model' },
        { regex: /%AI\d+_TargetResolution:\s*(\d+)/m, key: 'AI Target Resolution' },
        { regex: /%AI\d+_NumLayers:\s*(\d+)/m, key: 'AI Num Layers' },
    ];
    for (const { regex, key } of aiPatterns) {
        const match = text.match(regex);
        if (match) metadata[key] = match[1].trim();
    }

    // 3. XMP block in EPS/AI
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

    // 4. Detect the format
    if (text.startsWith('%!PS-Adobe')) {
        const epsMatch = text.match(/^(%!PS-Adobe-[\d.]+ EPSF-[\d.]+)/m);
        const psMatch = text.match(/^(%!PS-Adobe-[\d.]+)/m);
        metadata['Format'] = epsMatch ? epsMatch[1] : (psMatch ? psMatch[1] : 'PostScript');
    }

    return metadata;
}

function cleanEpsFile(text, arrayBuffer, mode) {
    let cleanText = text;

    if (mode === 'ALL') {
        // Remove all DSC metadata comments (keep structural ones)
        const metaDscPatterns = [
            /^%%Creator:.*$/gm,
            /^%%Title:.*$/gm,
            /^%%CreationDate:.*$/gm,
            /^%%For:.*$/gm,
            /^%%Copyright:.*$/gm,
            /^%AI\d+_.*$/gm,
        ];
        for (const pat of metaDscPatterns) {
            cleanText = cleanText.replace(pat, '');
        }
    } else if (mode === 'PRIVATE') {
        // Remove only personal info
        cleanText = cleanText.replace(/^%%Creator:.*$/gm, '');
        cleanText = cleanText.replace(/^%%For:.*$/gm, '');
        cleanText = cleanText.replace(/^%%CreationDate:.*$/gm, '');
    }
    // STOCK mode: keep creator/title, remove rest
    if (mode === 'STOCK') {
        cleanText = cleanText.replace(/^%%For:.*$/gm, '');
        cleanText = cleanText.replace(/^%%CreationDate:.*$/gm, '');
        cleanText = cleanText.replace(/^%AI\d+_.*$/gm, '');
    }

    // Remove XMP block from all modes except STOCK (keep stock info)
    if (mode === 'ALL' || mode === 'PRIVATE') {
        cleanText = cleanText.replace(/<x:xmpmeta[\s\S]*?<\/x:xmpmeta>/gi, '');
        // Also remove XMP packet wrappers
        cleanText = cleanText.replace(/<\?xpacket[\s\S]*?\?>/gi, '');
    }

    // Clean up empty lines left behind
    cleanText = cleanText.replace(/\n{3,}/g, '\n\n');

    return cleanText;
}

// ============================================================
// VIDEO CLEANING ENGINE
// ============================================================

function cleanVideoFile(arrayBuffer, file, mode) {
    const ext = getFileExtension(file.name);

    if (['mp4', 'mov', 'm4v'].includes(ext) || file.type === 'video/mp4' || file.type === 'video/quicktime') {
        return cleanMp4File(arrayBuffer, mode);
    }

    if (['webm', 'mkv'].includes(ext) || file.type === 'video/webm' || file.type === 'video/x-matroska') {
        return cleanWebmFile(arrayBuffer, mode);
    }

    // For AVI and other formats: strip XMP only
    return cleanGenericVideoXmp(arrayBuffer, mode);
}

function cleanMp4File(arrayBuffer, mode) {
    // Strategy: Rebuild the file, excluding metadata atoms (udta, meta in moov)
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

            // Decide whether to skip this atom
            const isMetaAtom = (type === 'udta' || (type === 'meta' && parentType === 'moov'));

            if (mode === 'ALL' && isMetaAtom) {
                // Skip entire udta/meta atoms (removes all metadata)
                offset = atomEnd;
                continue;
            }

            // Container atoms: recurse to selectively clean children
            if (['moov', 'trak', 'mdia', 'minf', 'stbl'].includes(type)) {
                // Write atom header
                chunks.push({ start: offset, end: offset + 8 });
                collectAtoms(offset + 8, atomEnd, depth + 1, type);
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

    // Fix container atom sizes (moov, trak, etc.) - simplified approach:
    // Since we only removed whole child atoms, the parent sizes need updating.
    // For simplicity and reliability, we recalculate all container sizes.
    fixMp4ContainerSizes(output);

    return output.buffer;
}

function fixMp4ContainerSizes(bytes) {
    const view = new DataView(bytes.buffer);
    const containerTypes = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl']);

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
                // Recurse to fix children first
                fixAtoms(offset + 8, offset + origSize);
                // Recalculate this container's actual size
                let childEnd = offset + 8;
                while (childEnd < offset + origSize) {
                    const childSize = view.getUint32(childEnd);
                    if (childSize < 8) break;
                    childEnd += childSize;
                }
                // The container size should encompass header + all children
                // Since we didn't change internal structure during collection,
                // the sizes should still be correct from the chunk concatenation
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
    // WebM/MKV: Strip XMP from raw bytes
    return cleanGenericVideoXmp(arrayBuffer, mode);
}

function cleanGenericVideoXmp(arrayBuffer, mode) {
    // Find and zero-out XMP blocks in the file
    const bytes = new Uint8Array(arrayBuffer);
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const fullStr = decoder.decode(bytes);

    const xmpStart = fullStr.indexOf('<x:xmpmeta');
    if (xmpStart === -1) return arrayBuffer; // No XMP found

    const xmpEnd = fullStr.indexOf('</x:xmpmeta>', xmpStart);
    if (xmpEnd === -1) return arrayBuffer;

    // Create a copy and blank out the XMP region with spaces (preserves file structure/offsets)
    const output = new Uint8Array(arrayBuffer.slice(0));
    const encoder = new TextEncoder();
    const space = 0x20; // space character
    for (let i = xmpStart; i < xmpEnd + 12 && i < output.length; i++) {
        output[i] = space;
    }

    return output.buffer;
}

// ============================================================
// PROCESSING PIPELINE (unified)
// ============================================================

async function processFiles(mode) {
    for (let fileObj of filesList) {
        if (fileObj.status === 'cleaned') continue;

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
                    fileObj.metadata = await exifr.parse(cleanBlob, { xmp: true, iptc: true, exif: true, gps: true }) || {};
                } else if (fileObj.category === 'video') {
                    fileObj.metadata = await extractVideoMetadata(newBuffer, fileObj.originalFile);
                } else if (fileObj.category === 'vector') {
                    if (isSvg(fileObj.originalFile)) {
                        const text = new TextDecoder('utf-8').decode(newBuffer);
                        fileObj.metadata = extractSvgMetadata(text);
                    } else {
                        const text = new TextDecoder('latin1').decode(newBuffer);
                        fileObj.metadata = extractEpsMetadata(text, newBuffer);
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
}

async function processImage(fileObj, mode) {
    let finalDataURL = fileObj.previewURL;

    if (mode === 'ALL') {
        finalDataURL = await cleanViaCanvas(fileObj);
    } else if (mode === 'PRIVATE' || mode === 'STOCK') {
        if (fileObj.type === 'image/jpeg') {
            try {
                finalDataURL = piexif.remove(fileObj.previewURL);
            } catch (e) {
                finalDataURL = await cleanViaCanvas(fileObj);
            }
        } else {
            finalDataURL = await cleanViaCanvas(fileObj);
        }
    }

    return dataURLtoBlob(finalDataURL);
}

async function processVideo(fileObj, mode) {
    const cleanedBuffer = cleanVideoFile(fileObj.originalArrayBuffer, fileObj.originalFile, mode);
    return new Blob([cleanedBuffer], { type: fileObj.type || 'video/mp4' });
}

function processVector(fileObj, mode) {
    if (isSvg(fileObj.originalFile)) {
        const text = new TextDecoder('utf-8').decode(fileObj.originalArrayBuffer);
        const cleanText = cleanSvgFile(text, mode);
        return new Blob([cleanText], { type: 'image/svg+xml' });
    } else {
        // EPS / AI
        const text = new TextDecoder('latin1').decode(fileObj.originalArrayBuffer);
        const cleanText = cleanEpsFile(text, fileObj.originalArrayBuffer, mode);
        const encoder = new TextEncoder();
        // Use latin1 encoding for EPS
        const bytes = new Uint8Array(cleanText.length);
        for (let i = 0; i < cleanText.length; i++) {
            bytes[i] = cleanText.charCodeAt(i) & 0xFF;
        }
        return new Blob([bytes], { type: 'application/postscript' });
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

    // Check for sensitive metadata
    let hasSensitiveData = false;
    const m = fileObj.metadata;
    if (m) {
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
        if (hasSensitiveData) {
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
            <div class="file-name" title="${fileObj.name}">${fileObj.name}</div>
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

// --- Image metadata rendering (original logic) ---
function renderImageMetadata(m, fileObj) {
    let html = '';

    // Camera Category
    if (m.Make || m.Model || m.LensModel || m.ISO || m.FNumber) {
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
    html += renderRawMetadata(m, new Set([...xmpKeys, 'Make', 'Model', 'LensModel', 'ISO', 'FNumber', 'ExposureTime', 'Software',
        'latitude', 'longitude', 'ObjectName', 'title', 'Keywords', 'subject', 'Copyright', 'rights', 'Creator', 'creator', 'Caption']));

    return html;
}

// --- Video metadata rendering ---
function renderVideoMetadata(m, fileObj) {
    let html = '';

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
    const creatorKeys = ['Creator', 'Detected Creator', 'For (Author)', 'Creation Date'];
    let creatorRows = '';
    for (const key of creatorKeys) {
        if (m[key]) creatorRows += `<tr><th>${key}</th><td class="val-warning">${m[key]}</td></tr>`;
    }
    if (creatorRows) {
        html += `
        <div class="meta-category" style="border-color: rgba(245, 158, 11, 0.3);">
            <div class="meta-category-header" style="color: var(--warning);"><i class='bx bx-pen'></i> Creator Info</div>
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
        if (skipKeys.has(key)) continue;

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

    const parts = fileObj.name.split('.');
    const ext = parts.pop();
    const newName = parts.join('.') + '_clean.' + ext;

    saveAs(fileObj.cleanBlob, newName);
}

async function downloadAllZip() {
    const zip = new JSZip();
    const cleanedFiles = filesList.filter(f => f.status === 'cleaned');

    if (cleanedFiles.length === 0) return;

    btnDownloadAll.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Zipping...`;
    btnDownloadAll.disabled = true;

    for (const fileObj of cleanedFiles) {
        const parts = fileObj.name.split('.');
        const ext = parts.pop();
        const newName = parts.join('.') + '_clean.' + ext;

        // Convert blob to ArrayBuffer for JSZip
        const buffer = await fileObj.cleanBlob.arrayBuffer();
        zip.file(newName, buffer);
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

// Deep XMP extraction from raw file bytes
function extractXmpFromBytes(arrayBuffer) {
    const result = {};
    const bytes = new Uint8Array(arrayBuffer);

    const decoder = new TextDecoder('utf-8', { fatal: false });
    const fullStr = decoder.decode(bytes);

    const xmpStart = fullStr.indexOf('<x:xmpmeta');
    if (xmpStart === -1) return result;

    const xmpEnd = fullStr.indexOf('</x:xmpmeta>', xmpStart);
    if (xmpEnd === -1) return result;

    const xmpString = fullStr.substring(xmpStart, xmpEnd + 12);

    result['RawXMP'] = xmpString;

    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmpString, 'application/xml');

        const allElements = xmlDoc.getElementsByTagName('*');
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const tagName = el.localName || el.tagName;

            if (['RDF', 'Description', 'xmpmeta', 'Seq', 'Bag', 'Alt', 'li'].includes(tagName)) continue;

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

    return result;
}

// ============================================================
// BOOT
// ============================================================
init();
