const MODULE_ID = "coc7-ko";

const PC_SLOT_DEFS = [
  { key: "pc1", label: "PC 1", group: "pc" },
  { key: "pc2", label: "PC 2", group: "pc" },
  { key: "pc3", label: "PC 3", group: "pc" },
  { key: "pc4", label: "PC 4", group: "pc" },
  { key: "pc5", label: "PC 5", group: "pc" },
  { key: "pc6", label: "PC 6", group: "pc" }
];

const NPC_SLOT_DEFS = [
  { key: "npc1", label: "NPC 1", group: "npc" },
  { key: "npc2", label: "NPC 2", group: "npc" },
  { key: "npc3", label: "NPC 3", group: "npc" },
  { key: "npc4", label: "NPC 4", group: "npc" }
];

const SLOT_DEFS = [...PC_SLOT_DEFS, ...NPC_SLOT_DEFS];

/* ------------------------------------------------------------------------ *
 * v0.7.0 | Free-form Stage layout
 *
 * Each slot may store a user-defined anchor:
 *   { x: <percent of stage width>, y: <percent of stage height>, w: <px> }
 *
 * When a slot has no stored layout it falls back to the CSS anchors
 * (pc1..pc6 / npc1..npc4) that shipped with earlier versions.
 * ------------------------------------------------------------------------ */

const LAYOUT_MIN_WIDTH = 90;
const LAYOUT_MAX_WIDTH = 460;

function getStageLayout() {
  try {
    return foundry.utils.deepClone(game.settings.get(MODULE_ID, "stageLayout") ?? {});
  } catch (_) {
    return {};
  }
}

