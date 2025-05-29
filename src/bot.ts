import { WebSocket } from "ws";
import "dotenv/config";

const env = process.env;
const BOT_USER_ID = env.BOT_USER_ID;
const CLIENT_ID = env.CLIENT_ID;

const EVENTSUB_WEBSOCKET_URL = "wss://eventsub.wss.twitch.tv/ws";

let websocketSessionID;

export const getAuth = async (token: string) => {
  const response = await fetch("https://id.twitch.tv/oauth2/validate", {
    method: "GET",
    headers: {
      Authorization: "OAuth " + token,
    },
  });

  if (response.status != 200) {
    const data = await response.json();
    console.error(
      "Token is not valid. /oauth2/validate returned status code " +
        response.status
    );
    console.error(data);
    process.exit(1);
  }

  console.log("Estamos al aire!!");
};

export const startWebSocketClient = (token: string, channelId: string) => {
  const websocketClient = new WebSocket(EVENTSUB_WEBSOCKET_URL);
  websocketClient.on("error", console.error);
  websocketClient.on("open", () => {
    console.log(`WebSocket connection opened to ${EVENTSUB_WEBSOCKET_URL}`);
  });
  websocketClient.on("message", (data) => {
    handleWebSocketMessage(JSON.parse(data.toString()), token, channelId);
  });
};

const handleWebSocketMessage = (
  data: any,
  token: string,
  channelId: string
) => {
  const messageType = data.metadata.message_type;
  if (messageType === "session_welcome") {
    websocketSessionID = data.payload.session.id;
    registerEventSubListeners(token, channelId);
  } else if (messageType === "notification") {
    const subscriptionType = data.metadata.subscription_type;

    switch (subscriptionType) {
      case "channel.chat.message":
        console.log(
          `MSG #${data.payload.event.broadcaster_user_login} <${data.payload.event.chatter_user_login}> ${data.payload.event.message.text}`
        );

        if (data.payload.event.message.text.trim() == "!gacha") {
          sendChatMessage("Haz hecho una tirada de gacha!", token, channelId);
        }

        break;
    }
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

const registerEventSubListeners = async (token: string, channelId: string) => {
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
        type: "channel.chat.message",
        version: "1",
        condition: {
          broadcaster_user_id: channelId,
          user_id: BOT_USER_ID,
        },
        transport: {
          method: "websocket",
          session_id: websocketSessionID,
        },
      }),
    }
  );
  const data = await response.json();

  if (response.status != 202) {
    console.error(
      "Failed to subscribe to channel.chat.message. API call returned status code " +
        response.status
    );
    console.error(data);
    process.exit(1);
  } else {
    console.log(`Subscribed to channel.chat.message [${data.data[0].id}]`);
  }
};
