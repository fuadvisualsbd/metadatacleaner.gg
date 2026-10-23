// ===================================================
// MetaCleaner Pro — Google Auth, Admin Panel & 3 Multi-PC Profiles
// ===================================================

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.1/firebase-app.js";
import { 
    getAuth, 
    GoogleAuthProvider, 
    signInWithPopup, 
    onAuthStateChanged, 
    signOut 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-auth.js";
import { 
    getFirestore, 
    doc, 
    setDoc, 
    getDoc,
    collection,
    getDocs,
    serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

// Dedicated Admin Emails
export const ADMIN_EMAILS = [
    "fuyad212002@gmail.com",
    "fuyad600@gmail.com"
];

// Firebase Config (Dedicated MetaCleaner Pro Project)
const firebaseConfig = {
    apiKey: "AIzaSyCQjlIW8fdDGfuL5Qy_7lIqTen0h8yEzLg",
    authDomain: "metadata-cleaner-69a95.firebaseapp.com",
    projectId: "metadata-cleaner-69a95",
    storageBucket: "metadata-cleaner-69a95.firebasestorage.app",
    messagingSenderId: "700518487065",
    appId: "1:700518487065:web:a0a0096a5edfbc1c2f0688"
};

let app = null;
let auth = null;
let db = null;
let provider = null;

try {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
} catch (e) {
    console.warn("[MetaCleaner Auth] Firebase initialization warning:", e);
}

// Current User State
let currentUser = null;
let allUsersList = [];

// Default 3 Profiles (Empty by default — User customizes each)
const DEFAULT_PROFILES = {
    profile_1: {
        id: "profile_1",
        name: "",
        psVersion: "2024",
        aiVersion: "2024",
        os: "Windows 11",
        configured: false
    },
    profile_2: {
        id: "profile_2",
        name: "",
        psVersion: "2023",
        aiVersion: "2023",
        os: "Windows 10",
        configured: false
    },
    profile_3: {
        id: "profile_3",
        name: "",
        psVersion: "2021",
        aiVersion: "2021",
        os: "Windows 10",
        configured: false
    }
};

let userProfiles = { ...DEFAULT_PROFILES };
let activeTab = "profile_1";

// Helper: Sanitize profile and strip legacy dummy defaults so slots start clean
function sanitizeProfile(p, fallbackId) {
    if (!p) return { id: fallbackId, name: "", psVersion: "2024", aiVersion: "2024", os: "Windows 11", configured: false };
    const dummyNames = [
        "pc 1 — photoshop 2024",
        "pc 2 — illustrator 2023",
        "pc 3 — photoshop 2020",
        "pc 1 (workstation)",
        "pc 2 (laptop)",
        "pc 3 (office)",
        "profile 1",
        "profile 2",
        "profile 3"
    ];
    const name = (p.name || "").trim();
    const isDummy = !name || dummyNames.includes(name.toLowerCase());
    return {
        id: p.id || fallbackId,
        name: isDummy ? "" : name,
        psVersion: p.psVersion || p.version || "2024",
        aiVersion: p.aiVersion || p.version || "2024",
        os: p.os || "Windows 11",
        configured: isDummy ? false : (p.configured !== false)
    };
}

// Helper: Map Illustrator Year to Authentic Forensic Metadata Profile
export function getIllustratorAuthenticMeta(versionYear) {
    const v = String(versionYear || "2024").trim();
    const map = {
        "2026": {
            shortVer: "30.4",
            fullVer: "30.4.0",
            dscCreator: "Adobe Illustrator(R) 30.4",
            xmpCreatorTool: "Adobe Illustrator 30.4 (Windows)",
            buildNumber: "Adobe Illustrator(R) 30.4.0 x226 R agm 8.0 ct 11.7",
            xmptk: "Adobe XMP Core 10.0-c000 1.000000, 0000/00/00-00:00:00        ",
            pdfProducer: "Adobe PDF library 18.00"
        },
        "2025": {
            shortVer: "29.5",
            fullVer: "29.5.0",
            dscCreator: "Adobe Illustrator(R) 29.5",
            xmpCreatorTool: "Adobe Illustrator 29.5 (Windows)",
            buildNumber: "Adobe Illustrator(R) 29.5.0 x134 R agm 7.1 ct 11.5",
            xmptk: "Adobe XMP Core 9.1-c002 79.a1cd12f, 2024/11/15-19:08:22        ",
            pdfProducer: "Adobe PDF library 17.00"
        },
        "2024": {
            shortVer: "28.5",
            fullVer: "28.5.0",
            dscCreator: "Adobe Illustrator(R) 28.5",
            xmpCreatorTool: "Adobe Illustrator 28.5 (Windows)",
            buildNumber: "Adobe Illustrator(R) 28.5.0 x132 R agm 7.0 ct 11.4",
            xmptk: "Adobe XMP Core 9.1-c001 79.675d0f7, 2023/06/11-19:21:16        ",
            pdfProducer: "Adobe PDF library 17.00"
        },
        "2023": {
            shortVer: "27.9",
            fullVer: "27.9.0",
            dscCreator: "Adobe Illustrator(R) 27.9",
            xmpCreatorTool: "Adobe Illustrator 27.9 (Windows)",
            buildNumber: "Adobe Illustrator(R) 27.9.0 x80 R agm 5.1 ct 11.2",
            xmptk: "Adobe XMP Core 9.0-c001 79.14ecb42, 2022/12/02-19:12:44        ",
            pdfProducer: "Adobe PDF library 17.00"
        },
        "2022": {
            shortVer: "26.5",
            fullVer: "26.5.0",
            dscCreator: "Adobe Illustrator(R) 26.5",
            xmpCreatorTool: "Adobe Illustrator 26.5 (Windows)",
            buildNumber: "Adobe Illustrator(R) 26.5.0 x22 R agm 5.0 ct 11.0",
            xmptk: "Adobe XMP Core 7.1-c000 79.b0f8be9, 2021/12/08-19:11:22        ",
            pdfProducer: "Adobe PDF library 16.03"
        },
        "2021": {
            shortVer: "25.4",
            fullVer: "25.4.1",
            dscCreator: "Adobe Illustrator(R) 25.4",
            xmpCreatorTool: "Adobe Illustrator 25.4 (Windows)",
            buildNumber: "Adobe Illustrator(R) 25.4.1 x498 R agm 4.85 ct 5.75",
            xmptk: "Adobe XMP Core 7.0-c000 79.dabacbb, 2021/04/14-00:39:44        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2020": {
            shortVer: "24.3",
            fullVer: "24.3.0",
            dscCreator: "Adobe Illustrator(R) 24.3",
            xmpCreatorTool: "Adobe Illustrator 24.3 (Windows)",
            buildNumber: "Adobe Illustrator(R) 24.3.0 x569 R agm 4.7767 ct 5.4352",
            xmptk: "Adobe XMP Core 6.0-c002 79.164488, 2020/07/10-22:06:53        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2019": {
            shortVer: "23.1",
            fullVer: "23.1.0",
            dscCreator: "Adobe Illustrator(R) 23.1",
            xmpCreatorTool: "Adobe Illustrator CC 23.1 (Windows)",
            buildNumber: "Adobe Illustrator(R) 23.1.0 x670 R agm 4.72 ct 5.30",
            xmptk: "Adobe XMP Core 5.6-c145 79.163499, 2018/08/13-16:40:22        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2018": {
            shortVer: "22.1",
            fullVer: "22.1.0",
            dscCreator: "Adobe Illustrator(R) 22.1",
            xmpCreatorTool: "Adobe Illustrator CC 22.1 (Windows)",
            buildNumber: "Adobe Illustrator(R) 22.1.0 x312 R agm 4.67 ct 5.20",
            xmptk: "Adobe XMP Core 5.6-c143 79.161356, 2017/09/07-01:11:22        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2017": {
            shortVer: "21.1",
            fullVer: "21.1.0",
            dscCreator: "Adobe Illustrator(R) 21.1",
            xmpCreatorTool: "Adobe Illustrator CC 2017 (Windows)",
            buildNumber: "Adobe Illustrator(R) 21.1.0 x326 R agm 4.62 ct 5.10",
            xmptk: "Adobe XMP Core 5.6-c137 79.159768, 2016/08/11-13:24:42        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2016": {
            shortVer: "20.1",
            fullVer: "20.1.0",
            dscCreator: "Adobe Illustrator(R) 20.1",
            xmpCreatorTool: "Adobe Illustrator CC 2015.3 (Windows)",
            buildNumber: "Adobe Illustrator(R) 20.1.0 x174 R agm 4.58 ct 5.02",
            xmptk: "Adobe XMP Core 5.6-c132 79.159284, 2016/04/19-13:13:40        ",
            pdfProducer: "Adobe PDF library 15.00"
        },
        "2015": {
            shortVer: "19.2",
            fullVer: "19.2.1",
            dscCreator: "Adobe Illustrator(R) 19.2",
            xmpCreatorTool: "Adobe Illustrator CC 2015 (Windows)",
            buildNumber: "Adobe Illustrator(R) 19.2.1 x147 R agm 4.55 ct 5.00",
            xmptk: "Adobe XMP Core 5.6-c067 79.157747, 2015/03/30-23:40:42        ",
            pdfProducer: "Adobe PDF library 15.00"
        }
    };
    return map[v] || map["2024"];
}

// Helper: Map Photoshop Year to Authentic Forensic Metadata Profile
export function getPhotoshopAuthenticMeta(versionYear) {
    const v = String(versionYear || "2024").trim();
    const map = {
        "2026": {
            softwareStr: "Adobe Photoshop 27.4 (Windows)",
            xmptk: "Adobe XMP Core 10.0-c000 1.000000, 0000/00/00-00:00:00        "
        },
        "2025": {
            softwareStr: "Adobe Photoshop 26.5 (Windows)",
            xmptk: "Adobe XMP Core 9.1-c002 79.a1cd12f, 2024/11/15-19:08:22        "
        },
        "2024": {
            softwareStr: "Adobe Photoshop 25.9 (Windows)",
            xmptk: "Adobe XMP Core 9.1-c002 79.f3a8c9b, 2024/03/12-14:22:10        "
        },
        "2023": {
            softwareStr: "Adobe Photoshop 24.7 (Windows)",
            xmptk: "Adobe XMP Core 9.0-c001 79.14ecb42, 2022/12/02-19:12:44        "
        },
        "2022": {
            softwareStr: "Adobe Photoshop 23.5 (Windows)",
            xmptk: "Adobe XMP Core 7.1-c000 79.b0f8be9, 2021/12/08-19:11:22        "
        },
        "2021": {
            softwareStr: "Adobe Photoshop 22.5 (Windows)",
            xmptk: "Adobe XMP Core 6.0-c006 79.dabacbb, 2021/04/14-00:39:44        "
        },
        "2020": {
            softwareStr: "Adobe Photoshop 21.2 (Windows)",
            xmptk: "Adobe XMP Core 6.0-c002 79.164488, 2020/07/10-22:06:53        "
        },
        "2019": {
            softwareStr: "Adobe Photoshop CC 2019 (Windows)",
            xmptk: "Adobe XMP Core 5.6-c145 79.163499, 2018/08/13-16:40:22        "
        },
        "2018": {
            softwareStr: "Adobe Photoshop CC 2018 (Windows)",
            xmptk: "Adobe XMP Core 5.6-c142 79.160924, 2017/07/13-01:06:39        "
        },
        "2017": {
            softwareStr: "Adobe Photoshop CC 2017 (Windows)",
            xmptk: "Adobe XMP Core 5.6-c138 79.159824, 2016/09/14-01:09:01        "
        },
        "2016": {
            softwareStr: "Adobe Photoshop CC 2015.5 (Windows)",
            xmptk: "Adobe XMP Core 5.6-c132 79.159284, 2016/04/19-13:13:40        "
        },
        "2015": {
            softwareStr: "Adobe Photoshop CC 2015 (Windows)",
            xmptk: "Adobe XMP Core 5.6-c067 79.157747, 2015/03/30-23:40:42        "
        }
    };
    return map[v] || map["2024"];
}

// Helper: Map Illustrator Year to Internal Major Version Number (e.g. 2024 -> 28.5)
export function getIllustratorMajorVersion(versionYear) {
    return getIllustratorAuthenticMeta(versionYear).shortVer;
}

// Helper: Map Software + Version Year (2015-2026) to exact commercial Adobe strings
export function getSoftwareString(software, version) {
    if (software === "Illustrator") {
        return getIllustratorAuthenticMeta(version).xmpCreatorTool;
    } else {
        return getPhotoshopAuthenticMeta(version).softwareStr;
    }
}

// Storage key helper
function getStorageKey() {
    return currentUser ? `fv_mc_profiles_${currentUser.uid}` : "fv_mc_profiles_guest";
}

// Load profiles from LocalStorage or Firestore
async function loadProfiles() {
    try {
        const local = localStorage.getItem(getStorageKey());
        if (local) {
            const parsed = JSON.parse(local);
            userProfiles = {
                profile_1: sanitizeProfile(parsed.profile_1, "profile_1"),
                profile_2: sanitizeProfile(parsed.profile_2, "profile_2"),
                profile_3: sanitizeProfile(parsed.profile_3, "profile_3")
            };
        } else {
            userProfiles = { ...DEFAULT_PROFILES };
        }
    } catch (e) {
        userProfiles = { ...DEFAULT_PROFILES };
    }

    if (currentUser && db) {
        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            const snap = await getDoc(userDocRef);
            if (snap.exists() && snap.data().customProfiles) {
                const cloud = snap.data().customProfiles;
                userProfiles = {
                    profile_1: sanitizeProfile(cloud.profile_1, "profile_1"),
                    profile_2: sanitizeProfile(cloud.profile_2, "profile_2"),
                    profile_3: sanitizeProfile(cloud.profile_3, "profile_3")
                };
                localStorage.setItem(getStorageKey(), JSON.stringify(userProfiles));
            } else {
                await setDoc(userDocRef, { customProfiles: userProfiles }, { merge: true });
            }
        } catch (err) {
            console.warn("[MetaCleaner Auth] Firestore read error:", err);
        }
    }

    renderWorkspaceProfileButtons();
}

// Save profiles to LocalStorage & Firestore
export async function saveProfiles(newProfiles) {
    userProfiles = { ...newProfiles };
    
    try {
        localStorage.setItem(getStorageKey(), JSON.stringify(userProfiles));
    } catch (e) {}

    if (currentUser && db) {
        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            await setDoc(userDocRef, { customProfiles: userProfiles }, { merge: true });
        } catch (err) {
            console.warn("[MetaCleaner Auth] Firestore save error:", err);
        }
    }

    renderWorkspaceProfileButtons();
    updateModalFormFields(activeTab);
}

// Render the 3 profile action buttons in Workspace
export function renderWorkspaceProfileButtons() {
    const container = document.getElementById("customProfilesButtons");
    if (!container) return;

    let html = "";
    ["profile_1", "profile_2", "profile_3"].forEach((key, idx) => {
        const prof = userProfiles[key] || DEFAULT_PROFILES[key];
        const isConfigured = Boolean(prof && prof.configured && prof.name && prof.name.trim());

        if (isConfigured) {
            const shortName = prof.name.trim();
            const psVer = prof.psVersion || prof.version || "2024";
            const aiVer = prof.aiVersion || prof.version || "2024";
            const osShort = (prof.os || "Windows 11") === "Windows 11" ? "Win11" : "Win10";
            const titleDesc = `${shortName}: Photoshop ${psVer} (Raster) + Illustrator ${aiVer} (Vector, Owner: ${shortName}) on ${prof.os || 'Windows 11'}`;

            html += `
                <button class="btn btn-preset btn-profile-apply" id="btn-apply-${key}" data-profile="${key}" data-configured="true" title="${escapeHtml(titleDesc)}">
                    <i class='bx bx-devices'></i>
                    <span class="btn-prof-title">${escapeHtml(shortName)}</span>
                    <span class="btn-prof-badge">PS${psVer} • AI${aiVer} • ${osShort}</span>
                </button>
            `;
        } else {
            html += `
                <button class="btn btn-preset btn-profile-empty" id="btn-apply-${key}" data-profile="${key}" data-configured="false" title="Profile ${idx + 1} is empty. Click to configure PC / Owner Name.">
                    <i class='bx bx-plus-circle' style="color: var(--accent-primary);"></i>
                    <span class="btn-prof-title">Profile ${idx + 1}</span>
                    <span class="btn-prof-badge" style="color: var(--accent-primary); font-weight: 600;">+ Configure</span>
                </button>
            `;
        }
    });

    container.innerHTML = html;

    ["profile_1", "profile_2", "profile_3"].forEach((key) => {
        const btn = document.getElementById(`btn-apply-${key}`);
        if (btn) {
            btn.addEventListener("click", async function() {
                const isConf = this.getAttribute("data-configured") === "true";
                if (!isConf) {
                    openProfilesModal(key);
                    return;
                }
                if (window.processFiles) {
                    const originalHtml = this.innerHTML;
                    this.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Applying...`;
                    await window.processFiles(`CUSTOM_${key.toUpperCase()}`);
                    this.innerHTML = originalHtml;
                }
            });
        }
    });
}

// Record/Update user in Firestore upon login
async function recordUserLogin(user) {
    if (!db || !user) return;
    try {
        const userDocRef = doc(db, "users", user.uid);
        const snap = await getDoc(userDocRef);
        const isAdmin = ADMIN_EMAILS.includes(user.email);

        const userData = {
            uid: user.uid,
            displayName: user.displayName || "Unknown Contributor",
            email: user.email,
            photoURL: user.photoURL || "",
            lastLogin: serverTimestamp(),
            lastLoginFormatted: new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" }),
            role: isAdmin ? "admin" : "user",
            app: "metacleaner-pro"
        };

        if (!snap.exists()) {
            userData.createdAt = serverTimestamp();
            userData.createdAtFormatted = new Date().toLocaleString("en-US", { timeZone: "Asia/Dhaka" });
            userData.customProfiles = userProfiles;
            userData.cleanCount = 0;
        }

        await setDoc(userDocRef, userData, { merge: true });

        // Telegram Login Alert
        if (window.triggerLoginAlert && !sessionStorage.getItem("fv_mc_login_alert_" + user.uid)) {
            sessionStorage.setItem("fv_mc_login_alert_" + user.uid, "1");
            window.triggerLoginAlert(user);
        }
    } catch (e) {
        console.error("[MetaCleaner Auth] Error recording user login:", e);
    }
}

// Admin Panel: Load all registered users
async function loadAdminUsers() {
    const tableBody = document.getElementById("adminUsersTableBody");
    const countEl = document.getElementById("adminTotalUsersCount");
    const adminCountEl = document.getElementById("adminTotalAdminsCount");
    if (!tableBody) return;

    tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem;"><i class='bx bx-loader-alt bx-spin' style="font-size: 1.8rem; color: var(--accent-primary);"></i><br>Loading registered users...</td></tr>`;

    if (!db) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--danger);">Database connection unavailable.</td></tr>`;
        return;
    }

    try {
        const snap = await getDocs(collection(db, "users"));
        allUsersList = [];
        let adminCount = 0;

        snap.forEach(docSnap => {
            const data = docSnap.data();
            allUsersList.push({ id: docSnap.id, ...data });
            if (ADMIN_EMAILS.includes(data.email) || data.role === "admin") {
                adminCount++;
            }
        });

        // Sort by last login (newest first)
        allUsersList.sort((a, b) => {
            const timeA = a.lastLogin && a.lastLogin.toMillis ? a.lastLogin.toMillis() : 0;
            const timeB = b.lastLogin && b.lastLogin.toMillis ? b.lastLogin.toMillis() : 0;
            return timeB - timeA;
        });

        if (countEl) countEl.textContent = allUsersList.length;
        if (adminCountEl) adminCountEl.textContent = adminCount;

        renderAdminUsersTable(allUsersList);
    } catch (err) {
        console.error("[MetaCleaner Admin] Error loading users:", err);
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--danger); padding: 2rem;">Error loading users: ${escapeHtml(err.message)}</td></tr>`;
    }
}

function renderAdminUsersTable(users) {
    const tableBody = document.getElementById("adminUsersTableBody");
    if (!tableBody) return;

    if (users.length === 0) {
        tableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; padding: 2rem; color: var(--text-muted);">No users found.</td></tr>`;
        return;
    }

    let rows = "";
    users.forEach(u => {
        const isAdmin = ADMIN_EMAILS.includes(u.email) || u.role === "admin";
        const avatar = u.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(u.displayName || 'User')}&background=9e552f&color=fff`;
        const lastActive = u.lastLoginFormatted || (u.lastLogin && u.lastLogin.toDate ? u.lastLogin.toDate().toLocaleString() : 'Recent');

        // Summarize profiles
        let profilesSummary = "Default (3 Profiles)";
        if (u.customProfiles) {
            const p1 = u.customProfiles.profile_1;
            const p2 = u.customProfiles.profile_2;
            const p1Str = p1 ? `PC1: PS${p1.psVersion || p1.version || '2024'}/AI${p1.aiVersion || p1.version || '2024'}` : "";
            const p2Str = p2 ? `PC2: PS${p2.psVersion || p2.version || '2023'}/AI${p2.aiVersion || p2.version || '2023'}` : "";
            profilesSummary = [p1Str, p2Str].filter(Boolean).join(" • ") || "Configured";
        }

        rows += `
            <tr>
                <td>
                    <div style="display: flex; align-items: center; gap: 10px;">
                        <img src="${avatar}" class="admin-table-avatar" alt="Avatar">
                        <div>
                            <strong>${escapeHtml(u.displayName || 'Unknown')}</strong>
                        </div>
                    </div>
                </td>
                <td><code>${escapeHtml(u.email || 'N/A')}</code></td>
                <td><span style="font-size: 0.8rem; color: var(--text-secondary);">${escapeHtml(lastActive)}</span></td>
                <td><span style="font-size: 0.78rem; color: var(--accent-primary); font-weight: 500;">${escapeHtml(profilesSummary)}</span></td>
                <td>
                    <span class="role-badge ${isAdmin ? 'badge-admin' : 'badge-user'}">
                        ${isAdmin ? '⭐ Admin' : 'Contributor'}
                    </span>
                </td>
            </tr>
        `;
    });

    tableBody.innerHTML = rows;
}

// UI: Update Profile Modal Form Fields when tab changes
function updateModalTabs() {
    ["profile_1", "profile_2", "profile_3"].forEach((key, idx) => {
        const btn = document.querySelector(`.profile-tab-btn[data-tab="${key}"]`);
        if (btn) {
            const p = userProfiles[key];
            const isConf = Boolean(p && p.configured && p.name && p.name.trim());
            const icon = isConf ? "bx-desktop" : "bx-plus-circle";
            const label = isConf ? p.name.trim() : `Profile ${idx + 1} (Empty)`;
            btn.innerHTML = `<i class='bx ${icon}'></i> ${escapeHtml(label)}`;
        }
    });
}

function updateModalFormFields(tabKey) {
    activeTab = tabKey;
    const prof = userProfiles[tabKey] || DEFAULT_PROFILES[tabKey];

    const nameInput = document.getElementById("profNameInput");
    const osSelect = document.getElementById("profOsSelect");
    const psSelect = document.getElementById("profPsVersionSelect");
    const aiSelect = document.getElementById("profAiVersionSelect");
    const previewEl = document.getElementById("profOutputPreview");

    const nameVal = (prof && prof.name) ? prof.name.trim() : "";
    const psVer = prof.psVersion || prof.version || "2024";
    const aiVer = prof.aiVersion || prof.version || "2024";
    const osVal = prof.os || "Windows 11";

    if (nameInput) nameInput.value = nameVal;
    if (osSelect) osSelect.value = osVal;
    if (psSelect) psSelect.value = psVer;
    if (aiSelect) aiSelect.value = aiVer;

    updateModalPreview(nameVal, psVer, aiVer, osVal);
    updateModalTabs();

    document.querySelectorAll(".profile-tab-btn").forEach(btn => {
        if (btn.getAttribute("data-tab") === tabKey) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

function updateModalPreview(nameVal, psVer, aiVer, osVal) {
    const previewEl = document.getElementById("profOutputPreview");
    if (!previewEl) return;

    if (!nameVal) {
        previewEl.innerHTML = `
            <div style="color: var(--text-muted); font-size: 0.82rem; font-style: italic; display: flex; align-items: center; gap: 6px;">
                <i class='bx bx-info-circle' style="color: var(--accent-primary); font-size: 1.1rem;"></i>
                <span>This profile slot is currently empty. Enter your PC / Owner Name above to activate it.</span>
            </div>
        `;
    } else {
        const psMeta = getPhotoshopAuthenticMeta(psVer);
        const aiMeta = getIllustratorAuthenticMeta(aiVer);
        previewEl.innerHTML = `
            <div style="display: flex; flex-direction: column; gap: 6px;">
                <div><i class='bx bx-user-check' style="color: var(--accent-primary);"></i> <strong>Vector Owner (%%For) / EXIF Artist:</strong> <code>${escapeHtml(nameVal)}</code></div>
                <div><i class='bx bx-image' style="color: var(--accent-primary);"></i> <strong>Raster (JPG/PNG/WebP):</strong> <code>${escapeHtml(psMeta.softwareStr)}</code> on <code>${escapeHtml(osVal)}</code></div>
                <div><i class='bx bx-vector' style="color: var(--accent-secondary);"></i> <strong>Vector DSC &amp; Build:</strong> <code>${escapeHtml(aiMeta.dscCreator)}</code> • <code>v${escapeHtml(aiMeta.fullVer)}</code></div>
                <div><i class='bx bx-code-alt' style="color: var(--accent-secondary);"></i> <strong>Vector XMP CreatorTool:</strong> <code>${escapeHtml(aiMeta.xmpCreatorTool)}</code></div>
            </div>
        `;
    }
}

function readModalFormFields() {
    const nameInput = document.getElementById("profNameInput");
    const osSelect = document.getElementById("profOsSelect");
    const psSelect = document.getElementById("profPsVersionSelect");
    const aiSelect = document.getElementById("profAiVersionSelect");

    const enteredName = nameInput ? nameInput.value.trim() : "";
    const isConfigured = Boolean(enteredName);
    const psVer = psSelect ? psSelect.value : "2024";
    const aiVer = aiSelect ? aiSelect.value : "2024";
    const osVal = osSelect ? osSelect.value : "Windows 11";

    return {
        id: activeTab,
        name: enteredName,
        os: osVal,
        psVersion: psVer,
        aiVersion: aiVer,
        configured: isConfigured,
        software: "Photoshop & Illustrator",
        version: `${psVer}/${aiVer}`
    };
}

export function openProfilesModal(tabKey = "profile_1") {
    const profilesModal = document.getElementById("profilesModal");
    if (profilesModal) {
        updateModalFormFields(tabKey);
        profilesModal.style.display = "flex";
        setTimeout(() => {
            const nameInput = document.getElementById("profNameInput");
            if (nameInput) nameInput.focus();
        }, 120);
    }
}
window.openProfilesModal = openProfilesModal;

// Setup Event Listeners
function setupEvents() {
    const handleGoogleLogin = async () => {
        try {
            if (!auth) throw new Error("Auth service unavailable");
            await signInWithPopup(auth, provider);
        } catch (err) {
            console.error("[MetaCleaner Auth] Login error:", err);
            if (err.code === "auth/unauthorized-domain") {
                alert("Firebase Error: Please add metadatacleaner-gg.vercel.app to Firebase Console -> Authentication -> Authorized Domains.");
            } else {
                alert("Google Sign-In failed: " + (err.message || "Please try again."));
            }
        }
    };

    const googleLoginBtn = document.getElementById("googleLoginBtn");
    const loginWallGoogleBtn = document.getElementById("loginWallGoogleBtn");

    if (googleLoginBtn) googleLoginBtn.addEventListener("click", handleGoogleLogin);
    if (loginWallGoogleBtn) loginWallGoogleBtn.addEventListener("click", handleGoogleLogin);

    // Logout
    const googleLogoutBtn = document.getElementById("googleLogoutBtn");
    if (googleLogoutBtn && auth) {
        googleLogoutBtn.addEventListener("click", () => {
            signOut(auth);
        });
    }

    // Profiles Modal
    const openProfilesModalBtn = document.getElementById("openProfilesModalBtn");
    const btnEditProfiles = document.getElementById("btn-edit-profiles");
    const profilesModal = document.getElementById("profilesModal");
    const closeProfilesModalBtn = document.getElementById("closeProfilesModalBtn");

    const openModal = () => {
        if (profilesModal) {
            updateModalFormFields(activeTab);
            profilesModal.style.display = "flex";
        }
    };

    if (openProfilesModalBtn) openProfilesModalBtn.addEventListener("click", openModal);
    if (btnEditProfiles) btnEditProfiles.addEventListener("click", openModal);

    if (closeProfilesModalBtn && profilesModal) {
        closeProfilesModalBtn.addEventListener("click", () => {
            profilesModal.style.display = "none";
        });
    }

    if (profilesModal) {
        profilesModal.addEventListener("click", (e) => {
            if (e.target === profilesModal) profilesModal.style.display = "none";
        });
    }

    // Profile Tabs
    document.querySelectorAll(".profile-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            userProfiles[activeTab] = readModalFormFields();
            const targetTab = btn.getAttribute("data-tab");
            updateModalFormFields(targetTab);
        });
    });

    const inputs = ["profNameInput", "profOsSelect", "profPsVersionSelect", "profAiVersionSelect"];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", () => {
                const currentData = readModalFormFields();
                userProfiles[activeTab] = currentData;
                updateModalPreview(currentData.name, currentData.psVersion, currentData.aiVersion, currentData.os);
                updateModalTabs();
            });
        }
    });

    // Reset / Clear Current Profile Button
    const resetCurrentProfileBtn = document.getElementById("resetCurrentProfileBtn");
    if (resetCurrentProfileBtn) {
        resetCurrentProfileBtn.addEventListener("click", async () => {
            const slotNum = activeTab.replace('profile_', '');
            if (confirm(`Are you sure you want to clear Profile ${slotNum}?`)) {
                userProfiles[activeTab] = {
                    id: activeTab,
                    name: "",
                    psVersion: "2024",
                    aiVersion: "2024",
                    os: "Windows 11",
                    configured: false
                };
                await saveProfiles(userProfiles);
                updateModalFormFields(activeTab);
            }
        });
    }

    // Save Profiles Button
    const saveProfilesBtn = document.getElementById("saveProfilesBtn");
    if (saveProfilesBtn) {
        saveProfilesBtn.addEventListener("click", async () => {
            userProfiles[activeTab] = readModalFormFields();
            const originalHtml = saveProfilesBtn.innerHTML;
            saveProfilesBtn.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Saving...`;
            await saveProfiles(userProfiles);
            saveProfilesBtn.innerHTML = `<i class='bx bx-check'></i> Saved Successfully!`;
            setTimeout(() => {
                saveProfilesBtn.innerHTML = originalHtml;
                if (profilesModal) profilesModal.style.display = "none";
            }, 800);
        });
    }

    // Admin Panel Events
    const adminPanelBtn = document.getElementById("adminPanelBtn");
    const adminPanelModal = document.getElementById("adminPanelModal");
    const closeAdminPanelBtn = document.getElementById("closeAdminPanelBtn");
    const adminRefreshBtn = document.getElementById("adminRefreshBtn");
    const adminUserSearch = document.getElementById("adminUserSearch");

    if (adminPanelBtn && adminPanelModal) {
        adminPanelBtn.addEventListener("click", () => {
            adminPanelModal.style.display = "flex";
            loadAdminUsers();
        });
    }

    if (closeAdminPanelBtn && adminPanelModal) {
        closeAdminPanelBtn.addEventListener("click", () => {
            adminPanelModal.style.display = "none";
        });
    }

    if (adminPanelModal) {
        adminPanelModal.addEventListener("click", (e) => {
            if (e.target === adminPanelModal) adminPanelModal.style.display = "none";
        });
    }

    if (adminRefreshBtn) {
        adminRefreshBtn.addEventListener("click", () => {
            loadAdminUsers();
        });
    }

    if (adminUserSearch) {
        adminUserSearch.addEventListener("input", (e) => {
            const query = e.target.value.toLowerCase().trim();
            if (!query) {
                renderAdminUsersTable(allUsersList);
                return;
            }
            const filtered = allUsersList.filter(u => {
                const name = (u.displayName || "").toLowerCase();
                const email = (u.email || "").toLowerCase();
                return name.includes(query) || email.includes(query);
            });
            renderAdminUsersTable(filtered);
        });
    }
}

// Update Header User UI & Login Wall
function updateAuthUI(user) {
    currentUser = user;
    const loginWallOverlay = document.getElementById("loginWallOverlay");
    const mainApp = document.querySelector("main");
    const googleLoginBtn = document.getElementById("googleLoginBtn");
    const userProfileBar = document.getElementById("userProfileBar");
    const userAvatarImg = document.getElementById("userAvatarImg");
    const userNameText = document.getElementById("userNameText");
    const adminPanelBtn = document.getElementById("adminPanelBtn");
    const modalSyncStatus = document.getElementById("modalSyncStatus");

    if (user) {
        // Authenticated: Hide Login Wall, unlock app
        if (loginWallOverlay) loginWallOverlay.style.display = "none";
        if (mainApp) mainApp.style.filter = "none";
        if (googleLoginBtn) googleLoginBtn.style.display = "none";
        if (userProfileBar) userProfileBar.style.display = "flex";
        if (userAvatarImg) userAvatarImg.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=9e552f&color=fff`;
        if (userNameText) userNameText.textContent = user.displayName ? user.displayName.split(' ')[0] : 'User';

        // Check Admin privilege
        const isAdmin = ADMIN_EMAILS.includes(user.email);
        if (adminPanelBtn) {
            adminPanelBtn.style.display = isAdmin ? "inline-flex" : "none";
        }

        if (modalSyncStatus) {
            modalSyncStatus.innerHTML = `<i class='bx bxs-cloud-check' style="color: var(--success);"></i> Synced to Cloud: <code>${escapeHtml(user.email)}</code>`;
        }
    } else {
        // Not Authenticated: Strictly Lock App Behind Login Wall (No Offline)
        if (loginWallOverlay) loginWallOverlay.style.display = "flex";
        if (mainApp) mainApp.style.filter = "blur(4px)";
        if (googleLoginBtn) googleLoginBtn.style.display = "inline-flex";
        if (userProfileBar) userProfileBar.style.display = "none";
        if (adminPanelBtn) adminPanelBtn.style.display = "none";
        if (modalSyncStatus) {
            modalSyncStatus.innerHTML = `<i class='bx bx-lock-alt' style="color: var(--danger);"></i> Authentication required to sync profiles.`;
        }
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Global hooks for app.js
window.getCustomProfile = function(profileKey) {
    const key = (profileKey || "profile_1").toLowerCase();
    return userProfiles[key] || DEFAULT_PROFILES[key] || DEFAULT_PROFILES["profile_1"];
};

window.getSoftwareString = getSoftwareString;
window.getIllustratorMajorVersion = getIllustratorMajorVersion;
window.getIllustratorAuthenticMeta = getIllustratorAuthenticMeta;
window.getPhotoshopAuthenticMeta = getPhotoshopAuthenticMeta;

// Initialize on Load
(function init() {
    setupEvents();

    if (auth) {
        onAuthStateChanged(auth, async (user) => {
            updateAuthUI(user);
            if (user) {
                await recordUserLogin(user);
                await loadProfiles();
            }
        });
    } else {
        updateAuthUI(null);
    }
})();
