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

// Initialize Events
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

// Handle incoming files
async function handleFiles(files) {
    if (files.length === 0) return;
    
    // Show workspace, hide dropzone partially
    dropZone.style.display = 'none';
    workspace.style.display = 'block';

    for (let file of files) {
        if (!file.type.match('image/jpeg') && !file.type.match('image/png') && !file.type.match('image/webp')) {
            continue; // Skip unsupported
        }

        const id = 'file_' + Math.random().toString(36).substr(2, 9);
        const dataURL = await readFileAsDataURL(file);
        
        // Read file bytes once for all operations
        const arrayBuffer = await file.arrayBuffer();

        // 1. Extract metadata using exifr
        let metadata = null;
        try {
            metadata = await exifr.parse(new Blob([arrayBuffer], {type: file.type}), { 
                xmp: true, iptc: true, exif: true, gps: true, 
                icc: true, ihdr: true, tiff: true,
                mergeOutput: true
            });
        } catch (e) {
            console.log("No metadata or error reading:", e);
        }
        metadata = metadata || {};

        // 2. Custom PNG chunk extraction for AI/ChatGPT generated images
        if (file.type === 'image/png') {
            try {
                const pngText = extractPngTextChunks(arrayBuffer);
                if (Object.keys(pngText).length > 0) {
                    metadata = { ...metadata, ...pngText };
                }
            } catch(e) {
                console.error("PNG Parse error", e);
            }
        }

        // 3. Deep XMP scan - ALWAYS run to catch what exifr misses
        try {
            const xmpParsed = extractXmpFromBytes(arrayBuffer);
            if (xmpParsed && Object.keys(xmpParsed).length > 0) {
                // Merge, but don't overwrite existing keys
                for (const [key, val] of Object.entries(xmpParsed)) {
                    if (!metadata[key]) {
                        metadata[key] = val;
                    }
                }
            }
        } catch(e) {
            console.error("XMP scan error", e);
        }

        const fileObj = {
            id,
            originalFile: file,
            name: file.name,
            size: file.size,
            type: file.type,
            dataURL: dataURL,
            cleanDataURL: null, // Will hold cleaned file
            status: 'pending', // pending, cleaned
            metadata: metadata || {}
        };

        filesList.push(fileObj);
        renderFileItem(fileObj);
    }
    
    updateQueueStats();
    
    // Select first file if none selected
    if (filesList.length > 0 && !activeFileId) {
        selectFile(filesList[0].id);
    }
}

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

// Render UI
function renderFileItem(fileObj) {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.id = fileObj.id;
    li.onclick = () => selectFile(fileObj.id);

    // Check for sensitive metadata (GPS, EXIF camera details)
    let hasSensitiveData = false;
    const m = fileObj.metadata;
    if (m && (m.latitude || m.longitude || m.Make || m.Model || m.ISO || m.FNumber)) {
        hasSensitiveData = true;
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

    li.innerHTML = `
        <img src="${fileObj.dataURL}" class="file-preview" alt="Preview">
        <div class="file-info">
            <div class="file-name" title="${fileObj.name}">${fileObj.name}</div>
            <div class="file-meta">
                <span>${formatBytes(fileObj.size)}</span>
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
    
    // Update active class
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

    // XMP / Creator Info Category (from deep scan)
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
            <table class="meta-table">
                ${xmpRows}
            </table>
        </div>`;
    }

    // Always show all raw data keys so the user can inspect everything
    const skipInRaw = new Set([...xmpKeys, 'Make', 'Model', 'LensModel', 'ISO', 'FNumber', 'ExposureTime', 'Software',
        'latitude', 'longitude', 'ObjectName', 'title', 'Keywords', 'subject', 'Copyright', 'rights', 'Creator', 'creator', 'Caption']);
    
    let rawRows = '';
    for (const [key, value] of Object.entries(m)) {
        if (skipInRaw.has(key)) continue; // Already shown above
        
        let displayVal = value;
        
        if (key === 'RawXMP') {
            displayVal = `<div style="max-height: 200px; overflow-y: auto; background: rgba(0,0,0,0.3); padding: 8px; border-radius: 6px; font-family: monospace; font-size: 0.75rem; white-space: pre-wrap; line-height: 1.4;">${String(displayVal).replace(/</g, '&lt;').replace(/>/g, '&gt;')}</div>`;
            rawRows += `<tr><th>${key}</th><td style="word-break: break-word;">${displayVal}</td></tr>`;
            continue;
        }

        if (typeof value === 'object' && value !== null) {
            try {
                displayVal = JSON.stringify(value);
            } catch(e) { displayVal = '[Object]'; }
        }
        if (typeof displayVal === 'string' && displayVal.length > 300) {
            displayVal = displayVal.substring(0, 300) + '...';
        }
        rawRows += `<tr><th>${key}</th><td style="word-break: break-word;">${displayVal}</td></tr>`;
    }

    if (rawRows !== '') {
        html += `
        <div class="meta-category">
            <div class="meta-category-header"><i class='bx bx-list-ul'></i> All Raw Metadata</div>
            <table class="meta-table">
                ${rawRows}
            </table>
        </div>`;
    }

    // Add download button if cleaned
    if (fileObj.status === 'cleaned') {
        html += getDownloadButtonHtml(fileObj);
    }

    inspectorContent.innerHTML = html;
}

