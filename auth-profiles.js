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

// Firebase Config (StockMetadata Hub)
const firebaseConfig = {
    apiKey: "AIzaSyAlNxUKHw_rh_fkfoJL1QBVjmdSdJTbKnM",
    authDomain: "stockmetadata-63e30.firebaseapp.com",
    projectId: "stockmetadata-63e30",
    storageBucket: "stockmetadata-63e30.firebasestorage.app",
    messagingSenderId: "316005330427",
    appId: "1:316005330427:web:fcbd9d228258fe2abe6f5e"
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

// Default 3 Profiles
const DEFAULT_PROFILES = {
    profile_1: {
        id: "profile_1",
        name: "PC 1 — Photoshop 2024",
        software: "Photoshop",
        version: "2024",
        os: "Windows 11"
    },
    profile_2: {
        id: "profile_2",
        name: "PC 2 — Illustrator 2023",
        software: "Illustrator",
        version: "2023",
        os: "Windows 10"
    },
    profile_3: {
        id: "profile_3",
        name: "PC 3 — Photoshop 2020",
        software: "Photoshop",
        version: "2020",
        os: "Windows 10"
    }
};

let userProfiles = { ...DEFAULT_PROFILES };
let activeTab = "profile_1";

// Helper: Map Software + Version Year (2015-2026) to exact commercial Adobe strings
export function getSoftwareString(software, version) {
    const v = String(version);
    if (software === "Illustrator") {
        const aiMap = {
            "2015": "Adobe Illustrator CC 2015 (Windows)",
            "2016": "Adobe Illustrator CC 2015.3 (Windows)",
            "2017": "Adobe Illustrator CC 2017 (Windows)",
            "2018": "Adobe Illustrator CC 2018 (Windows)",
            "2019": "Adobe Illustrator CC 2019 (Windows)",
            "2020": "Adobe Illustrator 24.0 (Windows)",
            "2021": "Adobe Illustrator 25.0 (Windows)",
            "2022": "Adobe Illustrator 26.0 (Windows)",
            "2023": "Adobe Illustrator 27.0 (Windows)",
            "2024": "Adobe Illustrator 28.0 (Windows)",
            "2025": "Adobe Illustrator 29.0 (Windows)",
            "2026": "Adobe Illustrator 30.0 (Windows)"
        };
        return aiMap[v] || `Adobe Illustrator ${v}.0 (Windows)`;
    } else {
        const psMap = {
            "2015": "Adobe Photoshop CC 2015 (Windows)",
            "2016": "Adobe Photoshop CC 2015.5 (Windows)",
            "2017": "Adobe Photoshop CC 2017 (Windows)",
            "2018": "Adobe Photoshop CC 2018 (Windows)",
            "2019": "Adobe Photoshop CC 2019 (Windows)",
            "2020": "Adobe Photoshop 21.0 (Windows)",
            "2021": "Adobe Photoshop 22.0 (Windows)",
            "2022": "Adobe Photoshop 23.0 (Windows)",
            "2023": "Adobe Photoshop 24.0 (Windows)",
            "2024": "Adobe Photoshop 25.0 (Windows)",
            "2025": "Adobe Photoshop 26.0 (Windows)",
            "2026": "Adobe Photoshop 27.0 (Windows)"
        };
        return psMap[v] || `Adobe Photoshop ${v}.0 (Windows)`;
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
            userProfiles = { ...DEFAULT_PROFILES, ...JSON.parse(local) };
        }
    } catch (e) {
        userProfiles = { ...DEFAULT_PROFILES };
    }

    if (currentUser && db) {
        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            const snap = await getDoc(userDocRef);
            if (snap.exists() && snap.data().customProfiles) {
                userProfiles = { ...DEFAULT_PROFILES, ...snap.data().customProfiles };
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
        const icon = prof.software === "Illustrator" ? "bx-vector" : "bx-image";
        const shortName = prof.name || `Profile ${idx + 1}`;
        const titleDesc = `${prof.software} ${prof.version} on ${prof.os}`;

        html += `
            <button class="btn btn-preset btn-profile-apply" id="btn-apply-${key}" data-profile="${key}" title="Apply: ${titleDesc}">
                <i class='bx ${icon}'></i>
                <span class="btn-prof-title">${escapeHtml(shortName)}</span>
                <span class="btn-prof-badge">${prof.version} • ${prof.os === 'Windows 11' ? 'Win11' : 'Win10'}</span>
            </button>
        `;
    });

    container.innerHTML = html;

    ["profile_1", "profile_2", "profile_3"].forEach((key) => {
        const btn = document.getElementById(`btn-apply-${key}`);
        if (btn && window.processFiles) {
            btn.addEventListener("click", async function() {
                const originalHtml = this.innerHTML;
                this.innerHTML = `<i class='bx bx-loader-alt bx-spin'></i> Applying...`;
                await window.processFiles(`CUSTOM_${key.toUpperCase()}`);
                this.innerHTML = originalHtml;
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
            const p1 = u.customProfiles.profile_1 ? `${u.customProfiles.profile_1.software} ${u.customProfiles.profile_1.version}` : "";
            const p2 = u.customProfiles.profile_2 ? `${u.customProfiles.profile_2.software} ${u.customProfiles.profile_2.version}` : "";
            profilesSummary = [p1, p2].filter(Boolean).join(" • ") || "Configured";
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
function updateModalFormFields(tabKey) {
    activeTab = tabKey;
    const prof = userProfiles[tabKey] || DEFAULT_PROFILES[tabKey];

    const nameInput = document.getElementById("profNameInput");
    const softwareSelect = document.getElementById("profSoftwareSelect");
    const versionSelect = document.getElementById("profVersionSelect");
    const osSelect = document.getElementById("profOsSelect");
    const previewEl = document.getElementById("profOutputPreview");

    if (nameInput) nameInput.value = prof.name || "";
    if (softwareSelect) softwareSelect.value = prof.software || "Photoshop";
    if (versionSelect) versionSelect.value = prof.version || "2024";
    if (osSelect) osSelect.value = prof.os || "Windows 11";

    if (previewEl) {
        const softwareFull = getSoftwareString(prof.software, prof.version);
        previewEl.innerHTML = `<strong>Output String:</strong> <code>${softwareFull}</code> • <strong>OS:</strong> <code>${prof.os}</code>`;
    }

    document.querySelectorAll(".profile-tab-btn").forEach(btn => {
        if (btn.getAttribute("data-tab") === tabKey) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

function readModalFormFields() {
    const nameInput = document.getElementById("profNameInput");
    const softwareSelect = document.getElementById("profSoftwareSelect");
    const versionSelect = document.getElementById("profVersionSelect");
    const osSelect = document.getElementById("profOsSelect");

    return {
        id: activeTab,
        name: (nameInput ? nameInput.value.trim() : "") || `Profile ${activeTab.replace('profile_', '')}`,
        software: softwareSelect ? softwareSelect.value : "Photoshop",
        version: versionSelect ? versionSelect.value : "2024",
        os: osSelect ? osSelect.value : "Windows 11"
    };
}

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

    const inputs = ["profNameInput", "profSoftwareSelect", "profVersionSelect", "profOsSelect"];
    inputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener("input", () => {
                const currentData = readModalFormFields();
                userProfiles[activeTab] = currentData;
                const previewEl = document.getElementById("profOutputPreview");
                if (previewEl) {
                    const softwareFull = getSoftwareString(currentData.software, currentData.version);
                    previewEl.innerHTML = `<strong>Output String:</strong> <code>${softwareFull}</code> • <strong>OS:</strong> <code>${currentData.os}</code>`;
                }
            });
        }
    });

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