function getSlotLayout(layout, slotKey) {
  const entry = layout?.[slotKey];
  if (!entry) return null;

  const x = Number(entry.x);
  const y = Number(entry.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;

  return {
    x: Math.clamp(x, 0, 100),
    y: Math.clamp(y, 0, 100),
    w: Math.clamp(Number(entry.w) || 170, LAYOUT_MIN_WIDTH, LAYOUT_MAX_WIDTH)
  };
}

function isLayoutLocked() {
  try {
    return !!game.settings.get(MODULE_ID, "stageLayoutLocked");
  } catch (_) {
    return true;
  }
}

/*
 * Bubbles open away from the edge they sit on: portraits on the left of the
 * stage speak rightwards, portraits on the right speak leftwards, and the
 * bottom-centre NPC row speaks upwards.
 */
const DEFAULT_BUBBLE_DIRECTION = {
  pc1: "right", pc3: "right", pc5: "right",
  pc2: "left", pc4: "left", pc6: "left",
  npc1: "up", npc2: "up", npc3: "up", npc4: "up"
};

/*
 * NPC cluster arrangement.
 *
 * Offsets are in units of the card's own size, applied with translate(), so
 * they scale with the portrait scale setting. The cluster is anchored at the
 * bottom centre of the stage.
 *
 * Reading order is bottom row first (npc1, npc2) with later arrivals forming
 * the row above, which puts 3/4 over 1/2 as a square once four are on stage.
 * Only occupied slots take part, so an empty seat never leaves a gap.
 */
const NPC_ARRANGEMENTS = {
  1: [[0, 0]],
  2: [[-0.56, 0], [0.56, 0]],
  3: [[-0.56, 0], [0.56, 0], [0, -1.04]],
  4: [[-0.56, 0], [0.56, 0], [-0.56, -1.04], [0.56, -1.04]]
};

function npcClusterOffset(activeIndex, activeCount) {
  const arrangement = NPC_ARRANGEMENTS[Math.clamp(activeCount, 1, 4)] ?? NPC_ARRANGEMENTS[1];
  return arrangement[activeIndex] ?? [0, 0];
}

function bubbleDirection(slotKey, layoutEntry) {
  if (layoutEntry) {
    // A freely placed card is judged by where the keeper actually put it.
    if (layoutEntry.x < 38) return "right";
    if (layoutEntry.x > 62) return "left";
    return "up";
  }

  return DEFAULT_BUBBLE_DIRECTION[slotKey] ?? "up";
}

/** Plain-text excerpt of a ChatMessage, safe for a speech bubble. */
function chatMessageToSpeech(message, limit = 160) {
  const raw = String(message?.content ?? "");
  if (!raw) return "";

  const div = document.createElement("div");
  div.innerHTML = raw;

  // Roll tables, damage cards and similar structured cards are not dialogue.
  if (div.querySelector(".dice-roll, .chat-card, table")) return "";

  const text = (div.textContent ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";

  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}

const DEFAULT_FLAGS = {
  stageMode: false,
  hideHotbar: true,
  npcHudMode: "gm",
  focusedSlot: null,
  media: {
    background: "",
    foreground: "",
    backgroundFit: "cover",
    foregroundFit: "cover",
    backgroundColor: "#111111",
    backgroundOpacity: 0.40,
    backgroundBlur: 0,
    mainScale: 1
  },
  presets: [],
  slots: Object.fromEntries(SLOT_DEFS.map(s => [s.key, {
    actorId: "",
    actorUuid: "",
    image: "",
    mirror: false,
    visible: false
  }]))
};

function deepClone(data) {
  return foundry.utils.deepClone(data);
}

function mergeObject(base, other) {
  return foundry.utils.mergeObject(base, other, { inplace: false, overwrite: true });
}

function makePresetId() {
  return foundry.utils.randomID(12);
}

function emptyPcSlots() {
  return Object.fromEntries(PC_SLOT_DEFS.map(s => [s.key, {
    actorId: "",
    actorUuid: "",
    image: "",
    mirror: false,
    visible: false
  }]));
}

function hasConfiguredPc(slots) {
  return PC_SLOT_DEFS.some(def => {
    const slot = slots?.[def.key];
    return !!(slot?.actorId || slot?.actorUuid || slot?.image || slot?.visible);
  });
}

function getPcSetupSlots(scene = canvas?.scene) {
  let stored = {};
  try {
    stored = game.settings.get(MODULE_ID, "pcStageSlots") ?? {};
  } catch (_) {}

  // Backward compatibility: before the first dedicated PC Setup save,
  // keep using the PC assignments stored in the current Scene.
  if (!hasConfiguredPc(stored) && scene) {
    const legacy = scene.getFlag(MODULE_ID, "stage")?.slots ?? {};
    if (hasConfiguredPc(legacy)) {
      stored = Object.fromEntries(
        PC_SLOT_DEFS.map(def => [def.key, deepClone(legacy[def.key] ?? emptyPcSlots()[def.key])])
      );
    }
  }

  return mergeObject(emptyPcSlots(), stored);
}

function getStageFlags(scene = canvas?.scene) {
  if (!scene) return deepClone(DEFAULT_FLAGS);

  const stored = scene.getFlag(MODULE_ID, "stage") ?? {};
  const stage = mergeObject(deepClone(DEFAULT_FLAGS), stored);

  // PCs are campaign-level setup. NPCs remain Scene-level.
  const pcSlots = getPcSetupSlots(scene);
  for (const def of PC_SLOT_DEFS) {
    stage.slots[def.key] = deepClone(pcSlots[def.key]);
  }

  return stage;
}

function getActorFromSlot(slot) {
  if (!slot) return null;

  // v0.2.1: world Actor IDs are the most reliable reference for this Stage use-case.
  if (slot.actorId) {
    const actor = game.actors.get(slot.actorId);
    if (actor) return actor;
  }

  // Backward compatibility with v0.1/v0.2 data.
  const uuid = slot.actorUuid;
  if (uuid) {
    try {
      const resolved = fromUuidSync(uuid);
      if (resolved?.documentName === "Actor") return resolved;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not resolve Actor UUID`, uuid, err);
    }
  }

  return null;
}

function getPortrait(slot, actor) {
  return (
    slot?.image ||
    actor?.prototypeToken?.texture?.src ||
    actor?.img ||
    "icons/svg/mystery-man.svg"
  );
}

function canControlActor(actor) {
  if (!actor) return false;
  return game.user.isGM || actor.isOwner;
}

function actorItems(actor) {
  if (!actor) return [];
  const excludedTypes = new Set([
    "skill", "occupation", "archetype", "setup"
  ]);
  const items = actor.items.contents.filter(i => !excludedTypes.has(i.type));
  return items.slice(0, 10);
}


const ITEM_PALETTE_EXCLUDED_TYPES = new Set([
  "skill",
  "occupation",
  "archetype",
  "setup",
  "status",
  "spell",
  "talent"
]);

function isPaletteItemType(type) {
  return !ITEM_PALETTE_EXCLUDED_TYPES.has(String(type ?? ""));
}

async function resolveDroppedItem(data) {
  if (!data || data.type !== "Item") return null;

  if (data.uuid) {
    try {
      const item = await fromUuid(data.uuid);
      if (item?.documentName === "Item") return item;
    } catch (_) {}
  }

  if (data.pack && data.id) {
    const pack = game.packs.get(data.pack);
    if (pack?.documentName === "Item") {
      try {
        return await pack.getDocument(data.id);
      } catch (_) {}
    }
  }

  if (data.id) {
    const item = game.items.get(data.id);
    if (item?.documentName === "Item") return item;
  }

  return null;
}

function parseItemDragData(event) {
  const raw = event.dataTransfer?.getData("text/plain")
    || event.dataTransfer?.getData("application/json")
    || "";

  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch (_) {
    return null;
  }
}

function cleanEmbeddedItemData(item) {
  const data = item.toObject();

  delete data._id;
  delete data.folder;
  delete data.sort;
  delete data.ownership;

  return data;
}

function getNested(obj, path) {
  return foundry.utils.getProperty(obj, path);
}

function firstValue(obj, paths, fallback = "—") {
  for (const path of paths) {
    const value = getNested(obj, path);
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return fallback;
}


function actorStats(actor) {
  const system = actor?.system ?? {};
  return {
    hp: {
      value: firstValue(
        system,
        ["attribs.hp.value", "characteristics.hp.value", "hp.value"],
        "—"
      ),
      max: firstValue(
        system,
        ["attribs.hp.max", "characteristics.hp.max", "hp.max"],
        "—"
      )
    },
    mp: {
      value: firstValue(
        system,
        ["attribs.mp.value", "characteristics.mp.value", "mp.value"],
        "—"
      ),
      max: firstValue(
        system,
        ["attribs.mp.max", "characteristics.mp.max", "mp.max"],
        "—"
      )
    },
    san: {
      value: firstValue(
        system,
        ["attribs.san.value", "san.value"],
        "—"
      ),
      max: firstValue(
        system,
        ["attribs.san.max", "attribs.san.dailyLimit", "san.max"],
        "—"
      )
    },
    luck: {
      value: firstValue(
        system,
        ["attribs.lck.value", "attribs.luck.value", "luck.value"],
        "—"
      ),
      max: firstValue(
        system,
        ["attribs.lck.max", "attribs.luck.max", "luck.max"],
        "—"
      )
    }
  };
}


function escapeHtml(value) {
  return foundry.utils.escapeHTML(String(value ?? ""));
}

const STAGE_MEDIA_FLAG = "stageMediaRole";

/*
 * 1.0.0 and 1.0.1 wrote a "transparent" placeholder into the scene's native
 * background to stop Foundry drawing its scene outline. Two things went wrong:
 * the bundled image was not actually transparent (it was half-transparent
 * blue), and on v14 writing the Level background right before creating the
 * stage tiles could interrupt the tile creation. The result was a blue box
 * over the scene and no stage images.
 *
 * The module no longer writes the native background for cosmetic reasons.
 * The outline is hidden at render time instead (see findSceneOutlines), which
 * changes nothing in the world data. The placeholder path is kept only so
 * scenes that already received it can be recognised and cleaned up.
 */
const TRANSPARENT_BACKGROUND = `modules/${MODULE_ID}/assets/transparent.png`;

function isPlaceholderBackground(src) {
  return !!src && String(src).endsWith("/assets/transparent.png");
}

/*
 * Native scene background, read and written the v14 way.
 *
 * v14 moved the background onto Level documents. Writing Scene#background is
 * still accepted by the API but SILENTLY DROPPED, so every earlier attempt to
 * clear or replace it did nothing on v14 — including the transparent
 * placeholder in 1.0.0. Older cores without levels keep the old path.
 */
function sceneLevels(scene) {
  const levels = scene?.levels;
  return levels?.size ? levels.contents : [];
}

function getNativeBackground(scene) {
  const levels = sceneLevels(scene);
  if (levels.length) return levels[0].background?.src ?? "";
  return scene?.background?.src ?? "";
}


function getStageMediaTile(scene, role) {
  return scene?.tiles?.find(
    tile => tile.getFlag(MODULE_ID, STAGE_MEDIA_FLAG) === role
  ) ?? null;
}

/*
 * Stage media geometry (CoCoFolia-style).
 *
 *   background — fills the ENTIRE canvas, padding included, so the grey
 *                margin around the playable area is covered too.
 *   main       — fills the playable scene rectangle (what players see),
 *                optionally inset by mainScale while keeping the scene's own
 *                aspect ratio.
 *
 * Earlier versions sized the backdrop to the scene rectangle only and forced
 * the main image into a 72% 16:9 box, which did not match most scenes and
 * made the two images look randomly placed.
 */
function getStageMediaRect(role, media) {
  const d = canvas?.dimensions;
  if (!d) return null;

  if (role === "background") {
    return {
      x: d.width / 2,
      y: d.height / 2,
      width: d.width,
      height: d.height
    };
  }

  const sx = d.sceneX;
  const sy = d.sceneY;
  const sw = d.sceneWidth;
  const sh = d.sceneHeight;

  const scale = Math.clamp(
    Number(media.mainScale ?? 1),
    0.50,
    1
  );

  const width = sw * scale;
  const height = sh * scale;

  return {
    x: sx + (sw / 2),
    y: sy + (sh / 2),
    width,
    height
  };
}

function stageTileData(role, media) {
  const rect = getStageMediaRect(role, media);
  if (!rect) return null;

  const isBackground = role === "background";
  const src = isBackground ? media.background : media.foreground;
  if (!src) return null;

  return {
    name: isBackground
      ? "CoC7-KO Stage Backdrop"
      : "CoC7-KO Stage Main Image",

    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,

    anchorX: 0.5,
    anchorY: 0.5,

    alpha: isBackground
      ? Math.clamp(
          Number(media.backgroundOpacity ?? 0.40),
          0.15,
          1
        )
      : 1,

    rotation: 0,
    hidden: false,
    locked: true,
    elevation: 0,
    sort: isBackground ? -1000 : -999,

    texture: {
      src,
      fit: isBackground
        ? (media.backgroundFit || "cover")
        : (media.foregroundFit || "cover")
    },

    flags: {
      [MODULE_ID]: {
        [STAGE_MEDIA_FLAG]: role
      }
    }
  };
}

async function deleteStageMediaTiles(scene = canvas?.scene) {
  if (!scene || !game.user.isGM) return;
  const ids = scene.tiles
    .filter(tile => ["background", "main"].includes(
      tile.getFlag(MODULE_ID, STAGE_MEDIA_FLAG)
    ))
    .map(tile => tile.id);

  if (ids.length) {
    await scene.deleteEmbeddedDocuments("Tile", ids);
  }
}

async function _syncStageMediaTiles(scene = canvas?.scene, stageOverride = null) {
  if (!scene || !canvas?.ready || scene.id !== canvas.scene?.id) return;
  if (!game.user.isGM) return;

  const stage = stageOverride ?? getStageFlags(scene);

  if (!stage.stageMode) {
    await deleteStageMediaTiles(scene);
    return;
  }

  const media = stage.media ?? {};

  /*
   * The custom Backdrop Tile is semi-transparent by design. If Foundry's
   * native Scene background is still showing the same image underneath it,
   * the two images visually stack and the opacity appears not to work.
   * Custom Stage media is authoritative while Stage Mode is active.
   */
  const nativeMediaUpdate = {};
  if (scene.background?.src && !isPlaceholderBackground(scene.background.src)) {
    nativeMediaUpdate["background.src"] = null;
  }
  if (scene.foreground) nativeMediaUpdate.foreground = null;

  if (Object.keys(nativeMediaUpdate).length) {
    await scene.update(nativeMediaUpdate);
  }
  const desired = {
    background: stageTileData("background", media),
    main: stageTileData("main", media)
  };

  const creates = [];
  const updates = [];
  const deletes = [];

  for (const role of ["background", "main"]) {
    const existingDocs = scene.tiles.filter(
      tile => tile.getFlag(MODULE_ID, STAGE_MEDIA_FLAG) === role
    );
    const existing = existingDocs[0] ?? null;
    const data = desired[role];

    // v0.5.1-v0.5.3 could race two sync calls and create duplicate Stage Tiles.
    // Keep a single authoritative document per role and remove every duplicate.
    if (existingDocs.length > 1) {
      deletes.push(...existingDocs.slice(1).map(tile => tile.id));
    }

    if (!data && existing) {
      deletes.push(existing.id);
      continue;
    }

    if (!data) continue;

    if (existing) {
      updates.push({ _id: existing.id, ...data });
    } else {
      creates.push(data);
    }
  }

  if (deletes.length) {
    await scene.deleteEmbeddedDocuments("Tile", [...new Set(deletes)]);
  }
  if (updates.length) await scene.updateEmbeddedDocuments("Tile", updates);
  if (creates.length) await scene.createEmbeddedDocuments("Tile", creates);

  /*
   * Keep the native Scene background as a neutral backing colour — on cores
   * without levels only. v14 moved the colour onto Level documents: reading
   * Scene#backgroundColor logs a deprecation warning and writing it is
   * silently dropped. The full-canvas backdrop tile covers it anyway.
   */
  if (!sceneLevels(scene).length && scene.backgroundColor !== (media.backgroundColor || "#111111")) {
    await scene.update({ backgroundColor: media.backgroundColor || "#111111" });
  }

  setTimeout(() => applyStageTileVisualEffects(scene), 50);
}


let stageMediaSyncQueue = Promise.resolve();

function syncStageMediaTiles(scene = canvas?.scene, stageOverride = null) {
  const targetScene = scene;
  const targetStage = stageOverride ? deepClone(stageOverride) : null;

  stageMediaSyncQueue = stageMediaSyncQueue
    .catch(() => undefined)
    .then(() => _syncStageMediaTiles(targetScene, targetStage));

  return stageMediaSyncQueue;
}

/*
 * Pre-baked backdrop blur.
 *
 * A live PIXI BlurFilter on the backdrop tile is unreliable in v12+: tiles
 * are drawn by the primary canvas group through its own batched render pass,
 * which can ignore per-mesh filters, the mesh is rebuilt on refresh so the
 * filter is lost, and blurring a full-canvas texture every frame is costly.
 *
 * Blurring once in a 2D canvas and saving the result as an image sidesteps
 * all of that: the tile then just shows an ordinary picture, identical on
 * every client and free at runtime. The image is scaled down first because a
 * blurred backdrop needs no resolution, which also keeps the file small.
 */
/*
 * Why this worked locally but not on the server, and what changed:
 *
 *  - File name. The copy used to be named after the original, so a Korean or
 *    space-containing name went up as-is. Windows is forgiving about that; on
 *    a Linux server the stored path and the URL Foundry hands back can end up
 *    encoded differently, so the new tile points at a file that "isn't there".
 *    The copy is now named with ASCII only: a short hash of the source path.
 *
 *  - Loading. <img> + canvas needs CORS headers to stay readable once the
 *    site is behind a reverse proxy or a CDN. The image is now fetched as a
 *    blob from the same origin and decoded with createImageBitmap, which
 *    needs no CORS at all.
 *
 *  - Diagnosis. Each stage reports its own error, so a failure says whether
 *    it was loading, encoding, permission or upload.
 */
async function hashText(text) {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-1", bytes);
  return [...new Uint8Array(digest)].slice(0, 6).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function bakeBlurredCopy(src, radius = 16) {
  if (!game.user.can("FILES_UPLOAD")) {
    throw new Error("이 계정에 파일 업로드 권한이 없습니다. (설정 → 권한 설정 → 파일 업로드)");
  }

  // 1. Load
  let bitmap;
  try {
    const response = await fetch(src, { credentials: "same-origin" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    bitmap = await createImageBitmap(await response.blob());
  } catch (error) {
    throw new Error(`[불러오기 실패] 원본 이미지를 읽지 못했습니다 (${error.message}). 경로: ${src}`);
  }

  // 2. Blur
  let blob;
  try {
    const MAX = 1600;
    const ratio = Math.min(1, MAX / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * ratio));
    const height = Math.max(1, Math.round(bitmap.height * ratio));

    const canvasEl = document.createElement("canvas");
    canvasEl.width = width;
    canvasEl.height = height;
    const ctx = canvasEl.getContext("2d");

    // Oversize the draw so edges have real pixels to sample instead of
    // fading to transparent.
    const bleed = radius * 2;
    ctx.filter = `blur(${radius}px)`;
    ctx.drawImage(bitmap, -bleed, -bleed, width + bleed * 2, height + bleed * 2);
    bitmap.close?.();

    blob = await new Promise(resolve => canvasEl.toBlob(resolve, "image/webp", 0.86));
    if (!blob) blob = await new Promise(resolve => canvasEl.toBlob(resolve, "image/jpeg", 0.9));
    if (!blob) throw new Error("이미지 인코딩 실패");
  } catch (error) {
    throw new Error(`[블러 처리 실패] ${error.message}`);
  }

  // 3. Upload
  const extension = blob.type === "image/jpeg" ? "jpg" : "webp";
  const name = `blur-${await hashText(src)}-r${radius}.${extension}`;
  const file = new File([blob], name, { type: blob.type });

  const folder = `worlds/${game.world.id}/coc7ko-blur`;
  const FilePickerImpl = foundry.applications?.apps?.FilePicker?.implementation ?? FilePicker;

  try {
    await FilePickerImpl.createDirectory("data", folder);
  } catch (_) {
    // Already exists.
  }

  let result;
  try {
    result = await FilePickerImpl.upload("data", folder, file, {}, { notify: false });
  } catch (error) {
    throw new Error(`[업로드 실패] ${error.message ?? error}`);
  }

  if (!result?.path) {
    throw new Error(`[업로드 실패] 서버가 저장 경로를 돌려주지 않았습니다. 응답: ${JSON.stringify(result ?? null)}`);
  }

  // Store a decoded path; Foundry encodes it itself when it builds the URL.
  try {
    return decodeURIComponent(result.path);
  } catch (_) {
    return result.path;
  }
}

function applyStageTileVisualEffects(scene = canvas?.scene) {
  if (!scene || scene.id !== canvas.scene?.id) return;

  const backgroundTile = canvas.tiles?.placeables?.find(
    tile => tile.document.getFlag(MODULE_ID, STAGE_MEDIA_FLAG) === "background"
  );

  if (!backgroundTile?.mesh) return;

  /*
   * v0.5.8:
   * Full-scene PIXI BlurFilter proved unreliable on some Foundry/WebGL clients.
   * Remove any blur filter created by older versions and do not add a new one.
   * Backdrop atmosphere is handled by opacity instead.
   */
  const cleanFilters = (backgroundTile.mesh.filters ?? [])
    .filter(filter => !filter.__coc7koStageBlur);

  backgroundTile.mesh.filters = cleanFilters.length ? cleanFilters : null;
}

class Coc7KoStageOverlay {
  constructor() {
    this.element = null;
    this.resizeObserver = null;
    this.expandedHuds = new Set();
    this.autoFocusedSlot = null;
    this.autoFocusTimer = null;
    this._windowResizeHandler = () => this.syncViewport();

    // Slots whose players are talking right now (voice). Several can be
    // active at once, independently of the single chat-driven focus.
    this.speakingSlots = new Set();

    // v0.7.0
    this.layoutEditing = false;
    this.speech = new Map();      // slotKey -> { text, timer }
    this._drag = null;            // active drag/resize gesture
    this._layoutSaveTimer = null;
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
  }

  get scene() {
    return canvas?.scene;
  }

  get flags() {
    return getStageFlags(this.scene);
  }

  getViewportRect() {
    const board = document.getElementById("board");
    const base = board?.getBoundingClientRect?.();

    let left = Math.max(0, base?.left ?? 0);
    let top = Math.max(0, base?.top ?? 0);
    let right = Math.min(window.innerWidth, base?.right ?? window.innerWidth);
    let bottom = Math.min(window.innerHeight, base?.bottom ?? window.innerHeight);

    // If the Foundry sidebar overlaps the board, reserve its current width.
    const sidebar = document.getElementById("sidebar");
    if (sidebar && sidebar.offsetParent !== null) {
      const side = sidebar.getBoundingClientRect();
      const verticalOverlap = side.bottom > top && side.top < bottom;
      const horizontalOverlap = side.left < right && side.right > left;

      if (verticalOverlap && horizontalOverlap && side.left > left) {
        right = Math.min(right, side.left - 6);
      }
    }

    return {
      left,
      top,
      width: Math.max(0, right - left),
      height: Math.max(0, bottom - top)
    };
  }

  syncViewport() {
    if (!this.element?.isConnected) return;
    const rect = this.getViewportRect();

    Object.assign(this.element.style, {
      left: `${Math.round(rect.left)}px`,
      top: `${Math.round(rect.top)}px`,
      width: `${Math.round(rect.width)}px`,
      height: `${Math.round(rect.height)}px`,
      right: "auto",
      bottom: "auto"
    });

    /*
     * Reserve the space actually occupied by Foundry's left-hand chrome.
     *
     * This used to measure only `#controls`, which does not exist in v14. The
     * lookup returned null, the fallback of 64px was written inline on every
     * resize, and that inline value silently overrode any margin set in the
     * stylesheet — which is why widening the CSS margin changed nothing.
     *
     * Every known left-rail element is measured now and the widest wins, so
     * both icon columns and the player list are cleared on any core version.
     */
    const LEFT_CHROME = [
      "#scene-controls",
      "#controls",
      "#scene-controls-layers",
      "#scene-controls-tools",
      "#ui-left-column-1",
      "#players"
    ];

    let rightmost = 0;
    for (const selector of LEFT_CHROME) {
      const el = document.querySelector(selector);
      if (!el || el.offsetParent === null) continue;

      const box = el.getBoundingClientRect();
      if (!box.width || box.right <= rect.left) continue;
      rightmost = Math.max(rightmost, box.right - rect.left);
    }

    const gap = Number(game.settings.get(MODULE_ID, "stageLeftGap")) || 28;
    const safeLeft = Math.max(96, Math.round(rightmost + gap));

    this.element.style.setProperty("--coc7ko-safe-left", `${safeLeft}px`);
    this.scheduleFit?.();
  }

  bindViewportTracking() {
    window.removeEventListener("resize", this._windowResizeHandler);
    window.addEventListener("resize", this._windowResizeHandler);

    this.resizeObserver?.disconnect();

    const board = document.getElementById("board");
    const sidebar = document.getElementById("sidebar");

    if (globalThis.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => this.syncViewport());
      if (board) this.resizeObserver.observe(board);
      if (sidebar) this.resizeObserver.observe(sidebar);
    }

    this.syncViewport();
  }

  syncUserScale() {
    if (!this.element?.isConnected) return;
    const scale = Number(game.settings.get(MODULE_ID, "stagePortraitScale")) || 1;
    this.element.style.setProperty("--coc7ko-user-scale", String(scale));
  }

  /*
   * Portrait auto-fit.
   *
   * Card width follows the screen width (vw), but the overlaps happen
   * vertically: each side column stacks up to three cards — top, middle and
   * bottom — and nothing accounted for the screen height. A wide, short
   * window therefore made them collide.
   *
   * The size the user picked is treated as the MAXIMUM. When the column is
   * too short to hold the occupied cards with a gap between them, all side
   * cards shrink just enough to fit, and grow back when there is room again.
   * Hand-placed cards (layout editor) are left alone.
   */
  scheduleFit() {
    cancelAnimationFrame(this._fitFrame);
    this._fitFrame = requestAnimationFrame(() => this.fitPortraits());
  }

  fitPortraits() {
    const el = this.element;
    if (!el?.isConnected || el.classList.contains("hidden")) return;

    let enabled = true;
    try { enabled = game.settings.get(MODULE_ID, "stageAutoFit"); } catch (_) {}

    const current = Number(el.style.getPropertyValue("--coc7ko-fit-scale")) || 1;

    const style = getComputedStyle(el);
    const px = name => parseFloat(style.getPropertyValue(name)) || 0;

    const height = el.clientHeight;
    const top = px("--coc7ko-safe-top");
    const bottom = px("--coc7ko-safe-bottom") + 40;   // matches the pc5/pc6 offset
    const band = height - top - bottom;               // room between the top and bottom rows
    const gap = 14;

    /*
     * A card's resting height: portrait and nameplate only. The investigator
     * HUD (stats and inventory) opens below the card and must not count —
     * measuring it made every portrait shrink the moment an inventory opened.
     */
    const restingHeight = node => {
      let h = node.offsetHeight;
      for (const extra of node.querySelectorAll(":scope > .stats, :scope > .inventory-grid")) {
        h -= extra.offsetHeight;
      }
      return Math.max(0, h);
    };

    const columns = [["pc1", "pc3", "pc5"], ["pc2", "pc4", "pc6"]];
    let naturalHeight = 0;
    let limit = Infinity;

    for (const [upper, middle, lower] of columns) {
      const card = key => el.querySelector(`.coc7ko-stage-slot.${key}:not(.empty):not(.positioned)`);
      const occupied = { upper: card(upper), middle: card(middle), lower: card(lower) };

      for (const node of Object.values(occupied)) {
        if (node) naturalHeight = Math.max(naturalHeight, restingHeight(node) / current);
      }

      /*
       * The middle card sits at the centre of the band between the top and
       * bottom rows (see below), so both of its gaps are equal and a single
       * limit covers them.
       */
      if (occupied.middle && (occupied.upper || occupied.lower)) {
        limit = Math.min(limit, (band - 2 * gap) / 3);
      }
      if (occupied.upper && occupied.lower && !occupied.middle) {
        limit = Math.min(limit, (band - gap) / 2);
      }
    }

    let fit = 1;
    if (enabled && naturalHeight > 0 && Number.isFinite(limit)) {
      fit = Math.clamp(limit / naturalHeight, 0.35, 1);
    }

    // Avoid churning the layout over sub-pixel differences.
    if (Math.abs(fit - current) > 0.01) {
      el.style.setProperty("--coc7ko-fit-scale", fit.toFixed(3));
    }

    /*
     * Place the middle row at the centre of the band, not of the screen.
     * The bottom keep-out is much larger than the top one (it clears the
     * hotbar), so the screen centre lies below the band centre: the middle
     * row used to sit close to the bottom row and far from the top row.
     */
    const cardHeight = naturalHeight * fit;
    if (cardHeight > 0) {
      const middleTop = top + Math.max(0, (band - cardHeight) / 2);
      el.style.setProperty("--coc7ko-mid-top", `${Math.round(middleTop)}px`);
      el.style.setProperty("--coc7ko-mid-shift", "0px");
    }
  }


  syncUiChrome() {
    const flags = this.flags;
    document.body.classList.toggle("coc7ko-stage-mode", !!flags.stageMode);
    document.body.classList.toggle(
      "coc7ko-stage-hide-hotbar",
      !!flags.stageMode && !!flags.hideHotbar
    );
    document.body.classList.toggle("coc7ko-layout-edit", !!this.layoutEditing);
  }

  ensureElement() {
    if (this.element?.isConnected) return this.element;
    this.element = document.createElement("section");
    this.element.id = "coc7ko-stage-overlay";
    this.element.classList.add("hidden");
    document.body.append(this.element);
    this.syncUserScale();
    this.bindViewportTracking();

    this.element.addEventListener("pointerdown", this._onPointerDown.bind(this));
    this.element.addEventListener("click", this._onClick.bind(this));
    this.element.addEventListener("dblclick", this._onDblClick.bind(this));
    this.element.addEventListener("contextmenu", this._onContextMenu.bind(this));
    this.element.addEventListener("dragover", this._onDragOver.bind(this));
    this.element.addEventListener("dragleave", this._onDragLeave.bind(this));
    this.element.addEventListener("drop", this._onDrop.bind(this));
    return this.element;
  }

  destroy() {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    window.removeEventListener("resize", this._windowResizeHandler);
    document.body.classList.remove(
      "coc7ko-stage-mode",
      "coc7ko-stage-hide-hotbar",
      "coc7ko-layout-edit"
    );
    this.clearSpeech();
    this.layoutEditing = false;
    this.expandedHuds.clear();
    clearTimeout(this.autoFocusTimer);
    this.autoFocusTimer = null;
    this.autoFocusedSlot = null;
    if (this.element?.isConnected) this.element.remove();
    this.element = null;
  }

  async refresh() {
    const el = this.ensureElement();
    const scene = this.scene;
    const flags = this.flags;

    this.syncUiChrome();
    this.syncUserScale();

    if (!scene || !flags.stageMode) {
      el.classList.add("hidden");
      el.innerHTML = "";
      return;
    }

    el.classList.remove("hidden");
    el.innerHTML = this._render(flags);
    this.syncViewport();
    this.scheduleFit();
  }

  clearAutoSpeaker({ refresh = true } = {}) {
    clearTimeout(this.autoFocusTimer);
    this.autoFocusTimer = null;
    this.autoFocusedSlot = null;
    if (refresh) return this.refresh();
  }

  /** Focuses a slot directly, used by the voice-activity bridge. */
  async setAutoSpeakerBySlot(slotKey, duration = 3000) {
    if (!slotKey) return null;

    clearTimeout(this.autoFocusTimer);
    this.autoFocusedSlot = slotKey;
    await this.refresh();

    this.autoFocusTimer = setTimeout(async () => {
      if (this.autoFocusedSlot !== slotKey) return;

      this.autoFocusedSlot = null;
      this.autoFocusTimer = null;
      await this.refresh();
    }, duration);

    return slotKey;
  }

  async setAutoSpeakerByActor(actorId, duration = 3000) {
    if (!actorId || !canvas?.scene) return null;

    const stage = getStageFlags(canvas.scene);
    const found = SLOT_DEFS.find(def => {
      const actor = getActorFromSlot(stage.slots[def.key]);
      return actor?.id === actorId;
    });

    if (!found) return null;

    clearTimeout(this.autoFocusTimer);
    this.autoFocusedSlot = found.key;
    await this.refresh();

    const expectedSlot = found.key;
    this.autoFocusTimer = setTimeout(async () => {
      if (this.autoFocusedSlot !== expectedSlot) return;

      this.autoFocusedSlot = null;
      this.autoFocusTimer = null;

      // Temporary chat focus is purely client-local. Never write Scene flags
      // from a player client when the timer expires.
      await this.refresh();
    }, duration);

    return found.key;
  }

  _render(flags) {
    const focused = this.autoFocusedSlot ?? flags.focusedSlot;
    const layout = getStageLayout();
    const editing = this.layoutEditing && game.user.isGM;

    // Which NPC seats are actually occupied, in slot order.
    const activeNpcKeys = NPC_SLOT_DEFS
      .filter(def => {
        const slot = flags.slots[def.key] ?? {};
        return slot.visible && getActorFromSlot(slot);
      })
      .map(def => def.key);

    const styleFor = key => {
      const entry = getSlotLayout(layout, key);

      if (!entry) {
        // No hand-placed position: NPCs fall back to the adaptive cluster.
        const index = activeNpcKeys.indexOf(key);
        if (index >= 0) {
          const [x, y] = npcClusterOffset(index, activeNpcKeys.length);
          return {
            cls: " npc-clustered",
            style: ` style="translate:calc(-50% + ${x * 100}%) ${y * 100}%;"`
          };
        }

        return { cls: "", style: "" };
      }
      return {
        cls: " positioned",
        style: ` style="left:${entry.x}%;top:${entry.y}%;width:${entry.w}px;"`
      };
    };

    const cards = SLOT_DEFS.map(slotDef => {
      const slot = flags.slots[slotDef.key] ?? {};
      const actor = getActorFromSlot(slot);
      const anchor = styleFor(slotDef.key);

      if (!slot.visible || !actor) {
        // While arranging the layout, empty slots stay draggable so the keeper
        // can pre-build a seating plan before the cast is assigned.
        if (!editing) {
          // An unused NPC seat would otherwise leave a grey placeholder in
          // the middle of the stage, so it is simply not drawn.
          if (slotDef.group === "npc") return "";

          const reason = !slot.visible
            ? `${slotDef.label}`
            : `${slotDef.label} · Actor 연결 실패`;
          return `<div class="coc7ko-stage-slot ${slotDef.key} empty${anchor.cls}" data-slot="${slotDef.key}"${anchor.style}>
            <div class="empty-label">${reason}</div>
          </div>`;
        }

        return `<div class="coc7ko-stage-slot ${slotDef.key} ${slotDef.group} empty layout-editing${anchor.cls}"
                     data-slot="${slotDef.key}"${anchor.style}>
          <div class="empty-label">${slotDef.label}</div>
          <div class="layout-grip" data-action="layoutResize" title="크기 조정"></div>
        </div>`;
      }

      const portrait = getPortrait(slot, actor);
      const voiceActive = this.speakingSlots.has(slotDef.key);
      const isFocused = focused === slotDef.key || voiceActive;
      const anyoneFocused = !!focused || this.speakingSlots.size > 0;
      const isDimmed = !anyoneFocused || !isFocused;
      const mirrored = !!slot.mirror;

      const hudAllowed = slotDef.group === "npc"
        ? (flags.npcHudMode !== "off" && game.user.isGM)
        : (
            game.user.isGM ||
            game.user.character?.id === actor.id
          );

      if (!hudAllowed) this.expandedHuds.delete(slotDef.key);

      const hudOpen = hudAllowed && this.expandedHuds.has(slotDef.key);
      const stats = hudAllowed ? actorStats(actor) : null;
      const items = hudAllowed ? actorItems(actor) : [];

      const itemHtml = hudAllowed
        ? Array.from({ length: 10 }, (_, i) => {
            const item = items[i];
            if (!item) return `<div class="item-cell empty"></div>`;
            const qty = firstValue(item, ["system.quantity", "system.qty", "system.amount"], "");
            const quest = item.getFlag(MODULE_ID, "questItem") ? " quest" : "";
            const qtyHtml = qty !== "" ? `<span class="qty">${qty}</span>` : "";
            return `
              <div class="item-cell${quest}" data-item-id="${item.id}" data-actor-id="${actor.id}" title="${item.name}">
                <img src="${item.img}" alt="${item.name}">
                ${qtyHtml}
              </div>
            `;
          }).join("")
        : "";

      const speechText = this.speech.get(slotDef.key)?.text ?? "";
      const direction = bubbleDirection(slotDef.key, getSlotLayout(layout, slotDef.key));
      const speechHtml = speechText
        ? `<div class="coc7ko-speech-bubble bubble-${direction}"><span>${escapeHtml(speechText)}</span></div>`
        : "";

      return `
        <article class="coc7ko-stage-slot ${slotDef.key} ${slotDef.group} ${isFocused ? "focused" : ""} ${isDimmed ? "dimmed" : ""} ${hudOpen ? "hud-open" : ""}${editing ? " layout-editing" : ""}${speechText ? " speaking" : ""}${anchor.cls}"
                 data-slot="${slotDef.key}" data-actor-uuid="${actor.uuid}"${anchor.style}>
          ${speechHtml}
          ${editing ? `<div class="layout-grip" data-action="layoutResize" title="크기 조정"></div>` : ""}
          ${hudAllowed ? `
            <button type="button" class="hud-toggle" data-action="toggleHud" title="조사자 HUD">
              <i class="fa-solid fa-box-open"></i>
            </button>
          ` : ""}

          <div class="portrait-wrap ${mirrored ? "mirrored" : ""}">
            <img class="portrait" src="${portrait}" alt="${actor.name}">
          </div>

          <div class="nameplate">
            <span class="slot-name">${actor.name}</span>
            <span class="speaker-badge">${isFocused ? "화자" : ""}</span>
          </div>

          ${hudAllowed ? `
            <div class="stats">
              <span>HP ${stats.hp.value}/${stats.hp.max}</span>
              <span>MP ${stats.mp.value}/${stats.mp.max}</span>
              <span>SAN ${stats.san.value}/${stats.san.max}</span>
              <span>Luck ${stats.luck.value}</span>
            </div>

            <div class="inventory-grid">
              ${itemHtml}
            </div>
          ` : ""}
        </article>
      `;
    }).join("");

    const editBar = editing
      ? `
        <div class="coc7ko-layout-toolbar">
          <span class="layout-hint">
            <i class="fa-solid fa-arrows-up-down-left-right"></i>
            카드를 드래그해 배치하고, 우하단 모서리로 크기를 조절하세요.
          </span>
          <button type="button" data-action="layoutReset" title="기본 배치로 되돌리기">
            <i class="fa-solid fa-rotate-left"></i> 초기화
          </button>
          <button type="button" data-action="layoutLock" title="배치 잠그기">
            <i class="fa-solid fa-lock"></i> 잠금
          </button>
        </div>
      `
      : "";

    return `
      <div class="coc7ko-stage-root${editing ? " layout-editing" : ""}">
        ${editBar}
        <div class="coc7ko-stage-character-layer">
          ${cards}
        </div>
      </div>
    `;
  }

  /* --- v0.7.0 | Layout editing ------------------------------------------ */

  async setLayoutEditing(active) {
    if (!game.user.isGM) return;

    this.layoutEditing = !!active;
    document.body.classList.toggle("coc7ko-layout-edit", this.layoutEditing);

    if (this.layoutEditing && isLayoutLocked()) {
      await game.settings.set(MODULE_ID, "stageLayoutLocked", false);
    }

    await this.refresh();
  }

  async toggleLayoutEditing() {
    return this.setLayoutEditing(!this.layoutEditing);
  }

  _stageRect() {
    const layer = this.element?.querySelector(".coc7ko-stage-character-layer");
    return layer?.getBoundingClientRect() ?? this.element?.getBoundingClientRect();
  }

  _onPointerDown(event) {
    if (!this.layoutEditing || !game.user.isGM) return;
    if (event.button !== 0) return;

    const card = event.target.closest(".coc7ko-stage-slot");
    if (!card) return;

    // Toolbar buttons keep their normal click behaviour.
    if (event.target.closest(".coc7ko-layout-toolbar")) return;

    const rect = this._stageRect();
    if (!rect?.width || !rect?.height) return;

    const cardRect = card.getBoundingClientRect();
    const resizing = !!event.target.closest("[data-action='layoutResize']");

    event.preventDefault();
    event.stopPropagation();

    this._drag = {
      card,
      slotKey: card.dataset.slot,
      mode: resizing ? "resize" : "move",
      stage: rect,
      startX: event.clientX,
      startY: event.clientY,
      startWidth: cardRect.width,
      offsetX: event.clientX - cardRect.left,
      offsetY: event.clientY - cardRect.top
    };

    card.classList.add("layout-active");
    card.setPointerCapture?.(event.pointerId);

    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag) return;

    const { card, stage } = drag;

    if (drag.mode === "resize") {
      const width = Math.clamp(
        drag.startWidth + (event.clientX - drag.startX),
        LAYOUT_MIN_WIDTH,
        LAYOUT_MAX_WIDTH
      );
      card.style.width = `${Math.round(width)}px`;
      return;
    }

    const left = event.clientX - drag.offsetX - stage.left;
    const top = event.clientY - drag.offsetY - stage.top;

    const x = Math.clamp((left / stage.width) * 100, 0, 100);
    const y = Math.clamp((top / stage.height) * 100, 0, 100);

    card.classList.add("positioned");
    card.style.left = `${x.toFixed(2)}%`;
    card.style.top = `${y.toFixed(2)}%`;
    card.style.right = "auto";
    card.style.bottom = "auto";
    card.style.translate = "none";
  }

  async _onPointerUp() {
    const drag = this._drag;
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    if (!drag) return;

    this._drag = null;
    drag.card.classList.remove("layout-active");

    const stage = this._stageRect();
    const cardRect = drag.card.getBoundingClientRect();
    if (!stage?.width || !stage?.height) return;

    const entry = {
      x: Number(Math.clamp(((cardRect.left - stage.left) / stage.width) * 100, 0, 100).toFixed(2)),
      y: Number(Math.clamp(((cardRect.top - stage.top) / stage.height) * 100, 0, 100).toFixed(2)),
      w: Math.round(Math.clamp(cardRect.width, LAYOUT_MIN_WIDTH, LAYOUT_MAX_WIDTH))
    };

    const layout = getStageLayout();
    layout[drag.slotKey] = entry;

    clearTimeout(this._layoutSaveTimer);
    this._layoutSaveTimer = setTimeout(() => {
      game.settings.set(MODULE_ID, "stageLayout", layout);
    }, 180);
  }

  /* --- v0.7.0 | Speech bubbles ------------------------------------------ */

  async showSpeech(slotKey, text, duration = 6000) {
    if (!slotKey || !text) return;

    const existing = this.speech.get(slotKey);
    if (existing?.timer) clearTimeout(existing.timer);

    const timer = setTimeout(() => {
      this.speech.delete(slotKey);
      this.refresh();
    }, duration);

    this.speech.set(slotKey, { text, timer });
    await this.refresh();
  }

  clearSpeech() {
    for (const entry of this.speech.values()) clearTimeout(entry.timer);
    this.speech.clear();
  }

  findSlotForActor(actorId) {
    if (!actorId || !canvas?.scene) return null;
    const stage = getStageFlags(canvas.scene);
    const found = SLOT_DEFS.find(def => {
      const actor = getActorFromSlot(stage.slots[def.key]);
      return actor?.id === actorId;
    });
    return found?.key ?? null;
  }

  _getPcDropSlot(event) {
    if (!game.user.isGM) return null;

    const slotEl = event.target.closest(".coc7ko-stage-slot.pc");
    if (!slotEl || slotEl.classList.contains("empty")) return null;

    return slotEl;
  }

  _clearDropHighlights() {
    this.element?.querySelectorAll(".item-drop-hover")
      .forEach(el => el.classList.remove("item-drop-hover"));
  }

  _onDragOver(event) {
    const slotEl = this._getPcDropSlot(event);
    if (!slotEl) return;

    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = "copy";

    this._clearDropHighlights();
    slotEl.classList.add("item-drop-hover");
  }

  _onDragLeave(event) {
    const slotEl = event.target.closest(".coc7ko-stage-slot.pc");
    if (!slotEl) return;

    const related = event.relatedTarget;
    if (related && slotEl.contains(related)) return;

    slotEl.classList.remove("item-drop-hover");
  }

  async _onDrop(event) {
    const slotEl = this._getPcDropSlot(event);
    this._clearDropHighlights();
    if (!slotEl) return;

    event.preventDefault();
    event.stopPropagation();

    const dragData = parseItemDragData(event);
    if (!dragData || dragData.type !== "Item") {
      return ui.notifications.warn("CoC7-KO | Item만 캐릭터 카드에 지급할 수 있습니다.");
    }

    const actor = fromUuidSync(slotEl.dataset.actorUuid);
    if (!actor) {
      return ui.notifications.error("CoC7-KO | 대상 Actor를 찾을 수 없습니다.");
    }

    const item = await resolveDroppedItem(dragData);
    if (!item) {
      return ui.notifications.error("CoC7-KO | 드래그한 Item을 불러올 수 없습니다.");
    }

    await game.coc7koStage.grantItemToActor(item, actor);
  }

  async _onClick(event) {
    const layoutReset = event.target.closest("[data-action='layoutReset']");
    if (layoutReset) {
      event.stopPropagation();
      return game.coc7koStage.resetStageLayout();
    }

    const layoutLock = event.target.closest("[data-action='layoutLock']");
    if (layoutLock) {
      event.stopPropagation();
      await game.settings.set(MODULE_ID, "stageLayoutLocked", true);
      return this.setLayoutEditing(false);
    }

    // While arranging the stage, clicks must not change the active speaker.
    if (this.layoutEditing) return;

    const slotEl = event.target.closest(".coc7ko-stage-slot");
    if (!slotEl || slotEl.classList.contains("empty")) return;

    const slotKey = slotEl.dataset.slot;
    const actorUuid = slotEl.dataset.actorUuid;
    const actor = fromUuidSync(actorUuid);
    if (!actor) return;

    const hudButton = event.target.closest("[data-action='toggleHud']");
    if (hudButton) {
      event.stopPropagation();

      const stage = getStageFlags(canvas.scene);
      const slotDef = SLOT_DEFS.find(def => def.key === slotKey);
      const hudAllowed = slotDef?.group === "npc"
        ? (stage.npcHudMode !== "off" && game.user.isGM)
        : (
            game.user.isGM ||
            game.user.character?.id === actor.id
          );

      if (!hudAllowed) return;

      if (this.expandedHuds.has(slotKey)) this.expandedHuds.delete(slotKey);
      else this.expandedHuds.add(slotKey);
      return this.refresh();
    }

    const itemEl = event.target.closest(".item-cell");
    if (itemEl && itemEl.dataset.itemId) {
      const item = actor.items.get(itemEl.dataset.itemId);
      if (item) return item.sheet?.render(true);
    }

    // Single-click portrait focus is a Keeper operation.
    // Players clicking their own Stage portrait should cause no Scene update,
    // no permission warning, and no popup.
    //
    // Clicking the current speaker again releases it. Previously a click could
    // only assign, and an accidental assignment stuck until someone chatted.
    if (game.user.isGM) {
      const current = getStageFlags(canvas.scene).focusedSlot;
      await game.coc7koStage.setFocusedSlot(current === slotKey ? null : slotKey);
    }
  }

  async _onDblClick(event) {
    const slotEl = event.target.closest(".coc7ko-stage-slot");
    if (!slotEl || slotEl.classList.contains("empty")) return;

    const actor = fromUuidSync(slotEl.dataset.actorUuid);
    if (!actor) return;

    const canOpenSheet = game.user.isGM || game.user.character?.id === actor.id;
    if (!canOpenSheet) return;

    actor.sheet?.render(true);
  }

  async _onContextMenu(event) {
    const slotEl = event.target.closest(".coc7ko-stage-slot");
    if (!slotEl || slotEl.classList.contains("empty")) return;

    event.preventDefault();
    const actor = fromUuidSync(slotEl.dataset.actorUuid);
    const slotKey = slotEl.dataset.slot;
    if (!actor || !game.user.isGM) return;

    const isSpeaker =
      getStageFlags(canvas.scene).focusedSlot === slotKey ||
      this.autoFocusedSlot === slotKey;

    const choice = await foundry.applications.api.DialogV2.wait({
      window: { title: `${actor.name} | Stage Action` },
      content: `
        <div class="standard-form">
          <p><strong>${actor.name}</strong>에 대해 실행할 작업을 고르세요.</p>
        </div>
      `,
      buttons: [
        isSpeaker
          ? { action: "unfocus", label: "화자 지정 해제", default: true }
          : { action: "focus", label: "화자로 지정", default: true },
        { action: "clearAll", label: "모든 화자 해제" },
        { action: "mirror", label: "좌우 반전 토글" },
        { action: "hide", label: "스테이지에서 숨기기" },
        { action: "sheet", label: "시트 열기" },
        { action: "cancel", label: "취소" }
      ]
    });

    if (choice === "focus") return game.coc7koStage.setFocusedSlot(slotKey);
    if (choice === "unfocus") return game.coc7koStage.releaseSpeakers();
    if (choice === "clearAll") return game.coc7koStage.releaseSpeakers();
    if (choice === "mirror") return game.coc7koStage.toggleMirror(slotKey);
    if (choice === "hide") return game.coc7koStage.setSlotVisibility(slotKey, false);
    if (choice === "sheet") return actor.sheet?.render(true);
  }
}

class Coc7KoStageConfig extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "coc7ko-stage-config",
    tag: "form",
    window: {
      title: "CoC7-KO 장면 / NPC 조정",
      icon: "fa-solid fa-clapperboard",
      resizable: true
    },
    position: {
      width: 820,
      height: 700
    },
    form: {
      closeOnSubmit: false,
      submitOnClose: false,
      handler: function(event, form, formData) {
        return this._handleSubmit(event, form, formData);
      }
    }
  };

  constructor(options = {}) {
    super(options);
  }

  async _prepareContext() {
    const stage = getStageFlags(canvas.scene);
    const actorOptions = game.actors.contents
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(actor => ({
        id: actor.id,
        uuid: actor.uuid,
        name: `${actor.name} [${actor.type}]`
      }));

    const pcSlots = getPcSetupSlots(canvas.scene);
    const pcActorIds = new Set(
      PC_SLOT_DEFS.map(def => pcSlots[def.key]?.actorId).filter(Boolean)
    );

    const activeNpcIds = new Set(
      NPC_SLOT_DEFS.map(def => stage.slots[def.key]?.actorId).filter(Boolean)
    );

    const npcActors = game.actors.contents
      .filter(actor => !pcActorIds.has(actor.id))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(actor => ({
        id: actor.id,
        name: actor.name,
        img: actor.prototypeToken?.texture?.src || actor.img || "icons/svg/mystery-man.svg",
        active: activeNpcIds.has(actor.id)
      }));

    const media = stage.media ?? {};
    const rawNative = getNativeBackground(canvas.scene);
    const nativeBackground = isPlaceholderBackground(rawNative) ? "" : rawNative;
    const nativeForeground = canvas.scene?.foreground ?? "";

    return {
      stage,
      actorOptions,
      npcActors,
      slots: NPC_SLOT_DEFS,
      allSlots: SLOT_DEFS,
      presets: stage.presets ?? [],
      backgroundPath: media.background || nativeBackground,
      foregroundPath: media.foreground || nativeForeground,
      backgroundFit: media.backgroundFit || "cover",
      foregroundFit: media.foregroundFit || "cover",
      backgroundColor: media.backgroundColor || "#111111",
      backgroundOpacity: Number(media.backgroundOpacity ?? 0.40),
      backgroundBlur: Number(media.backgroundBlur ?? 0),
      mainScale: Number(media.mainScale ?? 1),
      portraitScale: Number(game.settings.get(MODULE_ID, "stagePortraitScale") ?? 1)
    };
  }

  async _renderHTML(context) {
    const actorOptionsHtml = context.actorOptions
      .map(o => `<option value="${o.id}">${o.name}</option>`)
      .join("");
    const slotRows = context.slots.map(slotDef => {
      const slot = context.stage.slots[slotDef.key] ?? {};
      return `
        <fieldset class="slot-fieldset">
          <legend>${slotDef.label}</legend>

          <div class="form-group">
            <label>표시</label>
            <input type="checkbox" name="slots.${slotDef.key}.visible" ${slot.visible ? "checked" : ""}>
          </div>

          <div class="form-group">
            <label>Actor</label>
            <select name="slots.${slotDef.key}.actorId">
              <option value="">없음</option>
              ${actorOptionsHtml.replace(
                `value="${slot.actorId || ""}"`,
                `value="${slot.actorId || ""}" selected`
              )}
            </select>
          </div>

          <div class="form-group">
            <label>이미지 Override</label>
            <div class="form-fields">
              <input type="text" name="slots.${slotDef.key}.image" value="${slot.image ?? ""}" placeholder="systems/... or modules/...">
              <button type="button" data-action="pickFile" data-target="slots.${slotDef.key}.image"><i class="fa-solid fa-folder-open"></i></button>
            </div>
          </div>

          <div class="form-group">
            <label>좌우 반전</label>
            <input type="checkbox" name="slots.${slotDef.key}.mirror" ${slot.mirror ? "checked" : ""}>
          </div>
        </fieldset>
      `;
    }).join("");

    return `
      <div class="standard-form coc7ko-stage-config">
        <div class="form-group">
          <label>Stage Mode 사용</label>
          <input type="checkbox" name="stageMode" ${context.stage.stageMode ? "checked" : ""}>
        </div>

        <div class="form-group">
          <label>매크로 바 숨기기</label>
          <input type="checkbox" name="hideHotbar" ${context.stage.hideHotbar ? "checked" : ""}>
          <p class="hint">Stage Mode일 때만 Foundry 기본 Hotbar를 숨깁니다.</p>
        </div>

        <div class="form-group coc7ko-live-setting">
          <label>캐릭터 포트레잇 UI 배율</label>
          <div class="form-fields">
            <input type="range"
                   name="portraitScale"
                   min="0.70"
                   max="1.35"
                   step="0.05"
                   value="${context.portraitScale}">
            <span class="live-value">${Math.round(context.portraitScale * 100)}%</span>
          </div>
          <p class="hint">사용자별(client) 설정입니다. 다른 플레이어의 화면 크기에는 영향을 주지 않습니다.</p>
        </div>

        <fieldset class="slot-fieldset stage-media-fieldset">
          <legend>Stage 이미지</legend>

          <div class="form-group">
            <label>배경색</label>
            <div class="form-fields">
              <input type="color" name="backgroundColor" value="${context.backgroundColor}">
              <span class="hint">이미지가 없거나 Contain으로 여백이 생기면 이 색으로 채웁니다.</span>
            </div>
          </div>

          <div class="form-group">
            <label>Background</label>
            <div class="form-fields">
              <input type="text" name="backgroundPath" value="${context.backgroundPath}" placeholder="배경 이미지 또는 영상">
              <button type="button" data-action="pickFile" data-target="backgroundPath"><i class="fa-solid fa-folder-open"></i></button>
              <select name="backgroundFit">
                <option value="cover" ${context.backgroundFit === "cover" ? "selected" : ""}>채우기 (Cover)</option>
                <option value="contain" ${context.backgroundFit === "contain" ? "selected" : ""}>맞추기 (Contain)</option>
              </select>
            </div>
            <p class="hint">
              씬 바깥 여백까지 캔버스 전체를 채우는 배경입니다. 토큰보다 아래에 배치됩니다.
            </p>

            <div class="form-group">
              <label>배경 투명도</label>
              <div class="form-fields">
                <input type="range"
                       name="backgroundOpacity"
                       min="0.15"
                       max="1"
                       step="0.05"
                       value="${context.backgroundOpacity}">
                <span>${Math.round(context.backgroundOpacity * 100)}%</span>
              </div>
            </div>

            <div class="form-group">
              <label>배경 블러</label>
              <div class="form-fields">
                <select name="blurRadius">
                  <option value="8">약하게</option>
                  <option value="16" selected>보통</option>
                  <option value="28">강하게</option>
                </select>
                <button type="button" data-action="bakeBlur">
                  <i class="fa-solid fa-droplet"></i> 블러 사본 만들기
                </button>
              </div>
              <p class="hint">
                배경 이미지를 흐리게 처리한 사본을 월드 폴더에 저장하고 배경으로 교체합니다.
                원본은 그대로 남습니다.
              </p>
            </div>
          </div>

          <div class="form-group">
            <label>중앙 이미지</label>
            <div class="form-fields">
              <input type="text" name="foregroundPath" value="${context.foregroundPath}" placeholder="중앙에 표시할 이미지 또는 영상">
              <button type="button" data-action="pickFile" data-target="foregroundPath"><i class="fa-solid fa-folder-open"></i></button>
              <select name="foregroundFit">
                <option value="cover" ${context.foregroundFit === "cover" ? "selected" : ""}>채우기 (Cover)</option>
                <option value="contain" ${context.foregroundFit === "contain" ? "selected" : ""}>맞추기 (Contain)</option>
              </select>
            </div>
            <p class="hint">
              플레이어가 보는 씬 영역을 채웁니다(100%). 줄이면 씬 비율을 유지한 채 가운데로 작아집니다. 토큰보다 아래에 배치됩니다.
            </p>

            <div class="form-group">
              <label>중앙 이미지 크기</label>
              <div class="form-fields">
                <input type="range"
                       name="mainScale"
                       min="0.50"
                       max="1"
                       step="0.05"
                       value="${context.mainScale}">
                <span>${Math.round(context.mainScale * 100)}%</span>
              </div>
            </div>
          </div>
        </fieldset>

        <fieldset class="slot-fieldset stage-preset-fieldset">
          <legend>Stage Preset</legend>

          <div class="form-group">
            <label>현재 이미지 조합 저장</label>
            <div class="form-fields">
              <input type="text" name="newPresetName" placeholder="예: 호텔 로비">
              <button type="button" data-action="savePreset">
                <i class="fa-solid fa-bookmark"></i> 저장
              </button>
            </div>
            <p class="hint">
              현재 Background + Foreground 경로를 하나의 장소 프리셋으로 저장합니다.
            </p>
          </div>

          <div class="coc7ko-preset-list">
            ${context.presets.length
              ? context.presets.map(preset => `
                <div class="coc7ko-preset-row" data-preset-id="${preset.id}">
                  <div class="preset-main">
                    <strong>${preset.name}</strong>
                    <span class="preset-path">${preset.background || "Background 없음"}</span>
                    <span class="preset-path">${preset.foreground || "Foreground 없음"}</span>
                  </div>
                  <div class="preset-actions">
                    <button type="button" data-action="applyPreset" data-preset-id="${preset.id}" title="적용">
                      <i class="fa-solid fa-play"></i>
                    </button>
                    <button type="button" data-action="deletePreset" data-preset-id="${preset.id}" title="삭제">
                      <i class="fa-solid fa-trash"></i>
                    </button>
                  </div>
                </div>
              `).join("")
              : `<p class="hint">아직 저장된 장소 프리셋이 없습니다.</p>`
            }
          </div>
        </fieldset>

        <div class="form-group">
          <label>현재 화자</label>
          <select name="focusedSlot">
            <option value="">없음</option>
            ${context.allSlots.map(s => {
              const selected = context.stage.focusedSlot === s.key ? "selected" : "";
              return `<option value="${s.key}" ${selected}>${s.label}</option>`;
            }).join("")}
          </select>
        </div>

        <hr>

        <div class="coc7ko-palette-launchers">
          <button type="button" data-action="openItemPalette">
            <i class="fa-solid fa-box-open"></i>
            아이템 팔레트 열기
          </button>
          <button type="button" data-action="openNpcPalette">
            <i class="fa-solid fa-masks-theater"></i>
            NPC 팔레트 열기
          </button>
          <p class="hint">
            두 팔레트는 각각 독립된 창으로 열립니다. 이 창을 닫아도 계속 띄워둘 수 있습니다.
          </p>
        </div>

        <hr>

        <h3>현재 대화 NPC 슬롯</h3>
        <p class="hint">
          Palette에서 빠르게 등장/퇴장할 수 있습니다. Stage 이미지 Override나 좌우 반전이 필요할 때만 아래 슬롯을 직접 조정하세요.
        </p>

        <div class="slot-grid npc-slot-grid">
          ${slotRows}
        </div>

        <footer class="form-footer">
          <button type="submit"><i class="fa-solid fa-floppy-disk"></i> 저장</button>
        </footer>
      </div>
    `;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;
    content.querySelector("[data-action='bakeBlur']")?.addEventListener("click", async event => {
      const button = event.currentTarget;
      const pathInput = content.querySelector("[name='backgroundPath']");
      const src = pathInput?.value?.trim();

      if (!src) return ui.notifications.warn("CoC7-KO | 먼저 배경 이미지를 지정하세요.");
      if (/\.(webm|mp4|m4v|ogg)$/i.test(src)) {
        return ui.notifications.warn("CoC7-KO | 영상 배경에는 블러 사본을 만들 수 없습니다.");
      }

      const radius = Number(content.querySelector("[name='blurRadius']")?.value) || 16;

      button.disabled = true;
      try {
        const blurred = await bakeBlurredCopy(src, radius);
        pathInput.value = blurred;
        pathInput.dispatchEvent(new Event("change", { bubbles: true }));
        ui.notifications.info("CoC7-KO | 블러 사본을 만들었습니다. 저장하면 배경에 적용됩니다.");
      } catch (error) {
        console.error(`${MODULE_ID} | blur bake failed`, error);
        ui.notifications.error(`CoC7-KO | ${error.message}`);
      } finally {
        button.disabled = false;
      }
    });

    content.querySelectorAll("[data-action='pickFile']").forEach(btn => {
      btn.addEventListener("click", async (event) => {
        const target = event.currentTarget.dataset.target;
        const field = content.querySelector(`[name="${target}"]`);
        const FilePickerClass = foundry.applications.apps.FilePicker;
        const fp = new FilePickerClass({
          type: "image",
          callback: (path) => {
            field.value = path;
            field.dispatchEvent(new Event("change", { bubbles: true }));
          }
        });
        fp.render({ force: true });
      });
    });

    const readLiveMedia = () => ({
      background: content.querySelector("[name='backgroundPath']")?.value?.trim() ?? "",
      foreground: content.querySelector("[name='foregroundPath']")?.value?.trim() ?? "",
      backgroundFit: content.querySelector("[name='backgroundFit']")?.value ?? "cover",
      foregroundFit: content.querySelector("[name='foregroundFit']")?.value ?? "cover",
      backgroundColor: content.querySelector("[name='backgroundColor']")?.value ?? "#111111",
      backgroundOpacity: Number(content.querySelector("[name='backgroundOpacity']")?.value ?? 0.40),
      backgroundBlur: Number(content.querySelector("[name='backgroundBlur']")?.value ?? 0),
      mainScale: Number(content.querySelector("[name='mainScale']")?.value ?? 1)
    });

    let previewTimer = null;
    const previewMedia = () => {
      clearTimeout(previewTimer);
      previewTimer = setTimeout(() => {
        game.coc7koStage.previewMedia(readLiveMedia());
      }, 60);
    };

    const commitMedia = () => {
      clearTimeout(previewTimer);
      return game.coc7koStage.commitMedia(readLiveMedia());
    };

    // Sliders preview continuously while dragging and persist when released.
    for (const name of ["backgroundOpacity", "mainScale"]) {
      const input = content.querySelector(`[name="${name}"]`);
      if (!input) continue;

      const valueLabel = input.closest(".form-fields")?.querySelector("span");

      input.addEventListener("input", () => {
        const value = Number(input.value);
        if (valueLabel) {
          valueLabel.textContent = `${Math.round(value * 100)}%`;
        }
        previewMedia();
      });

      input.addEventListener("change", commitMedia);
    }

    // File paths, fit mode and background color update immediately on change.
    for (const name of [
      "backgroundPath",
      "foregroundPath",
      "backgroundFit",
      "foregroundFit",
      "backgroundColor"
    ]) {
      content.querySelector(`[name="${name}"]`)?.addEventListener("change", commitMedia);
    }

    // Portrait scale is client-local and previews/persists immediately.
    const portraitScale = content.querySelector("[name='portraitScale']");
    if (portraitScale) {
      const valueLabel = portraitScale.closest(".form-fields")?.querySelector(".live-value");

      portraitScale.addEventListener("input", () => {
        const scale = Number(portraitScale.value);
        if (valueLabel) valueLabel.textContent = `${Math.round(scale * 100)}%`;
        game.coc7koStage.overlay.element?.style.setProperty("--coc7ko-user-scale", String(scale));
        game.coc7koStage.overlay.syncViewport();
      });

      portraitScale.addEventListener("change", async () => {
        await game.settings.set(
          MODULE_ID,
          "stagePortraitScale",
          Number(portraitScale.value)
        );
      });
    }

    content.querySelector("[data-action='savePreset']")?.addEventListener("click", async () => {
      const name = content.querySelector("[name='newPresetName']")?.value?.trim();
      const background = content.querySelector("[name='backgroundPath']")?.value?.trim() ?? "";
      const foreground = content.querySelector("[name='foregroundPath']")?.value?.trim() ?? "";
      const backgroundFit = content.querySelector("[name='backgroundFit']")?.value ?? "cover";
      const foregroundFit = content.querySelector("[name='foregroundFit']")?.value ?? "cover";
      const backgroundColor = content.querySelector("[name='backgroundColor']")?.value ?? "#111111";
      const backgroundOpacity = Number(content.querySelector("[name='backgroundOpacity']")?.value ?? 0.40);
      const backgroundBlur = Number(content.querySelector("[name='backgroundBlur']")?.value ?? 0);
      const mainScale = Number(content.querySelector("[name='mainScale']")?.value ?? 1);

      if (!name) {
        return ui.notifications.warn("CoC7-KO | 프리셋 이름을 입력하세요.");
      }

      await game.coc7koStage.savePreset({
        name,
        background,
        foreground,
        backgroundFit,
        foregroundFit,
        backgroundColor,
        backgroundOpacity,
        backgroundBlur,
        mainScale
      });
      await this.render({ force: true });
    });

    content.querySelectorAll("[data-action='applyPreset']").forEach(btn => {
      btn.addEventListener("click", async event => {
        const presetId = event.currentTarget.dataset.presetId;
        await game.coc7koStage.applyPreset(presetId);
        await this.render({ force: true });
      });
    });

    content.querySelectorAll("[data-action='deletePreset']").forEach(btn => {
      btn.addEventListener("click", async event => {
        const presetId = event.currentTarget.dataset.presetId;
        await game.coc7koStage.deletePreset(presetId);
        await this.render({ force: true });
      });
    });

    content.querySelector("[data-action='openItemPalette']")?.addEventListener("click", () => {
      game.coc7koStage.openItemPalette();
    });

    content.querySelector("[data-action='openNpcPalette']")?.addEventListener("click", () => {
      game.coc7koStage.openNpcPalette();
    });
  }

  async _handleSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);

    const backgroundPath = String(expanded.backgroundPath ?? "").trim();
    const foregroundPath = String(expanded.foregroundPath ?? "").trim();
    const backgroundFit = ["cover", "contain"].includes(expanded.backgroundFit)
      ? expanded.backgroundFit
      : "cover";
    const foregroundFit = ["cover", "contain"].includes(expanded.foregroundFit)
      ? expanded.foregroundFit
      : "cover";
    const backgroundColor = String(expanded.backgroundColor ?? "#111111");
    const backgroundOpacity = Math.clamp(Number(expanded.backgroundOpacity ?? 0.40), 0.15, 1);
    const backgroundBlur = 0;
    const mainScale = Math.clamp(Number(expanded.mainScale ?? 0.72), 0.50, 0.90);

    delete expanded.backgroundPath;
    delete expanded.foregroundPath;
    delete expanded.backgroundFit;
    delete expanded.foregroundFit;
    delete expanded.backgroundColor;
    delete expanded.backgroundOpacity;
    delete expanded.backgroundBlur;
    delete expanded.mainScale;
    delete expanded.portraitScale;
    delete expanded.newPresetName;

    const stage = getStageFlags(canvas.scene);
    const next = mergeObject(stage, expanded);

    next.media = {
      background: backgroundPath,
      foreground: foregroundPath,
      backgroundFit,
      foregroundFit,
      backgroundColor,
      backgroundOpacity,
      backgroundBlur,
      mainScale
    };

    for (const slotDef of NPC_SLOT_DEFS) {
      const slot = next.slots[slotDef.key] ?? {};
      slot.actorId = String(slot.actorId ?? "");
      const actor = slot.actorId ? game.actors.get(slot.actorId) : null;
      slot.actorUuid = actor?.uuid ?? String(slot.actorUuid ?? "");
      slot.image = String(slot.image ?? "");
      slot.mirror = !!slot.mirror;
      slot.visible = !!slot.visible;
      next.slots[slotDef.key] = slot;
    }

    next.stageMode = !!next.stageMode;
    next.hideHotbar = !!next.hideHotbar;
    next.focusedSlot = next.focusedSlot || null;

    await canvas.scene.setFlag(MODULE_ID, "stage", next);

    // v0.5 custom Stage Media no longer uses Foundry's native Foreground.
    // Clear an old native foreground after its path has been imported into Stage media.
    // This removes the Foundry "foreground size does not match background" warning.
    const sceneUpdate = {};
    if (canvas.scene.foreground) sceneUpdate.foreground = null;
    if (canvas.scene.background?.src) sceneUpdate["background.src"] = null;
    if (Object.keys(sceneUpdate).length) {
      await canvas.scene.update(sceneUpdate);
    }

    await syncStageMediaTiles(canvas.scene);

    ui.notifications.info("CoC7-KO | Visual Novel Stage 설정을 저장했습니다.");
    await game.coc7koStage.overlay.refresh();
    this.close();
  }
}


