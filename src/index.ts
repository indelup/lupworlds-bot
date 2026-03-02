import express, { Request, Response, NextFunction } from "express";
import { startWebSocketClient, stopWebSocketClient, checkToken, isSessionActive } from "./bot";
import { redisClient } from "./redis";
import { attachOverlayServer } from "./broadcast";
import "dotenv/config";

const app = express();
const port = 3000;

app.use((req: Request, res: Response, next: NextFunction) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.get("/", (req, res) => {
  res.send("Hola mundo");
});

app.get("/start", async (req, res) => {
  const channelId = req.query.channelId as string;
  const streamerToken = req.query.streamerToken as string;

  if (!channelId) {
    res.status(400).send("channelId is required");
    return;
  }
  if (!streamerToken) {
    res.status(400).send("streamerToken is required");
    return;
  }

  const tokenValid = await checkToken();
  if (!tokenValid) {
    res.status(401).send("Bot token is invalid");
    return;
  }

  const botToken = await redisClient.get("twitchToken");
  const started = startWebSocketClient(botToken, streamerToken, channelId);
  if (!started) {
    res.status(409).send("Bot ya está activo para este canal.");
    return;
  }

  res.send("Bot inicializado!!");
});

app.get("/status", (req: Request, res: Response) => {
  const channelId = req.query.channelId as string;
  if (!channelId) {
    res.status(400).send("channelId is required");
    return;
  }
  res.json({ active: isSessionActive(channelId) });
});

app.get("/stop", (req: Request, res: Response) => {
  const channelId = req.query.channelId as string;
  if (!channelId) {
    res.status(400).send("channelId is required");
    return;
  }
  const stopped = stopWebSocketClient(channelId);
  if (!stopped) {
    res.status(404).send("No hay bot activo para este canal.");
    return;
  }
  res.send("Bot detenido!");
});

const server = app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

attachOverlayServer(server);
