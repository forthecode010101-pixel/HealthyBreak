/* =========================================================
HEALTHY BREAK
========================================================= */

document.addEventListener("DOMContentLoaded", () => {

    "use strict";

    /* ===================== STORAGE ===================== */

    const STORAGE_KEY = "healthyBreakData";
    const LOGS_KEY = "healthyBreakLogs";
    const EXCEPTIONS_KEY = "healthyBreakScheduleExceptions";
    const TIMER_KEY = "healthyBreakTimer";

    const PLACEHOLDER_PATTERN = /^(enter your|select your)/i;
    const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const WEEK_ORDER = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
    const SHORT_DAYS = { Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday", Fri: "Friday", Sat: "Saturday", Sun: "Sunday" };

    const COURSE_INTENSITY = {
        BSN: 3, CEN: 3,
        BSA: 2, BSBio: 2, BSIT: 2, "BIT-CPT": 2, BSF: 2,
        BSBA: 1, BSED: 1, BEED: 1, BTLEd: 1, BTVTEd: 1, BAComm: 1, BSHM: 1, BPA: 1, BSFAS: 1
    };

    const defaultData = {
        profile: { nickname: "", yearLevel: "", course: "", school: "" },
        subjects: [],
        schedules: { Monday: [], Tuesday: [], Wednesday: [], Thursday: [], Friday: [], Saturday: [], Sunday: [] },
        stats: { studyMinutes: 0, breakMinutes: 0, studySessions: 0, breaksToday: 0, streak: 0, lastStudyDate: "", lastBreakDate: "" },
        streak: { best: 0, history: [] },
        subjectProgress: {},
        notes: [],
        activityCount: 0,
        settings: { theme: "dark", notifications: true, autoSave: true, autoStartBreak: true, sound: true },
        logo: "",
        onboardingComplete: false
    };

    const clone = value => JSON.parse(JSON.stringify(value));
    const pad = value => String(value).padStart(2, "0");
    const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
    const roundTo = (value, step) => Math.round(value / step) * step;
    const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

    function readJSON(key, fallback) {
        try {
            const raw = localStorage.getItem(key);
            if (raw === null) return fallback;
            const parsed = JSON.parse(raw);
            return parsed === null || parsed === undefined ? fallback : parsed;
        } catch {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
            return true;
        } catch (error) {
            console.error("HealthyBreak: could not write", key, error);
            return false;
        }
    }

    function removeKey(key) {
        try { localStorage.removeItem(key); } catch { /* ignore */ }
    }

    function mergeData(base, saved) {

        if (!saved || typeof saved !== "object" || Array.isArray(saved)) return base;

        const object = value => (value && typeof value === "object" && !Array.isArray(value) ? value : {});

        return {
            ...base,
            ...saved,
            profile: { ...base.profile, ...object(saved.profile) },
            schedules: { ...base.schedules, ...object(saved.schedules) },
            stats: { ...base.stats, ...object(saved.stats) },
            streak: { ...base.streak, ...object(saved.streak) },
            settings: { ...base.settings, ...object(saved.settings) },
            subjectProgress: { ...base.subjectProgress, ...object(saved.subjectProgress) }
        };
    }

    function normalizeData(d) {

        ["nickname", "yearLevel", "course", "school"].forEach(key => {
            const value = String(d.profile[key] ?? "").trim();
            d.profile[key] = PLACEHOLDER_PATTERN.test(value) ? "" : value;
        });

        d.subjects = (Array.isArray(d.subjects) ? d.subjects : [])
            .filter(subject => subject && typeof subject.name === "string" && subject.name.trim())
            .map(subject => ({
                id: subject.id ?? uid(),
                name: subject.name.trim(),
                goalMinutes: Number(subject.goalMinutes) > 0 ? Number(subject.goalMinutes) : 120,
                minutes: Number(subject.minutes) || 0
            }));

        WEEK_ORDER.forEach(day => {
            const list = Array.isArray(d.schedules[day]) ? d.schedules[day] : [];
            d.schedules[day] = list
                .filter(entry => entry && typeof entry === "object")
                .map(entry => ({
                    id: entry.id ?? uid(),
                    day,
                    subject: String(entry.subject ?? ""),
                    start: entry.start || "08:00",
                    end: entry.end || "09:00",
                    type: entry.type || "Class",
                    date: typeof entry.date === "string" ? entry.date : ""
                }));
        });

        if (!Array.isArray(d.notes)) d.notes = [];
        d.activityCount = Number(d.activityCount) || 0;
        d.streak.best = Number(d.streak.best) || 0;
        d.streak.history = Array.isArray(d.streak.history) ? d.streak.history : [];

        const dates = new Set(d.streak.history.filter(item => /^\d{4}-\d{2}-\d{2}$/.test(String(item))));
        getLogs().forEach(log => {
            if (log.type === "study" && /^\d{4}-\d{2}-\d{2}$/.test(String(log.date))) dates.add(log.date);
        });
        if (/^\d{4}-\d{2}-\d{2}$/.test(String(d.stats.lastStudyDate))) dates.add(d.stats.lastStudyDate);
        d.streak.history = [...dates].sort();

        return d;
    }

    function hydrateData(raw) {
        return normalizeData(mergeData(clone(defaultData), raw));
    }

    let data = hydrateData(readJSON(STORAGE_KEY, null));

    let currentOnboardingStep = 1;
    let currentScheduleDay = "Monday";
    let currentSelectedSubject = null;
    let editingScheduleId = null;

    function saveData() {
        return writeJSON(STORAGE_KEY, data);
    }

    /* ===================== DOM HELPERS ===================== */

    const $ = (selector, parent = document) => parent.querySelector(selector);
    const $$ = (selector, parent = document) => Array.from(parent.querySelectorAll(selector));

    function createElement(tag, className = "", text = "") {
        const element = document.createElement(tag);
        if (className) element.className = className;
        if (text !== "") element.textContent = text;
        return element;
    }

    function escapeHTML(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }

    function setText(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = value;
    }

    function setSelectValue(select, value) {
        if (select && value && Array.from(select.options).some(option => option.value === value)) {
            select.value = value;
        }
    }

    function assignRuntimeIds() {

        const groups = [
            ["#page-home .stat-card", ["todayStreak", "todayProgress", "todayStudyTime", "todayBreaks"]],
            ["#page-progress .stat-card", ["progressStudyTime", "progressBreakTime", "progressStudySessions", "progressWellnessBalance"]]
        ];

        groups.forEach(([selector, ids]) => {
            $$(selector).forEach((card, index) => {
                const strong = $("strong", card);
                if (strong && ids[index] && !document.getElementById(ids[index])) strong.id = ids[index];
            });
        });

        const assign = (selector, id) => {
            const element = $(selector);
            if (element && !element.id) element.id = id;
        };

        assign(".quick-card .white-action", "addQuickNote");
        assign(".selected-actions .white-action", "editSelectedSubject");
        assign(".selected-actions .purple-action", "startSelectedSubject");
    }

    /* ===================== TOAST ===================== */

    function showToast(message, duration = 2500) {

        let toast = $("#toast");

        if (!toast) {
            toast = createElement("div", "toast");
            toast.id = "toast";
            document.body.appendChild(toast);
        }

        toast.textContent = message;
        toast.classList.add("show");
        clearTimeout(toast._timeout);
        toast._timeout = setTimeout(() => toast.classList.remove("show"), duration);
    }

    /* ===================== DATE HELPERS ===================== */

    function dateKey(date = new Date()) {
        return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    }

    function parseKey(key) {
        const [year, month, day] = String(key).split("-").map(Number);
        return new Date(year, (month || 1) - 1, day || 1);
    }

    function dayNameOf(date) {
        return DAY_NAMES[date.getDay()];
    }

    function addDays(date, amount) {
        const result = new Date(date.getFullYear(), date.getMonth(), date.getDate());
        result.setDate(result.getDate() + amount);
        return result;
    }

    function weekStart(date = new Date()) {
        return addDays(date, -((date.getDay() + 6) % 7));
    }

    function nextDateForDay(dayName) {
        const today = new Date();
        for (let i = 0; i < 7; i++) {
            const candidate = addDays(today, i);
            if (dayNameOf(candidate) === dayName) return candidate;
        }
        return today;
    }

    function timeToMinutes(time) {
        const [hours, minutes] = String(time).split(":").map(Number);
        return (hours || 0) * 60 + (minutes || 0);
    }

    function minutesToTime(total) {
        return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
    }

    function formatMinutes(minutes) {

        minutes = Math.max(0, Math.round(Number(minutes) || 0));

        if (minutes < 60) return `${minutes}m`;

        const hours = Math.floor(minutes / 60);
        const remaining = minutes % 60;

        return remaining === 0 ? `${hours}h` : `${hours}h ${remaining}m`;
    }

    function formatTime(seconds) {

        seconds = Math.max(0, Math.floor(seconds));

        const hours = Math.floor(seconds / 3600);
        const minutes = Math.floor((seconds % 3600) / 60);
        const secs = seconds % 60;

        return hours > 0
            ? `${pad(hours)}:${pad(minutes)}:${pad(secs)}`
            : `${pad(minutes)}:${pad(secs)}`;
    }

    const byStart = (a, b) => String(a.start).localeCompare(String(b.start));

    /* ===================== ACTIVITY LOGS ===================== */

    function getLogs() {
        const logs = readJSON(LOGS_KEY, []);
        return Array.isArray(logs) ? logs.filter(log => log && typeof log === "object") : [];
    }

    function addLog(type, minutes, label, sessionId) {

        const logs = getLogs();

        if (sessionId && logs.some(log => log.sessionId === sessionId)) return false;

        logs.push({
            id: uid(),
            sessionId,
            date: dateKey(),
            ts: Date.now(),
            type,
            minutes: Number(minutes) || 0,
            subject: label || ""
        });

        writeJSON(LOGS_KEY, logs);
        return true;
    }

    function sumMinutes(logs, type) {
        return logs.filter(log => log.type === type).reduce((total, log) => total + (Number(log.minutes) || 0), 0);
    }

    function studyMinutesOn(key) {
        return sumMinutes(getLogs().filter(log => log.date === key), "study");
    }

    function breakMinutesOn(key) {
        return sumMinutes(getLogs().filter(log => log.date === key), "break");
    }

    function breaksOn(key) {
        return getLogs().filter(log => log.date === key && log.type === "break").length;
    }

    function weeklyMinutes(subjectName) {
        const from = dateKey(weekStart());
        return getLogs()
            .filter(log => log.type === "study" && log.subject === subjectName && String(log.date) >= from)
            .reduce((total, log) => total + (Number(log.minutes) || 0), 0);
    }

    /* ===================== PROFILE ===================== */

    function getDisplayName() {
        return data.profile.nickname.trim() || "Student";
    }

    function updateGreeting() {

        const heading = $("#page-home h1");
        const node = heading && heading.firstChild;

        if (!node || node.nodeType !== Node.TEXT_NODE) return;

        const hour = new Date().getHours();
        const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

        node.nodeValue = `${greeting}, `;
    }

    function updateProfileUI() {

        const name = getDisplayName();

        setText("headerName", name);
        setText("welcomeName", name);
        updateGreeting();

        const userDetails = $(".user-details small");

        if (userDetails) {
            const line1 = [data.profile.yearLevel, data.profile.course].filter(Boolean).join(" • ");
            userDetails.innerHTML = line1 || data.profile.school
                ? `${escapeHTML(line1)}<br>${escapeHTML(data.profile.school)}`
                : "Complete your profile";
        }

        const nicknameInput = $("#settingsNickname");

        if (nicknameInput && document.activeElement !== nicknameInput) {
            nicknameInput.value = data.profile.nickname;
        }

        updateSettingsSelects();
        updateLogoUI();
    }

    function updateSettingsSelects() {

        if (["settingsYearLevel", "settingsCourse", "settingsSchool"].some(id => document.activeElement === document.getElementById(id))) return;

        setSelectValue($("#settingsYearLevel"), data.profile.yearLevel);
        setSelectValue($("#settingsCourse"), data.profile.course);
        setSelectValue($("#settingsSchool"), data.profile.school);
    }

    /* ===================== LOGO / AVATAR ===================== */

    function updateLogoUI() {

        if (!data.logo) return;

        const avatar = $(".user-avatar");

        if (avatar) {
            avatar.innerHTML = "";
            const image = document.createElement("img");
            image.src = data.logo;
            image.alt = "Profile";
            image.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:inherit;";
            avatar.appendChild(image);
        }

        const settingsAvatar = $(".settings-avatar");

        if (settingsAvatar) {
            let image = settingsAvatar.querySelector("img");
            if (!image) {
                image = document.createElement("img");
                settingsAvatar.prepend(image);
            }
            image.src = data.logo;
            image.alt = "Profile";
            image.style.cssText = "width:100%;height:100%;object-fit:cover;border-radius:50%;";
        }
    }

    function setupLogoUploader() {

        const avatar = $(".settings-avatar");

        if (!avatar) return;

        avatar.style.cursor = "pointer";
        avatar.title = "Click to change your profile image";

        avatar.addEventListener("click", () => {

            let input = $("#hiddenLogoInput");

            if (!input) {
                input = document.createElement("input");
                input.type = "file";
                input.id = "hiddenLogoInput";
                input.accept = "image/png,image/jpeg,image/webp";
                input.style.display = "none";
                document.body.appendChild(input);
                input.addEventListener("change", handleLogoChange);
            }

            input.click();
        });
    }

    function handleLogoChange(event) {

        const file = event.target.files && event.target.files[0];

        if (!file) return;

        if (!file.type.startsWith("image/")) {
            showToast("Please select an image file.");
            return;
        }

        const reader = new FileReader();

        reader.onload = () => {

            const previous = data.logo;
            data.logo = reader.result;

            if (!saveData()) {
                data.logo = previous;
                showToast("That image is too large to save offline.");
                return;
            }

            updateLogoUI();
            showToast("Profile image updated!");
        };

        reader.readAsDataURL(file);
        event.target.value = "";
    }

    /* ===================== ONBOARDING ===================== */

    function showOnboardingStep(step) {

        step = clamp(Number(step), 1, 5);
        currentOnboardingStep = step;

        $$(".onboarding-panel").forEach(panel => {
            panel.classList.toggle("active", Number(panel.dataset.panel) === step);
        });

        $$(".step").forEach(element => {
            const number = Number(element.dataset.step);
            element.classList.toggle("active", number === step);
            element.classList.toggle("completed", number < step);
        });

        $$(".step-line").forEach((line, index) => line.classList.toggle("active", index < step - 1));

        window.scrollTo({ top: 0, behavior: "smooth" });
    }

    function validateOnboardingStep(step) {

        if (step === 2) {
            const nickname = $("#nickname") && $("#nickname").value.trim();
            if (!nickname) {
                showToast("Please enter your nickname.");
                $("#nickname")?.focus();
                return false;
            }
        }

        if (step === 3) {
            const names = $$("#subjectList .subject-input").map(input => input.value.trim()).filter(Boolean);
            if (names.length === 0) {
                showToast("Please add at least one subject.");
                return false;
            }
        }

        return true;
    }

    function renderOnboardingProfile() {

        const nickname = $("#nickname");

        if (nickname && !nickname.value) nickname.value = data.profile.nickname;

        setSelectValue($("#yearLevel"), data.profile.yearLevel);
        setSelectValue($("#course"), data.profile.course);
        setSelectValue($("#school"), data.profile.school);
    }

    function saveOnboardingProfile() {

        data.profile.nickname = ($("#nickname")?.value || "").trim();
        data.profile.yearLevel = $("#yearLevel")?.value || "";
        data.profile.course = $("#course")?.value || "";
        data.profile.school = $("#school")?.value || "";

        saveData();
        updateProfileUI();
    }

    function goToNextStep(nextStep) {

        const currentStep = currentOnboardingStep;

        if (!validateOnboardingStep(currentStep)) return;

        if (currentStep === 2) saveOnboardingProfile();
        if (currentStep === 3) collectSubjectsFromOnboarding();
        if (currentStep === 4) saveData();

        showOnboardingStep(nextStep);

        if (nextStep === 4) renderScheduleDay(currentScheduleDay);
        if (nextStep === 5) updateFinalSummary();
    }

    function updateFinalSummary() {

        const finalPanel = $(".final-panel");

        if (!finalPanel) return;

        let summary = finalPanel.querySelector(".setup-summary");

        if (!summary) {
            summary = createElement("div", "setup-summary");
            finalPanel.insertBefore(summary, finalPanel.querySelector("#dashboardButton"));
        }

        const count = data.subjects.length;

        summary.innerHTML = `
            <strong>${escapeHTML(getDisplayName())}</strong>
            <span>${escapeHTML([data.profile.yearLevel, data.profile.course].filter(Boolean).join(" • "))}</span>
            <span>${count} subject${count === 1 ? "" : "s"} added</span>
        `;
    }

    /* ===================== SUBJECTS ===================== */

    function addSubjectInput(name = "", focus = true) {

        const list = $("#subjectList");

        if (!list) return;

        const row = createElement("div", "subject-row");

        row.innerHTML = `
            <input type="text" class="subject-input" placeholder="Enter subject name" value="${escapeHTML(name)}" autocomplete="off">
            <button type="button" class="remove-subject" title="Remove subject">×</button>
        `;

        $(".remove-subject", row).addEventListener("click", () => {
            row.remove();
            showToast("Subject removed.");
        });

        list.appendChild(row);

        if (focus) $(".subject-input", row).focus();
    }

    function collectSubjectsFromOnboarding() {

        if (data.onboardingComplete) return;

        const result = [];

        $$("#subjectList .subject-input").forEach(input => {

            const name = input.value.trim();

            if (!name || result.some(subject => subject.name.toLowerCase() === name.toLowerCase())) return;

            const existing = data.subjects.find(subject => subject.name.toLowerCase() === name.toLowerCase());

            result.push(existing || { id: uid(), name, goalMinutes: 120, minutes: 0 });
        });

        data.subjects = result;
        saveData();
    }

    function renderOnboardingSubjects() {

        const list = $("#subjectList");

        if (!list) return;

        list.innerHTML = "";
        data.subjects.forEach(subject => addSubjectInput(subject.name, false));
    }

    // Opens a clean in-app modal (instead of the browser prompt) to add a subject.
    function addSubjectFromDashboard() {

        const body = openGenericModal("Add Subject", "📚", `
            <p class="hb-modal-description" style="margin-bottom:16px;">
                Type the name of the subject you're currently taking.
            </p>

            <input
                type="text"
                id="hbSubjectInput"
                placeholder="Example: Mathematics, Programming..."
                autocomplete="off"
                maxlength="60"
                style="width:100%;margin-bottom:18px;"
            >

            <div class="hb-timer-actions">
                <button type="button" class="white-action" id="hbSubjectCancel">Cancel</button>
                <button type="button" class="green-action" id="hbSubjectSave">＋ Add Subject</button>
            </div>
        `, "addSubject");

        const input = $("#hbSubjectInput", body);

        const save = () => {

            const clean = input.value.trim();

            if (!clean) return showToast("Enter a subject name first.");

            if (data.subjects.some(subject => subject.name.toLowerCase() === clean.toLowerCase())) {
                return showToast("That subject already exists.");
            }

            data.subjects.push({ id: uid(), name: clean, goalMinutes: 120, minutes: 0 });
            currentSelectedSubject = clean;
            saveData();
            closeGenericModal();
            renderStudyPage();
            updateStatistics();
            showToast("Subject added!");
        };

        $("#hbSubjectSave", body).addEventListener("click", save);
        $("#hbSubjectCancel", body).addEventListener("click", closeGenericModal);

        input.addEventListener("keydown", event => {
            if (event.key === "Enter") save();
        });

        input.focus();
    }

    /* ===================== SCHEDULE ===================== */

    function normalizeDay(day) {
        return SHORT_DAYS[day] || day;
    }

    function getExceptions() {
        const all = readJSON(EXCEPTIONS_KEY, {});
        return all && typeof all === "object" && !Array.isArray(all) ? all : {};
    }

    function setException(key, id, value) {

        const all = getExceptions();

        all[key] = all[key] || {};

        if (value === null) delete all[key][id];
        else all[key][id] = value;

        if (Object.keys(all[key]).length === 0) delete all[key];

        writeJSON(EXCEPTIONS_KEY, all);
    }

    function purgeExceptions(id) {

        const all = getExceptions();

        Object.keys(all).forEach(key => {
            delete all[key][id];
            if (Object.keys(all[key]).length === 0) delete all[key];
        });

        writeJSON(EXCEPTIONS_KEY, all);
    }

    function findEntry(id) {

        for (const day of WEEK_ORDER) {
            const entry = (data.schedules[day] || []).find(item => String(item.id) === String(id));
            if (entry) return { entry, day };
        }

        return null;
    }

    function occurrencesOn(date, includeCancelled = false) {

        const key = dateKey(date);
        const exceptions = getExceptions()[key] || {};

        return (data.schedules[dayNameOf(date)] || [])
            .filter(entry => !entry.date || entry.date === key)
            .map(entry => {
                const exception = exceptions[entry.id] || {};
                return {
                    ...entry,
                    start: exception.start || entry.start,
                    end: exception.end || entry.end,
                    cancelled: Boolean(exception.cancel),
                    moved: Boolean(exception.start)
                };
            })
            .filter(entry => includeCancelled || !entry.cancelled);
    }

    function saveScheduleEntry(item) {

        const found = findEntry(item.id);

        if (found) {
            data.schedules[found.day] = data.schedules[found.day].filter(entry => String(entry.id) !== String(item.id));
        }

        data.schedules[item.day].push(item);
    }

    function deleteScheduleEntry(id) {

        const found = findEntry(id);

        if (!found) return;

        if (!found.entry.date && !window.confirm("Delete this schedule permanently? It will be removed from every week. To skip only today, use the skip button instead.")) {
            return;
        }

        data.schedules[found.day] = data.schedules[found.day].filter(entry => String(entry.id) !== String(id));
        purgeExceptions(id);

        if (String(editingScheduleId) === String(id)) editingScheduleId = null;

        afterScheduleChange();
        showToast("Schedule deleted permanently.");
    }

    function skipToday(id) {
        setException(dateKey(), id, { cancel: true });
        afterScheduleChange();
        showToast("Skipped for today only. It will return on its next normal day.");
    }

    function restoreToday(id) {
        setException(dateKey(), id, null);
        afterScheduleChange();
        showToast("Restored for today.");
    }

    function postponeToday(id) {

        const found = findEntry(id);

        if (!found) return;

        const start = timeToMinutes(found.entry.start) + 30;
        const end = timeToMinutes(found.entry.end) + 30;

        if (end >= 1440) {
            showToast("Too late in the day to postpone this.");
            return;
        }

        setException(dateKey(), id, { start: minutesToTime(start), end: minutesToTime(end) });
        afterScheduleChange();
        showToast("Postponed by 30 minutes for today only.");
    }

    function afterScheduleChange() {

        saveData();
        renderScheduleDay(currentScheduleDay);
        renderScheduleManager();

        if (data.onboardingComplete) {
            renderTodaySchedule();
            renderStudyPage();
        }
    }

    function onScheduleAction(event) {

        const button = event.target.closest("[data-act]");
        const row = button && button.closest("[data-id]");

        if (!button || !row) return;

        const id = row.dataset.id;

        switch (button.dataset.act) {
            case "edit":
                editingScheduleId = id;
                afterScheduleChange();
                break;
            case "delete":
                deleteScheduleEntry(id);
                break;
            case "skip":
                skipToday(id);
                break;
            case "restore":
                restoreToday(id);
                break;
            case "postpone":
                postponeToday(id);
                break;
        }
    }

    function createScheduleRow(entry, manager = false) {

        const row = createElement("div", "schedule-row");
        row.dataset.id = entry.id;

        const todayKey = dateKey();
        const occursToday = entry.day === dayNameOf(new Date()) && (!entry.date || entry.date === todayKey);
        const cancelledToday = occursToday && Boolean((getExceptions()[todayKey] || {})[entry.id]?.cancel);
        const repeat = entry.date ? `One-time · ${entry.date}` : "Every week";

        let todayActions = "";

        if (manager && occursToday) {
            todayActions = cancelledToday
                ? `<button type="button" class="schedule-delete" data-act="restore" title="Restore for today">↩</button>`
                : `<button type="button" class="schedule-delete" data-act="skip" title="Skip today only">⏭</button>
                   <button type="button" class="schedule-delete" data-act="postpone" title="Postpone today by 30 minutes">⏱</button>`;
        }

        row.innerHTML = `
            <div class="schedule-time">
                <strong>${escapeHTML(entry.start)}</strong>
                <span>${escapeHTML(entry.end)}</span>
            </div>
            <div class="schedule-info">
                <strong>${escapeHTML(entry.subject || "Untitled")}</strong>
                <small>${escapeHTML(entry.type || "Class")} · ${escapeHTML(repeat)}${cancelledToday ? " · skipped today" : ""}</small>
            </div>
            <div class="schedule-actions">
                ${todayActions}
                <button type="button" class="schedule-delete" data-act="edit" title="Edit">✎</button>
                <button type="button" class="schedule-delete" data-act="delete" title="Delete permanently">×</button>
            </div>
        `;

        return row;
    }

    function buildScheduleForm(container) {

        const found = editingScheduleId ? findEntry(editingScheduleId) : null;
        const entry = found ? found.entry : null;

        if (editingScheduleId && !entry) editingScheduleId = null;

        const knownSubject = Boolean(entry && data.subjects.some(subject => subject.name === entry.subject));
        const dayValue = entry ? entry.day : currentScheduleDay;
        const form = createElement("div", "schedule-add-form");

        form.innerHTML = `
            <div class="schedule-form-title">${entry ? "✎ Edit Schedule" : "＋ Add Schedule"}</div>
            <div class="schedule-form-grid">
                <select class="schedule-subject">
                    <option value="">Choose subject</option>
                    ${data.subjects.map(subject => `<option value="${escapeHTML(subject.name)}">${escapeHTML(subject.name)}</option>`).join("")}
                </select>
                <input type="text" class="schedule-custom-subject" placeholder="Or type subject" value="${entry && !knownSubject ? escapeHTML(entry.subject) : ""}">
                <select class="schedule-type">
                    ${["Class", "Study", "Review", "Exam", "Activity"].map(type => `<option${entry && entry.type === type ? " selected" : ""}>${type}</option>`).join("")}
                </select>
                <select class="schedule-repeat">
                    <option value="weekly">Every week</option>
                    <option value="once"${entry && entry.date ? " selected" : ""}>One-time</option>
                </select>
                <select class="schedule-day">
                    ${WEEK_ORDER.map(day => `<option value="${day}"${day === dayValue ? " selected" : ""}>${day}</option>`).join("")}
                </select>
                <input type="date" class="schedule-date" value="${entry && entry.date ? entry.date : ""}">
                <input type="time" class="schedule-start" value="${entry ? escapeHTML(entry.start) : "08:00"}">
                <input type="time" class="schedule-end" value="${entry ? escapeHTML(entry.end) : "09:00"}">
                <button type="button" class="primary-button add-schedule-button">${entry ? "Save" : "Add"}</button>
                ${entry ? `<button type="button" class="white-action cancel-schedule-edit">Cancel</button>` : ""}
            </div>
        `;

        const subjectSelect = $(".schedule-subject", form);
        const customSubject = $(".schedule-custom-subject", form);
        const repeatSelect = $(".schedule-repeat", form);
        const daySelect = $(".schedule-day", form);
        const dateInput = $(".schedule-date", form);

        if (knownSubject) subjectSelect.value = entry.subject;

        const syncRepeat = () => {
            const once = repeatSelect.value === "once";
            dateInput.style.display = once ? "" : "none";
            daySelect.style.display = once ? "none" : "";
        };

        repeatSelect.addEventListener("change", syncRepeat);
        syncRepeat();

        $(".cancel-schedule-edit", form)?.addEventListener("click", () => {
            editingScheduleId = null;
            afterScheduleChange();
        });

        $(".add-schedule-button", form).addEventListener("click", () => {

            const subject = customSubject.value.trim() || subjectSelect.value.trim();
            const start = $(".schedule-start", form).value;
            const end = $(".schedule-end", form).value;
            const type = $(".schedule-type", form).value;

            if (!subject) return showToast("Enter or select a subject.");
            if (!start || !end) return showToast("Please select a start and end time.");
            if (end <= start) return showToast("End time must be after start time.");

            let day = daySelect.value;
            let date = "";

            if (repeatSelect.value === "once") {
                date = dateInput.value || dateKey(nextDateForDay(day));
                day = dayNameOf(parseKey(date));
            }

            const editing = Boolean(entry);

            saveScheduleEntry({ id: entry ? entry.id : uid(), day, subject, start, end, type, date });
            editingScheduleId = null;
            currentScheduleDay = day;
            afterScheduleChange();
            showToast(editing ? "Schedule updated!" : "Schedule added!");
        });

        container.appendChild(form);
    }

    function renderScheduleDay(day) {

        currentScheduleDay = normalizeDay(day);

        const scheduleList = $(".schedule-list");

        if (!scheduleList) return;

        scheduleList.innerHTML = "";

        const entries = data.schedules[currentScheduleDay] || [];

        if (entries.length === 0) {
            const empty = createElement("div", "schedule-empty");
            empty.innerHTML = `
                <div style="font-size:32px;">📅</div>
                <strong>No schedule yet</strong>
                <small>Add your class or study time below.</small>
            `;
            scheduleList.appendChild(empty);
        } else {
            entries.slice().sort(byStart).forEach(entry => scheduleList.appendChild(createScheduleRow(entry)));
        }

        buildScheduleForm(scheduleList);
        updateDayButtons();
    }

    function updateDayButtons() {
        $$(".day").forEach(button => {
            button.classList.toggle("active", normalizeDay(button.textContent.trim()) === currentScheduleDay);
        });
    }

    function openScheduleManager() {
        openGenericModal("Manage Schedule", "🗓️", "", "schedule");
        renderScheduleManager();
    }

    function renderScheduleManager() {

        if (genericKind !== "schedule") return;

        const body = $("#genericModalBody");

        if (!body) return;

        body.innerHTML = "";

        body.appendChild(createElement(
            "p",
            "hb-modal-description",
            "Skip today keeps your weekly schedule. Delete removes it permanently."
        ));

        const todayName = dayNameOf(new Date());
        let any = false;

        WEEK_ORDER.forEach(day => {
            const entries = data.schedules[day] || [];
            if (entries.length === 0) return;
            any = true;
            body.appendChild(createElement("h4", "hb-day-heading", day + (day === todayName ? " · Today" : "")));
            entries.slice().sort(byStart).forEach(entry => body.appendChild(createScheduleRow(entry, true)));
        });

        if (!any) body.appendChild(createElement("p", "hb-modal-description", "No schedule yet."));

        buildScheduleForm(body);
    }

    /* ===================== GENERIC MODAL ===================== */

    let genericKind = "";

    // When true, Settings panels open inside the Settings page instead of a popup
    let inlineSettings = false;

    function openGenericModal(title, icon, bodyHTML, kind = "") {

        let modal = $("#genericModal");

        if (!modal) {

            modal = createElement("div", "hb-modal");
            modal.id = "genericModal";

            modal.innerHTML = `
                <div class="hb-modal-box hb-generic-box">
                    <button type="button" class="hb-close" id="closeGenericModal" aria-label="Close">×</button>
                    <div class="hb-modal-icon" id="genericModalIcon"></div>
                    <h2 id="genericModalTitle"></h2>
                    <div class="hb-settings-grid" id="genericModalBody"></div>
                </div>
            `;

            document.body.appendChild(modal);

            $("#closeGenericModal", modal).addEventListener("click", closeGenericModal);
            modal.addEventListener("click", event => {
                if (event.target === modal && !modal.classList.contains("hb-inline")) closeGenericModal();
            });
            $("#genericModalBody", modal).addEventListener("click", event => {
                if (genericKind === "schedule") onScheduleAction(event);
            });
        }

        // Popup by default; inside the Settings page when a Settings item is opened
        const host = inlineSettings ? $(".settings-layout") : null;

        if (host) {
            modal.classList.add("hb-inline");
            if (modal.parentElement !== host) host.appendChild(modal);
        } else {
            modal.classList.remove("hb-inline");
            if (modal.parentElement !== document.body) document.body.appendChild(modal);
        }

        genericKind = kind;
        $("#genericModalIcon", modal).textContent = icon;
        $("#genericModalTitle", modal).textContent = title;

        const body = $("#genericModalBody", modal);
        body.innerHTML = bodyHTML;
        modal.style.display = host ? "block" : "flex";

        return body;
    }

    function closeGenericModal() {

        const modal = $("#genericModal");

        genericKind = "";
        editingScheduleId = null;

        if (modal) modal.style.display = "none";
    }

    /* ===================== WORKLOAD AND AUTOMATIC DURATION ===================== */

    function getYearNumber() {
        const match = String(data.profile.yearLevel).match(/\d/);
        return match ? Number(match[0]) : 0;
    }

    function getWorkload() {

        const intensity = COURSE_INTENSITY[data.profile.course] ?? 1;
        const subjectPoints = clamp(data.subjects.length - 3, 0, 4) * 0.5;

        let weekly = 0;
        const start = weekStart();

        for (let i = 0; i < 7; i++) weekly += occurrencesOn(addDays(start, i)).length;

        const points = intensity + subjectPoints + Math.min(3, weekly / 6);

        return { points, level: points < 2.5 ? "light" : points < 5 ? "moderate" : "heavy" };
    }

    function nowInMinutes() {
        const now = new Date();
        return now.getHours() * 60 + now.getMinutes();
    }

    function minutesUntilNext(types) {

        const nowMinutes = nowInMinutes();

        const upcoming = occurrencesOn(new Date())
            .filter(entry => (!types || types.includes(entry.type)) && timeToMinutes(entry.start) > nowMinutes)
            .map(entry => timeToMinutes(entry.start) - nowMinutes);

        return upcoming.length ? Math.min(...upcoming) : null;
    }

    function getCurrentEntry() {

        const nowMinutes = nowInMinutes();

        return occurrencesOn(new Date()).find(entry =>
            timeToMinutes(entry.start) <= nowMinutes && nowMinutes < timeToMinutes(entry.end)
        ) || null;
    }

    function scheduledSubjectNow() {

        const nowMinutes = nowInMinutes();
        const entries = occurrencesOn(new Date())
            .filter(entry => data.subjects.some(subject => subject.name === entry.subject))
            .sort(byStart);

        const current = entries.find(entry => ["Study", "Review"].includes(entry.type)
            && timeToMinutes(entry.start) <= nowMinutes && nowMinutes < timeToMinutes(entry.end));
        const upcoming = entries.find(entry => {
            const gap = timeToMinutes(entry.start) - nowMinutes;
            return gap > 0 && gap <= 60;
        });

        return (current || upcoming || {}).subject || "";
    }

    function recommendStudyMinutes(subjectName) {

        const workload = getWorkload();
        const yearAdjustment = [0, -2, 0, 3, 5][getYearNumber()] || 0;
        const subject = data.subjects.find(item => item.name === subjectName);

        let minutes = 25 + yearAdjustment + Math.round(workload.points * 0.8);
        let limited = "";

        if (subject) {
            const goal = Number(subject.goalMinutes) || 120;
            if (goal >= 240) minutes += 3;
            else if (goal >= 180) minutes += 1;
            else if (goal <= 60) minutes -= 2;
            if (getSchedulesForSubject(subject.name).length >= 3) minutes += 2;
        }

        const recent = getLogs().filter(log => log.type === "study").slice(-5);

        if (recent.length >= 3) {
            const average = recent.reduce((total, log) => total + (Number(log.minutes) || 0), 0) / recent.length;
            minutes = 0.7 * minutes + 0.3 * average;
        }

        const today = studyMinutesOn(dateKey());

        if (today >= 180) minutes -= 10;
        else if (today >= 90) minutes -= 5;

        minutes = roundTo(minutes, 5);

        if (subject) {
            const remaining = (Number(subject.goalMinutes) || 120) - weeklyMinutes(subject.name);
            if (remaining > 0 && remaining < minutes) {
                minutes = Math.max(15, roundTo(remaining, 5));
                limited = "goal";
            }
        }

        const current = getCurrentEntry();

        if (current && ["Study", "Review"].includes(current.type) && current.subject === subjectName) {
            const left = timeToMinutes(current.end) - nowInMinutes();
            if (left < minutes) {
                minutes = Math.max(10, left);
                limited = "block";
            }
        }

        const free = minutesUntilNext(["Class", "Exam"]);

        if (free !== null && free - 5 < minutes) {
            minutes = Math.max(10, free - 5);
            limited = "class";
        }

        return { minutes: clamp(Math.round(minutes), 10, 50), level: workload.level, limited };
    }

    function recommendBreakMinutes(studyMinutes, subjectName) {

        const workload = getWorkload();
        const todayKey = dateKey();
        const todayLogs = getLogs().filter(log => log.date === todayKey).sort((a, b) => (a.ts || 0) - (b.ts || 0));

        let sessions = 0;

        todayLogs.forEach(log => {
            if (log.type === "study") sessions++;
            else if (Number(log.minutes) >= 5) sessions = 0;
        });

        let minutes = studyMinutes * 0.2 + workload.points * 0.25;

        if (studyMinutes >= 45) minutes += 2;
        if (studyMinutesOn(todayKey) >= 120) minutes += 2;

        const subject = data.subjects.find(item => item.name === subjectName);

        if (subject && ((Number(subject.goalMinutes) || 0) >= 180 || getSchedulesForSubject(subject.name).length >= 3)) minutes += 1;

        minutes = Math.round(minutes);

        const long = sessions >= 4;

        minutes = long ? clamp(Math.max(minutes * 2, 15), 15, 30) : clamp(minutes, 3, 20);

        return { minutes: minutes >= 10 ? roundTo(minutes, 5) : minutes, long };
    }

    function pickBreakActivity(breakMinutes, studyMinutes = 0) {

        const fitting = activities.filter(item => item.minutes <= breakMinutes);

        if (fitting.length === 0) return null;

        const recent = getLogs().filter(log => log.type === "break").slice(-2).map(log => log.subject);
        const tired = studyMinutes >= 40 || getWorkload().level === "heavy";
        const preferred = tired ? ["Move", "Relax"] : ["Breathe", "Mind", "Relax"];

        return fitting
            .map(item => ({
                item,
                score: item.minutes / breakMinutes
                    + (preferred.includes(item.category) ? 0.25 : 0)
                    - (recent.includes(item.name) ? 0.5 : 0)
            }))
            .sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name))[0].item;
    }

    function planBreak(studyMinutes, subjectName) {

        const base = recommendBreakMinutes(studyMinutes, subjectName);
        const gap = minutesUntilNext(null);

        let minutes = base.minutes;
        let limited = false;

        if (gap !== null && gap - 2 < minutes) {
            minutes = Math.max(1, gap - 2);
            limited = true;
        }

        return {
            minutes,
            long: base.long && !limited,
            limited,
            gap,
            activity: pickBreakActivity(minutes, studyMinutes)
        };
    }

    /* ===================== TIMER SYSTEM ===================== */

    function normalizeTimer(value) {

        if (!value || typeof value !== "object") return null;
        if (value.type !== "study" && value.type !== "break") return null;
        if (!["running", "paused", "ready"].includes(value.status)) return null;
        if (!(Number(value.total) > 0)) return null;

        return {
            id: String(value.id || uid()),
            type: value.type,
            label: String(value.label || ""),
            activity: String(value.activity || ""),
            minutes: Number(value.minutes) || Math.round(Number(value.total) / 60),
            total: Number(value.total),
            remaining: Number(value.remaining) || Number(value.total),
            endsAt: Number(value.endsAt) || 0,
            status: value.status
        };
    }

    let timer = normalizeTimer(readJSON(TIMER_KEY, null));
    let tickHandle = null;
    let audioContext = null;

    const timerView = {
        config: { type: "study", subject: "", activity: "", suggested: "", minutes: 0, basis: 0 },
        pending: null,
        banner: ""
    };

    function persistTimer() {
        if (timer) writeJSON(TIMER_KEY, timer);
        else removeKey(TIMER_KEY);
    }

    function timerRemaining() {

        if (!timer) return 0;

        if (timer.status === "running") {
            return Math.max(0, Math.ceil((timer.endsAt - Date.now()) / 1000));
        }

        return Math.max(0, Number(timer.remaining) || 0);
    }

    function stopTicker() {
        if (tickHandle !== null) {
            clearInterval(tickHandle);
            tickHandle = null;
        }
    }

    function startTicker() {
        stopTicker();
        tickHandle = setInterval(tick, 500);
    }

    function tick() {

        if (!timer || timer.status !== "running") {
            stopTicker();
            return;
        }

        if (timerRemaining() <= 0) {
            completeTimer();
            return;
        }

        updateTimerUI();
    }

    function beginTimer(type, label, minutes, activity = "") {

        stopTicker();

        timer = {
            id: uid(),
            type,
            label,
            activity,
            minutes,
            total: minutes * 60,
            remaining: minutes * 60,
            endsAt: 0,
            status: "ready"
        };

        startTimer();
    }

    function startTimer() {

        if (!timer || timer.status === "running") return;

        timer.endsAt = Date.now() + timer.remaining * 1000;
        timer.status = "running";

        persistTimer();
        startTicker();
        updateTimerUI();
    }

    function pauseTimer() {

        if (!timer || timer.status !== "running") return;

        timer.remaining = timerRemaining();
        timer.endsAt = 0;
        timer.status = "paused";

        stopTicker();
        persistTimer();
        updateTimerUI();
    }

    function resetTimer() {

        if (!timer) return;

        stopTicker();

        timer.remaining = timer.total;
        timer.endsAt = 0;
        timer.status = "ready";

        persistTimer();
        updateTimerUI();
    }

    function cancelTimer() {

        stopTicker();
        timer = null;
        persistTimer();
        updateTimerUI();
    }

    function completeTimer() {

        if (!timer) return;

        const finished = timer;

        timer = null;
        stopTicker();
        persistTimer();

        if (finished.type === "study") onStudyComplete(finished);
        else onBreakComplete(finished);
    }

    function primeAudio() {
        try {
            const Context = window.AudioContext || window.webkitAudioContext;
            if (!Context) return;
            audioContext = audioContext || new Context();
            if (audioContext.state === "suspended") audioContext.resume();
        } catch { /* ignore */ }
    }

    function playChime() {

        if (!data.settings.sound) return;

        try {
            primeAudio();
            if (!audioContext) return;

            [660, 880].forEach((frequency, index) => {
                const oscillator = audioContext.createOscillator();
                const gain = audioContext.createGain();
                const start = audioContext.currentTime + index * 0.22;

                oscillator.type = "sine";
                oscillator.frequency.value = frequency;
                gain.gain.setValueAtTime(0.0001, start);
                gain.gain.exponentialRampToValueAtTime(0.25, start + 0.03);
                gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.35);

                oscillator.connect(gain);
                gain.connect(audioContext.destination);
                oscillator.start(start);
                oscillator.stop(start + 0.4);
            });
        } catch { /* ignore */ }
    }

    function notifyUser(title, body) {

        if (!data.settings.notifications || !document.hidden) return;
        if (!("Notification" in window) || Notification.permission !== "granted") return;

        try { new Notification(title, { body }); } catch { /* ignore */ }
    }

    function onStudyComplete(finished) {

        if (addLog("study", finished.minutes, finished.label, finished.id)) {
            registerStudyDay();
            const subject = data.subjects.find(item => item.name === finished.label);
            if (subject) subject.minutes = (Number(subject.minutes) || 0) + finished.minutes;
        }

        syncStats();

        const plan = planBreak(finished.minutes, finished.label);
        const activityName = plan.activity ? plan.activity.name : "";
        const lines = [
            "Study Session Complete! 🌿",
            "It's break time.",
            `Recommended break: ${plan.minutes} minute${plan.minutes === 1 ? "" : "s"}${plan.long ? " (long break)" : ""}`
        ];

        if (plan.activity) lines.push(`Suggested activity: ${plan.activity.name} (${plan.activity.minutes} min)`);
        if (plan.limited) lines.push(`Shortened so you're back for your next scheduled subject in ${plan.gap} min.`);

        const summary = lines.join("\n");

        playChime();
        notifyUser("Study Session Complete! 🌿", `Break time: ${plan.minutes} min${activityName ? " · " + activityName : ""}`);

        if (data.settings.autoStartBreak) {
            timerView.pending = null;
            timerView.banner = `${summary}\nYour break timer has started.`;
            beginTimer("break", "Break", plan.minutes, activityName);
        } else {
            timerView.pending = { type: "break", label: "Break", minutes: plan.minutes, activity: activityName };
            timerView.banner = summary;
        }

        renderAllDashboard();
        showTimerModal();
    }

    function onBreakComplete(finished) {

        addLog("break", finished.minutes, finished.activity || finished.label, finished.id);
        syncStats();

        const lastStudy = getLogs().filter(log => log.type === "study").pop();
        const subjectName = lastStudy && data.subjects.some(item => item.name === lastStudy.subject)
            ? lastStudy.subject
            : data.subjects[0]?.name;

        timerView.pending = subjectName
            ? { type: "study", label: subjectName, minutes: recommendStudyMinutes(subjectName).minutes, activity: "" }
            : null;

        timerView.banner = "Break Complete! 🌱\nReady for your next study session?";

        playChime();
        notifyUser("Break Complete! 🌱", "Ready for your next study session?");

        renderAllDashboard();
        showTimerModal();
    }

    function ensureTimerChip() {

        if ($("#timerChip")) return;

        const host = $(".top-header > div:first-child") || $(".top-header");

        if (!host) return;

        const chip = createElement("button", "hb-timer-chip");
        chip.type = "button";
        chip.id = "timerChip";
        chip.addEventListener("click", showTimerModal);
        host.appendChild(chip);
    }

    function updateTimerChip() {

        const chip = $("#timerChip");

        if (!chip) return;

        if (!timer) {
            chip.style.display = "none";
            return;
        }

        const icon = timer.type === "study" ? "📚" : "🌿";
        const paused = timer.status === "running" ? "" : " ⏸";

        chip.textContent = `${icon} ${timer.label || (timer.type === "study" ? "Study" : "Break")} · ${formatTime(timerRemaining())}${paused}`;
        chip.style.display = "inline-flex";
    }

    function ensureTimerModal() {

        if ($("#timerModal")) return $("#timerModal");

        const modal = createElement("div", "hb-modal");
        modal.id = "timerModal";
        modal.style.display = "none";

        modal.innerHTML = `
            <div class="hb-modal-box">
                <button type="button" class="hb-close" id="timerCloseBtn" aria-label="Close">×</button>
                <div class="hb-modal-icon" id="timerIcon"></div>
                <h2 id="timerTitle"></h2>
                <p class="hb-modal-description" id="timerMessage" style="white-space:pre-line"></p>
                <div id="timerConfig">
                    <label id="timerSubjectLabel">Subject
                        <select id="timerSubject"></select>
                    </label>
                    <label>Duration
                        <select id="timerDuration"></select>
                    </label>
                    <p class="hb-modal-description" id="timerHint"></p>
                </div>
                <div id="timerDisplay" class="hb-timer-display"></div>
                <div class="hb-timer-actions">
                    <button type="button" id="timerStartBtn" class="purple-action"></button>
                    <button type="button" id="timerPauseBtn" class="white-action">⏸ Pause</button>
                    <button type="button" id="timerResetBtn" class="white-action">↺ Reset</button>
                    <button type="button" id="timerCancelBtn" class="white-action">Cancel</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        $("#timerCloseBtn", modal).addEventListener("click", hideTimerModal);
        modal.addEventListener("click", event => {
            if (event.target === modal) hideTimerModal();
        });

        $("#timerStartBtn", modal).addEventListener("click", handleTimerPrimary);
        $("#timerPauseBtn", modal).addEventListener("click", pauseTimer);
        $("#timerResetBtn", modal).addEventListener("click", resetTimer);

        $("#timerCancelBtn", modal).addEventListener("click", () => {
            const wasActive = Boolean(timer);
            if (wasActive) cancelTimer();
            hideTimerModal();
            if (wasActive) showToast("Timer cancelled.");
        });

        $("#timerSubject", modal).addEventListener("change", event => {
            timerView.config.subject = event.target.value;
            fillDurationSelect();
        });

        $("#timerDuration", modal).addEventListener("change", () => {

            const config = timerView.config;

            if (config.type === "break" && !config.activity) {
                const picked = pickBreakActivity(Number($("#timerDuration").value), config.basis);
                config.suggested = picked ? picked.name : "";
                setText("timerHint", picked ? `Suggested activity: ${picked.name} (${picked.minutes} min)` : "No activity fits this length.");
            }

            updateTimerUI();
        });

        return modal;
    }

    function showTimerModal() {
        ensureTimerModal().style.display = "flex";
        updateTimerUI();
    }

    function hideTimerModal() {

        const modal = $("#timerModal");

        if (modal) modal.style.display = "none";

        timerView.banner = "";

        if (!timer) timerView.pending = null;
    }

    function fillDurationSelect() {

        const config = timerView.config;
        const select = $("#timerDuration");

        if (!select) return;

        let recommended;
        let hint;

        if (config.type === "study") {
            const result = recommendStudyMinutes(config.subject);
            recommended = result.minutes;
            const note = result.limited === "class" ? ", fits before your next class" : result.limited === "block" ? ", fits your scheduled study block" : result.limited === "goal" ? ", matches what is left of your weekly goal" : "";
            hint = `Recommended for you: ${recommended} min (${result.level} workload${note})`;
        } else if (config.activity) {
            recommended = config.minutes;
            hint = `${config.activity} · ${recommended} min`;
        } else {
            const plan = planBreak(config.basis, config.subject);
            recommended = plan.minutes;
            config.suggested = plan.activity ? plan.activity.name : "";
            hint = `Recommended break: ${recommended} min${plan.long ? " (long break after several sessions)" : ""}${plan.limited ? ", shortened for your next scheduled subject" : ""}${plan.activity ? ` · Suggested activity: ${plan.activity.name} (${plan.activity.minutes} min)` : ""}`;
        }

        const base = config.type === "study" ? [15, 20, 25, 30, 35, 40, 45, 50, 60] : [1, 2, 3, 5, 10, 15, 20, 25, 30];
        const values = [...new Set([...base, recommended])].sort((a, b) => a - b);

        select.innerHTML = values
            .map(value => `<option value="${value}">${value} min${value === recommended ? " (recommended)" : ""}</option>`)
            .join("");

        select.value = String(recommended);

        setText("timerHint", hint);
        updateTimerUI();
    }

    function populateTimerConfig() {

        const config = timerView.config;
        const isStudy = config.type === "study";
        const subjectLabel = $("#timerSubjectLabel");
        const subjectSelect = $("#timerSubject");

        if (subjectLabel) subjectLabel.style.display = isStudy ? "" : "none";

        if (isStudy && subjectSelect) {
            subjectSelect.innerHTML = data.subjects
                .map(subject => `<option value="${escapeHTML(subject.name)}">${escapeHTML(subject.name)}</option>`)
                .join("");
            setSelectValue(subjectSelect, config.subject);
            config.subject = subjectSelect.value;
        }

        fillDurationSelect();
    }

    function openTimerConfig(config) {

        ensureTimerModal();

        if (timer) {
            showToast("A timer is already active. Finish or cancel it first.");
            showTimerModal();
            return;
        }

        timerView.config = { type: "study", subject: "", activity: "", suggested: "", minutes: 0, basis: 0, ...config };
        timerView.pending = null;
        timerView.banner = "";

        populateTimerConfig();
        showTimerModal();
    }

    // Sets the big icon of the timer modal: the activity picture, or an emoji.
    // It only redraws when the icon changes, so the picture does not flicker every tick.
    function setTimerIcon(type, activityName) {

        const icon = $("#timerIcon");

        if (!icon) return;

        const activity = type === "break" ? findActivity(activityName) : null;
        const key = activity ? activity.name : type;

        if (icon.dataset.key === key) return;

        icon.dataset.key = key;

        if (activity) {
            icon.classList.add("hb-activity-photo");
            icon.innerHTML = `<img src="${escapeHTML(activity.image)}" alt="${escapeHTML(activity.name)}">`;
            loadActivityImage($("img", icon), activity);
        } else {
            icon.classList.remove("hb-activity-photo");
            icon.textContent = type === "study" ? "📚" : "🌿";
        }
    }

    function updateTimerUI() {

        updateTimerChip();

        const modal = $("#timerModal");

        if (!modal || modal.style.display === "none") return;

        const pending = !timer && timerView.pending;
        const result = !timer && !pending && Boolean(timerView.banner);
        const config = !timer && !pending && !result;
        const type = timer ? timer.type : pending ? pending.type : timerView.config.type;

        let title = type === "study" ? "Study Session" : "Take a Break";
        if (pending) title = pending.type === "break" ? "Break Time" : "Ready to Study";
        if (result) title = "Well Done";

        // Break timers show the picture of the activity instead of the leaf emoji
        let iconActivity = "";

        if (timer) iconActivity = timer.type === "break" ? (timer.activity || (timer.label !== "Break" ? timer.label : "")) : "";
        else if (pending) iconActivity = pending.type === "break" ? (pending.activity || "") : "";
        else if (config) iconActivity = timerView.config.type === "break" ? (timerView.config.activity || timerView.config.suggested || "") : "";

        setTimerIcon(type, iconActivity);
        $("#timerTitle").textContent = title;

        let subtitle = "";

        if (timer) {
            if (timer.type === "study") {
                subtitle = `Subject: ${timer.label}`;
            } else if (timer.label !== "Break") {
                subtitle = `Activity: ${timer.label}`;
            } else if (timer.activity) {
                const item = activities.find(entry => entry.name === timer.activity);
                subtitle = `Suggested activity: ${timer.activity}${item ? ` (${item.minutes} min)` : ""}`;
            } else {
                subtitle = "Relax, breathe, stretch, or drink some water.";
            }
        } else if (pending) {
            subtitle = pending.type === "study" ? `Next: ${pending.label}` : "";
        }

        $("#timerMessage").textContent = [timerView.banner, subtitle].filter(Boolean).join("\n\n");

        const seconds = timer
            ? timerRemaining()
            : pending ? pending.minutes * 60 : Number($("#timerDuration").value || 0) * 60;

        $("#timerDisplay").textContent = formatTime(seconds);
        $("#timerConfig").style.display = config ? "" : "none";

        const start = $("#timerStartBtn");
        const canStart = config || Boolean(pending) || (timer && timer.status !== "running");

        start.style.display = canStart ? "" : "none";
        start.textContent = timer
            ? (timer.status === "paused" ? "▶ Resume" : "▶ Start")
            : pending ? `▶ Start ${pending.type === "break" ? "Break" : "Study"} (${pending.minutes} min)` : "▶ Start";

        $("#timerPauseBtn").style.display = timer && timer.status === "running" ? "" : "none";
        $("#timerResetBtn").style.display = timer ? "" : "none";
        $("#timerCancelBtn").textContent = timer ? "Cancel" : "Close";
    }

    function handleTimerPrimary() {

        primeAudio();

        if (timer) {
            startTimer();
            return;
        }

        if (timerView.pending) {
            const pending = timerView.pending;
            timerView.pending = null;
            timerView.banner = "";
            beginTimer(pending.type, pending.label, pending.minutes, pending.activity || "");
            return;
        }

        const config = timerView.config;
        const minutes = Number($("#timerDuration").value);

        if (!minutes) {
            showToast("Choose a duration first.");
            return;
        }

        timerView.banner = "";

        if (config.type === "study") {
            const subject = $("#timerSubject").value;
            if (!subject) return showToast("Choose a subject first.");
            beginTimer("study", subject, minutes);
        } else {
            beginTimer("break", config.activity || "Break", minutes, config.activity || config.suggested || "");
        }
    }

    function openStudySession(subjectName) {

        if (data.subjects.length === 0) {
            showToast("Add a subject before starting a study session.");
            showPage("study");
            return;
        }

        const lastStudy = getLogs().filter(log => log.type === "study").pop();
        const candidates = [subjectName, scheduledSubjectNow(), currentSelectedSubject, lastStudy && lastStudy.subject];
        const subject = candidates.find(name => name && data.subjects.some(item => item.name === name)) || data.subjects[0].name;

        openTimerConfig({ type: "study", subject });
    }

    function openBreak() {

        const lastStudy = getLogs().filter(log => log.type === "study" && log.date === dateKey()).pop();
        const basis = lastStudy ? Number(lastStudy.minutes) : recommendStudyMinutes(currentSelectedSubject || data.subjects[0]?.name).minutes;

        openTimerConfig({ type: "break", basis, subject: lastStudy ? lastStudy.subject : "" });
    }

    function restoreTimer() {

        if (!timer) return;

        if (!data.onboardingComplete) {
            timer = null;
            persistTimer();
            return;
        }

        if (timer.status === "running") {
            startTicker();
            tick();
        }

        updateTimerChip();
    }

    /* ===================== STREAK SYSTEM ===================== */

    function computeStreak() {

        const days = new Set(data.streak.history);
        let cursor = new Date();

        if (!days.has(dateKey(cursor))) cursor = addDays(cursor, -1);

        let count = 0;

        while (days.has(dateKey(cursor))) {
            count++;
            cursor = addDays(cursor, -1);
        }

        return count;
    }

    function registerStudyDay() {

        const today = dateKey();

        if (!data.streak.history.includes(today)) {
            data.streak.history.push(today);
            data.streak.history.sort();
        }

        data.streak.best = Math.max(data.streak.best, computeStreak());
    }

    /* ===================== STATISTICS ===================== */

    function getTotals() {

        const logs = getLogs();

        return {
            studyMinutes: sumMinutes(logs, "study"),
            breakMinutes: sumMinutes(logs, "break"),
            studySessions: logs.filter(log => log.type === "study").length,
            breakCount: logs.filter(log => log.type === "break").length
        };
    }

    function syncStats() {

        const totals = getTotals();
        const history = data.streak.history;

        data.stats.studyMinutes = totals.studyMinutes;
        data.stats.breakMinutes = totals.breakMinutes;
        data.stats.studySessions = totals.studySessions;
        data.stats.breaksToday = breaksOn(dateKey());
        data.stats.streak = computeStreak();
        data.stats.lastStudyDate = history[history.length - 1] || "";
        data.activityCount = totals.breakCount;

        data.subjects.forEach(subject => {
            data.subjectProgress[subject.name] = calculateSubjectProgress(subject);
        });

        saveData();
    }

    function getDailyTarget() {

        const total = data.subjects.reduce((sum, subject) => sum + (Number(subject.goalMinutes) || 0), 0);

        return total > 0 ? Math.max(15, roundTo(total / 5, 5)) : 0;
    }

    function calculateTodayProgress() {

        const target = getDailyTarget();

        if (!target) return 0;

        return Math.min(100, Math.round(studyMinutesOn(dateKey()) / target * 100));
    }

    function calculateWellnessBalance(totals) {

        if (totals.studyMinutes === 0 && totals.breakMinutes === 0) return 0;
        if (totals.studyMinutes === 0) return 100;

        return Math.min(100, Math.round(totals.breakMinutes / (totals.studyMinutes * 0.2) * 100));
    }

    function updateStatistics() {

        const today = dateKey();
        const totals = getTotals();

        setText("todayStreak", computeStreak());
        setText("todayProgress", `${calculateTodayProgress()}%`);
        setText("todayStudyTime", formatMinutes(studyMinutesOn(today)));
        setText("todayBreaks", breaksOn(today));
        const breaksCard = document.getElementById("todayBreaks");
        if (breaksCard) breaksCard.title = `Break time today: ${formatMinutes(breakMinutesOn(today))}`;

        setText("progressStudyTime", formatMinutes(totals.studyMinutes));
        setText("progressBreakTime", formatMinutes(totals.breakMinutes));
        setText("progressStudySessions", totals.studySessions);
        setText("progressWellnessBalance", `${calculateWellnessBalance(totals)}%`);
    }

    /* ===================== DASHBOARD NAVIGATION ===================== */

    function showDashboard() {

        $("#onboarding")?.classList.add("hidden");
        $("#dashboard")?.classList.remove("hidden");

        collectSubjectsFromOnboarding();
        data.onboardingComplete = true;
        syncStats();

        renderAllDashboard();
        showPage("home");
    }

    function showPage(page) {

        const validPages = ["home", "study", "activities", "progress", "settings"];

        if (!validPages.includes(page)) page = "home";

        $$(".dashboard-page").forEach(section => section.classList.toggle("active", section.id === `page-${page}`));
        $$(".nav-button").forEach(button => button.classList.toggle("active", button.dataset.page === page));

        if (page === "home") renderHome();
        if (page === "study") renderStudyPage();
        if (page === "activities") setupActivityFilters();
        if (page === "progress") renderProgress();
        if (page === "settings") {
            resetSettingsView();
            updateProfileUI();
        }
    }

    function renderAllDashboard() {

        updateProfileUI();
        renderTodaySchedule();
        renderHomeNote();
        renderStudyPage();
        renderProgress();
        updateStatistics();
        updateTimerUI();
    }

    /* ===================== HOME ===================== */

    function renderHome() {
        updateProfileUI();
        renderTodaySchedule();
        renderHomeNote();
        updateStatistics();
    }

    function renderTodaySchedule() {

        const container = $(".today-schedule");

        if (!container) return;

        container.innerHTML = "";

        const entries = occurrencesOn(new Date()).sort(byStart);

        if (entries.length === 0) {
            const empty = createElement("div");
            empty.innerHTML = `<span>--</span><i class="dot gray-dot"></i>Free Time / Break`;
            container.appendChild(empty);
            return;
        }

        entries.forEach(entry => {
            const item = createElement("div");
            item.dataset.id = entry.id;
            item.innerHTML = `
                <span>${escapeHTML(entry.start)}</span>
                <i class="dot"></i>
                <strong>${escapeHTML(entry.subject)}</strong>
                <small>${escapeHTML(entry.type)}${entry.moved ? " · moved" : ""}</small>
                <button type="button" class="schedule-delete" data-act="skip" title="Skip today only">⏭</button>
            `;
            container.appendChild(item);
        });
    }

    // Shows the latest quick note in the green message box on Home.
    // If there are no notes, the default motivation message is shown.
    function renderHomeNote() {

        const box = $(".green-message");

        if (!box) return;

        const latest = data.notes.length ? data.notes[data.notes.length - 1] : null;

        box.innerHTML = latest
            ? `✧ &nbsp; <strong class="hb-home-note" style="font-weight:600;white-space:pre-wrap;overflow-wrap:anywhere;">${escapeHTML(latest.text)}</strong> <span>📝</span>`
            : `✧ &nbsp; Small progress each day adds up to big results. ❤️ <span>🌱</span>`;

        box.title = latest ? "Click to view or add notes" : "";
        box.style.cursor = latest ? "pointer" : "";

        if (box.dataset.bound !== "true") {
            box.dataset.bound = "true";
            box.addEventListener("click", () => {
                if (data.notes.length) addQuickNote();
            });
        }
    }

    function addQuickNote() {

        const body = openGenericModal("Quick Notes", "📝", `
            <textarea id="hbNoteInput" rows="3" placeholder="Write your note here..."></textarea>
            <div class="hb-timer-actions" style="margin-bottom:16px;">
                <button type="button" class="white-action" id="hbNoteCancelEdit" style="display:none;">Cancel</button>
                <button type="button" class="hb-setting-action" id="hbNoteSave">SAVE NOTE</button>
            </div>
            <div id="hbNoteList"></div>
        `, "notes");

        const input = $("#hbNoteInput", body);
        const list = $("#hbNoteList", body);
        const saveButton = $("#hbNoteSave", body);
        const cancelButton = $("#hbNoteCancelEdit", body);

        let editingNoteId = null;
        let deletingNoteId = null;

        input.style.cssText = "width:100%;padding:12px;margin-bottom:10px;border-radius:12px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.06);color:inherit;font:inherit;resize:vertical;";

        const resetForm = () => {
            editingNoteId = null;
            input.value = "";
            saveButton.textContent = "SAVE NOTE";
            cancelButton.style.display = "none";
        };

        const startEdit = note => {
            deletingNoteId = null;
            editingNoteId = note.id;
            input.value = note.text;
            saveButton.textContent = "UPDATE NOTE";
            cancelButton.style.display = "";
            renderNotes();
            input.focus();
        };

        const renderNotes = () => {

            list.innerHTML = "";

            if (data.notes.length === 0) {
                list.appendChild(createElement("p", "hb-modal-description", "No notes yet."));
                return;
            }

            data.notes.slice().reverse().forEach(note => {

                const row = createElement("div", "hb-setting-option");
                const info = document.createElement("div");
                const actions = createElement("div", "schedule-actions");

                info.style.minWidth = "0";
                info.style.flex = "1";

                // Delete confirmation is shown inside the note itself (no browser popup)
                if (String(deletingNoteId) === String(note.id)) {

                    const preview = note.text.length > 60 ? `${note.text.slice(0, 60)}…` : note.text;
                    const question = createElement("strong", "", "Delete this note?");
                    const detail = createElement("small", "", preview);
                    const keep = createElement("button", "hb-setting-action", "KEEP");
                    const confirmDelete = createElement("button", "hb-setting-action", "DELETE");

                    keep.type = "button";
                    confirmDelete.type = "button";
                    confirmDelete.style.cssText = "color:var(--red);background:rgba(var(--red-rgb),.12);border-color:rgba(var(--red-rgb),.35);";
                    row.style.borderColor = "rgba(var(--red-rgb),.35)";
                    detail.style.cssText = "white-space:pre-wrap;word-break:break-word;";

                    keep.addEventListener("click", () => {
                        deletingNoteId = null;
                        renderNotes();
                    });

                    confirmDelete.addEventListener("click", () => {
                        data.notes = data.notes.filter(item => item.id !== note.id);
                        if (String(editingNoteId) === String(note.id)) resetForm();
                        deletingNoteId = null;
                        saveData();
                        renderNotes();
                        renderHomeNote();
                        showToast("Note deleted.");
                    });

                    info.append(question, detail);
                    actions.append(keep, confirmDelete);
                    row.append(info, actions);
                    list.appendChild(row);
                    return;
                }

                const text = createElement("strong", "", note.text);
                const date = createElement("small", "", note.edited ? `${note.date || ""} · edited ${note.edited}` : (note.date || ""));
                const edit = createElement("button", "schedule-delete", "✎");
                const remove = createElement("button", "schedule-delete", "×");

                text.style.cssText = "white-space:pre-wrap;word-break:break-word;";
                edit.type = "button";
                edit.title = "Edit note";
                edit.dataset.act = "edit";
                remove.type = "button";
                remove.title = "Delete note";

                if (String(editingNoteId) === String(note.id)) {
                    row.style.borderColor = "var(--cyan)";
                    row.style.boxShadow = "0 0 0 1px var(--cyan) inset";
                }

                edit.addEventListener("click", () => startEdit(note));

                remove.addEventListener("click", () => {
                    deletingNoteId = note.id;
                    renderNotes();
                });

                info.append(text, date);
                actions.append(edit, remove);
                row.append(info, actions);
                list.appendChild(row);
            });
        };

        saveButton.addEventListener("click", () => {

            const value = input.value.trim();

            if (!value) return showToast("Write something first.");

            if (editingNoteId !== null) {

                const note = data.notes.find(item => String(item.id) === String(editingNoteId));

                if (note) {
                    note.text = value;
                    note.edited = new Date().toLocaleString();
                }

                saveData();
                resetForm();
                renderNotes();
                renderHomeNote();
                showToast("Note updated! ✎");
                return;
            }

            data.notes.push({ id: Date.now(), text: value, date: new Date().toLocaleString() });
            saveData();
            input.value = "";
            renderNotes();
            renderHomeNote();
            showToast("Quick note saved! 📝");
        });

        cancelButton.addEventListener("click", () => {
            resetForm();
            renderNotes();
        });

        renderNotes();
        input.focus();
    }

    /* ===================== STUDY PLAN ===================== */

    function calculateSubjectProgress(subject) {

        const goal = Number(subject.goalMinutes) || 120;

        return Math.min(100, Math.round(weeklyMinutes(subject.name) / goal * 100));
    }

    function renderStudyPage() {
        renderSubjects();
        renderSelectedSubject();
        renderWeeklyCalendar();
    }

    function renderSubjects() {

        const container = $(".subject-progress");

        if (!container) return;

        container.innerHTML = "";

        if (data.subjects.length === 0) {
            container.innerHTML = `
                <div class="empty-state">
                    <div>📚</div>
                    <strong>No subjects yet</strong>
                    <small>Add your subjects to start studying.</small>
                </div>
            `;
            return;
        }

        data.subjects.forEach(subject => {

            const progress = calculateSubjectProgress(subject);
            const card = createElement("button", "subject-progress-item");

            card.type = "button";
            card.dataset.subject = subject.name;
            card.classList.toggle("selected", currentSelectedSubject === subject.name);

            card.innerHTML = `
                <div class="subject-item-top">
                    <strong>${escapeHTML(subject.name)}</strong>
                    <b>${progress}%</b>
                </div>
                <div class="subject-progress-track"><i style="width:${progress}%"></i></div>
                <small>${formatMinutes(weeklyMinutes(subject.name))} / ${formatMinutes(subject.goalMinutes)} this week</small>
            `;

            container.appendChild(card);
        });
    }

    function getSchedulesForSubject(subjectName) {

        const results = [];

        WEEK_ORDER.forEach(day => {
            (data.schedules[day] || []).forEach(entry => {
                if (!entry.date && entry.subject.toLowerCase() === subjectName.toLowerCase()) {
                    results.push({ ...entry, day });
                }
            });
        });

        return results;
    }

    function renderSelectedSubject() {

        const card = $(".selected-subject");

        if (!card) return;

        const title = $("h3", card);
        const paragraphs = $$(".selected-info p", card);
        const bar = $(".large-progress i", card);
        const write = (paragraph, text) => {
            const span = paragraph && $("span", paragraph);
            if (span) span.textContent = text;
        };

        const subject = data.subjects.find(item => item.name === currentSelectedSubject) || data.subjects[0] || null;

        currentSelectedSubject = subject ? subject.name : null;

        if (!subject) {
            if (title) title.textContent = "No subject selected";
            write(paragraphs[0], "2 hours per week");
            write(paragraphs[1], "0%");
            write(paragraphs[2], "No schedule yet");
            if (bar) bar.style.width = "0%";
            return;
        }

        const progress = calculateSubjectProgress(subject);
        const schedules = getSchedulesForSubject(subject.name);

        if (title) title.textContent = subject.name;

        write(paragraphs[0], `${formatMinutes(subject.goalMinutes)} per week`);
        write(paragraphs[1], `${progress}%`);
        write(paragraphs[2], schedules.length
            ? schedules.map(item => `${item.day.slice(0, 3)}: ${item.start}-${item.end}`).join(" • ")
            : "No schedule yet");

        if (bar) bar.style.width = `${progress}%`;
    }

    // Weekly goal: in-app dark modal (instead of the browser prompt)
    function editSelectedSubject() {

        const subject = data.subjects.find(item => item.name === currentSelectedSubject);

        if (!subject) return showToast("Select a subject first.");

        const body = openGenericModal("Weekly Goal", "🎯", `
            <p class="hb-modal-description" style="margin-bottom:16px;">
                How many minutes per week do you want to study
                <strong>${escapeHTML(subject.name)}</strong>?
            </p>

            <input
                type="number"
                id="hbGoalInput"
                min="1"
                step="5"
                value="${Number(subject.goalMinutes) || 120}"
                style="width:100%;margin-bottom:8px;"
            >

            <p class="hb-modal-description" id="hbGoalHint" style="margin-bottom:18px;"></p>

            <div class="hb-timer-actions">
                <button type="button" class="white-action" id="hbGoalCancel">Cancel</button>
                <button type="button" class="green-action" id="hbGoalSave">Save Goal</button>
            </div>
        `, "goal");

        const input = $("#hbGoalInput", body);
        const hint = $("#hbGoalHint", body);

        const updateHint = () => {
            const value = Number(input.value);
            hint.textContent = Number.isFinite(value) && value > 0 ? `= ${formatMinutes(value)} per week` : "";
        };

        const save = () => {

            const numeric = Number(input.value);

            if (!Number.isFinite(numeric) || numeric <= 0) return showToast("Enter a valid goal.");

            subject.goalMinutes = Math.round(numeric);
            closeGenericModal();
            syncStats();
            renderStudyPage();
            updateStatistics();
            showToast("Subject goal updated!");
        };

        input.addEventListener("input", updateHint);
        input.addEventListener("keydown", event => {
            if (event.key === "Enter") save();
        });

        $("#hbGoalSave", body).addEventListener("click", save);
        $("#hbGoalCancel", body).addEventListener("click", openSubjectOptions);

        updateHint();
        input.focus();
        input.select();
    }

    function openSubjectOptions() {

        const subject = data.subjects.find(item => item.name === currentSelectedSubject);

        if (!subject) return showToast("Select a subject first.");

        const todayName = dayNameOf(new Date());
        const schedules = getSchedulesForSubject(subject.name).sort((a, b) =>
            WEEK_ORDER.indexOf(a.day) - WEEK_ORDER.indexOf(b.day) || byStart(a, b));

        const scheduleRows = schedules.length
            ? schedules.map(entry => `
                <div class="hb-setting-option" data-id="${escapeHTML(entry.id)}">
                    <div>
                        <strong>${escapeHTML(entry.day)}${entry.day === todayName ? " · Today" : ""}</strong>
                        <small>${escapeHTML(entry.start)} - ${escapeHTML(entry.end)} · ${escapeHTML(entry.type)}</small>
                    </div>
                    <div class="schedule-actions">
                        <button type="button" class="hb-setting-action" data-opt="postpone">POSTPONE</button>
                        <button type="button" class="hb-setting-action" data-opt="reschedule">RESCHEDULE</button>
                    </div>
                </div>`).join("")
            : `<p class="hb-modal-description">No weekly schedule for this subject yet.</p>`;

        const body = openGenericModal(`Edit ${subject.name}`, "✏️", `
            ${scheduleRows}
            <div class="hb-setting-option">
                <div>
                    <strong>Weekly goal</strong>
                    <small>Currently ${escapeHTML(formatMinutes(subject.goalMinutes))} per week.</small>
                </div>
                <button type="button" class="hb-setting-action" data-opt="goal">CHANGE</button>
            </div>
            <div class="hb-setting-option">
                <div>
                    <strong>Delete subject</strong>
                    <small>Removes this subject and all its schedules.</small>
                </div>
                <button type="button" class="hb-setting-action" data-opt="delete">DELETE</button>
            </div>
        `, "subjectOptions");

        $$("[data-opt]", body).forEach(button => {
            button.addEventListener("click", () => {

                const row = button.closest("[data-id]");
                const id = row && row.dataset.id;

                switch (button.dataset.opt) {

                    case "postpone": {
                        const entry = schedules.find(item => String(item.id) === String(id));
                        if (!entry || entry.day !== todayName) {
                            showToast("Postpone only works for a schedule that happens today.");
                            return;
                        }
                        closeGenericModal();
                        postponeToday(id);
                        break;
                    }

                    case "reschedule":
                        editingScheduleId = id;
                        openScheduleManager();
                        break;

                    case "goal":
                        editSelectedSubject();
                        break;

                    case "delete":
                        deleteSubject(subject.name);
                        break;
                }
            });
        });
    }

    // Delete subject: in-app dark confirmation (instead of the browser confirm)
    function deleteSubject(name) {

        const body = openGenericModal("Delete Subject", "🗑️", `
            <p class="hb-modal-description" style="margin-bottom:18px;">
                Delete <strong>${escapeHTML(name)}</strong> and all its schedules?<br>
                This cannot be undone.
            </p>

            <div class="hb-timer-actions">
                <button type="button" class="white-action" id="hbDeleteCancel">Keep</button>
                <button
                    type="button"
                    class="white-action"
                    id="hbDeleteConfirm"
                    style="color:var(--red);background:rgba(var(--red-rgb),.12);border-color:rgba(var(--red-rgb),.35);"
                >Delete</button>
            </div>
        `, "deleteSubject");

        $("#hbDeleteCancel", body).addEventListener("click", openSubjectOptions);

        $("#hbDeleteConfirm", body).addEventListener("click", () => {

            WEEK_ORDER.forEach(day => {
                data.schedules[day] = (data.schedules[day] || []).filter(entry => {
                    const match = String(entry.subject).toLowerCase() === name.toLowerCase();
                    if (match) purgeExceptions(entry.id);
                    return !match;
                });
            });

            data.subjects = data.subjects.filter(subject => subject.name !== name);
            delete data.subjectProgress[name];

            if (currentSelectedSubject === name) currentSelectedSubject = null;

            closeGenericModal();
            syncStats();
            renderAllDashboard();
            showToast("Subject deleted.");
        });
    }

    function getSchedulePeriod(time) {

        const hour = Number(String(time).split(":")[0]);

        if (hour < 12) return "Morning";
        if (hour < 17) return "Afternoon";
        if (hour < 21) return "Evening";

        return "Night";
    }

    function renderWeeklyCalendar() {

        const calendar = $(".calendar");

        if (!calendar) return;

        const start = weekStart();
        const dates = WEEK_ORDER.map((_, index) => addDays(start, index));
        const perDay = dates.map(date => occurrencesOn(date));

        calendar.innerHTML = `<div></div>${WEEK_ORDER.map(day => `<b>${day.slice(0, 3).toUpperCase()}</b>`).join("")}`;

        ["Morning", "Afternoon", "Evening", "Night"].forEach(period => {

            calendar.insertAdjacentHTML("beforeend", `<span>${period}</span>`);

            perDay.forEach(entries => {

                const matches = entries.filter(entry => getSchedulePeriod(entry.start) === period).sort(byStart);
                const cell = document.createElement("em");

                if (matches.length === 0) {
                    cell.textContent = "—";
                } else {
                    cell.innerHTML = matches
                        .map(entry => `<strong>${escapeHTML(entry.subject)}${entry.date ? " •" : ""}</strong><small>${escapeHTML(entry.start)}–${escapeHTML(entry.end)}</small>`)
                        .join("<br>");
                }

                calendar.appendChild(cell);
            });
        });

        ensureManageScheduleButton();
    }

    function ensureManageScheduleButton() {

        const heading = $(".weekly-card h2");

        if (!heading || $("#manageSchedule")) return;

        const button = createElement("button", "white-action", "✎ Manage");
        button.type = "button";
        button.id = "manageSchedule";
        button.style.cssText = "margin-left:12px;padding:6px 12px;font-size:12px;width:auto;";
        button.addEventListener("click", openScheduleManager);
        heading.appendChild(button);
    }

    /* ===================== ACTIVITIES ===================== */

    const activities = [
        // RELAX
        { name: "Nap Time", category: "Relax", minutes: 10, image: "images/naptime.jpg", icon: "😴" },
        { name: "Listen to Music", category: "Relax", minutes: 5, image: "images/listentomusic.jpg", icon: "🎧" },
        { name: "Eye Rest", category: "Relax", minutes: 2, image: "images/eyerest.jpg", icon: "👁️" },
        { name: "Daydream", category: "Relax", minutes: 3, image: "images/daydream.jpg", icon: "☁️" },
        { name: "Hydration", category: "Relax", minutes: 1, image: "images/hydration.jpg", icon: "💧" },
        { name: "Gratitude Moment", category: "Relax", minutes: 2, image: "images/gratitudemoment.jpg", icon: "🙏" },

        // MOVE
        { name: "Walk Around", category: "Move", minutes: 5, image: "images/walkaround.jpg", icon: "🚶" },
        { name: "Tidy Desk", category: "Move", minutes: 3, image: "images/tidydesk.jpg", icon: "🧹" },
        { name: "Shoulder Rolls", category: "Move", minutes: 2, image: "images/shoulderrolls.jpg", icon: "💪" },
        { name: "Neck Stretch", category: "Move", minutes: 2, image: "images/neckstretch.jpg", icon: "🧘" },
        { name: "Wrist and Finger Stretch", category: "Move", minutes: 2, image: "images/wristandfingerstretch.jpg", icon: "🤲" },

        // BREATHE
        { name: "Deep Breathing", category: "Breathe", minutes: 2, image: "images/deepbreathing.jpg", icon: "🌬️" },
        { name: "Box Breathing", category: "Breathe", minutes: 2, image: "images/boxbreathing.jpg", icon: "⬜" },
        { name: "4-7-8 Breathing", category: "Breathe", minutes: 2, image: "images/478breathing.jpg", icon: "🫁" },
        { name: "Hum a Song", category: "Breathe", minutes: 2, image: "images/humasong.jpg", icon: "🎵" }
    ];

    function findActivity(name) {
        const key = String(name || "").trim().toLowerCase();
        return activities.find(item => item.name.toLowerCase() === key) || null;
    }

    function setupActivityFilters() {

        const buttons = $$(".activity-tabs button");

        if (buttons.length === 0) return;

        buttons.forEach(button => {

            if (button.dataset.bound === "true") return;

            button.dataset.bound = "true";

            button.addEventListener("click", () => {

                const filter = (button.dataset.filter || button.textContent).trim().toLowerCase();

                buttons.forEach(item => item.classList.toggle("active", item === button));

                $$(".activity-card").forEach(card => {
                    const category = (card.dataset.category || "").toLowerCase();
                    card.style.display = filter === "all" || category === filter ? "" : "none";
                });

                // hide grids that have no visible cards, so there are no empty gaps
                $$(".activity-grid").forEach(grid => {
                    const hasVisible = $$(".activity-card", grid).some(card => card.style.display !== "none");
                    grid.style.display = hasVisible ? "" : "none";
                });
            });
        });
    }

    // If an image fails to load, try other extensions, then fall back to the emoji.
    function loadActivityImage(image, activity) {

        const base = activity.image.replace(/\.[^.]+$/, "");
        const tries = ["jpg", "jpeg", "png", "webp", "JPG", "JPEG", "PNG"]
            .map(ext => `${base}.${ext}`);

        const attempted = new Set([image.getAttribute("src")]);
        let index = 0;

        const next = () => {
            while (index < tries.length && attempted.has(tries[index])) index++;

            if (index < tries.length) {
                attempted.add(tries[index]);
                image.src = tries[index++];
            } else {
                const holder = image.parentElement;
                if (holder) holder.textContent = activity.icon;
            }
        };

        image.addEventListener("error", next);

        // the image may have already failed before this script ran
        if (image.complete && image.naturalWidth === 0) next();
    }

    // Uses the cards already written in the HTML and makes them work.
    function renderActivities() {

        // The HTML has 3 separate grids (Relax / Move / Breathe), so each category
        // starts on a new row and leaves gaps. Merge all cards into the first grid.
        const grids = $$(".activity-grid");

        if (grids.length > 1) {
            const mainGrid = grids[0];
            grids.slice(1).forEach(grid => {
                $$(".activity-card", grid).forEach(card => mainGrid.appendChild(card));
                grid.remove();
            });
        }

        $$(".activity-card").forEach(card => {

            const title = $("h3", card);
            const button = $("button", card);
            const activity = findActivity(title && title.textContent);

            if (!activity || !button || button.dataset.bound === "true") return;

            button.dataset.bound = "true";
            button.classList.add("activity-start");
            button.addEventListener("click", () => createActivityModal(activity));

            const image = $("img", card);

            if (image) loadActivityImage(image, activity);
        });

        setupActivityFilters();
    }

    function startActivityBreak(activity) {
        openTimerConfig({ type: "break", activity: activity.name, minutes: activity.minutes });
    }

    function createActivityModal(activity) {

        $("#healthyBreakActivityModal")?.remove();

        const modal = createElement("div", "hb-modal");

        modal.id = "healthyBreakActivityModal";

        modal.innerHTML = `
            <div class="hb-modal-box">
                <button type="button" class="hb-close" aria-label="Close">×</button>
                <div class="hb-modal-icon hb-activity-photo">
                    <img src="${escapeHTML(activity.image)}" alt="${escapeHTML(activity.name)}">
                </div>
                <h2>${escapeHTML(activity.name)}</h2>
                <p>Take a short ${escapeHTML(activity.name.toLowerCase())} break and refresh yourself.</p>
                <div class="hb-activity-duration">
                    ${activity.minutes} minute${activity.minutes === 1 ? "" : "s"}
                </div>
                <button type="button" class="green-action" id="beginActivity">▶ Start Activity</button>
            </div>
        `;

        document.body.appendChild(modal);

        const photo = $(".hb-activity-photo img", modal);
        if (photo) loadActivityImage(photo, activity);

        $(".hb-close", modal).addEventListener("click", () => modal.remove());

        modal.addEventListener("click", event => {
            if (event.target === modal) modal.remove();
        });

        $("#beginActivity", modal).addEventListener("click", () => {
            modal.remove();
            startActivityBreak(activity);
        });
    }

    function surpriseActivity() {

        const activity = activities[Math.floor(Math.random() * activities.length)];

        showToast(`Try: ${activity.name} — ${activity.minutes} min`);

        createActivityModal(activity);
    }

    /* ===================== PROGRESS PAGE ===================== */

    function renderProgress() {
        updateStatistics();
        renderProgressChart();
        renderSubjectProgress();
        renderTaskGoals();
    }

    function renderProgressChart() {

        const chart = $(".chart");

        if (!chart) return;

        const start = weekStart();
        const dates = WEEK_ORDER.map((_, index) => addDays(start, index));
        const values = dates.map(date => studyMinutesOn(dateKey(date)));
        const max = Math.max(60, ...values);

        chart.innerHTML = "";

        values.forEach((minutes, index) => {
            const bar = createElement("div", "bar");
            bar.style.height = `${clamp(minutes / max * 100, 4, 100)}%`;
            bar.title = `${WEEK_ORDER[index]}: ${formatMinutes(minutes)}`;
            chart.appendChild(bar);
        });

        const labels = $(".chart-days");

        if (labels) {
            labels.innerHTML = WEEK_ORDER.map(day => `<span>${day.slice(0, 3)}</span>`).join("");
        }
    }

    function renderSubjectProgress() {

        const card = $$("#page-progress .dashboard-card").find(element => element.textContent.includes("Subject Progress"));

        if (!card) return;

        $$(".subject-line, .empty-state", card).forEach(element => element.remove());

        if (data.subjects.length === 0) {
            card.insertAdjacentHTML("beforeend", `<div class="empty-state">No subjects added yet.</div>`);
            return;
        }

        data.subjects.forEach(subject => {

            const progress = calculateSubjectProgress(subject);
            const line = createElement("div", "subject-line");

            line.innerHTML = `
                <span>${escapeHTML(subject.name)}</span>
                <b>${progress}%</b>
                <div><i style="width:${progress}%"></i></div>
            `;

            card.appendChild(line);
        });
    }

    function renderTaskGoals() {

        const container = $(".achievement-grid");

        if (!container) return;

        const goalReached = data.subjects.some(subject => calculateSubjectProgress(subject) >= 100);
        const totals = getTotals();

        const achievements = [
            {
                icon: "🔥", title: "Day Streak",
                description: data.streak.best >= 3 ? `Best streak: ${data.streak.best} days` : "Study 3 days in a row to unlock",
                unlocked: data.streak.best >= 3
            },
            {
                icon: "🌿", title: "Wellness Week",
                description: totals.breakMinutes >= 30 ? "Completed wellness breaks" : "Take more healthy breaks",
                unlocked: totals.breakMinutes >= 30
            },
            {
                icon: "🎯", title: "Goal Getter",
                description: goalReached ? "Completed a weekly subject goal" : "Complete a weekly subject goal",
                unlocked: goalReached
            },
            {
                icon: "🧘", title: "Mindful Student",
                description: totals.breakCount >= 10 ? "Completed 10 wellness activities" : `${totals.breakCount}/10 activities completed`,
                unlocked: totals.breakCount >= 10
            },
        ];

        container.innerHTML = "";

        achievements.forEach(achievement => {
            const item = createElement("div");
            if (achievement.unlocked) item.classList.add("unlocked");
            item.innerHTML = `${achievement.icon}<strong>${escapeHTML(achievement.title)}</strong><small>${escapeHTML(achievement.description)}</small>`;
            container.appendChild(item);
        });
    }

    /* ===================== SETTINGS ===================== */

    function saveSettings() {

        const nickname = ($("#settingsNickname")?.value || "").trim();

        if (nickname) data.profile.nickname = nickname;

        data.profile.yearLevel = $("#settingsYearLevel")?.value || data.profile.yearLevel;
        data.profile.course = $("#settingsCourse")?.value || data.profile.course;
        data.profile.school = $("#settingsSchool")?.value || data.profile.school;

        saveData();
        updateProfileUI();
        updateTimerUI();
        showToast("Settings saved successfully! ✓");
    }

    function setupSettingsMenu() {

        const menu = $(".settings-menu");

        if (!menu) return;

        menu.addEventListener("click", event => {

            const button = event.target.closest("button");

            if (!button) return;

            const buttons = $$("button", menu);

            buttons.forEach(item => item.classList.toggle("active", item === button));

            const index = buttons.indexOf(button);

            if (index === 0) showSettingsProfile();
            else openSettingsInline(index);
        });
    }

    // Profile: show the profile card and hide any Settings panel
    function showSettingsProfile() {

        const modal = $("#genericModal");

        if (modal && modal.classList.contains("hb-inline")) closeGenericModal();

        const card = $(".profile-card");

        if (card) card.style.display = "";
    }

    // Other items: replace the profile card with the chosen panel
    function openSettingsInline(index) {

        const card = $(".profile-card");

        if (card) card.style.display = "none";

        inlineSettings = true;

        try {
            openEnhancedSettings(index);
        } finally {
            inlineSettings = false;
        }
    }

    // Going back to the Settings page always starts on Profile
    function resetSettingsView() {

        showSettingsProfile();

        const buttons = $$(".settings-menu button");

        buttons.forEach((item, index) => item.classList.toggle("active", index === 0));
    }

    function openEnhancedSettings(index) {

        const panels = {
            1: showAppearanceSettings,
            2: showNotificationSettings,
            3: showStudyBreakSettings,
            4: openScheduleManager,
            5: showDataSettings,
            6: showAboutSettings
        };

        if (panels[index]) panels[index]();
    }

    function applyHealthyBreakTheme(theme) {

        const safeTheme = ["dark", "ocean", "forest", "violet"].includes(theme) ? theme : "dark";

        document.body.classList.remove("hb-theme-dark", "hb-theme-ocean", "hb-theme-forest", "hb-theme-violet");
        document.body.classList.add(`hb-theme-${safeTheme}`);
        document.body.dataset.hbTheme = safeTheme;

        data.settings.theme = safeTheme;
        saveData();
    }

    function toggleLabel(value) {
        return value ? "ON" : "OFF";
    }

    function showAppearanceSettings() {

        const themes = [["dark", "🌌", "Neon Dark"], ["ocean", "🌊", "Ocean"], ["forest", "🌿", "Forest"], ["violet", "🔮", "Violet"]];

        const body = openGenericModal("Appearance", "🎨", `
            <div class="hb-setting-option">
                <div>
                    <strong>Choose your theme</strong>
                    <small>Your choice is saved automatically.</small>
                </div>
            </div>
            <div class="hb-theme-preview-grid">
                ${themes.map(([value, icon, label]) => `
                    <button type="button" class="hb-theme-choice ${data.settings.theme === value ? "active" : ""}" data-theme-choice="${value}">
                        <div style="font-size:24px">${icon}</div>
                        <div style="margin-top:4px;font-size:11px">${label}</div>
                    </button>
                `).join("")}
            </div>
        `, "appearance");

        $$("[data-theme-choice]", body).forEach(button => {
            button.addEventListener("click", () => {
                applyHealthyBreakTheme(button.dataset.themeChoice);
                $$("[data-theme-choice]", body).forEach(item => item.classList.toggle("active", item === button));
                showToast(`Theme changed to ${button.textContent.trim()}.`);
            });
        });
    }

    function notificationStatusText() {

        if (!data.settings.notifications) return "Browser alerts are turned off.";
        if (!("Notification" in window)) return "This browser does not support alerts. In-app messages still work.";
        if (Notification.permission === "granted") return "Browser alerts are allowed.";
        if (Notification.permission === "denied") return "Alerts are blocked in your browser settings. In-app messages still work.";

        return "Browser alerts have not been allowed yet. Turning this on will ask once.";
    }

    function showNotificationSettings() {

        const body = openGenericModal("Notifications", "🔔", `
            <div class="hb-setting-option">
                <div>
                    <strong>Alerts when a timer ends</strong>
                    <small>Uses your browser's notifications if you allow them.</small>
                </div>
                <button type="button" class="hb-setting-action" id="hbNotificationToggle">${toggleLabel(data.settings.notifications)}</button>
            </div>
            <div class="hb-setting-option">
                <div>
                    <strong>Current status</strong>
                    <small id="hbNotificationStatus">${escapeHTML(notificationStatusText())}</small>
                </div>
            </div>
        `, "notifications");

        $("#hbNotificationToggle", body).addEventListener("click", event => {

            data.settings.notifications = !data.settings.notifications;
            event.currentTarget.textContent = toggleLabel(data.settings.notifications);
            saveData();

            const refresh = () => setText("hbNotificationStatus", notificationStatusText());

            if (data.settings.notifications && "Notification" in window && Notification.permission === "default") {
                Notification.requestPermission().then(refresh).catch(refresh);
            }

            refresh();
        });
    }

    function showStudyBreakSettings() {

        const subjectName = currentSelectedSubject || data.subjects[0]?.name;
        const study = recommendStudyMinutes(subjectName);
        const breakInfo = recommendBreakMinutes(study.minutes);

        const body = openGenericModal("Study & Break", "⏱️", `
            <div class="hb-setting-option">
                <div>
                    <strong>Automatic durations</strong>
                    <small>Study ${study.minutes} min, then a ${breakInfo.minutes} min break (${study.level} workload). Calculated from your year, course, subjects, schedule and recent sessions.</small>
                </div>
            </div>
            <div class="hb-setting-option">
                <div>
                    <strong>Start break automatically</strong>
                    <small>Begin the break timer as soon as a study session ends.</small>
                </div>
                <button type="button" class="hb-setting-action" id="hbAutoBreakToggle">${toggleLabel(data.settings.autoStartBreak)}</button>
            </div>
            <div class="hb-setting-option">
                <div>
                    <strong>Sound</strong>
                    <small>Play a short chime when a timer ends.</small>
                </div>
                <button type="button" class="hb-setting-action" id="hbSoundToggle">${toggleLabel(data.settings.sound)}</button>
            </div>
            <div class="hb-setting-option">
                <div>
                    <strong>Auto-save</strong>
                    <small>Save your progress when you leave or switch tabs.</small>
                </div>
                <button type="button" class="hb-setting-action" id="hbAutoSaveToggle">${toggleLabel(data.settings.autoSave)}</button>
            </div>
        `, "studybreak");

        const bindToggle = (id, key, message) => {
            $(id, body).addEventListener("click", event => {
                data.settings[key] = !data.settings[key];
                event.currentTarget.textContent = toggleLabel(data.settings[key]);
                saveData();
                showToast(`${message} ${data.settings[key] ? "enabled" : "disabled"}.`);
            });
        };

        bindToggle("#hbAutoBreakToggle", "autoStartBreak", "Automatic break");
        bindToggle("#hbSoundToggle", "sound", "Sound");
        bindToggle("#hbAutoSaveToggle", "autoSave", "Auto-save");
    }

    function showDataSettings() {

        const body = openGenericModal("Data & Offline", "💾", `
            <div class="hb-setting-option">
                <div>
                    <strong>Export backup</strong>
                    <small>Download your profile, subjects, schedules, notes and progress as JSON.</small>
                </div>
                <button type="button" class="hb-setting-action" id="hbExportData">EXPORT</button>
            </div>
            <div class="hb-setting-option">
                <div>
                    <strong>Import backup</strong>
                    <small>Restore a HealthyBreak JSON backup from this device.</small>
                </div>
                <button type="button" class="hb-setting-action" id="hbImportData">IMPORT</button>
            </div>
            <div class="hb-setting-option">
                <div>
                    <strong>Reset application</strong>
                    <small>This removes locally saved HealthyBreak data.</small>
                </div>
                <button type="button" class="hb-setting-action" id="hbResetData">RESET</button>
            </div>
        `, "data");

        $("#hbExportData", body).addEventListener("click", exportHealthyBreakData);
        $("#hbImportData", body).addEventListener("click", importHealthyBreakData);
        $("#hbResetData", body).addEventListener("click", () => {
            closeGenericModal();
            resetAllData();
        });
    }

    function showAboutSettings() {

    
        const aboutInfo = {
            version: "1",
            created: "2026",
            teamImage: "images/team.jpg",
            developers: [
                "Glaiza D. Fullante",
                "Laarnie Joy C. Empeo",
                "Kimberlly Carcpo",
                "Carl Chian Escovidal",
                "Gendo Rex Leonor",
            ]
        };

        const sections = [
            ["The App", [
                ["intro", "", "About the App"],
                ["features", "", "Key Features"]
            ]],
            ["Team and Data", [
                ["devs", "", "Developers"],
                ["storage", "", "Data Storage"]
            ]]
        ];

        // Make menu icons grayscale
        document.querySelectorAll('.menu-icon').forEach(icon => {
            icon.style.filter = 'grayscale(100%)';
        });

        const titles = {
            intro: "About the App",
            features: "Key Features",
            devs: "Developers",
            storage: "Data Storage"
        };

        const option = (title, text) => `
            <div class="hb-setting-option">
                <div>
                    <strong>${title}</strong>
                    <small>${text}</small>
                </div>
            </div>`;


        const panels = {

            intro: () => `
                ${option("What is HealthyBreak?", "HealthyBreak is a study planner and wellness companion. It helps you plan your subjects and schedule, run study sessions, and take healthy breaks in between.")}
                ${option("Purpose", "Many students study for hours without resting, which leads to stress and tiredness. HealthyBreak encourages a balance between studying and resting so you can learn better and feel better.")}
                ${option("What is it for?", "Planning your weekly schedule, timing your study sessions, doing short break activities (relax, move, breathe), and tracking your progress and streaks.")}
                ${option("Who is it for?", "College students, including students of Southern Luzon State University (SLSU), who want to manage their study time and take care of their well-being.")}
                ${option("Version", `v${escapeHTML(aboutInfo.version)}`)}
            `,

            devs: () => `
                <div class="hb-team-photo">
                    <img src="${escapeHTML(aboutInfo.teamImage)}" alt="Developer team">
                </div>
                <div class="hb-team-names">
                    ${aboutInfo.developers.map(name => `<div class="hb-team-name">${escapeHTML(name)}</div>`).join("")}
                </div>
                ${option("Date created", escapeHTML(aboutInfo.created))}
            `,

            features: () => `
                ${option("📚Study timer", "Automatic study durations based on your year level, course, subjects, schedule and recent sessions.")}
                ${option("🌿 Break activities", `${activities.length} activities in Relax, Move and Breathe, with a suggested activity that fits your break.`)}
                ${option("🗓️ Weekly schedule", "Add classes and study blocks, then skip or postpone them for today only without deleting them.")}
                ${option("📊 Progress and achievements", "Track study time, break time, streaks, subject goals and unlockable achievements.")}
                ${option("📝 Quick notes", "Write a note anytime. Your latest note appears on your Home page.")}
                ${option("🎨 Themes", "Choose from four themes: Neon Dark, Ocean, Forest and Violet.")}
            `,

            storage: () => `
                ${option("Saved on this device", "Your profile, subjects, schedules, notes and progress are stored locally in this browser. The app works offline.")}
                ${option("No server, no account", "Nothing is sent online. Your data stays on your device.")}
                ${option("Back up your data", "Clearing your browser data will erase your progress. Use Data &amp; Offline in Settings to export a backup file and import it later.")}
            `
        };

        const body = openGenericModal("About HealthyBreak", "", `<div id="hbAboutView"></div>`, "about");

        // App logo at the top, with fallbacks if the file path is different
        const iconBox = $("#genericModalIcon");

        if (iconBox) {
            iconBox.innerHTML = `<img class="hb-about-logo" src="images/image2.png" alt="HealthyBreak logo">`;

            const logo = $("img", iconBox);
            const sources = ["images/image2.png", "image2.png"];
            let tried = 1;

            logo.addEventListener("error", () => {
                if (tried < sources.length) logo.src = sources[tried++];
                else iconBox.textContent = "🌿";
            });
        }

        const view = $("#hbAboutView", body);

        // Main list: grouped cards, icon on the left, arrow on the right
        const showMenu = () => {

            setText("genericModalTitle", "About HealthyBreak");

            view.innerHTML = `
                <div class="hb-menu">
                    ${sections.map(([label, items]) => `
                        <div class="hb-menu-label">${label}</div>
                        <div class="hb-menu-card">
                            ${items.map(([key, icon, title]) => `
                               <button type="button" class="hb-menu-row" data-about-open="${key}">
                               <span class="hb-menu-text">${title}</span>
                               <span class="hb-menu-chevron">›</span>
                             </button>
                            `).join("")}
                        </div>
                    `).join("")}
                    <p class="hb-menu-version">HealthyBreak v${escapeHTML(aboutInfo.version)}</p>
                </div>
            `;

            $$("[data-about-open]", view).forEach(button => {
                button.addEventListener("click", () => showDetail(button.dataset.aboutOpen));
            });
        };

        // Detail page: back arrow on top, then the content
        const showDetail = key => {

            setText("genericModalTitle", "About HealthyBreak");

            view.innerHTML = `
                <div class="hb-menu-detail-head">
                    <button type="button" class="hb-menu-back" id="hbAboutBack" aria-label="Back">←</button>
                    <h3>${escapeHTML(titles[key])}</h3>
                </div>
                <div id="hbAboutPanel">${panels[key]()}</div>
            `;

            $("#hbAboutBack", view).addEventListener("click", showMenu);

            // if the team photo is missing, show a placeholder instead
            const teamImage = $(".hb-team-photo img", view);

            if (teamImage) {
                const usePlaceholder = () => {
                    const holder = teamImage.parentElement;
                    if (holder) holder.textContent = "👥 Team photo";
                };
                teamImage.addEventListener("error", usePlaceholder);
                if (teamImage.complete && teamImage.naturalWidth === 0) usePlaceholder();
            }
        };

        showMenu();
    }

    function exportHealthyBreakData() {

        const payload = {
            app: "HealthyBreak",
            version: 3,
            exportedAt: new Date().toISOString(),
            data,
            logs: getLogs(),
            exceptions: getExceptions()
        };

        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download = `healthybreak-backup-${dateKey()}.json`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);

        showToast("Backup exported successfully! 💾");
    }

    function importHealthyBreakData() {

        const input = document.createElement("input");
        input.type = "file";
        input.accept = "application/json,.json";

        input.addEventListener("change", () => {

            const file = input.files && input.files[0];

            if (!file) return;

            const reader = new FileReader();

            reader.onload = () => {
                try {
                    const parsed = JSON.parse(String(reader.result || ""));
                    const incoming = parsed && parsed.data ? parsed.data : parsed;

                    if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) throw new Error("Invalid backup");

                    stopTicker();
                    timer = null;
                    persistTimer();

                    if (Array.isArray(parsed.logs)) writeJSON(LOGS_KEY, parsed.logs);
                    if (parsed.exceptions && typeof parsed.exceptions === "object") writeJSON(EXCEPTIONS_KEY, parsed.exceptions);

                    data = hydrateData(incoming);
                    saveData();
                    window.location.reload();
                } catch (error) {
                    console.error(error);
                    showToast("That backup file is not valid.");
                }
            };

            reader.readAsText(file);
        });

        input.click();
    }

    function resetAllData() {

        const confirmed = window.confirm("Reset all HealthyBreak data? Your subjects, schedules, progress, notes and profile will be removed.");

        if (!confirmed) return;

        stopTicker();
        timer = null;

        [STORAGE_KEY, LOGS_KEY, EXCEPTIONS_KEY, TIMER_KEY].forEach(removeKey);

        data = clone(defaultData);
        window.location.reload();
    }

    function addDashboardUtilityButton() {

        const header = $(".top-header .user-area");

        if (!header || $("#hbHeaderTools")) return;

        const tools = document.createElement("div");
        tools.id = "hbHeaderTools";
        tools.style.cssText = "display:flex;align-items:center;gap:8px;margin-right:6px;";

        const saveButton = document.createElement("button");
        saveButton.type = "button";
        saveButton.title = "Save now";
        saveButton.setAttribute("aria-label", "Save now");
        saveButton.textContent = "💾";
        saveButton.style.cssText = "border:1px solid rgba(0,245,255,.16);background:rgba(0,245,255,.05);border-radius:12px;width:38px;height:38px;color:white;";

        saveButton.addEventListener("click", () => {
            saveData();
            showToast("All changes saved. ✓");
        });

        tools.appendChild(saveButton);
        header.prepend(tools);
    }

    /* ===================== EVENT LISTENERS ===================== */

    function setupEvents() {

        $$(".next-button").forEach(button => {
            button.addEventListener("click", () => goToNextStep(Number(button.dataset.next)));
        });

        $("#addSubject")?.addEventListener("click", () => addSubjectInput());
        $("#dashboardButton")?.addEventListener("click", showDashboard);

        $$(".nav-button").forEach(button => {
            button.addEventListener("click", () => showPage(button.dataset.page));
        });

        $$(".day").forEach(button => {
            button.addEventListener("click", () => {
                editingScheduleId = null;
                renderScheduleDay(normalizeDay(button.textContent.trim()));
            });
        });

        $(".schedule-list")?.addEventListener("click", onScheduleAction);
        $(".today-schedule")?.addEventListener("click", onScheduleAction);
        $$(".option-grid > div").forEach(option => option.addEventListener("click", openScheduleManager));

        $("#startStudy")?.addEventListener("click", () => openStudySession());
        $("#takeBreak")?.addEventListener("click", openBreak);
        $("#addQuickNote")?.addEventListener("click", addQuickNote);
        $("#surpriseButton")?.addEventListener("click", surpriseActivity);
        $("#saveSettings")?.addEventListener("click", saveSettings);

        $("#editSelectedSubject")?.addEventListener("click", openSubjectOptions);

        $("#startSelectedSubject")?.addEventListener("click", () => {
            if (!currentSelectedSubject) return showToast("Select a subject first.");
            openStudySession(currentSelectedSubject);
        });

        $(".subject-progress")?.addEventListener("click", event => {
            const card = event.target.closest("[data-subject]");
            if (!card) return;
            currentSelectedSubject = card.dataset.subject;
            renderStudyPage();
        });

        $(".study-tabs")?.addEventListener("click", event => {

            const tab = event.target.closest("button");

            if (!tab) return;

            const tabs = $$(".study-tabs button");

            tabs.forEach(item => item.classList.toggle("active", item === tab));

            if (tabs.indexOf(tab) === 1) $(".weekly-card")?.scrollIntoView({ behavior: "smooth" });
            else showToast("Subjects view selected.");
        });

        $$(".card-header a").forEach(link => {
            link.addEventListener("click", event => {

                event.preventDefault();

                const text = link.textContent.trim().toLowerCase();

                if (text.includes("view all")) {
                    showPage("study");
                    $(".weekly-card")?.scrollIntoView({ behavior: "smooth" });
                }

                if (text.includes("add subject")) addSubjectFromDashboard();
            });
        });

        setupSettingsMenu();

        document.addEventListener("keydown", event => {
            if (event.key !== "Escape") return;
            if ($("#timerModal")?.style.display === "flex") hideTimerModal();
            if ($("#genericModal")?.style.display === "flex") closeGenericModal();
            $("#healthyBreakActivityModal")?.remove();
        });

        document.addEventListener("visibilitychange", () => {

            if (document.visibilityState === "hidden") {
                if (data.settings.autoSave) saveData();
                return;
            }

            tick();

            if (data.onboardingComplete) {
                updateStatistics();
                renderTodaySchedule();
            }
        });

        window.addEventListener("pagehide", () => {
            if (data.settings.autoSave) saveData();
        });
    }

    /* ===================== RUNTIME STYLES ===================== */

    function injectRuntimeStyles() {

        if ($("#healthyBreakRuntimeStyles")) return;

        const style = document.createElement("style");
        style.id = "healthyBreakRuntimeStyles";

        style.textContent = `
            .hb-modal { position: fixed; inset: 0; z-index: 99999; display: flex; align-items: center; justify-content: center; padding: 20px; background: rgba(0,0,0,.72); backdrop-filter: blur(12px); }
            .hb-modal-box { width: min(460px, 100%); padding: 30px; border-radius: 24px; background: #10101d; color: white; border: 1px solid rgba(255,255,255,.12); box-shadow: 0 30px 90px rgba(0,0,0,.55); position: relative; }
            .hb-generic-box { max-height: 90vh; overflow: auto; }
            .hb-close { position: absolute; right: 15px; top: 12px; width: 38px; height: 38px; border: 0; border-radius: 50%; background: rgba(255,255,255,.08); color: white; font-size: 24px; cursor: pointer; }
            .hb-modal-icon { font-size: 48px; text-align: center; margin-bottom: 10px; }
            .hb-modal-box h2 { text-align: center; margin-bottom: 20px; }
            .hb-modal-box label { display: block; margin: 14px 0; font-weight: 700; }
            .hb-modal-box select { width: 100%; margin-top: 7px; padding: 12px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: #181827; color: white; }
            .hb-timer-display { font-size: 54px; font-weight: 800; text-align: center; letter-spacing: 2px; margin: 25px 0; }
            .hb-timer-actions { display: flex; flex-wrap: wrap; gap: 10px; }
            .hb-timer-actions button { flex: 1; min-width: 110px; }
            .hb-modal-description { text-align: center; opacity: .75; line-height: 1.6; }
            .hb-timer-chip { display: none; align-items: center; border: 1px solid rgba(255,255,255,.14); background: rgba(139,92,246,.18); color: inherit; border-radius: 999px; padding: 8px 14px; font-weight: 700; cursor: pointer; }
            :where(.hb-setting-option) { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 0; border-bottom: 1px solid rgba(255,255,255,.08); }
            :where(.hb-setting-option) small { display: block; opacity: .6; margin-top: 3px; }
            :where(.hb-setting-action) { border: 1px solid rgba(255,255,255,.14); background: rgba(255,255,255,.06); color: inherit; border-radius: 10px; padding: 9px 14px; font-weight: 800; cursor: pointer; }
            :where(.hb-day-heading) { margin: 16px 0 8px; }
            .subject-row { display: grid; grid-template-columns: 1fr auto; gap: 10px; margin-bottom: 10px; }
            .subject-row input { width: 100%; padding: 13px 15px; border-radius: 12px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.05); color: inherit; }
            .remove-subject { width: 45px; border: 0; border-radius: 12px; background: rgba(255,70,70,.14); color: #ff7777; font-size: 22px; cursor: pointer; }
            .schedule-add-form { margin-top: 18px; padding: 18px; border-radius: 18px; background: rgba(255,255,255,.04); border: 1px dashed rgba(255,255,255,.14); }
            .schedule-form-title { font-weight: 800; margin-bottom: 12px; }
            .schedule-form-grid { display: grid; grid-template-columns: repeat(2, minmax(0,1fr)); gap: 10px; }
            .schedule-form-grid input, .schedule-form-grid select { min-width: 0; padding: 11px; border-radius: 10px; border: 1px solid rgba(255,255,255,.12); background: rgba(255,255,255,.06); color: inherit; }
            .schedule-form-grid button { min-height: 44px; }
            .schedule-row { display: grid; grid-template-columns: 80px 1fr auto; gap: 12px; align-items: center; padding: 13px; margin-bottom: 9px; border-radius: 15px; background: rgba(255,255,255,.045); }
            .schedule-time { display: flex; flex-direction: column; }
            .schedule-time span, .schedule-info small { opacity: .6; font-size: 12px; }
            .schedule-info { display: flex; flex-direction: column; gap: 3px; }
            .schedule-actions { display: flex; gap: 6px; }
            .schedule-delete { width: 34px; height: 34px; border: 0; border-radius: 9px; background: rgba(255,70,70,.12); color: #ff7070; cursor: pointer; font-size: 17px; }
            .today-schedule .schedule-delete { margin-left: auto; }
            .schedule-empty { text-align: center; padding: 28px 10px; opacity: .7; display: flex; flex-direction: column; gap: 5px; }
            .setup-summary { display: flex; flex-direction: column; gap: 5px; margin: 20px auto; padding: 15px 20px; max-width: 360px; border-radius: 15px; background: rgba(255,255,255,.05); text-align: center; }
            .setup-summary span { font-size: 13px; opacity: .7; }
            .empty-state { text-align: center; padding: 30px 15px; opacity: .7; }
            .empty-state div { font-size: 38px; margin-bottom: 8px; }
            .empty-state strong, .empty-state small { display: block; }
            .subject-progress-item { width: 100%; border: 0; text-align: left; padding: 14px; margin-bottom: 10px; border-radius: 14px; background: rgba(255,255,255,.04); color: inherit; cursor: pointer; }
            .subject-progress-item.selected { outline: 2px solid rgba(139,92,246,.65); background: rgba(139,92,246,.09); }
            .subject-item-top { display: flex; justify-content: space-between; gap: 10px; margin-bottom: 9px; }
            .subject-progress-track { height: 7px; border-radius: 10px; background: rgba(255,255,255,.08); overflow: hidden; }
            .subject-progress-track i { display: block; height: 100%; border-radius: inherit; background: linear-gradient(90deg, #8b5cf6, #00f5ff); }
            .subject-progress-item small { display: block; margin-top: 7px; opacity: .55; }
            .calendar em { min-height: 55px; padding: 7px; font-style: normal; overflow: hidden; }
            .calendar em strong, .calendar em small { display: block; }
            .calendar em strong { font-size: 11px; }
            .calendar em small { font-size: 9px; opacity: .6; }
            .hb-activity-duration { text-align: center; font-size: 22px; font-weight: 800; margin: 20px 0; }
            .activity-card[style*="display: none"] { display: none !important; }
            .settings-avatar img { position: absolute; inset: 0; }

            /* ACTIVITIES: images fill the card (overrides the small 70px emoji box) */
            body .activity-card .activity-image {
                width: 100%;
                height: 150px;
                margin: 0 0 10px;
                padding: 0;
                font-size: 48px;
                overflow: hidden;
                background: rgba(var(--white-rgb), .04);
                border: 1px solid rgba(var(--white-rgb), .10);
            }
            body .activity-card .activity-image img {
                display: block;
                width: 100%;
                height: 100%;
                object-fit: cover;
                object-position: center;
            }
            .activity-grid { margin-bottom: 14px; }

            /* ABOUT: logo, tabs and developer cards */
            body .hb-about-logo { display: block; width: 110px; max-width: 100%; height: auto; margin: 0 auto; object-fit: contain; }
            .hb-about-tabs { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
            .hb-about-tab { flex: 1 1 auto; min-height: 38px; padding: 8px 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: rgba(255,255,255,.04); color: inherit; font-weight: 700; font-size: 12px; cursor: pointer; }
            .hb-about-tab.active { color: #001418; background: var(--cyan); border-color: var(--cyan); }
            .hb-team-photo { width: 100%; min-height: 80px; margin-bottom: 12px; overflow: hidden; border-radius: 16px; display: flex; align-items: center; justify-content: center; font-weight: 700; opacity: 1; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.10); }
            .hb-team-photo img { display: block; width: 100%; height: auto; max-height: 280px; object-fit: cover; }
            .hb-team-names { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 8px; margin-bottom: 12px; }
            .hb-team-name { padding: 11px 12px; text-align: center; font-weight: 700; border-radius: 12px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.10); border-left: 3px solid var(--cyan); }

            /* SETTINGS: panels shown inside the page (same box as the popup, but not floating) */
            body .hb-modal.hb-inline { position: static; inset: auto; z-index: auto; display: block; width: 100%; max-width: 680px; min-width: 0; padding: 0; background: none; -webkit-backdrop-filter: none; backdrop-filter: none; grid-column: 2; grid-row: 1; }
            body .hb-modal.hb-inline .hb-modal-box { width: 100%; max-width: none; max-height: none; overflow: visible; padding: 24px; border-radius: 18px; box-shadow: none; }
            body .hb-modal.hb-inline .hb-close { display: none; }
            @media (max-width: 700px) {
                body .hb-modal.hb-inline { grid-column: 1; grid-row: auto; max-width: none; }
                body .hb-modal.hb-inline .hb-modal-box { padding: 18px; }
            }

            /* ABOUT: settings-style list (grouped cards, icon left, arrow right) */
            .hb-menu-label { margin: 16px 0 8px 4px; color: var(--muted); font-size: 13px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
            .hb-menu-label:first-child { margin-top: 4px; }
            .hb-menu-card { overflow: hidden; border-radius: 18px; background: rgba(255,255,255,.04); border: 1px solid rgba(255,255,255,.08); }
            .hb-menu-row { display: flex; align-items: center; gap: 14px; width: 100%; min-height: 60px; padding: 0 16px; color: inherit; font-size: 15px; font-weight: 600; text-align: left; background: transparent; border: 0; cursor: pointer; transition: background .2s ease; }
            .hb-menu-row + .hb-menu-row { border-top: 1px solid rgba(255,255,255,.06); }
            .hb-menu-row:hover { background: rgba(var(--cyan-rgb), .08); }
            .hb-menu-icon { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 36px; height: 36px; font-size: 18px; border-radius: 10px; background: rgba(var(--cyan-rgb), .10); }
            .hb-menu-text { flex: 1; min-width: 0; }
            .hb-menu-chevron { flex-shrink: 0; color: var(--muted); font-size: 26px; line-height: 1; }
            .hb-menu-version { margin-top: 18px; color: var(--muted); font-size: 12px; text-align: center; }
            .hb-menu-detail-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
            .hb-menu-detail-head h3 { color: var(--white); font-family: var(--font-display); font-size: 16px; overflow-wrap: anywhere; }
            .hb-menu-back { flex-shrink: 0; width: 40px; height: 40px; color: inherit; font-size: 20px; line-height: 1; border-radius: 50%; background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.12); cursor: pointer; transition: border-color .2s ease; }
            .hb-menu-back:hover { border-color: var(--cyan); }

            /* ACTIVITIES: picture inside the Start modal */
            body .hb-activity-photo {
                width: 100%;
                height: auto;
                max-height: 280px;
                margin: 0 0 14px;
                overflow: hidden;
                border-radius: 18px;
                font-size: 64px;
                display: flex;
                align-items: center;
                justify-content: center;
                background: #000;
                border: 1px solid rgba(var(--white-rgb), .10);
            }
            body .hb-activity-photo img {
                display: block;
                width: 100%;
                height: auto;
                max-height: 280px;
                object-fit: contain;
                object-position: center;
            }

            @media (max-width: 600px) {
                .schedule-form-grid { grid-template-columns: 1fr; }
                .schedule-row { grid-template-columns: 65px 1fr auto; }
                .hb-modal-box { padding: 22px; }
                .hb-timer-display { font-size: 43px; }
            }
            @media (max-width: 500px) {
                body .activity-card .activity-image { height: 120px; }
            }
        `;

        document.head.appendChild(style);
    }

    function injectThemeStyles() {

        if ($("#healthyBreakThemeStyles")) return;

        const style = document.createElement("style");
        style.id = "healthyBreakThemeStyles";

        style.textContent = `
            body.hb-theme-ocean { --cyan: #48e5ff; --blue: #1687ff; --purple: #4969ff; --violet: #6b5cff; --pink: #38d9ff; --green: #5dffc5; --lime: #b8ffdf; }
            body.hb-theme-forest { --cyan: #62ffc0; --blue: #31b985; --purple: #6e8dff; --violet: #7d6cff; --pink: #54e7b2; --green: #55ff9a; --lime: #d0ff75; }
            body.hb-theme-violet { --cyan: #bca5ff; --blue: #8c7aff; --purple: #b26cff; --violet: #df62ff; --pink: #ff68e8; --green: #82ffce; --lime: #e6ff85; }
            .hb-theme-preview-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; margin-top: 8px; }
            .hb-theme-choice { min-height: 64px; border: 1px solid rgba(255,255,255,.10); border-radius: 12px; background: rgba(255,255,255,.025); color: #fff; font-weight: 800; cursor: pointer; }
            .hb-theme-choice.active { border-color: var(--cyan); box-shadow: 0 0 18px rgba(0,245,255,.16); }
            @media (max-width: 520px) { .hb-theme-preview-grid { grid-template-columns: 1fr 1fr; } }
        `;

        document.head.appendChild(style);
    }

    /* =====================================================
       MUSIC PLAYER
    ===================================================== */

    (function setupMusicPlayer() {

        const MUSIC_KEY = "healthyBreakMusic";

        const tracks = [
            { title: "13", src: "music/13.mp3" },
            { title: "Beauty and A beat", src: "music/beautyandabeat.mp3" },
            { title: "Summer Crush", src: "music/summercrush.mp3" },
            { title: "Be Your Everything", src: "music/beyoureverything.mp3" },
            { title: "Weng-Weng", src: "music/weng-weng.mp3" },
            
        ];

        const controls = $(".music-controls");
        const logo = $(".sidebar-logo");

        if (!controls || !logo) return;

        const prefs = readJSON(MUSIC_KEY, {});
        const audio = new Audio();

        let index = 0;
        let loaded = false;

        audio.preload = "auto";
        audio.volume = clamp(Number(prefs.volume ?? 0.6), 0, 1);

        /* styles  */

        const style = document.createElement("style");

        style.textContent = `
            .hb-player { margin: 0 2px 18px; padding: 12px; background: rgba(var(--cyan-rgb), .05); border: 1px solid var(--line-soft); border-radius: 14px; }
            .hb-player-top { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
            .hb-player-icon { flex-shrink: 0; display: flex; align-items: center; justify-content: center; width: 34px; height: 34px; color: var(--on-accent); font-size: 16px; border-radius: 10px; background: var(--cyan); box-shadow: var(--glow-cyan); }
            .hb-player.playing .hb-player-icon { animation: hbPulse 1.4s ease-in-out infinite; }
            @keyframes hbPulse { 50% { transform: scale(1.1); } }
            .hb-player-info { min-width: 0; flex: 1; }
            .hb-player-info strong { display: block; overflow: hidden; color: var(--white); font-family: var(--font-tech); font-size: 13px; letter-spacing: .5px; text-overflow: ellipsis; text-transform: none; white-space: nowrap; }
            .hb-player-info small { display: block; margin-top: 1px; color: var(--muted); font-size: 11px; font-variant-numeric: tabular-nums; letter-spacing: 0; text-transform: none; }
            .hb-player input[type="range"] { -webkit-appearance: none; appearance: none; display: block; width: 100%; height: 14px; min-height: 0; margin: 0; padding: 0; background: transparent; border: 0; border-radius: 0; box-shadow: none; cursor: pointer; }
            .hb-player input[type="range"]:focus { box-shadow: none; }
            .hb-player input[type="range"]::-webkit-slider-runnable-track { height: 4px; border-radius: 4px; background: linear-gradient(90deg, var(--cyan) var(--fill, 0%), rgba(var(--white-rgb), .14) var(--fill, 0%)); }
            .hb-player input[type="range"]::-webkit-slider-thumb { -webkit-appearance: none; width: 12px; height: 12px; margin-top: -4px; border: 0; border-radius: 50%; background: var(--white); box-shadow: 0 0 8px rgba(var(--cyan-rgb), .8); }
            .hb-player input[type="range"]::-moz-range-track { height: 4px; border-radius: 4px; background: rgba(var(--white-rgb), .14); }
            .hb-player input[type="range"]::-moz-range-progress { height: 4px; border-radius: 4px; background: var(--cyan); }
            .hb-player input[type="range"]::-moz-range-thumb { width: 12px; height: 12px; border: 0; border-radius: 50%; background: var(--white); }
            .hb-player-buttons { display: flex; align-items: center; justify-content: space-between; gap: 6px; margin: 8px 0; }
            .hb-player-buttons button { flex: 1; height: 34px; min-height: 0; padding: 0; color: var(--muted); font-size: 14px; line-height: 1; letter-spacing: 0; background: rgba(var(--white-rgb), .04); border: 1px solid var(--line-soft); border-radius: 10px; transition: color .2s ease, background .2s ease, border-color .2s ease; }
            .hb-player-buttons button:hover { color: var(--cyan); background: var(--tint-strong); border-color: var(--line-strong); }
            .hb-player-buttons .hb-play { flex: 1.4; color: var(--on-accent); background: var(--cyan); border-color: var(--cyan); }
            .hb-player-buttons .hb-play:hover { color: var(--on-accent); background: var(--cyan); box-shadow: var(--glow-cyan); }
            .hb-player-volume { display: flex; align-items: center; gap: 8px; color: var(--muted); font-size: 12px; }
            .hb-track-row { cursor: pointer; transition: border-color .2s ease, background .2s ease; }
            .hb-track-row:hover { border-color: var(--line-strong); }
            .hb-track-row.current { border-color: var(--cyan); background: var(--tint); }
                                    @media (max-width: 700px) {
                /* Phone: maliit na mini player sa ibabaw ng bottom navigation */
                .hb-player {
                    display: grid;
                    grid-template-columns: minmax(0, 1fr) auto;
                    grid-template-areas: "info buttons" "seek seek";
                    align-items: center;
                    column-gap: 8px;
                    row-gap: 2px;

                    position: fixed;
                    left: max(8px, var(--safe-left));
                    right: max(8px, var(--safe-right));
                    bottom: calc(66px + var(--safe-bottom) + 6px);
                    z-index: 25;

                    margin: 0;
                    padding: 6px 8px;
                    background: var(--panel);
                    border-color: var(--line);
                    border-radius: 12px;
                    box-shadow: 0 6px 18px rgba(0, 0, 0, .5);
                }
                .hb-player-top { grid-area: info; margin: 0; min-width: 0; gap: 8px; }
                .hb-player-icon { width: 28px; height: 28px; font-size: 13px; border-radius: 8px; }
                .hb-player-info strong { font-size: 12px; }
                .hb-player-info small { font-size: 10px; }
                .hb-player-buttons { grid-area: buttons; margin: 0; gap: 4px; }
                .hb-player-buttons button { flex: none; width: 34px; height: 34px; font-size: 13px; }
                .hb-player-buttons .hb-play { flex: none; width: 42px; }
                .hb-seek { grid-area: seek; height: 10px; }
                .hb-player-volume { display: none; }

                /* Espasyo sa ilalim ng page para hindi matakpan ng player ang content */
                body #dashboard:not(.hidden) .main-content {
                    padding-bottom: calc(150px + var(--safe-bottom));
                }

                /* Toast sa itaas ng player */
                body .toast {
                    bottom: calc(140px + var(--safe-bottom));
                }
            }
                
            @media (max-height: 760px) and (min-width: 701px) { .hb-player-volume { display: none; } .hb-player { margin-bottom: 12px; padding: 10px; } }
            @media (max-height: 600px) and (min-width: 701px) { .hb-player-top { display: none; } .hb-player { margin-bottom: 8px; padding: 8px; } .hb-player-buttons { margin: 6px 0 0; } }
        `;

        document.head.appendChild(style);


        controls.remove();

        const card = document.createElement("div");

        card.className = "hb-player";
        card.innerHTML = `
            <div class="hb-player-top">
                <div class="hb-player-icon">♫</div>
                <div class="hb-player-info">
                    <strong id="hbTrackTitle"></strong>
                    <small id="hbTrackTime">0:00 / 0:00</small>
                </div>
            </div>
            <input type="range" class="hb-seek" min="0" max="100" step="0.1" value="0" aria-label="Seek">
            <div class="hb-player-buttons">
                <button type="button" data-music="prev" title="Previous">⏮</button>
                <button type="button" data-music="play" class="hb-play" title="Play or Pause">▶</button>
                <button type="button" data-music="next" title="Next">⏭</button>
                <button type="button" data-music="list" title="Playlist">☷</button>
            </div>
            <div class="hb-player-volume">
                <span>🔊</span>
                <input type="range" class="hb-volume" min="0" max="1" step="0.01" aria-label="Volume">
            </div>
        `;

        logo.insertAdjacentElement("afterend", card);

        const titleEl = $("#hbTrackTitle", card);
        const timeEl = $("#hbTrackTime", card);
        const seek = $(".hb-seek", card);
        const volume = $(".hb-volume", card);
        const playButton = $(".hb-play", card);

        const fill = (input, percent) => input.style.setProperty("--fill", `${clamp(percent, 0, 100)}%`);

        const clock = seconds => {
            seconds = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0;
            return `${Math.floor(seconds / 60)}:${pad(seconds % 60)}`;
        };

        /* ---------- player logic ---------- */

        function updateInfo() {
            const track = tracks[index];
            titleEl.textContent = track ? track.title : "No songs yet";
            titleEl.title = titleEl.textContent;
        }

        function updatePlayButton() {
            const playing = !audio.paused;
            playButton.textContent = playing ? "⏸" : "▶";
            card.classList.toggle("playing", playing);
        }

        function loadTrack(newIndex, autoplay) {

            if (tracks.length === 0) return showToast("Add songs first. Tap ☷ then ＋ ADD SONGS.");

            index = (newIndex + tracks.length) % tracks.length;
            audio.src = tracks[index].src;
            loaded = true;

            seek.value = 0;
            fill(seek, 0);
            timeEl.textContent = "0:00 / 0:00";
            updateInfo();

            if (autoplay) {
                audio.play().catch(() => { /* the error event shows the message */ });
            }

            updatePlayButton();
            renderPlaylist();
        }

        function togglePlay() {

            if (tracks.length === 0) return showToast("Add songs first. Tap ☷ then ＋ ADD SONGS.");

            if (!loaded) return loadTrack(index, true);

            if (audio.paused) audio.play().catch(() => {});
            else audio.pause();
        }

        const next = () => loadTrack(index + 1, true);
        const previous = () => {
            if (audio.currentTime > 3) audio.currentTime = 0;
            else loadTrack(index - 1, true);
        };

        audio.addEventListener("play", updatePlayButton);
        audio.addEventListener("pause", updatePlayButton);
        audio.addEventListener("ended", next);

        audio.addEventListener("error", () => {
            if (!audio.src) return;
            updatePlayButton();
            showToast(`Can't play "${tracks[index] ? tracks[index].title : "song"}". Check the music folder or add songs from your device.`, 4000);
        });

        audio.addEventListener("timeupdate", () => {
            const duration = audio.duration;
            const percent = duration ? audio.currentTime / duration * 100 : 0;
            if (document.activeElement !== seek) seek.value = percent;
            fill(seek, percent);
            timeEl.textContent = `${clock(audio.currentTime)} / ${clock(duration)}`;
        });

        seek.addEventListener("input", () => {
            fill(seek, Number(seek.value));
            if (audio.duration) audio.currentTime = Number(seek.value) / 100 * audio.duration;
        });

        volume.value = audio.volume;
        fill(volume, audio.volume * 100);

        volume.addEventListener("input", () => {
            audio.volume = Number(volume.value);
            fill(volume, audio.volume * 100);
            writeJSON(MUSIC_KEY, { volume: audio.volume });
        });

        card.addEventListener("click", event => {

            const button = event.target.closest("[data-music]");

            if (!button) return;

            const action = button.dataset.music;

            if (action === "play") togglePlay();
            else if (action === "next") tracks.length ? next() : showToast("Add songs first.");
            else if (action === "prev") tracks.length ? previous() : showToast("Add songs first.");
            else if (action === "list") openPlaylist();
        });

        /* ---------- playlist ---------- */

        let playlistBody = null;

        function renderPlaylist() {

            if (!playlistBody || !document.body.contains(playlistBody)) return;

            const list = $("#hbPlaylistList", playlistBody);

            if (!list) return;

            list.innerHTML = "";

            if (tracks.length === 0) {
                list.appendChild(createElement("p", "hb-modal-description", "No songs yet."));
                return;
            }

            tracks.forEach((track, i) => {

                const row = createElement("div", "hb-setting-option hb-track-row" + (i === index ? " current" : ""));
                const info = document.createElement("div");
                const name = createElement("strong", "", track.title);
                const status = createElement("small", "", i === index && !audio.paused ? "Now playing" : `Track ${i + 1}`);
                const button = createElement("button", "hb-setting-action", i === index && !audio.paused ? "⏸" : "▶");

                button.type = "button";
                info.append(name, status);
                row.append(info, button);

                row.addEventListener("click", () => {
                    if (i === index && loaded) togglePlay();
                    else loadTrack(i, true);
                    renderPlaylist();
                });

                list.appendChild(row);
            });
        }

        function openPlaylist() {

            playlistBody = openGenericModal("Playlist", "🎵", `
                <div id="hbPlaylistList"></div>
                <div class="hb-timer-actions" style="margin-top:14px;">
                    <button type="button" class="green-action" id="hbAddSongs">＋ Add Songs</button>
                </div>
                <p class="hb-modal-description" style="margin-top:10px;">
                    Songs you add from your device stay until you refresh the page.
                    For permanent songs, put them in the music folder and list them in script.js.
                </p>
            `, "playlist");

            $("#hbAddSongs", playlistBody).addEventListener("click", () => {

                const input = document.createElement("input");

                input.type = "file";
                input.accept = "audio/*";
                input.multiple = true;

                input.addEventListener("change", () => {

                    const files = Array.from(input.files || []).filter(file => file.type.startsWith("audio/"));

                    if (files.length === 0) return;

                    const hadNothing = tracks.length === 0;

                    files.forEach(file => tracks.push({
                        title: file.name.replace(/\.[^.]+$/, ""),
                        src: URL.createObjectURL(file)
                    }));

                    renderPlaylist();
                    updateInfo();
                    showToast(`${files.length} song${files.length === 1 ? "" : "s"} added! 🎵`);

                    if (hadNothing) loadTrack(0, false);
                });

                input.click();
            });

            renderPlaylist();
        }

        audio.addEventListener("play", renderPlaylist);
        audio.addEventListener("pause", renderPlaylist);

        updateInfo();
        updatePlayButton();

    })();

    /* ===================== INITIAL RENDER ===================== */

    function initialize() {

        injectRuntimeStyles();
        injectThemeStyles();
        assignRuntimeIds();
        applyHealthyBreakTheme(data.settings.theme);

        setupEvents();
        setupLogoUploader();
        addDashboardUtilityButton();
        ensureTimerChip();
        ensureTimerModal();

        renderActivities();
        renderOnboardingSubjects();
        renderOnboardingProfile();
        updateProfileUI();

        if (data.onboardingComplete) {
            $("#onboarding")?.classList.add("hidden");
            $("#dashboard")?.classList.remove("hidden");
            syncStats();
            renderAllDashboard();
            showPage("home");
        } else {
            $("#onboarding")?.classList.remove("hidden");
            $("#dashboard")?.classList.add("hidden");
            showOnboardingStep(1);
        }

        restoreTimer();
    }

    initialize();

});