/*
 * Folder support for the palettes.
 *
 * Rather than inventing a second folder system, the palettes follow the
 * folders Foundry already has: the Actors and Items sidebar folders, and the
 * folders inside compendiums. Running several campaigns in one world then
 * works the natural way — make a folder per session in the sidebar, drag
 * actors or compendium items into it, and pick that folder in the palette.
 */
function folderPath(folder) {
  if (!folder) return "";
  const chain = [...(folder.ancestors ?? []).slice().reverse(), folder];
  return chain.map(f => f.name).join(" / ");
}

function paletteFolderFilter(key) {
  try {
    return game.settings.get(MODULE_ID, "paletteFolderFilter")?.[key] ?? "all";
  } catch (_) {
    return "all";
  }
}

async function rememberPaletteFolder(key, value) {
  const current = { ...(game.settings.get(MODULE_ID, "paletteFolderFilter") ?? {}) };
  current[key] = value;
  await game.settings.set(MODULE_ID, "paletteFolderFilter", current);
}

/** Builds the <option> list and grouped card markup shared by both palettes. */
function groupedFolderOptions(entries) {
  const seen = new Map();
  for (const entry of entries) {
    if (!seen.has(entry.folderKey)) seen.set(entry.folderKey, entry.folderLabel);
  }
  return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1], game.i18n.lang));
}

