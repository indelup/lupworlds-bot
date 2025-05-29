import express from "express";
import Redis from "ioredis";
import { getAuth, startWebSocketClient } from "./bot";
import "dotenv/config";

const env = process.env;
const app = express();
const port = 3000;

const redisClient = new Redis(
  `rediss://default:${env.REDIS_PASSWORD}@${env.REDIS_ENDPOINT}:${env.REDIS_PORT}`
);

app.get("/", (req, res) => {
  res.send("Hola mundo");
});

app.get("/start", async (req, res) => {
  const channelId = req.query.channelId;
  const token = await redisClient.get("twitchToken");

  await (async () => {
    await getAuth(token);
    startWebSocketClient(token, channelId);
  })();

  res.send("Bot inicializado!!");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
