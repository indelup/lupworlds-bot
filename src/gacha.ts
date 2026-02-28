import type { Banner, BannerBag, BannerBagItem, Character, GachaItem, Material, PlayerWorldData, User, World } from "@melda/lupworlds-types";
import { ROLE } from "@melda/lupworlds-types";
import {
    getUser,
    createUser,
    getWorld,
    getBanners,
    getCharacters,
    getMaterials,
    getPlayerData,
    upsertPlayerData,
} from "./api";
import { broadcast } from "./broadcast";

// --- Streamer cache (fixed per bot instance) ---

const streamerCache = new Map<string, import("@melda/lupworlds-types").User>();

const getStreamer = async (channelId: string) => {
    const cached = streamerCache.get(channelId);
    if (cached) return cached;
    const streamer = await getUser(channelId);
    if (streamer) streamerCache.set(channelId, streamer);
    return streamer;
};

// --- In-memory cache for world assets (fixed per bot instance) ---

interface WorldCache {
    world: World;
    banners: Banner[];
    characters: Character[];
    materials: Material[];
}

const worldCache = new Map<string, WorldCache>();

const getWorldAssets = async (worldId: string): Promise<WorldCache | null> => {
    const cached = worldCache.get(worldId);
    if (cached) return cached;

    const [world, banners, characters, materials] = await Promise.all([
        getWorld(worldId),
        getBanners(worldId),
        getCharacters(worldId),
        getMaterials(worldId),
    ]);

    if (!world) return null;

    const data: WorldCache = {
        world,
        banners: banners ?? [],
        characters: characters ?? [],
        materials: materials ?? [],
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
    redeemId: string,
): Promise<string> => {
    const tag = `@${viewerLogin}`;

    const streamer = await getStreamer(channelId);
    if (!streamer) return `${tag} No se encontró el streamer en el sistema.`;

    const worldId = streamer.worldIds?.[0];
    if (!worldId) return `${tag} El streamer no tiene un mundo configurado.`;

    const assets = await getWorldAssets(worldId);
    if (!assets) return `${tag} No se pudo cargar el mundo.`;

    const { world, banners, characters, materials } = assets;

    const mapping = world.redeems?.find((r) => r.redeemId === redeemId);
    if (!mapping) return `${tag} Este redeem no está vinculado a ningún banner.`;

    const banner = banners.find((b) => b.id === mapping.bannerId);
    if (!banner) return `${tag} El banner configurado para este redeem no existe.`;
    if (!banner.bags || banner.bags.length === 0)
        return `${tag} El banner no tiene bolsas configuradas.`;

    const bag = pickWeightedBag(banner.bags);
    if (!bag) return `${tag} Error al seleccionar bolsa.`;

    const bagItem = pickRandomItem(bag);
    if (!bagItem) return `${tag} La bolsa está vacía.`;

    let name: string;
    let rarity: number;
    let foundItem: Character | Material | undefined;

    if (bagItem.type === "character") {
        const char = characters.find((c) => c.id === bagItem.itemId);
        name = char?.name ?? "Personaje desconocido";
        rarity = char?.rarity ?? 1;
        foundItem = char;
    } else {
        const mat = materials.find((m) => m.id === bagItem.itemId);
        name = mat?.name ?? "Material desconocido";
        rarity = mat?.rarity ?? 1;
        foundItem = mat;
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

    if (foundItem) {
        broadcast({ channelId, viewerLogin, itemType: bagItem.type, item: foundItem });
    }

    const stars = "★".repeat(rarity);
    const typeLabel = bagItem.type === "character" ? "personaje" : "material";
    return `${tag} ¡Has obtenido ${name} ${stars} (${typeLabel})!`;
};