class Coc7KoItemPalette extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "coc7ko-item-palette",
    tag: "section",
    window: {
      title: "CoC7-KO Item Palette",
      icon: "fa-solid fa-box-open",
      resizable: true
    },
    position: {
      width: 560,
      height: 540
    }
  };

  async _prepareContext() {
    const favorites = new Set(
      game.settings.get(MODULE_ID, "itemPaletteFavorites") ?? []
    );

    const items = [];

    for (const item of game.items.contents) {
      if (!isPaletteItemType(item.type)) continue;

      const path = folderPath(item.folder);

      items.push({
        uuid: item.uuid,
        name: item.name,
        img: item.img || "icons/svg/item-bag.svg",
        type: item.type,
        source: "world",
        sourceLabel: "월드",
        folderKey: `world:${path}`,
        folderLabel: path ? `월드 › ${path}` : "월드 › (폴더 없음)",
        favorite: favorites.has(item.uuid)
      });
    }

    const itemPacks = Array.from(game.packs)
      .filter(pack => pack.documentName === "Item");

    for (const pack of itemPacks) {
      let index;
      try {
        index = await pack.getIndex({
          fields: ["name", "img", "type", "folder"]
        });
      } catch (err) {
        console.warn(`${MODULE_ID} | Could not index Item pack ${pack.collection}`, err);
        continue;
      }

      const packageName = pack.metadata?.packageName ?? "";
      const packageType = pack.metadata?.packageType ?? "";

      let source = "other";
      let sourceLabel = pack.metadata?.label ?? pack.collection;

      if (packageName === MODULE_ID || pack.collection.startsWith(`${MODULE_ID}.`)) {
        source = "coc7ko";
        sourceLabel = "CoC7-KO";
      } else if (packageType === "system" || packageName === game.system.id) {
        source = "system";
        sourceLabel = "CoC7";
      }

      for (const entry of index) {
        if (!isPaletteItemType(entry.type)) continue;

        const uuid = entry.uuid
          || `Compendium.${pack.collection}.Item.${entry._id}`;

        const packFolder = entry.folder ? pack.folders?.get?.(entry.folder) : null;
        const path = folderPath(packFolder);

        items.push({
          uuid,
          name: entry.name ?? "Unnamed Item",
          img: entry.img || "icons/svg/item-bag.svg",
          type: entry.type ?? "item",
          source,
          sourceLabel,
          folderKey: `pack:${pack.collection}:${path}`,
          folderLabel: path ? `${sourceLabel} › ${path}` : sourceLabel,
          favorite: favorites.has(uuid)
        });
      }
    }

    items.sort((a, b) => {
      if (a.favorite !== b.favorite) return a.favorite ? -1 : 1;
      return a.name.localeCompare(b.name, game.i18n.lang);
    });

    return {
      items,
      folders: groupedFolderOptions(items),
      folderFilter: paletteFolderFilter("items"),
      favoriteCount: items.filter(i => i.favorite).length
    };
  }

  async _renderHTML(context) {
    return `
      <div class="coc7ko-item-palette-root">
        <div class="item-palette-toolbar">
          <input type="search"
                 class="item-palette-search"
                 placeholder="아이템 검색...">

          <select class="item-palette-source">
            <option value="all">전체</option>
            <option value="favorites">★ 즐겨찾기 (${context.favoriteCount})</option>
            <option value="world">월드 Items</option>
            <option value="coc7ko">CoC7-KO</option>
            <option value="system">CoC7 시스템</option>
            <option value="other">기타 컴펜디움</option>
          </select>

          <select class="item-palette-folder" title="폴더">
            <option value="all" ${context.folderFilter === "all" ? "selected" : ""}>모든 폴더</option>
            ${context.folders.map(([key, label]) => `
              <option value="${escapeHtml(key)}" ${context.folderFilter === key ? "selected" : ""}>${escapeHtml(label)}</option>
            `).join("")}
          </select>
        </div>

        <p class="hint item-palette-hint">
          아이템을 PC 포트레잇 카드로 드래그하면 즉시 지급됩니다.
          우클릭하면 PC를 선택해 바로 지급할 수 있습니다.
        </p>

        <div class="coc7ko-item-grid">
          ${context.items.length
            ? context.items.map(item => `
              <article class="item-palette-card ${item.favorite ? "favorite" : ""}"
                       draggable="true"
                       data-uuid="${escapeHtml(item.uuid)}"
                       data-name="${escapeHtml(item.name)}"
                       data-source="${escapeHtml(item.source)}"
                       data-folder="${escapeHtml(item.folderKey)}"
                       data-search="${escapeHtml(`${item.name} ${item.type} ${item.sourceLabel} ${item.folderLabel}`.toLowerCase())}"
                       title="${escapeHtml(item.name)}">
                <button type="button"
                        class="item-favorite-toggle"
                        data-action="toggleFavorite"
                        title="즐겨찾기">
                  <i class="${item.favorite ? "fa-solid" : "fa-regular"} fa-star"></i>
                </button>

                <img src="${escapeHtml(item.img)}" alt="">

                <div class="item-palette-name">${escapeHtml(item.name)}</div>
                <div class="item-palette-meta">${escapeHtml(item.sourceLabel)}</div>
              </article>
            `).join("")
            : `<p class="hint">표시할 Item이 없습니다.</p>`
          }
        </div>
      </div>
    `;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;

    const search = content.querySelector(".item-palette-search");
    const source = content.querySelector(".item-palette-source");
    const folder = content.querySelector(".item-palette-folder");
    const cards = () => [...content.querySelectorAll(".item-palette-card")];

    const applyFilter = () => {
      const query = search?.value?.trim().toLowerCase() ?? "";
      const sourceValue = source?.value ?? "all";
      const folderValue = folder?.value ?? "all";

      for (const card of cards()) {
        const matchesSearch = !query || (card.dataset.search ?? "").includes(query);

        const matchesSource = sourceValue === "all"
          || (sourceValue === "favorites" && card.classList.contains("favorite"))
          || card.dataset.source === sourceValue;

        const matchesFolder = folderValue === "all" || card.dataset.folder === folderValue;

        card.hidden = !(matchesSearch && matchesSource && matchesFolder);
      }
    };

    search?.addEventListener("input", applyFilter);
    source?.addEventListener("change", applyFilter);
    folder?.addEventListener("change", () => {
      applyFilter();
      // Remembered per client, so each table reopens on its own session folder.
      rememberPaletteFolder("items", folder.value);
    });
    applyFilter();

    for (const card of cards()) {
      card.addEventListener("dragstart", event => {
        if (!game.user.isGM) {
          event.preventDefault();
          return;
        }

        const uuid = card.dataset.uuid;
        const data = {
          type: "Item",
          uuid
        };

        event.dataTransfer?.setData("text/plain", JSON.stringify(data));
        if (event.dataTransfer) event.dataTransfer.effectAllowed = "copy";

        document.body.classList.add("coc7ko-item-dragging");
        card.classList.add("dragging");
      });

      card.addEventListener("dragend", () => {
        document.body.classList.remove("coc7ko-item-dragging");
        card.classList.remove("dragging");
        game.coc7koStage?.overlay?._clearDropHighlights();
      });

      card.addEventListener("dblclick", async event => {
        if (event.target.closest(".item-favorite-toggle")) return;

        const item = await game.coc7koStage.resolveItemUuid(card.dataset.uuid);
        item?.sheet?.render(true);
      });

      card.addEventListener("contextmenu", async event => {
        if (!game.user.isGM) return;
        if (event.target.closest(".item-favorite-toggle")) return;

        event.preventDefault();
        await game.coc7koStage.quickGiveItem(card.dataset.uuid);
      });
    }

    content.querySelectorAll("[data-action='toggleFavorite']").forEach(button => {
      button.addEventListener("click", async event => {
        event.preventDefault();
        event.stopPropagation();

        const card = event.currentTarget.closest(".item-palette-card");
        if (!card) return;

        await game.coc7koStage.toggleItemFavorite(card.dataset.uuid);
        await this.render({ force: true });
      });
    });
  }
}

