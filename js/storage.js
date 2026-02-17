/**
 * Storage — LocalStorage scenarios + URL state sharing.
 */

const Storage = (() => {
    const STORAGE_KEY = 'musicus_shipping_scenarios';

    // ─── URL State ──────────────────────────────────────────────────

    function encodeState(state) {
        const json = JSON.stringify(state);
        return btoa(unescape(encodeURIComponent(json)));
    }

    function decodeState(encoded) {
        try {
            const json = decodeURIComponent(escape(atob(encoded)));
            return JSON.parse(json);
        } catch {
            return null;
        }
    }

    function saveToURL(state) {
        const encoded = encodeState(state);
        const url = new URL(window.location);
        url.searchParams.set('s', encoded);
        window.history.replaceState(null, '', url.toString());
    }

    function loadFromURL() {
        const params = new URLSearchParams(window.location.search);
        const encoded = params.get('s');
        if (!encoded) return null;
        return decodeState(encoded);
    }

    function getShareURL(state) {
        const encoded = encodeState(state);
        const url = new URL(window.location.origin + window.location.pathname);
        url.searchParams.set('s', encoded);
        return url.toString();
    }

    // ─── LocalStorage Scenarios ─────────────────────────────────────

    function getScenarios() {
        try {
            const raw = localStorage.getItem(STORAGE_KEY);
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    }

    function saveScenario(name, state) {
        const scenarios = getScenarios();
        const existing = scenarios.findIndex(s => s.name === name);
        const entry = {
            name,
            state,
            savedAt: new Date().toISOString(),
        };
        if (existing >= 0) {
            scenarios[existing] = entry;
        } else {
            scenarios.push(entry);
        }
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
        return scenarios;
    }

    function deleteScenario(name) {
        const scenarios = getScenarios().filter(s => s.name !== name);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
        return scenarios;
    }

    function loadScenario(name) {
        const scenarios = getScenarios();
        const found = scenarios.find(s => s.name === name);
        return found ? found.state : null;
    }

    // ─── JSON Export / Import ───────────────────────────────────────

    function exportJSON(state) {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `shipping-calc-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }

    function importJSON(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                try {
                    resolve(JSON.parse(reader.result));
                } catch (e) {
                    reject(new Error('Invalid JSON file'));
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsText(file);
        });
    }

    return {
        saveToURL, loadFromURL, getShareURL,
        getScenarios, saveScenario, deleteScenario, loadScenario,
        exportJSON, importJSON,
    };
})();
