// ===================================================
// MetaCleaner Pro — Firebase Google Auth & 3 Multi-PC Profiles
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
    getDoc 
} from "https://www.gstatic.com/firebasejs/10.8.1/firebase-firestore.js";

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

// State
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
    // 1. Try local storage first
    try {
        const local = localStorage.getItem(getStorageKey());
        if (local) {
            userProfiles = { ...DEFAULT_PROFILES, ...JSON.parse(local) };
        }
    } catch (e) {
        userProfiles = { ...DEFAULT_PROFILES };
    }

    // 2. If logged in and Firestore db is ready, try loading from Firestore
    if (currentUser && db) {
        try {
            const userDocRef = doc(db, "users", currentUser.uid);
            const snap = await getDoc(userDocRef);
            if (snap.exists() && snap.data().customProfiles) {
                userProfiles = { ...DEFAULT_PROFILES, ...snap.data().customProfiles };
                localStorage.setItem(getStorageKey(), JSON.stringify(userProfiles));
            } else {
                // If cloud doc has no profiles yet, save current local profiles to cloud
                await setDoc(userDocRef, { customProfiles: userProfiles }, { merge: true });
            }
        } catch (err) {
            console.warn("[MetaCleaner Auth] Firestore read error (using local):", err);
        }
    }

    renderWorkspaceProfileButtons();
}

// Save profiles to LocalStorage & Firestore
export async function saveProfiles(newProfiles) {
    userProfiles = { ...newProfiles };
    
    // Save to local storage
    try {
        localStorage.setItem(getStorageKey(), JSON.stringify(userProfiles));
    } catch (e) {}

    // Save to Firestore if logged in
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

    // Attach click listeners to trigger batch processing with this profile
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

    // Update active tab buttons
    document.querySelectorAll(".profile-tab-btn").forEach(btn => {
        if (btn.getAttribute("data-tab") === tabKey) {
            btn.classList.add("active");
        } else {
            btn.classList.remove("active");
        }
    });
}

// Read current form values from modal
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
    // Google Sign-In
    const googleLoginBtn = document.getElementById("googleLoginBtn");
    if (googleLoginBtn && auth) {
        googleLoginBtn.addEventListener("click", async () => {
            try {
                await signInWithPopup(auth, provider);
            } catch (err) {
                console.error("[MetaCleaner Auth] Login error:", err);
                if (err.code === "auth/unauthorized-domain") {
                    alert("Firebase Notice: Please add this domain to Firebase Console -> Authentication -> Authorized Domains.");
                } else {
                    alert("Google Sign-In failed: " + (err.message || "Please try again."));
                }
            }
        });
    }

    // Sign Out
    const googleLogoutBtn = document.getElementById("googleLogoutBtn");
    if (googleLogoutBtn && auth) {
        googleLogoutBtn.addEventListener("click", () => {
            signOut(auth);
        });
    }

    // Open Profiles Modal
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

    // Close on background click
    if (profilesModal) {
        profilesModal.addEventListener("click", (e) => {
            if (e.target === profilesModal) profilesModal.style.display = "none";
        });
    }

    // Profile Tabs Switcher
    document.querySelectorAll(".profile-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            // Save current form into state before switching
            userProfiles[activeTab] = readModalFormFields();
            const targetTab = btn.getAttribute("data-tab");
            updateModalFormFields(targetTab);
        });
    });

    // Live preview update on field changes
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
}

// Update Header User UI
function updateAuthUI(user) {
    currentUser = user;
    const googleLoginBtn = document.getElementById("googleLoginBtn");
    const userProfileBar = document.getElementById("userProfileBar");
    const userAvatarImg = document.getElementById("userAvatarImg");
    const userNameText = document.getElementById("userNameText");
    const modalSyncStatus = document.getElementById("modalSyncStatus");

    if (user) {
        if (googleLoginBtn) googleLoginBtn.style.display = "none";
        if (userProfileBar) userProfileBar.style.display = "flex";
        if (userAvatarImg) userAvatarImg.src = user.photoURL || `https://ui-avatars.com/api/?name=${encodeURIComponent(user.displayName || 'User')}&background=9e552f&color=fff`;
        if (userNameText) userNameText.textContent = user.displayName ? user.displayName.split(' ')[0] : 'User';
        if (modalSyncStatus) {
            modalSyncStatus.innerHTML = `<i class='bx bxs-cloud-check' style="color: var(--success);"></i> Synced with Google Account (${user.email})`;
        }
    } else {
        if (googleLoginBtn) googleLoginBtn.style.display = "inline-flex";
        if (userProfileBar) userProfileBar.style.display = "none";
        if (modalSyncStatus) {
            modalSyncStatus.innerHTML = `<i class='bx bx-info-circle'></i> Saved locally in browser. <a href="#" id="modalSignInLink" style="color: var(--accent-primary); font-weight: 600;">Sign in with Google</a> to sync across PCs.`;
            const link = document.getElementById("modalSignInLink");
            if (link && auth) {
                link.addEventListener("click", (e) => {
                    e.preventDefault();
                    signInWithPopup(auth, provider);
                });
            }
        }
    }
}

function escapeHtml(str) {
    if (!str) return "";
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Global hook for app.js
window.getCustomProfile = function(profileKey) {
    const key = (profileKey || "profile_1").toLowerCase();
    return userProfiles[key] || DEFAULT_PROFILES[key] || DEFAULT_PROFILES["profile_1"];
};

window.getSoftwareString = getSoftwareString;

// Initialize on Load
(function init() {
    setupEvents();
    loadProfiles();

    if (auth) {
        onAuthStateChanged(auth, async (user) => {
            updateAuthUI(user);
            await loadProfiles();
        });
    } else {
        updateAuthUI(null);
    }
})();