/**
 * v0.7.0 | NPC Palette
 *
 * Previously embedded inside the Stage config form. It is now an independent,
 * resizable window so the keeper can leave it open beside the item palette
 * and swap NPCs without reopening the Scene Controls every time.
 */
class Coc7KoNpcPalette extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "coc7ko-npc-palette",
    tag: "section",
    window: {
      title: "CoC7-KO NPC Palette",
      icon: "fa-solid fa-masks-theater",
      resizable: true
    },
    position: {
      width: 460,
      height: 560
    }
  };

  async _prepareContext() {
    const stage = getStageFlags(canvas?.scene);
    const pcSlots = getPcSetupSlots(canvas?.scene);

    const pcActorIds = new Set(
      PC_SLOT_DEFS.map(def => pcSlots[def.key]?.actorId).filter(Boolean)
    );

    const activeNpcIds = new Set(
      NPC_SLOT_DEFS.map(def => stage.slots[def.key]?.actorId).filter(Boolean)
    );

    const npcActors = game.actors.contents
      .filter(actor => !pcActorIds.has(actor.id))
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(actor => {
        const path = folderPath(actor.folder);
        return {
          id: actor.id,
          name: actor.name,
          img: actor.prototypeToken?.texture?.src || actor.img || "icons/svg/mystery-man.svg",
          active: activeNpcIds.has(actor.id),
          folderKey: path,
          folderLabel: path || "(폴더 없음)"
        };
      });

    return {
      npcActors,
      folders: groupedFolderOptions(npcActors),
      folderFilter: paletteFolderFilter("npcs"),
      npcHudMode: stage.npcHudMode ?? "gm",
      activeCount: activeNpcIds.size
    };
  }

  async _renderHTML(context) {
    return `
      <div class="coc7ko-npc-palette-root">
        <div class="npc-palette-toolbar">
          <input type="search"
                 class="coc7ko-npc-search"
                 placeholder="NPC 이름 검색...">

          <select class="coc7ko-npc-folder" title="폴더">
            <option value="all" ${context.folderFilter === "all" ? "selected" : ""}>모든 폴더</option>
            ${context.folders.map(([key, label]) => `
              <option value="${escapeHtml(key)}" ${context.folderFilter === key ? "selected" : ""}>${escapeHtml(label)}</option>
            `).join("")}
          </select>

          <select class="coc7ko-npc-hud-mode" title="NPC HUD 표시">
            <option value="gm" ${context.npcHudMode !== "off" ? "selected" : ""}>HUD: 키퍼만</option>
            <option value="off" ${context.npcHudMode === "off" ? "selected" : ""}>HUD: 끄기</option>
          </select>
        </div>

        <p class="hint npc-palette-hint">
          클릭하면 Stage에 등장/퇴장합니다. 동시에 최대 4명(${context.activeCount}/4)까지 표시됩니다.
        </p>

        <div class="coc7ko-npc-palette">
          ${context.npcActors.length
            ? context.npcActors.map(actor => `
              <button type="button"
                      class="npc-palette-card ${actor.active ? "active" : ""}"
                      data-action="toggleNpcActor"
                      data-actor-id="${actor.id}"
                      data-folder="${escapeHtml(actor.folderKey)}"
                      data-search-name="${escapeHtml(`${actor.name} ${actor.folderLabel}`.toLowerCase())}"
                      title="${escapeHtml(actor.name)}">
                <img src="${escapeHtml(actor.img)}" alt="">
                <span>${escapeHtml(actor.name)}</span>
                ${actor.active ? `<i class="fa-solid fa-circle-check"></i>` : ""}
              </button>
            `).join("")
            : `<p class="hint">표시할 NPC Actor가 없습니다.</p>`
          }
        </div>
      </div>
    `;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;

    const search = content.querySelector(".coc7ko-npc-search");
    const folder = content.querySelector(".coc7ko-npc-folder");

    const applyFilter = () => {
      const query = search?.value?.trim().toLowerCase() ?? "";
      const folderValue = folder?.value ?? "all";

      content.querySelectorAll(".npc-palette-card").forEach(card => {
        const matchesSearch = !query || (card.dataset.searchName ?? "").includes(query);
        const matchesFolder = folderValue === "all" || card.dataset.folder === folderValue;
        card.hidden = !(matchesSearch && matchesFolder);
      });
    };

    search?.addEventListener("input", applyFilter);
    folder?.addEventListener("change", () => {
      applyFilter();
      rememberPaletteFolder("npcs", folder.value);
    });
    applyFilter();

    content.querySelector(".coc7ko-npc-hud-mode")?.addEventListener("change", async event => {
      await game.coc7koStage.setNpcHudMode(event.currentTarget.value);
    });

    content.querySelectorAll("[data-action='toggleNpcActor']").forEach(btn => {
      btn.addEventListener("click", async event => {
        const actorId = event.currentTarget.dataset.actorId;
        await game.coc7koStage.toggleNpcActor(actorId);
        await this.render({ force: true });
      });
    });
  }
}

