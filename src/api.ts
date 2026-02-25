import "dotenv/config";
import axios from "axios";
import type {
    User,
    Banner,
    Character,
    Material,
    PlayerWorldData,
} from "@melda/lupworlds-types";

const apiClient = axios.create({
    baseURL: process.env.API_BASE_URL,
});

const safeGet = async <T>(path: string): Promise<T | null> => {
    try {
        const res = await apiClient.get<T>(path);
        return res.data;
    } catch {
        return null;
    }
};

const safePost = async <T>(path: string, body: unknown): Promise<T | null> => {
    try {
        const res = await apiClient.post<T>(path, body);
        return res.data;
    } catch {
        return null;
    }
};

const safePut = async <T>(path: string, body: unknown): Promise<T | null> => {
    try {
        const res = await apiClient.put<T>(path, body);
        return res.data;
    } catch {
        return null;
    }
};

export const getUser = (twitchId: string) =>
    safeGet<User>(`/users/${twitchId}`);

export const createUser = (body: Omit<User, "id">) =>
    safePost<User>(`/users`, body);

export const getBanners = (worldId: string) =>
    safeGet<Banner[]>(`/banners?worldId=${worldId}`);

export const getCharacters = (worldId: string) =>
    safeGet<Character[]>(`/characters?worldId=${worldId}`);

export const getMaterials = (worldId: string) =>
    safeGet<Material[]>(`/materials?worldId=${worldId}`);

export const getPlayerData = (userId: string, worldId: string) =>
    safeGet<PlayerWorldData>(`/player-data/${userId}/${worldId}`);

export const upsertPlayerData = (
    userId: string,
    worldId: string,
    data: PlayerWorldData,
) => safePut<PlayerWorldData>(`/player-data/${userId}/${worldId}`, data);
