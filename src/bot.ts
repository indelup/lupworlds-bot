import { WebSocket } from "ws";
import "dotenv/config";
import { redisClient } from "./redis";
import { performGachaPull } from "./gacha";

const env = process.env;
const BOT_USER_ID = env.BOT_USER_ID;
const CLIENT_ID = env.CLIENT_ID;

const EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";

interface ActiveSession {
  botWs: WebSocket;
  streamerWs: WebSocket;
}

const activeSessions = new Map<string, ActiveSession>();
export { redisClient };

export const checkToken = async () => {
  const token = await redisClient.get("twitchToken");
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    method: "GET",
    headers: {
      Authorization: "OAuth " + token,
    },
  });

  if (response.status == 401) {
    const newTokenData = await refreshToken();
    await redisClient.set("twitchToken", newTokenData.access_token);
    await redisClient.set("twitchRefresh", newTokenData.refresh_token);
    return true;
  } else if (response.status != 200) {
    console.error(
      "Token is not valid. /oauth2/validate returned status code " +
        response.status
    );
    return false;
  }
  return true;
};

const refreshToken = async () => {
  const refreshToken = await redisClient.get("twitchRefresh");

  const formData = new URLSearchParams();
  formData.append("client_id", env.CLIENT_ID);
  formData.append("client_secret", env.CLIENT_SECRET);
  formData.append("grant_type", "refresh_token");
  formData.append("refresh_token", refreshToken);

  const response = await fetch("https://id.twitch.tv/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });

  if (response.status != 200) {
    const data = await response.json();
    console.error("Could not retrieve new token");
    console.error(data);
    process.exit(1);
  }

  const data = await response.json();
  return data;
};

const subscribe = async (
  token: string,
  sessionId: string,
  type: string,
  version: string,
  condition: Record<string, string>
) => {
  const response = await fetch(
    "https://api.twitch.tv/helix/eventsub/subscriptions",
    {
      method: "POST",
      headers: {
        Authorization: "Bearer " + token,
        "Client-Id": CLIENT_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        type,
        version,
        condition,
        transport: {
          method: "websocket",
          session_id: sessionId,
        },
      }),
    }
  );
  const data = await response.json();

  if (response.status != 202) {
    console.error(
      `Failed to subscribe to ${type}. API call returned status code ${response.status}`
    );
    console.error(data);
    process.exit(1);
  } else {
    console.log(`Subscribed to ${type} [${data.data[0].id}]`);
  }
};

const sendChatMessage = async (
  message: string,
  token: string,
  channelId: string
) => {
  const response = await fetch("https://api.twitch.tv/helix/chat/messages", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + token,
      "Client-Id": CLIENT_ID,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      broadcaster_id: channelId,
      sender_id: BOT_USER_ID,
      message: message,
    }),
  });

  if (response.status != 200) {
    const data = await response.json();
    console.error("Failed to send chat message");
    console.error(data);
  } else {
    console.log("Sent chat message: " + message);
  }
};

const openWebSocket = (
  onReady: (sessionId: string) => Promise<void>,
  onNotification: (data: any) => void,
  onClose: () => void,
): WebSocket => {
  const ws = new WebSocket(EVENTSUB_WEBSOCKET_URL);

  ws.on("error", console.error);
  ws.on("open", () => {
    console.log(`WebSocket connection opened to ${EVENTSUB_WEBSOCKET_URL}`);
  });
  ws.on("close", onClose);
  ws.on("message", (raw) => {
    const data = JSON.parse(raw.toString());
    const messageType = data.metadata.message_type;
    if (messageType === "session_welcome") {
      onReady(data.payload.session.id).catch(console.error);
    } else if (messageType === "notification") {
      onNotification(data);
    }
  });

  return ws;
};

export const startWebSocketClient = (
  botToken: string,
  streamerToken: string,
  channelId: string
): boolean => {
  if (activeSessions.has(channelId)) return false;

  const cleanup = () => {
    activeSessions.delete(channelId);
    console.log(`Bot stopped for channel ${channelId}`);
  };

  const botWs = openWebSocket(
    async (sessionId) => {
      await subscribe(botToken, sessionId, "channel.chat.message", "1", {
        broadcaster_user_id: channelId,
        user_id: BOT_USER_ID,
      });
    },
    (data) => {
      if (data.metadata.subscription_type !== "channel.chat.message") return;
      const event = data.payload.event;
      console.log(
        `MSG #${event.broadcaster_user_login} <${event.chatter_user_login}> ${event.message.text}`
      );
    },
    cleanup,
  );

  const streamerWs = openWebSocket(
    async (sessionId) => {
      await subscribe(
        streamerToken,
        sessionId,
        "channel.channel_points_custom_reward_redemption.add",
        "1",
        { broadcaster_user_id: channelId }
      );
    },
    (data) => {
      if (data.metadata.subscription_type !== "channel.channel_points_custom_reward_redemption.add") return;
      const event = data.payload.event;
      console.log(
        `REDEEM #${event.broadcaster_user_login} <${event.user_login}> ${event.reward.title} [reward_id: ${event.reward.id}]`
      );
      if (env.GACHA_REWARD_NAME && event.reward.title !== env.GACHA_REWARD_NAME) return;
      performGachaPull(channelId, event.user_id, event.user_login, event.user_name)
        .then((msg) => sendChatMessage(msg, botToken, channelId))
        .catch((err) => console.error("Gacha pull error:", err));
    },
    cleanup,
  );

  activeSessions.set(channelId, { botWs, streamerWs });
  return true;
};

export const stopWebSocketClient = (channelId: string): boolean => {
  const session = activeSessions.get(channelId);
  if (!session) return false;
  session.botWs.close();
  session.streamerWs.close();
  return true;
};