class Coc7KoPcSetupConfig extends foundry.applications.api.ApplicationV2 {
  static DEFAULT_OPTIONS = {
    id: "coc7ko-pc-setup",
    tag: "form",
    window: {
      title: "CoC7-KO PC Stage Setup",
      icon: "fa-solid fa-users",
      resizable: true
    },
    position: {
      width: 820,
      height: 680
    },
    form: {
      closeOnSubmit: false,
      submitOnClose: false,
      handler: function(event, form, formData) {
        return this._handleSubmit(event, form, formData);
      }
    }
  };

  async _prepareContext() {
    const slots = getPcSetupSlots(canvas.scene);
    const actorOptions = game.actors.contents
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(actor => ({
        id: actor.id,
        name: `${actor.name} [${actor.type}]`
      }));

    return {
      slots,
      slotDefs: PC_SLOT_DEFS,
      actorOptions
    };
  }

  async _renderHTML(context) {
    const actorOptionsHtml = context.actorOptions
      .map(o => `<option value="${o.id}">${o.name}</option>`)
      .join("");

    const rows = context.slotDefs.map(slotDef => {
      const slot = context.slots[slotDef.key] ?? {};
      return `
        <fieldset class="slot-fieldset">
          <legend>${slotDef.label}</legend>

          <div class="form-group">
            <label>표시</label>
            <input type="checkbox" name="slots.${slotDef.key}.visible" ${slot.visible ? "checked" : ""}>
          </div>

          <div class="form-group">
            <label>Actor</label>
            <select name="slots.${slotDef.key}.actorId">
              <option value="">없음</option>
              ${actorOptionsHtml.replace(
                `value="${slot.actorId || ""}"`,
                `value="${slot.actorId || ""}" selected`
              )}
            </select>
          </div>

          <div class="form-group">
            <label>Stage 이미지</label>
            <div class="form-fields">
              <input type="text"
                     name="slots.${slotDef.key}.image"
                     value="${slot.image ?? ""}"
                     placeholder="비우면 Actor/Token 이미지 사용">
              <button type="button"
                      data-action="pickFile"
                      data-target="slots.${slotDef.key}.image">
                <i class="fa-solid fa-folder-open"></i>
              </button>
            </div>
          </div>

          <div class="form-group">
            <label>좌우 반전</label>
            <input type="checkbox" name="slots.${slotDef.key}.mirror" ${slot.mirror ? "checked" : ""}>
          </div>
        </fieldset>
      `;
    }).join("");

    return `
      <div class="standard-form coc7ko-stage-config coc7ko-pc-setup-config">
        <p class="hint">
          PC 슬롯은 캠페인 전체에서 공통으로 사용됩니다. 한 번 설정하면 Scene이나
          Stage Preset을 바꿔도 그대로 유지됩니다.
        </p>

        <div class="slot-grid pc-slot-grid">
          ${rows}
        </div>

        <footer class="form-footer">
          <button type="submit">
            <i class="fa-solid fa-floppy-disk"></i> PC 설정 저장
          </button>
        </footer>
      </div>
    `;
  }

  async _replaceHTML(result, content) {
    content.innerHTML = result;

    content.querySelectorAll("[data-action='pickFile']").forEach(btn => {
      btn.addEventListener("click", async event => {
        const target = event.currentTarget.dataset.target;
        const field = content.querySelector(`[name="${target}"]`);
        const FilePickerClass = foundry.applications.apps.FilePicker;
        const fp = new FilePickerClass({
          type: "image",
          callback: path => field.value = path
        });
        fp.render({ force: true });
      });
    });
  }

  async _handleSubmit(event, form, formData) {
    const expanded = foundry.utils.expandObject(formData.object);
    const current = getPcSetupSlots(canvas.scene);
    const next = mergeObject(current, expanded.slots ?? {});

    for (const def of PC_SLOT_DEFS) {
      const slot = next[def.key] ?? {};
      slot.actorId = String(slot.actorId ?? "");
      const actor = slot.actorId ? game.actors.get(slot.actorId) : null;
      slot.actorUuid = actor?.uuid ?? String(slot.actorUuid ?? "");
      slot.image = String(slot.image ?? "");
      slot.mirror = !!slot.mirror;
      slot.visible = !!slot.visible;
      next[def.key] = slot;
    }

    await game.settings.set(MODULE_ID, "pcStageSlots", next);
    await game.coc7koStage.overlay.refresh();

    ui.notifications.info("CoC7-KO | PC Stage 설정을 저장했습니다.");
    this.close();
  }
}


