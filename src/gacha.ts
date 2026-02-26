import type { Banner, BannerBag, BannerBagItem, GachaItem, PlayerWorldData, User } from "@melda/lupworlds-types";
import { ROLE } from "@melda/lupworlds-types";
import {
    getUser,
    createUser,
    getBanners,
    getCharacters,
    getMaterials,
    getPlayerData,
    upsertPlayerData,
} from "./api";

// --- Streamer cache (fixed per bot instance) ---

let cachedStreamer: import("@melda/lupworlds-types").User | null = null;

const getStreamer = async (channelId: string) => {
    if (cachedStreamer) return cachedStreamer;
    cachedStreamer = await getUser(channelId);
    return cachedStreamer;
};

// --- In-memory cache for world assets (5-minute TTL) ---

interface WorldCache {
    banners: Banner[];
    characters: { id: string; name: string; rarity: number }[];
    materials: { id: string; name: string; rarity: number }[];
    fetchedAt: number;
}

const worldCache = new Map<string, WorldCache>();
const CACHE_TTL_MS = 5 * 60 * 1000;

const getWorldAssets = async (worldId: string): Promise<WorldCache> => {
    const cached = worldCache.get(worldId);
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
        return cached;
    }

    const [banners, characters, materials] = await Promise.all([
        getBanners(worldId),
        getCharacters(worldId),
        getMaterials(worldId),
    ]);

    const data: WorldCache = {
        banners: banners ?? [],
        characters: characters ?? [],
        materials: materials ?? [],
        fetchedAt: Date.now(),
    };
    worldCache.set(worldId, data);
    return data;
};

// --- Gacha mechanics ---

const pickWeightedBag = (bags: BannerBag[]): BannerBag | null => {
    const total = bags.reduce((sum, bag) => sum + bag.chance, 0);
    let rand = Math.random() * total;
    for (const bag of bags) {
        rand -= bag.chance;
        if (rand <= 0) return bag;
    }
    return bags[bags.length - 1] ?? null;
};

const pickRandomItem = (bag: BannerBag): BannerBagItem | null => {
    if (bag.items.length === 0) return null;
    return bag.items[Math.floor(Math.random() * bag.items.length)];
};

// --- Inventory helpers ---

const addToInventory = (
    data: PlayerWorldData,
    type: "character" | "material",
    itemId: string,
): PlayerWorldData => {
    const list: GachaItem[] =
        type === "character" ? data.characters : data.materials;
    const existing = list.find((i) => i.itemId === itemId);
    if (existing) {
        existing.quantity += 1;
    } else {
        list.push({ itemId, quantity: 1 });
    }
    return data;
};

// --- User lookup / on-the-fly creation ---

const pendingCreations = new Map<string, Promise<User | null>>();

const getOrCreateUser = async (
    twitchId: string,
    displayName: string,
): Promise<User | null> => {
    const existing = await getUser(twitchId);
    if (existing) return existing;

    // Coalesce concurrent creation requests for the same twitchId
    const inflight = pendingCreations.get(twitchId);
    if (inflight) return inflight;

    const promise = createUser({
        twitchId,
        alias: displayName,
        allowedRoles: [ROLE.VIEWER],
        worldIds: [],
    }).finally(() => pendingCreations.delete(twitchId));

    pendingCreations.set(twitchId, promise);
    return promise;
};

// --- Public command handlers ---

export const performGachaPull = async (
    channelId: string,
    viewerTwitchId: string,
    viewerLogin: string,
    viewerDisplayName: string,
): Promise<string> => {
    const tag = `@${viewerLogin}`;

    const streamer = await getStreamer(channelId);
    if (!streamer) return `${tag} No se encontró el streamer en el sistema.`;

    const worldId = streamer.worldIds?.[0];
    if (!worldId) return `${tag} El streamer no tiene un mundo configurado.`;

    const { banners, characters, materials } = await getWorldAssets(worldId);

    if (banners.length === 0)
        return `${tag} No hay banners activos en este momento.`;

    const banner = banners[0];
    if (!banner.bags || banner.bags.length === 0)
        return `${tag} El banner no tiene bolsas configuradas.`;

    const bag = pickWeightedBag(banner.bags);
    if (!bag) return `${tag} Error al seleccionar bolsa.`;

    const bagItem = pickRandomItem(bag);
    if (!bagItem) return `${tag} La bolsa está vacía.`;

    let name: string;
    let rarity: number;

    if (bagItem.type === "character") {
        const char = characters.find((c) => c.id === bagItem.itemId);
        name = char?.name ?? "Personaje desconocido";
        rarity = char?.rarity ?? 1;
    } else {
        const mat = materials.find((m) => m.id === bagItem.itemId);
        name = mat?.name ?? "Material desconocido";
        rarity = mat?.rarity ?? 1;
    }

    // Ensure the viewer has an app account, creating one on the fly if needed
    const user = await getOrCreateUser(viewerTwitchId, viewerDisplayName);
    if (!user) return `${tag} No se pudo crear tu cuenta. Intenta de nuevo.`;

    // Persist to DynamoDB using the app UUID as userId
    const current = (await getPlayerData(user.id, worldId)) ?? {
        userId: user.id,
        worldId,
        characters: [],
        materials: [],
    };
    const updated = addToInventory(current, bagItem.type, bagItem.itemId);
    await upsertPlayerData(user.id, worldId, updated);

    const stars = "★".repeat(rarity);
    const typeLabel = bagItem.type === "character" ? "personaje" : "material";
    return `${tag} ¡Has obtenido ${name} ${stars} (${typeLabel})!`;
};
