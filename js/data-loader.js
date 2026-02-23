/**
 * Data Loader — Fetches JSON data files for any carrier and caches them.
 */

const DataLoader = (() => {
    const CARRIER_PATHS = {
        'fedex-ground': 'public/data/2025/fedex-ground',
        'amazon-shipping': 'public/data/2026/amazon-shipping',
    };

    let _cache = {};

    async function loadJSON(carrier, filename) {
        const cacheKey = `${carrier}/${filename}`;
        if (_cache[cacheKey]) return _cache[cacheKey];
        const basePath = CARRIER_PATHS[carrier];
        if (!basePath) throw new Error(`Unknown carrier: ${carrier}`);
        const resp = await fetch(`${basePath}/${filename}`);
        if (!resp.ok) throw new Error(`Failed to load ${cacheKey}: ${resp.status}`);
        const data = await resp.json();
        _cache[cacheKey] = data;
        return data;
    }

    async function loadAll(carrier) {
        carrier = carrier || 'fedex-ground';
        const [rates, surcharges, defaults, zones, meta] = await Promise.all([
            loadJSON(carrier, 'rates.json'),
            loadJSON(carrier, 'surcharges.json'),
            loadJSON(carrier, 'defaults.json'),
            loadJSON(carrier, 'zones.json'),
            loadJSON(carrier, 'meta.json'),
        ]);
        return { rates, surcharges, defaults, zones, meta };
    }

    function getCarriers() {
        return Object.keys(CARRIER_PATHS);
    }

    function clearCache() {
        _cache = {};
    }

    return { loadJSON, loadAll, getCarriers, clearCache };
})();
