import "dotenv/config";
import Redis from "ioredis";

const env = process.env;

export const redisClient = new Redis(
    `rediss://default:${env.REDIS_PASSWORD}@${env.REDIS_ENDPOINT}:${env.REDIS_PORT}`
);