function getDownloadButtonHtml(fileObj) {
    return `
    <div class="action-download-single">
        <button class="btn btn-primary" onclick="downloadSingleFile('${fileObj.id}')">
            <i class='bx bx-download'></i> Download Cleaned File
        </button>
    </div>`;
}

// Processing Logic
async function processFiles(mode) {
    // Mode: ALL, PRIVATE, STOCK
    
    for (let fileObj of filesList) {
        if (fileObj.status === 'cleaned') continue; // Skip already cleaned
        
        let finalDataURL = fileObj.dataURL;

        if (mode === 'ALL') {
            // Nuclear option: Redraw via Canvas (removes EVERYTHING)
            finalDataURL = await cleanViaCanvas(fileObj);
        } else if (mode === 'PRIVATE' || mode === 'STOCK') {
            // Surgically remove EXIF (Camera/GPS) but preserve IPTC/XMP
            // piexifjs only works on JPEG
            if (fileObj.type === 'image/jpeg') {
                try {
                    // piexif.remove strips EXIF APP1, leaves APP13 (IPTC) and XMP intact
                    finalDataURL = piexif.remove(fileObj.dataURL);
                } catch(e) {
                    console.log("Piexif removal failed, falling back to canvas", e);
                    finalDataURL = await cleanViaCanvas(fileObj);
                }
            } else {
                // Non-JPEGs: Fallback to canvas
                finalDataURL = await cleanViaCanvas(fileObj);
            }
        }

        fileObj.cleanDataURL = finalDataURL;
        fileObj.status = 'cleaned';
        
        // Re-read metadata to verify it's clean
        try {
            const blob = dataURLtoBlob(finalDataURL);
            fileObj.metadata = await exifr.parse(blob, { xmp: true, iptc: true, exif: true, gps: true }) || {};
        } catch(e) {
            fileObj.metadata = {};
        }

        // Update UI
        const el = document.getElementById(fileObj.id);
        if (el) {
            const statusDiv = el.querySelector('.status-badge');
            statusDiv.className = 'status-badge status-cleaned';
            statusDiv.textContent = 'Cleaned';
        }
    }

    updateQueueStats();
    if (activeFileId) selectFile(activeFileId); // Refresh inspector
}

// Canvas cleaning (Total Wipe)
function cleanViaCanvas(fileObj) {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = img.width;
            canvas.height = img.height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            // Export back to original format, quality 1.0 (lossless as possible for JPEG)
            resolve(canvas.toDataURL(fileObj.type, 1.0));
        };
        img.src = fileObj.dataURL;
    });
}