const api = {
  overlay: null,

  async init() {
    this.overlay = new Coc7KoStageOverlay();
    await this.overlay.refresh();
  },

  getSceneData() {
    return getStageFlags(canvas.scene);
  },

  async openStageManager() {
    if (!canvas.scene) return ui.notifications.warn("활성 Scene이 없습니다.");
    if (!game.user.isGM) return ui.notifications.warn("GM만 Stage 설정을 바꿀 수 있습니다.");
    new Coc7KoStageConfig().render({ force: true });
  },

  async openPcSetup() {
    if (!game.user.isGM) return ui.notifications.warn("GM만 PC Stage 설정을 바꿀 수 있습니다.");
    new Coc7KoPcSetupConfig().render({ force: true });
  },

  async openItemPalette() {
    if (!game.user.isGM) {
      return ui.notifications.warn("CoC7-KO | 아이템 팔레트는 키퍼 전용입니다.");
    }

    new Coc7KoItemPalette().render({ force: true });
  },

  async openNpcPalette() {
    if (!game.user.isGM) {
      return ui.notifications.warn("CoC7-KO | NPC 팔레트는 키퍼 전용입니다.");
    }

    new Coc7KoNpcPalette().render({ force: true });
  },

  async setNpcHudMode(mode) {
    if (!canvas.scene || !game.user.isGM) return;

    const stage = getStageFlags(canvas.scene);
    stage.npcHudMode = mode === "off" ? "off" : "gm";
    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    await this.overlay.refresh();
  },

  async toggleLayoutEditing() {
    if (!game.user.isGM) {
      return ui.notifications.warn("CoC7-KO | 배치 편집은 키퍼 전용입니다.");
    }

    if (!canvas.scene) return;

    const stage = getStageFlags(canvas.scene);
    if (!stage.stageMode) {
      return ui.notifications.warn("CoC7-KO | 먼저 Stage Mode를 켜주세요.");
    }

    await this.overlay.toggleLayoutEditing();

    ui.notifications.info(
      this.overlay.layoutEditing
        ? "CoC7-KO | 배치 편집 모드 ON — 드래그로 이동, 우하단 모서리로 크기 조절."
        : "CoC7-KO | 배치를 잠갔습니다."
    );
  },

  async resetStageLayout() {
    if (!game.user.isGM) return;

    await game.settings.set(MODULE_ID, "stageLayout", {});
    await this.overlay.refresh();
    ui.notifications.info("CoC7-KO | Stage 배치를 기본값으로 되돌렸습니다.");
  },

  async resolveItemUuid(uuid) {
    if (!uuid) return null;

    try {
      const doc = await fromUuid(uuid);
      if (doc?.documentName === "Item") return doc;
    } catch (err) {
      console.warn(`${MODULE_ID} | Could not resolve Item UUID ${uuid}`, err);
    }

    return null;
  },

  async grantItemToActor(itemOrUuid, actor) {
    if (!game.user.isGM) {
      return ui.notifications.warn("CoC7-KO | 키퍼만 아이템을 지급할 수 있습니다.");
    }

    if (!actor || actor.documentName !== "Actor") {
      return ui.notifications.error("CoC7-KO | 대상 Actor를 찾을 수 없습니다.");
    }

    const item = typeof itemOrUuid === "string"
      ? await this.resolveItemUuid(itemOrUuid)
      : itemOrUuid;

    if (!item || item.documentName !== "Item") {
      return ui.notifications.error("CoC7-KO | 지급할 Item을 찾을 수 없습니다.");
    }

    const data = cleanEmbeddedItemData(item);
    await actor.createEmbeddedDocuments("Item", [data]);

    ui.notifications.info(`CoC7-KO | ${actor.name}에게 「${item.name}」을(를) 지급했습니다.`);
    await this.overlay?.refresh();

    return item;
  },

  async quickGiveItem(itemUuid) {
    if (!game.user.isGM) return;

    const item = await this.resolveItemUuid(itemUuid);
    if (!item) {
      return ui.notifications.error("CoC7-KO | Item을 불러올 수 없습니다.");
    }

    const pcSlots = getPcSetupSlots(canvas.scene);
    const options = PC_SLOT_DEFS
      .map(def => {
        const actor = getActorFromSlot(pcSlots[def.key]);
        if (!actor) return null;
        return {
          key: def.key,
          actor,
          label: `${def.label}: ${actor.name}`
        };
      })
      .filter(Boolean);

    if (!options.length) {
      return ui.notifications.warn("CoC7-KO | PC Stage에 등록된 Actor가 없습니다.");
    }

    const buttons = options.map((option, index) => ({
      action: option.actor.id,
      label: option.label,
      default: index === 0
    }));

    buttons.push({
      action: "cancel",
      label: "취소"
    });

    const choice = await foundry.applications.api.DialogV2.wait({
      window: {
        title: `「${item.name}」 지급`
      },
      content: `<p>아이템을 받을 조사자를 선택하세요.</p>`,
      buttons
    });

    if (!choice || choice === "cancel") return;

    const actor = game.actors.get(choice);
    if (!actor) return;

    return this.grantItemToActor(item, actor);
  },

  async toggleItemFavorite(uuid) {
    const favorites = new Set(
      game.settings.get(MODULE_ID, "itemPaletteFavorites") ?? []
    );

    if (favorites.has(uuid)) favorites.delete(uuid);
    else favorites.add(uuid);

    await game.settings.set(
      MODULE_ID,
      "itemPaletteFavorites",
      [...favorites]
    );
  },

  async toggleStageMode() {
    if (!canvas.scene) return;
    const stage = getStageFlags(canvas.scene);
    stage.stageMode = !stage.stageMode;
    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    await syncStageMediaTiles(canvas.scene);
    await this.overlay.refresh();
    ui.notifications.info(`CoC7-KO | Stage Mode ${stage.stageMode ? "ON" : "OFF"}`);
  },

  async setFocusedSlot(slotKey) {
    if (!canvas.scene) return;
    await this.overlay?.clearAutoSpeaker({ refresh: false });
    const stage = getStageFlags(canvas.scene);
    stage.focusedSlot = slotKey || null;
    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    await this.overlay.refresh();
  },

  /**
   * Releases every kind of speaker highlight at once: the keeper's manual
   * pick, the temporary focus from a chat line, and any voice highlights.
   */
  async releaseSpeakers() {
    const overlay = this.overlay;
    if (overlay) {
      clearTimeout(overlay.autoFocusTimer);
      overlay.autoFocusTimer = null;
      overlay.autoFocusedSlot = null;
    }

    this.clearSpeaking?.();

    if (game.user.isGM && canvas.scene) {
      await this.setFocusedSlot(null);
    } else {
      await overlay?.refresh();
    }
  },

  async clearFocus() {
    return this.setFocusedSlot(null);
  },

  async repairStageMedia() {
    if (!canvas.scene || !game.user.isGM) return;

    await syncStageMediaTiles(canvas.scene);
    await this.overlay.refresh();

    ui.notifications.info("CoC7-KO | Stage 이미지 레이어를 정리했습니다.");
  },

  async previewMedia(media) {
    if (!canvas.scene || !game.user.isGM) return;

    const stage = getStageFlags(canvas.scene);
    stage.media = {
      ...stage.media,
      ...media
    };

    await syncStageMediaTiles(canvas.scene, stage);
  },

  async commitMedia(media) {
    if (!canvas.scene || !game.user.isGM) return;

    const stage = getStageFlags(canvas.scene);
    stage.media = {
      ...stage.media,
      ...media
    };

    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    // updateScene will also request a sync; the serialized queue guarantees
    // that these calls cannot create duplicate Tiles.
    await syncStageMediaTiles(canvas.scene, stage);
  },

  async savePreset({
    name,
    background = "",
    foreground = "",
    backgroundFit = "cover",
    foregroundFit = "cover",
    backgroundColor = "#111111",
    backgroundOpacity = 0.40,
    backgroundBlur = 0,
    mainScale = 0.72
  }) {
    if (!canvas.scene) return;
    if (!game.user.isGM) return ui.notifications.warn("GM만 Stage Preset을 저장할 수 있습니다.");

    const stage = getStageFlags(canvas.scene);
    const presets = Array.isArray(stage.presets) ? stage.presets : [];

    presets.push({
      id: makePresetId(),
      name,
      background,
      foreground,
      backgroundFit,
      foregroundFit,
      backgroundColor,
      backgroundOpacity,
      backgroundBlur,
      mainScale
    });

    stage.presets = presets;
    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    ui.notifications.info(`CoC7-KO | Stage Preset 저장: ${name}`);
  },

  async applyPreset(presetId) {
    if (!canvas.scene) return;
    if (!game.user.isGM) return ui.notifications.warn("GM만 Stage Preset을 적용할 수 있습니다.");

    const stage = getStageFlags(canvas.scene);
    const preset = (stage.presets ?? []).find(p => p.id === presetId);
    if (!preset) return ui.notifications.error("CoC7-KO | Stage Preset을 찾을 수 없습니다.");

    stage.media = {
      background: preset.background || "",
      foreground: preset.foreground || "",
      backgroundFit: preset.backgroundFit || "cover",
      foregroundFit: preset.foregroundFit || "cover",
      backgroundColor: preset.backgroundColor || "#111111",
      backgroundOpacity: Number(preset.backgroundOpacity ?? 0.40),
      backgroundBlur: Number(preset.backgroundBlur ?? 0),
      mainScale: Number(preset.mainScale ?? 0.72)
    };

    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    await syncStageMediaTiles(canvas.scene);
    await this.overlay.refresh();

    ui.notifications.info(`CoC7-KO | 장소 전환: ${preset.name}`);
  },

  async deletePreset(presetId) {
    if (!canvas.scene) return;
    if (!game.user.isGM) return ui.notifications.warn("GM만 Stage Preset을 삭제할 수 있습니다.");

    const stage = getStageFlags(canvas.scene);
    const preset = (stage.presets ?? []).find(p => p.id === presetId);
    stage.presets = (stage.presets ?? []).filter(p => p.id !== presetId);

    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    if (preset) ui.notifications.info(`CoC7-KO | Stage Preset 삭제: ${preset.name}`);
  },

  async toggleNpcActor(actorId) {
    if (!canvas.scene) return;
    if (!game.user.isGM) return ui.notifications.warn("GM만 NPC Stage를 조정할 수 있습니다.");

    const actor = game.actors.get(actorId);
    if (!actor) return ui.notifications.error("CoC7-KO | NPC Actor를 찾을 수 없습니다.");

    const stage = getStageFlags(canvas.scene);

    // Already on Stage -> remove.
    const activeDef = NPC_SLOT_DEFS.find(
      def => stage.slots[def.key]?.actorId === actorId
    );

    if (activeDef) {
      const slot = stage.slots[activeDef.key];
      slot.actorId = "";
      slot.actorUuid = "";
      slot.image = "";
      slot.visible = false;

      if (stage.focusedSlot === activeDef.key) stage.focusedSlot = null;

      await canvas.scene.setFlag(MODULE_ID, "stage", stage);
      await this.overlay.refresh();
      ui.notifications.info(`CoC7-KO | NPC 퇴장: ${actor.name}`);
      return;
    }

    // Use the first empty/hidden slot.
    let targetDef = NPC_SLOT_DEFS.find(def => {
      const slot = stage.slots[def.key];
      return !slot?.actorId || !slot?.visible;
    });

    // Every slot occupied: ask which one to replace.
    if (!targetDef) {
      const buttons = NPC_SLOT_DEFS.map((def, index) => {
        const currentActor = getActorFromSlot(stage.slots[def.key]);
        return {
          action: def.key,
          label: `${def.label}: ${currentActor?.name ?? "비어 있음"}`,
          default: index === 0
        };
      });
      buttons.push({ action: "cancel", label: "취소" });

      const choice = await foundry.applications.api.DialogV2.wait({
        window: { title: `${actor.name} 등장` },
        content: `<p>NPC 슬롯 ${NPC_SLOT_DEFS.length}개가 모두 사용 중입니다. 교체할 슬롯을 선택하세요.</p>`,
        buttons
      });

      if (!choice || choice === "cancel") return;
      targetDef = NPC_SLOT_DEFS.find(def => def.key === choice);
      if (!targetDef) return;
    }

    const slot = stage.slots[targetDef.key];
    slot.actorId = actor.id;
    slot.actorUuid = actor.uuid;
    slot.image = "";
    slot.mirror = false;
    slot.visible = true;

    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    await this.overlay.refresh();

    ui.notifications.info(`CoC7-KO | NPC 등장: ${actor.name}`);
  },

  async toggleMirror(slotKey) {
    if (!canvas.scene) return;
    const stage = getStageFlags(canvas.scene);
    const slot = stage.slots[slotKey];
    if (!slot) return;
    slot.mirror = !slot.mirror;
    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    await this.overlay.refresh();
  },

  async setSlotVisibility(slotKey, visible) {
    if (!canvas.scene) return;
    const stage = getStageFlags(canvas.scene);
    const slot = stage.slots[slotKey];
    if (!slot) return;
    slot.visible = !!visible;
    await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    await this.overlay.refresh();
  },

  async focusActor(actorId) {
    const scene = canvas.scene;
    if (!scene) return null;
    const stage = getStageFlags(scene);
    const found = SLOT_DEFS.find(def => {
      const actor = getActorFromSlot(stage.slots[def.key]);
      return actor?.id === actorId;
    });
    if (!found) return null;
    await this.setFocusedSlot(found.key);
    return found.key;
  },

};

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "pcStageSlots", {
    name: "PC Stage Slots",
    scope: "world",
    config: false,
    type: Object,
    default: emptyPcSlots(),
    onChange: () => game.coc7koStage?.overlay?.refresh()
  });

  game.settings.register(MODULE_ID, "itemPaletteFavorites", {
    name: "Item Palette Favorites",
    scope: "client",
    config: false,
    type: Array,
    default: []
  });

  game.settings.register(MODULE_ID, "stageLayout", {
    name: "Stage Layout",
    scope: "world",
    config: false,
    type: Object,
    default: {},
    onChange: () => game.coc7koStage?.overlay?.refresh()
  });

  game.settings.register(MODULE_ID, "stageLayoutLocked", {
    name: "Stage Layout Locked",
    scope: "world",
    config: false,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "forceStageSpeaker", {
    name: "Stage 캐릭터로 화자 고정",
    hint: "토큰을 선택하지 않고 채팅을 쳐도, PC Stage에 배정된 자기 캐릭터가 화자가 됩니다.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "paletteFolderFilter", {
    name: "Palette Folder Filter",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "stageAutoFit", {
    name: "초상화 크기 자동 맞춤",
    hint: "화면이 작아 초상화끼리 겹칠 때 겹치지 않을 만큼 자동으로 줄입니다. 위의 초상화 크기 설정은 최대 크기로 쓰이며, 공간이 넉넉해지면 다시 그 크기로 돌아갑니다.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => game.coc7koStage?.overlay?.scheduleFit()
  });

  game.settings.register(MODULE_ID, "stageLeftGap", {
    name: "포트레잇 좌측 여유 간격(px)",
    hint: "왼쪽 씬 컨트롤과 플레이어 목록에서 초상화를 얼마나 떨어뜨릴지 정합니다. 초상화가 아이콘과 겹치면 늘리세요.",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 240, step: 4 },
    default: 28,
    onChange: () => game.coc7koStage?.overlay?.syncViewport()
  });

  game.settings.register(MODULE_ID, "speechBubbles", {
    name: "스테이지 말풍선",
    hint: "캐릭터가 채팅으로 말하면 해당 포트레잇 위에 말풍선을 띄웁니다.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "speechBubbleDuration", {
    name: "말풍선 유지 시간(초)",
    hint: "말풍선이 화면에 남아 있는 시간입니다.",
    scope: "world",
    config: true,
    type: Number,
    range: { min: 2, max: 20, step: 1 },
    default: 7
  });

  game.settings.register(MODULE_ID, "stagePortraitScale", {
    name: "Stage 포트레잇 배율",
    hint: "이 기기에서 Visual Novel Stage의 캐릭터 포트레잇/HUD 크기를 조절합니다. 작은 화면에서는 낮추고, 큰 화면에서는 높일 수 있습니다.",
    scope: "client",
    config: true,
    type: Number,
    range: {
      min: 0.70,
      max: 1.35,
      step: 0.05
    },
    default: 1.00,
    onChange: () => {
      game.coc7koStage?.overlay?.syncUserScale();
      game.coc7koStage?.overlay?.syncViewport();
    }
  });

  game.coc7koStage = api;
});

Hooks.once("ready", async () => {
  // Several stylesheet rules guard keeper-only data; make the flag explicit.
  document.body.classList.toggle("is-gm", game.user.isGM);
  await game.coc7koStage.init();
  console.log(`${MODULE_ID} | Visual Novel Stage prototype ready.`);
});

Hooks.on("canvasReady", async () => {
  if (!game.coc7koStage?.overlay) return;

  if (game.user.isGM && canvas.scene) {
    // A newly-opened Stage starts with no active speaker.
    const stage = getStageFlags(canvas.scene);
    if (stage.focusedSlot) {
      stage.focusedSlot = null;
      await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    }

    await syncStageMediaTiles(canvas.scene);
  }

  await game.coc7koStage.overlay.refresh();
  setTimeout(() => applyStageTileVisualEffects(canvas.scene), 100);
});

Hooks.on("createTile", tile => {
  if (tile.parent?.id !== canvas.scene?.id) return;
  if (!tile.getFlag(MODULE_ID, STAGE_MEDIA_FLAG)) return;
  setTimeout(() => applyStageTileVisualEffects(canvas.scene), 50);
});

Hooks.on("updateTile", tile => {
  if (tile.parent?.id !== canvas.scene?.id) return;
  if (!tile.getFlag(MODULE_ID, STAGE_MEDIA_FLAG)) return;
  setTimeout(() => applyStageTileVisualEffects(canvas.scene), 50);
});

