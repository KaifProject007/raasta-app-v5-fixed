import { io } from "socket.io-client";

// same-origin, proxied to the backend by vite.config.js in dev
export const socket = io({ autoConnect: true, transports: ["websocket", "polling"] });
