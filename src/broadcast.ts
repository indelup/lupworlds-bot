import { WebSocketServer, WebSocket } from "ws";
import type { Server } from "http";

let wss: WebSocketServer | null = null;

export const attachOverlayServer = (server: Server) => {
    wss = new WebSocketServer({ server });
    wss.on("connection", () => {
        console.log("Overlay client connected");
    });
};

export const broadcast = (payload: unknown) => {
    if (!wss) return;
    const message = JSON.stringify(payload);
    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
};