Hooks.on("updateScene", async (scene, changed) => {
  if (scene.id !== canvas?.scene?.id) return;
  if (!game.coc7koStage?.overlay) return;
  if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.stage`)) {
    if (game.user.isGM) await syncStageMediaTiles(scene);
    await game.coc7koStage.overlay.refresh();
  }
});

Hooks.on("controlActor", async () => {
  if (!game.coc7koStage?.overlay) return;
  await game.coc7koStage.overlay.refresh();
});

Hooks.on("updateActor", async (actor) => {
  if (!game.coc7koStage?.overlay) return;
  const stage = getStageFlags(canvas?.scene);
  const usingActor = Object.values(stage.slots).some(
    slot => slot.actorId === actor.id || slot.actorUuid === actor.uuid
  );
  if (usingActor) await game.coc7koStage.overlay.refresh();
});

Hooks.on("createChatMessage", async (message) => {
  if (!canvas?.scene || !game.coc7koStage?.overlay) return;

  let actorId = message.speaker?.actor ?? null;

  // Tokenless PC chat can still carry the user's assigned Character.
  if (!actorId) {
    actorId = message.author?.character?.id ?? null;
  }

  // Last fallback for token-based messages that lack speaker.actor.
  if (!actorId && message.speaker?.token && message.speaker?.scene) {
    try {
      const token = fromUuidSync(
        `Scene.${message.speaker.scene}.Token.${message.speaker.token}`
      );
      actorId = token?.actor?.id ?? null;
    } catch (_) {}
  }

  if (!actorId) return;

  if (game.user.isGM) {
    const stage = getStageFlags(canvas.scene);
    if (stage.focusedSlot) {
      stage.focusedSlot = null;
      await canvas.scene.setFlag(MODULE_ID, "stage", stage);
    }
  }

  // v0.7.0 | On-canvas speech bubble for the speaking portrait.
  const bubblesOn = game.settings.get(MODULE_ID, "speechBubbles");
  const seconds = Number(game.settings.get(MODULE_ID, "speechBubbleDuration")) || 7;

  const slotKey = game.coc7koStage.overlay.findSlotForActor(actorId);
  const spoken = bubblesOn
    && slotKey
    && !message.rolls?.length
    && !(message.whisper?.length && !message.isOwner && !game.user.isGM)
    ? chatMessageToSpeech(message)
    : "";

  // Keep the highlight on screen for as long as the bubble it belongs to.
  const focusMs = spoken ? seconds * 1000 : 3000;
  await game.coc7koStage.overlay.setAutoSpeakerByActor(actorId, focusMs);

  if (spoken) {
    await game.coc7koStage.overlay.showSpeech(slotKey, spoken, seconds * 1000);
  }
});

Hooks.on("getSceneControlButtons", (controls) => {
  if (!game.user.isGM) return;

  const tokenControl = controls.tokens;
  if (!tokenControl?.tools) {
    console.warn(`${MODULE_ID} | controls.tokens.tools was not available.`);
    return;
  }

  const baseOrder = Math.max(
    0,
    ...Object.values(tokenControl.tools).map(tool => Number(tool.order) || 0)
  ) + 1;

  // Rarely used: campaign-level PC cast configuration.
  tokenControl.tools.coc7koPcSetup = {
    name: "coc7koPcSetup",
    title: "CoC7-KO | PC Stage 설정",
    icon: "fa-solid fa-users",
    order: baseOrder,
    button: true,
    visible: true,
    onChange: () => game.coc7koStage.openPcSetup()
  };

  // Frequently used during play: Scene media, presets and the active speaker.
  tokenControl.tools.coc7koStageManager = {
    name: "coc7koStageManager",
    title: "CoC7-KO | 장면 조정",
    icon: "fa-solid fa-clapperboard",
    order: baseOrder + 1,
    button: true,
    visible: true,
    onChange: () => game.coc7koStage.openStageManager()
  };

  // v0.7.0 | Each palette now has its own icon and its own window.
  tokenControl.tools.coc7koItemPalette = {
    name: "coc7koItemPalette",
    title: "CoC7-KO | 아이템 팔레트",
    icon: "fa-solid fa-box-open",
    order: baseOrder + 2,
    button: true,
    visible: true,
    onChange: () => game.coc7koStage.openItemPalette()
  };

  tokenControl.tools.coc7koNpcPalette = {
    name: "coc7koNpcPalette",
    title: "CoC7-KO | NPC 팔레트",
    icon: "fa-solid fa-masks-theater",
    order: baseOrder + 3,
    button: true,
    visible: true,
    onChange: () => game.coc7koStage.openNpcPalette()
  };

  tokenControl.tools.coc7koQuickbar = {
    name: "coc7koQuickbar",
    title: "CoC7-KO | 장면 퀵바",
    icon: "fa-solid fa-bookmark",
    order: baseOrder + 4,
    button: true,
    visible: true,
    onChange: () => game.coc7koQuickbar?.toggle()
  };

  tokenControl.tools.coc7koLayoutEdit = {
    name: "coc7koLayoutEdit",
    title: "CoC7-KO | 포트레잇 배치 편집 / 잠금",
    icon: "fa-solid fa-arrows-up-down-left-right",
    order: baseOrder + 5,
    button: true,
    visible: true,
    onChange: () => game.coc7koStage.toggleLayoutEditing()
  };
});

/* ------------------------------------------------------------------------ *
 * v0.8.2 | Forced stage speaker
 *
 * Players kept having to select their token before typing, or their lines
 * came out as OOC with no portrait. If a user owns exactly one of the PC
 * Stage slots, that actor becomes the speaker for plain chat messages.
 *
 * Deliberately conservative: it only fills in a speaker that is *missing*,
 * so rolls, item cards, /ooc, emotes and whispers are left untouched.
 * ------------------------------------------------------------------------ */

function findUserStageActor(user) {
  if (!canvas?.scene) return null;

  const slots = getPcSetupSlots(canvas.scene);

  const owned = PC_SLOT_DEFS
    .map(def => slots[def.key]?.actorId)
    .filter(Boolean)
    .map(id => game.actors.get(id))
    .filter(actor => actor?.testUserPermission(user, "OWNER"));

  const unique = [...new Set(owned.map(actor => actor.id))];

  // A keeper owns every actor; with no single candidate we stay out of it.
  if (unique.length !== 1) return null;
  return game.actors.get(unique[0]);
}

Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
  try {
    if (!game.settings.get(MODULE_ID, "forceStageSpeaker")) return;
  } catch (_) {
    return;
  }

  // Only the client that authored the message adjusts it.
  if (game.user.id !== userId) return;

  if (message.rolls?.length) return;
  if (data.whisper?.length) return;
  if (data.speaker?.actor || data.speaker?.token || data.speaker?.alias) return;

  const styles = CONST.CHAT_MESSAGE_STYLES ?? CONST.CHAT_MESSAGE_TYPES ?? {};

  /*
   * A token-less message normally arrives as OOC, which is exactly the case
   * we are fixing, so OOC is allowed through. Emotes and other explicit
   * styles are left alone.
   */
  const style = data.style ?? data.type;
  const convertible = [styles.OTHER, styles.IC, styles.OOC].filter(v => v !== undefined);
  if (style !== undefined && !convertible.includes(style)) return;

  const actor = findUserStageActor(game.user);
  if (!actor) return;

  message.updateSource({
    speaker: ChatMessage.implementation.getSpeaker({ actor }),
    style: styles.IC ?? 2
  });
});


/* ------------------------------------------------------------------------ *
 * Voice activity
 *
 * Highlights the portrait of whoever is currently speaking, the same way a
 * chat message does.
 *
 * Foundry's built-in A/V already detects speech, so that path works out of
 * the box. Discord cannot be observed from inside Foundry — the browser has
 * no access to another application's voice state — so an external bridge
 * must push the signal in. `game.coc7koStage.setSpeaking(userId, speaking)`
 * is that entry point: a small Discord bot or overlay relay only has to map
 * a Discord member to a Foundry user id and call it.
 * ------------------------------------------------------------------------ */

const speakingUsers = new Set();

function slotKeyForUser(userId) {
  const user = game.users.get(userId);
  if (!user || !canvas?.scene) return null;

  // The character the user owns on stage, preferring their assigned actor.
  const slots = getPcSetupSlots(canvas.scene);

  for (const def of PC_SLOT_DEFS) {
    const actorId = slots[def.key]?.actorId;
    if (!actorId) continue;

    const actor = game.actors.get(actorId);
    if (!actor) continue;

    if (user.character?.id === actor.id) return def.key;
    if (actor.testUserPermission(user, "OWNER") && !user.isGM) return def.key;
  }

  return null;
}

/*
 * Voice activity keeps its own set of active slots rather than borrowing the
 * single chat focus. With one focus, two people talking over each other
 * would steal the highlight back and forth, and whoever stopped first would
 * switch off the one still speaking.
 *
 * Each speaking slot also carries a safety timer. If a user drops out of the
 * voice channel mid-sentence the bridge may never send the matching "stopped"
 * event, and without the timer their portrait would stay lit indefinitely.
 */
const SPEAKING_STALE_MS = 5000;
const speakingTimers = new Map();

function setSpeaking(userId, speaking) {
  if (speaking) speakingUsers.add(userId);
  else speakingUsers.delete(userId);

  const slotKey = slotKeyForUser(userId);
  if (slotKey) setSpeakingSlot(slotKey, speaking);
}

/** Lights or clears one stage slot directly; used by the voice relay. */
function setSpeakingSlot(slotKey, speaking) {
  const overlay = game.coc7koStage?.overlay;
  if (!overlay || !slotKey) return;

  clearTimeout(speakingTimers.get(slotKey));
  speakingTimers.delete(slotKey);

  if (speaking) {
    overlay.speakingSlots.add(slotKey);
    speakingTimers.set(slotKey, setTimeout(() => setSpeakingSlot(slotKey, false), SPEAKING_STALE_MS));
  } else {
    overlay.speakingSlots.delete(slotKey);
  }

  overlay.refresh();
}

/** Clears every voice highlight, e.g. when the bridge connection drops. */
function clearSpeaking() {
  for (const timer of speakingTimers.values()) clearTimeout(timer);
  speakingTimers.clear();
  speakingUsers.clear();

  const overlay = game.coc7koStage?.overlay;
  if (!overlay) return;
  overlay.speakingSlots.clear();
  overlay.refresh();
}

Hooks.once("ready", () => {
  game.coc7koStage.setSpeaking = setSpeaking;
  game.coc7koStage.setSpeakingSlot = setSpeakingSlot;
  game.coc7koStage.slotKeyForUser = slotKeyForUser;
  game.coc7koStage.clearSpeaking = clearSpeaking;
  game.coc7koStage.speakingUsers = speakingUsers;
});

// Foundry's own audio/video layer, when the table uses it.
Hooks.on("rtcUserSpeaking", (userId, speaking) => setSpeaking(userId, speaking));

/*
 * Stage tiles are positioned from canvas.dimensions at the moment they are
 * synced. Changing the scene's size, padding or grid afterwards used to leave
 * them at stale coordinates, which is why they seemed to appear anywhere.
 * Re-sync whenever those change.
 */
Hooks.on("canvasReady", () => {
  if (!game.user.isGM || !canvas.scene) return;
  const media = canvas.scene.getFlag(MODULE_ID, "stage")?.media;
  if (media?.background || media?.foreground) syncStageMediaTiles(canvas.scene);
});

/* ------------------------------------------------------------------------ *
 * Scene outline / grid over the stage images
 *
 * Foundry's Interface#drawOutline draws a dark rectangle around the scene
 * whenever the scene has NO native background image. This module clears the
 * native background on purpose (the stage images are tiles, and a native
 * background underneath would double up with them), so from Foundry's point
 * of view every stage scene is "background-less" and the outline is always on.
 *
 * The outline and the grid live in the interface canvas group, which is drawn
 * above the tiles, so they cannot be pushed behind the images by sort order.
 * Instead they are hidden while stage images are showing, and restored when
 * they are not. Only visibility is toggled; nothing is destroyed, and grid
 * snapping for tokens is unaffected.
 * ------------------------------------------------------------------------ */

function sceneHasStageMedia(scene = canvas?.scene) {
  const media = scene?.getFlag(MODULE_ID, "stage")?.media ?? {};
  return !!(media.background || media.foreground);
}

/*
 * The scene outline is `InterfaceCanvasGroup#outline` — a private (#) field,
 * which no outside code can reach by name. That is why looking it up as
 * `canvas.interface.outline` never worked.
 *
 * It still has to be a child of the interface group to be drawn, though, and
 * it is the only plain PIXI.Graphics there: the grid and other layers are
 * CanvasLayer instances, and drawings and scrolling text live in their own
 * containers. So it is identified by what it is rather than what it is called.
 */
function findSceneOutlines() {
  const group = canvas?.interface;
  if (!group?.children) return [];

  const Layer = foundry.canvas?.layers?.CanvasLayer ?? globalThis.CanvasLayer;

  return group.children.filter(child =>
    child instanceof PIXI.Graphics &&
    !(Layer && child instanceof Layer) &&
    child.constructor === PIXI.Graphics
  );
}

function syncCanvasChrome() {
  if (!canvas?.ready) return;

  const covered = sceneHasStageMedia();

  const outlines = findSceneOutlines();

  for (const outline of outlines) outline.visible = !covered;

  let hideGrid = true;
  try { hideGrid = game.settings.get(MODULE_ID, "stageHideGrid"); } catch (_) {}

  const grid = canvas.interface?.grid ?? canvas.grid?.mesh ?? null;
  if (grid && "visible" in grid) grid.visible = !(covered && hideGrid);
}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "stageHideGrid", {
    name: "스테이지 이미지 위 격자 숨기기",
    hint: "배경·중앙 이미지가 있는 장면에서 격자선을 감춥니다. 토큰의 칸 맞춤은 그대로 동작합니다. 씬 테두리 선은 이 설정과 상관없이 항상 감춥니다.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => syncCanvasChrome()
  });
});

Hooks.on("canvasReady", () => setTimeout(syncCanvasChrome, 150));

/*
 * Undo 1.0.0/1.0.1: if this scene's background still points at the
 * placeholder, clear it. Only the placeholder is touched — a background the
 * keeper chose is never changed here.
 */
Hooks.on("canvasReady", async () => {
  if (!game.user.isGM || !canvas.scene) return;

  const scene = canvas.scene;
  const levels = sceneLevels(scene);

  try {
    if (levels.length) {
      const updates = levels
        .filter(level => isPlaceholderBackground(level.background?.src))
        .map(level => ({ _id: level.id, "background.src": null }));

      if (updates.length) {
        await scene.updateEmbeddedDocuments("Level", updates);
        console.log(`${MODULE_ID} | removed placeholder background from ${updates.length} level(s)`);
      }
    } else if (isPlaceholderBackground(scene.background?.src)) {
      await scene.update({ "background.src": null });
    }
  } catch (error) {
    console.warn(`${MODULE_ID} | placeholder cleanup failed`, error);
  }
});

Hooks.once("ready", () => {
  if (!game.coc7koStage) return;

  /** Lists what sits in the interface layer, to track down stray outlines. */
  game.coc7koStage.inspectCanvasChrome = () => {
    const rows = (canvas?.interface?.children ?? []).map(child => {
      const bounds = child.getBounds?.();
      return {
        type: child.constructor?.name,
        name: child.name ?? "",
        visible: child.visible,
        isOutlineCandidate: findSceneOutlines().includes(child),
        bounds: bounds ? `${Math.round(bounds.x)},${Math.round(bounds.y)} ${Math.round(bounds.width)}x${Math.round(bounds.height)}` : ""
      };
    });
    console.table(rows);
    console.log("native background:", getNativeBackground(canvas.scene));
    return rows;
  };
});

Hooks.on("updateScene", (scene, changed) => {
  if (scene.id !== canvas?.scene?.id) return;
  if (foundry.utils.hasProperty(changed, `flags.${MODULE_ID}`) || "grid" in changed || "background" in changed) {
    setTimeout(syncCanvasChrome, 150);
  }
});

// Foundry can redraw the interface group on its own (e.g. grid changes).
Hooks.on("drawInterfaceCanvasGroup", () => setTimeout(syncCanvasChrome, 50));
Hooks.on("drawGridLayer", () => setTimeout(syncCanvasChrome, 50));
