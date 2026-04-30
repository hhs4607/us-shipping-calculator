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

    async function loadBoth() {
        const [fedex, amazon] = await Promise.all([
            loadAll('fedex-ground'),
            loadAll('amazon-shipping'),
        ]);
        return { fedex, amazon };
    }

    function getCarriers() {
        return Object.keys(CARRIER_PATHS);
    }

    const YAMATO_PATH = 'public/data/2025/yamato';
    const SAGAWA_PATH = 'public/data/2025/sagawa';

    async function loadYamatoJSON(filename) {
        const cacheKey = `yamato/${filename}`;
        if (_cache[cacheKey]) return _cache[cacheKey];
        const resp = await fetch(`${YAMATO_PATH}/${filename}`);
        if (!resp.ok) throw new Error(`Failed to load ${cacheKey}: ${resp.status}`);
        const data = await resp.json();
        _cache[cacheKey] = data;
        return data;
    }

    async function loadYamato() {
        const [ratesCash, ratesCashless, ratesIntrapref, zones, surcharges, discounts, defaults, meta] = await Promise.all([
            loadYamatoJSON('rates-cash.json'),
            loadYamatoJSON('rates-cashless.json'),
            loadYamatoJSON('rates-intrapref.json'),
            loadYamatoJSON('zones.json'),
            loadYamatoJSON('surcharges.json'),
            loadYamatoJSON('discounts.json'),
            loadYamatoJSON('defaults.json'),
            loadYamatoJSON('meta.json'),
        ]);
        return { ratesCash, ratesCashless, ratesIntrapref, zones, surcharges, discounts, defaults, meta };
    }

    async function loadSagawaJSON(filename) {
        const cacheKey = `sagawa/${filename}`;
        if (_cache[cacheKey]) return _cache[cacheKey];
        const resp = await fetch(`${SAGAWA_PATH}/${filename}`);
        if (!resp.ok) throw new Error(`Failed to load ${cacheKey}: ${resp.status}`);
        const data = await resp.json();
        _cache[cacheKey] = data;
        return data;
    }

    async function loadSagawa() {
        const [rates, zones, surcharges, defaults, meta] = await Promise.all([
            loadSagawaJSON('rates.json'),
            loadSagawaJSON('zones.json'),
            loadSagawaJSON('surcharges.json'),
            loadSagawaJSON('defaults.json'),
            loadSagawaJSON('meta.json'),
        ]);
        return { rates, zones, surcharges, defaults, meta };
    }

    async function loadJp() {
        const [yamato, sagawa] = await Promise.all([loadYamato(), loadSagawa()]);
        return { yamato, sagawa };
    }

    function clearCache() {
        _cache = {};
    }

    return { loadJSON, loadAll, loadBoth, loadYamato, loadSagawa, loadJp, getCarriers, clearCache };
})();