function dataURLtoBlob(dataurl) {
    let arr = dataurl.split(','), mime = arr[0].match(/:(.*?);/)[1],
        bstr = atob(arr[1]), n = bstr.length, u8arr = new Uint8Array(n);
    while(n--){
        u8arr[n] = bstr.charCodeAt(n);
    }
    return new Blob([u8arr], {type:mime});
}

// Download
window.downloadSingleFile = function(id) {
    const fileObj = filesList.find(f => f.id === id);
    if (!fileObj || !fileObj.cleanDataURL) return;
    
    // Add _clean suffix
    const parts = fileObj.name.split('.');
    const ext = parts.pop();
    const newName = parts.join('.') + '_clean.' + ext;
    
    saveAs(dataURLtoBlob(fileObj.cleanDataURL), newName);
}

async function downloadAllZip() {
    const zip = new JSZip();
    const cleanedFiles = filesList.filter(f => f.status === 'cleaned');
    
    if (cleanedFiles.length === 0) return;

    // Change button state
    btnDownloadAll.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Zipping...`;
    btnDownloadAll.disabled = true;

    cleanedFiles.forEach(fileObj => {
        const parts = fileObj.name.split('.');
        const ext = parts.pop();
        const newName = parts.join('.') + '_clean.' + ext;
        
        // Remove "data:image/jpeg;base64," prefix for jszip
        const base64Data = fileObj.cleanDataURL.split(',')[1];
        zip.file(newName, base64Data, {base64: true});
    });

    try {
        const content = await zip.generateAsync({type:"blob"});
        saveAs(content, "Cleaned_Stock_Files.zip");
    } catch(e) {
        console.error("ZIP Generation failed", e);
        alert("Failed to generate ZIP file.");
    } finally {
        // Reset button state
        btnDownloadAll.innerHTML = `<i class='bx bxs-file-archive'></i> Download All ZIP`;
        btnDownloadAll.disabled = false;
    }
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
                pos += 2; // skip flag and method
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
    
    // Use TextDecoder for efficiency instead of char-by-char
    // Scan the entire file (XMP can be anywhere)
    const decoder = new TextDecoder('utf-8', { fatal: false });
    const fullStr = decoder.decode(bytes);
    
    // Find XMP block
    const xmpStart = fullStr.indexOf('<x:xmpmeta');
    if (xmpStart === -1) return result;
    
    const xmpEnd = fullStr.indexOf('</x:xmpmeta>', xmpStart);
    if (xmpEnd === -1) return result;
    
    const xmpString = fullStr.substring(xmpStart, xmpEnd + 12);
    
    // Store the raw XMP for display
    result['RawXMP'] = xmpString;
    
    // Parse XMP XML into readable key-value pairs using DOMParser
    try {
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmpString, 'application/xml');
        
        // Common XMP namespaces and their readable names
        const nsMap = {
            'dc': 'Dublin Core',
            'xmp': 'XMP Basic',
            'xmpMM': 'XMP Media Mgmt',
            'photoshop': 'Photoshop',
            'tiff': 'TIFF',
            'exif': 'EXIF',
            'stEvt': 'Event',
            'crs': 'Camera Raw'
        };

        // Extract all elements that have text content
        const allElements = xmlDoc.getElementsByTagName('*');
        for (let i = 0; i < allElements.length; i++) {
            const el = allElements[i];
            const tagName = el.localName || el.tagName;
            
            // Skip container/wrapper tags
            if (['RDF', 'Description', 'xmpmeta', 'Seq', 'Bag', 'Alt', 'li'].includes(tagName)) continue;
            
            // Get the namespace prefix
            const prefix = el.prefix || '';
            const displayKey = prefix ? `${prefix}:${tagName}` : tagName;
            
            // Get text value (skip if it has child elements that aren't text)
            let textContent = '';
            if (el.children.length === 0) {
                textContent = el.textContent.trim();
            } else {
                // Check if children are li elements (for arrays)
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
    } catch(e) {
        console.error("XMP XML parsing error:", e);
    }
    
    return result;
}

// Boot
init();
