/**
 * Data Loader — Fetches JSON data files and caches them.
 */

const DataLoader = (() => {
    const BASE_PATH = 'public/data/2025/fedex-ground';
    let _cache = {};

    async function loadJSON(filename) {
        if (_cache[filename]) return _cache[filename];
        const resp = await fetch(`${BASE_PATH}/${filename}`);
        if (!resp.ok) throw new Error(`Failed to load ${filename}: ${resp.status}`);
        const data = await resp.json();
        _cache[filename] = data;
        return data;
    }

    async function loadAll() {
        const [rates, surcharges, defaults, zones, meta] = await Promise.all([
            loadJSON('rates.json'),
            loadJSON('surcharges.json'),
            loadJSON('defaults.json'),
            loadJSON('zones.json'),
            loadJSON('meta.json'),
        ]);
        return { rates, surcharges, defaults, zones, meta };
    }

    function clearCache() {
        _cache = {};
    }

    return { loadJSON, loadAll, clearCache };
})();
