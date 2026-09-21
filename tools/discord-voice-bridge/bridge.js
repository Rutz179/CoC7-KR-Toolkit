/*
 * CoC7-KO Discord voice bridge.
 *
 * Joins one voice channel, listens only for Discord's "speaking" start/stop
 * notifications, and broadcasts them to connected Foundry clients over a
 * WebSocket. It never subscribes to or decodes audio.
 *
 * Configuration (environment variables):
 *   DISCORD_TOKEN      bot token from the Discord developer portal
 *   GUILD_ID           server id
 *   VOICE_CHANNEL_ID   the voice channel your table uses
 *   PORT               WebSocket port (default 8787)
 *   SHARED_KEY         optional; clients must connect with ?key=<value>
 */

import { Client, Events, GatewayIntentBits } from "discord.js";
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from "@discordjs/voice";
import { WebSocketServer } from "ws";

const {
  DISCORD_TOKEN,
  GUILD_ID,
  VOICE_CHANNEL_ID,
  PORT = "8787",
  SHARED_KEY = ""
} = process.env;

for (const [name, value] of Object.entries({ DISCORD_TOKEN, GUILD_ID, VOICE_CHANNEL_ID })) {
  if (!value) {
    console.error(`Missing environment variable: ${name}`);
    process.exit(1);
  }
}

/* --- WebSocket side -------------------------------------------------------- */

const wss = new WebSocketServer({ port: Number(PORT) });

wss.on("connection", (socket, request) => {
  if (SHARED_KEY) {
    const key = new URL(request.url ?? "/", "http://localhost").searchParams.get("key");
    if (key !== SHARED_KEY) {
      socket.close(1008, "invalid key");
      return;
    }
  }
  console.log(`Foundry client connected (${wss.clients.size} total)`);
});

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === 1) client.send(data);
  }
}

/* --- Speaking state ---------------------------------------------------------
 *
 * Discord reports speaking only at its start and its end. The Foundry side
 * clears a highlight that has gone quiet for a few seconds, so that someone
 * who drops out of the channel mid-sentence is not left lit forever. To keep
 * a long monologue lit, everyone currently speaking is re-announced on a
 * short heartbeat.
 */
const speaking = new Set();
const HEARTBEAT_MS = 3000;

setInterval(() => {
  for (const discordId of speaking) {
    broadcast({ type: "speaking", discordId, speaking: true });
  }
}, HEARTBEAT_MS);

function markSpeaking(discordId, isSpeaking) {
  if (isSpeaking) speaking.add(discordId);
  else speaking.delete(discordId);
  broadcast({ type: "speaking", discordId, speaking: isSpeaking });
}

/* --- Discord side ---------------------------------------------------------- */

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
});

async function join() {
  const guild = await client.guilds.fetch(GUILD_ID);

  const connection = joinVoiceChannel({
    channelId: VOICE_CHANNEL_ID,
    guildId: GUILD_ID,
    adapterCreator: guild.voiceAdapterCreator,
    // Speaking events are only delivered to a member that is not deafened.
    selfDeaf: false,
    selfMute: true
  });

  await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  console.log("Joined voice channel; relaying speaking events.");

  connection.receiver.speaking.on("start", userId => markSpeaking(userId, true));
  connection.receiver.speaking.on("end", userId => markSpeaking(userId, false));

  // Rejoin if the connection drops (server restart, kicked, network blip).
  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000)
      ]);
    } catch {
      connection.destroy();
      setTimeout(() => join().catch(console.error), 5_000);
    }
  });
}

// Someone leaving or moving channel while talking never sends "end".
client.on(Events.VoiceStateUpdate, (before, after) => {
  if (before.channelId === VOICE_CHANNEL_ID && after.channelId !== VOICE_CHANNEL_ID) {
    if (speaking.has(before.id)) markSpeaking(before.id, false);
  }
});

/*
 * discord.js renamed "ready" to "clientReady" and warns about the old name.
 * Pick whichever the installed version provides, so the bridge runs cleanly
 * on both the current release and the next major one.
 */
const READY_EVENT = Object.values(Events).includes("clientReady") ? "clientReady" : "ready";

client.once(READY_EVENT, () => {
  console.log(`Logged in as ${client.user.tag}. WebSocket on :${PORT}`);
  join().catch(error => {
    console.error("Could not join the voice channel:", error);
    process.exit(1);
  });
});

client.login(DISCORD_TOKEN);
