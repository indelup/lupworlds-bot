import express from "express";
import { startWebSocketClient, checkToken, redisClient } from "./bot";
import "dotenv/config";

const app = express();
const port = 3000;

app.get("/", (req, res) => {
  res.send("Hola mundo");
});

app.get("/start", async (req, res) => {
  const channelId = req.query.channelId;
  const tokenValid = await checkToken();

  if (!tokenValid) {
    res.send("Invalid token");
    return;
  }

  const token = await redisClient.get("twitchToken");
  startWebSocketClient(token, channelId);

  res.send("Bot inicializado!!");
});

app.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
