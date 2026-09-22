/* ==========================================================================
 * CoC7-KO | Chat Enhancements  (v0.7.0)
 *
 *  - Consecutive messages from the same speaker merge into one block.
 *  - The controlling player's name is printed under the speaker's lines.
 *  - The chat sidebar gains three tabs: 전체 / 귓속말 / 노트.
 *  - A fixed blank strip above the chat input keeps third-party "is typing"
 *    indicators (e.g. Cautious Gamemaster's Pack) from pushing the log up.
 *
 * Everything here is DOM-level decoration. No ChatMessage document is
 * modified, so turning the module off leaves the chat log untouched.
 * ========================================================================== */

const MODULE_ID = "coc7-ko";

const CHAT_ROOT_SELECTORS = [
  "#chat",
  "#chat-popout",
  "section.chat-sidebar",
  ".chat-sidebar",
  "section[data-tab='chat']"
];

const CHAT_LOG_SELECTORS = ["#chat-log", "ol.chat-log", ".chat-log"];

const CHAT_INPUT_SELECTORS = [
  "#chat-form",
  "form.chat-form",
  ".chat-form",
  "#chat-controls",
  ".chat-input"
];

const FALLBACK_SANS =
  '"Apple SD Gothic Neo", "Malgun Gothic", "Segoe UI", sans-serif';

const FALLBACK_SERIF = '"Nanum Myeongjo", "Batang", serif';

function googleFont(family) {
  return `https://fonts.googleapis.com/css2?family=${family}&display=swap`;
}

/*
 * Free, commercially usable Korean fonts served from public CDNs.
 * The reference screenshot paired Pretendard with 조선신명조; 조선신명조 is free
 * to use but is not redistributable under an open licence, so it is not
 * bundled or hot-linked here. The 명조 entries below are the closest
 * openly-licensed substitutes.
 */
const FONT_PRESETS = {
  pretendard: {
    label: "Pretendard — 현대적인 고딕 (OFL)",
    href: "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.min.css",
    stack: `Pretendard, "Pretendard Variable", ${FALLBACK_SANS}`
  },
  plex: {
    label: "IBM Plex Sans KR — 또렷한 본문 고딕 (OFL)",
    href: googleFont("IBM+Plex+Sans+KR:wght@300;400;500;600;700"),
    stack: `"IBM Plex Sans KR", ${FALLBACK_SANS}`
  },
  gowunDodum: {
    label: "고운돋움 — 부드럽고 눈이 편한 고딕 (OFL)",
    href: googleFont("Gowun+Dodum"),
    stack: `"Gowun Dodum", ${FALLBACK_SANS}`
  },
  kopubBatang: {
    label: "KoPubWorld 바탕 — 출판 본문용 명조 (CDN 불안정)",
    href: "https://cdn.jsdelivr.net/npm/font-kopubworld@1.0/batang.min.css",
    stack: `"KoPubWorld Batang", ${FALLBACK_SERIF}`
  },
  ridiBatang: {
    label: "리디바탕 — 소설 본문체, 조선신명조 대체 (OFL)",
    href: "https://unpkg.com/@kfonts/ridi-batang/index.css",
    stack: `RIDIBatang, "리디바탕", ${FALLBACK_SERIF}`
  },
  gowunBatang: {
    label: "고운바탕 — 차분한 명조 (OFL)",
    href: googleFont("Gowun+Batang:wght@400;700"),
    stack: `"Gowun Batang", ${FALLBACK_SERIF}`
  },
  nanumMyeongjo: {
    label: "나눔명조 — 고전적인 명조 (OFL)",
    href: googleFont("Nanum+Myeongjo:wght@400;700;800"),
    stack: `"Nanum Myeongjo", ${FALLBACK_SERIF}`
  },
  songMyung: {
    label: "송명 — 가늘고 서늘한 명조 (OFL)",
    href: googleFont("Song+Myung"),
    stack: `"Song Myung", ${FALLBACK_SERIF}`
  },
  hahmlet: {
    label: "Hahmlet — 묵직하고 개성 있는 명조 (OFL)",
    href: googleFont("Hahmlet:wght@300;400;500;700"),
    stack: `Hahmlet, ${FALLBACK_SERIF}`
  },
  system: {
    label: "시스템 기본 글꼴 (내려받기 없음)",
    stack: FALLBACK_SANS
  }
};

const FONT_CHOICES = Object.fromEntries(
  Object.entries(FONT_PRESETS).map(([key, value]) => [key, value.label])
);

const DEFAULT_FONT_STACK = FONT_PRESETS.pretendard.stack;

const DEFAULT_TYPING_SELECTOR =
  '#chat-typing, #typing-indicator, .typing-indicator, .cgmp-typing, [class*="typing-notification"]';

let regroupTimer = null;
let installTimer = null;

/* --- small helpers ------------------------------------------------------- */

function setting(key, fallback) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

function queryFirst(root, selectors) {
  for (const selector of selectors) {
    const found = root.querySelector(selector);
    if (found) return found;
  }
  return null;
}

/**
 * Every rendered chat surface: the sidebar tab and any popped-out chat.
 *
 * Several of the selectors match the same element, and in some layouts an
 * outer container matches as well as the inner one. Keeping an ancestor and
 * its descendant would build two tab bars stacked on top of each other, and
 * the hidden one swallows clicks — so only the innermost match is kept.
 */
function chatRoots() {
  const found = new Set();
  for (const selector of CHAT_ROOT_SELECTORS) {
    document.querySelectorAll(selector).forEach(el => found.add(el));
  }

  const candidates = [...found].filter(isValidChatRoot);

  return candidates.filter(
    root => !candidates.some(other => other !== root && root.contains(other))
  );
}

/*
 * A chat root must actually hold a message list AND live in a place Foundry
 * owns as a chat surface: the sidebar, or a popped-out application window.
 *
 * Without this check, transient containers (notification popovers, partially
 * re-rendered fragments) could be adopted as roots, and the tab bar, notes
 * panel and reserve strip would be injected into a node that Foundry then
 * moved or detached — which is how the chat ended up scattered across the
 * screen after deleting a message or opening a window.
 */
function isValidChatRoot(root) {
  if (!(root instanceof HTMLElement) || !root.isConnected) return false;
  if (!queryFirst(root, CHAT_LOG_SELECTORS)) return false;
  if (root.closest("#chat-notifications, .chat-notifications, #tooltip")) return false;

  /*
   * 0.8.3 required an ancestor id of #sidebar, which does not exist on every
   * core version — the result was no chat root at all and the tab bar simply
   * never appeared. The test is now "somewhere inside the persistent
   * interface, or inside a popped-out window", which is true on every layout
   * while still rejecting detached fragments and notification popovers.
   */
  return !!root.closest("#interface, #sidebar, #chat-popout, .application, .app")
    || root.parentElement === document.body;
}

/**
 * Removes any of our injected elements that are no longer inside a valid
 * chat root. Foundry re-renders can leave orphans behind, and an orphan that
 * is still in the document is exactly what the user sees floating loose.
 */
function cleanupOrphans() {
  const roots = new Set(chatRoots());

  for (const node of document.querySelectorAll(".coc7ko-typing-reserve")) {
    const owner = [...roots].find(root => root.contains(node));
    if (!owner) node.remove();
  }
}

/**
 * Whether a user id belongs to a keeper.
 *
 * This helper was accidentally deleted along with the chat-tab feature in
 * 0.9.0. decorateMessage() calls it on every message, so every call threw a
 * ReferenceError inside the renderChatMessageHTML hook — which is why the
 * portrait, the player name and the header grouping all silently vanished.
 */
function isGmUser(userId) {
  return !!game.users.get(userId)?.isGM;
}

/* --- message classification ---------------------------------------------- */

/**
 * Tags a rendered message with the data the grouping and tab filters need.
 * Kept idempotent so repeated renders are harmless.
 */
function decorateMessage(element, message) {
  if (!element || !message) return;

  element.classList.add("coc7ko-chat-message");

  const author = message.author ?? message.user;
  const alias = message.speaker?.alias || author?.name || "";

  element.dataset.ckAuthor = author?.id ?? "";
  element.dataset.ckAlias = alias;
  element.dataset.ckTime = String(message.timestamp ?? 0);

  const whisper = message.whisper ?? [];
  const isWhisper = whisper.length > 0;

  // The 귓속말 tab is specifically about keeper <-> player side conversations.
  const gmInvolved =
    isGmUser(author?.id) || whisper.some(id => isGmUser(id));

  element.dataset.ckWhisper = isWhisper && gmInvolved ? "1" : "0";
  element.classList.toggle("coc7ko-whisper", isWhisper && gmInvolved);

  if (message.rolls?.length) element.classList.add("coc7ko-roll");

  // Shared notes are chat messages, but they belong in the notes panel, not
  // in the running chat log.
  if (message.getFlag?.(MODULE_ID, "note")) element.classList.add("coc7ko-note-message");

  decorateFlavor(element);

  // Accent colour of the run, taken from the speaking user.
  const color = author?.color?.css ?? author?.color ?? "";
  if (color) element.style.setProperty("--coc7ko-user-color", color);

  const header = resolveHeader(element);
  if (!header) return;

  header.classList.add("coc7ko-header");

  // Tag the name element ourselves so the layout never depends on a core
  // class name that a Foundry release might rename.
  const sender = header.querySelector(
    ".message-sender, .message-sender-name, [class*='sender'], h4, h3"
  );
  sender?.classList.add("coc7ko-sender");

  // Portrait beside the name, the way a messaging app shows a sender.
  if (setting("chatAvatars", true)) {
    let avatar = header.querySelector(".coc7ko-avatar");
    if (!avatar) {
      avatar = document.createElement("img");
      avatar.classList.add("coc7ko-avatar");
      avatar.alt = "";
      header.prepend(avatar);
    }
    avatar.src = resolveSpeakerImage(message, author);
  } else {
    header.querySelector(".coc7ko-avatar")?.remove();
  }

  // The controlling player's name sits directly under the character name.
  const userName = author?.name ?? "";
  const shouldLabel = setting("chatShowUser", true) && !!userName && userName !== alias;

  let label = header.querySelector(".coc7ko-chat-user");
  if (!shouldLabel) {
    label?.remove();
    return;
  }

  if (!label) {
    label = document.createElement("div");
    label.classList.add("coc7ko-chat-user");
    header.append(label);
  }

  label.textContent = userName;

  normalizeHeader(header);
}

/**
 * Locates the message header without relying on one fixed class name.
 *
 * Foundry has moved this markup between releases, and when the lookup failed
 * the whole decoration step bailed out: no portrait, no meta grouping, and
 * the timestamp fell back to whatever order the core template used — which is
 * why it appeared to the left of the name.
 */
function resolveHeader(element) {
  return (
    element.querySelector(".message-header") ||
    element.querySelector("header") ||
    element.querySelector(".message-sender, .message-sender-name, [class*='sender']")
      ?.parentElement ||
    null
  );
}

/**
 * Foundry and the CoC7 system put a varying set of elements in the message
 * header (timestamp, delete control, whisper target, roll flavor...). Placing
 * them with CSS alone made them land on top of each other, so the unknown ones
 * are collected into a single meta container here and the grid only ever has
 * four known children.
 */
function normalizeHeader(header) {
  const KNOWN = ".coc7ko-avatar, .coc7ko-sender, .coc7ko-chat-user, .coc7ko-flavor, .coc7ko-meta";

  let meta = header.querySelector(":scope > .coc7ko-meta");
  if (!meta) {
    meta = document.createElement("div");
    meta.classList.add("coc7ko-meta");
    header.append(meta);
  }

  for (const child of [...header.children]) {
    if (child === meta) continue;
    if (child.matches(KNOWN)) continue;
    meta.append(child);
  }
}

const DIFFICULTY_PATTERNS = [
  { key: "critical", test: /대성공|critical/i },
  { key: "extreme", test: /극단|극심|extreme/i },
  { key: "hard", test: /어려|hard/i },
  { key: "regular", test: /보통|일반|regular/i }
];

/**
 * The roll flavour line ("자료조사 판정 (20%) - 보통 난이도") is the most
 * scanned part of a roll card, so it gets its own full-width row and a colour
 * keyed to the difficulty band.
 */
function decorateFlavor(element) {
  const flavor = element.querySelector(".message-flavor, .flavor-text, [class*='flavor']");
  if (!flavor) return;

  flavor.classList.add("coc7ko-flavor");

  const text = flavor.textContent ?? "";
  const match = DIFFICULTY_PATTERNS.find(entry => entry.test.test(text));

  if (match) flavor.dataset.ckDifficulty = match.key;
  else delete flavor.dataset.ckDifficulty;
}

/** Best available portrait for whoever is speaking. */
function resolveSpeakerImage(message, author) {
  const speaker = message.speaker ?? {};

  if (speaker.scene && speaker.token) {
    try {
      const token = fromUuidSync(`Scene.${speaker.scene}.Token.${speaker.token}`);
      const src = token?.texture?.src || token?.actor?.img;
      if (src) return src;
    } catch (_) {}
  }

  const actor = speaker.actor ? game.actors.get(speaker.actor) : null;
  return actor?.img || author?.avatar || "icons/svg/mystery-man.svg";
}

/* --- grouping ------------------------------------------------------------ */

function regroup() {
  if (!setting("chatGrouping", true)) {
    document.querySelectorAll(".coc7ko-grouped").forEach(el => {
      el.classList.remove("coc7ko-grouped", "coc7ko-group-start", "coc7ko-group-end");
    });
    return;
  }

  const windowMs = (Number(setting("chatGroupWindow", 5)) || 5) * 60000;

  for (const root of chatRoots()) {
    const log = queryFirst(root, CHAT_LOG_SELECTORS);
    if (!log) continue;

    const messages = [...log.querySelectorAll(".chat-message")]
      .filter(el => el.offsetParent !== null || el.clientHeight > 0);

    let previous = null;

    for (const element of messages) {
      element.classList.remove("coc7ko-grouped", "coc7ko-group-start", "coc7ko-group-end");

      const sameAuthor =
        previous &&
        previous.dataset.ckAuthor === element.dataset.ckAuthor &&
        previous.dataset.ckAlias === element.dataset.ckAlias &&
        previous.dataset.ckWhisper === element.dataset.ckWhisper;

      const delta = previous
        ? Math.abs(Number(element.dataset.ckTime) - Number(previous.dataset.ckTime))
        : Infinity;

      // Roll cards and other structured output stay visually separate.
      const groupable =
        sameAuthor &&
        delta <= windowMs &&
        !element.classList.contains("coc7ko-roll") &&
        !previous.classList.contains("coc7ko-roll");

      if (groupable) element.classList.add("coc7ko-grouped");
      else element.classList.add("coc7ko-group-start");

      previous = element;
    }

    // Only the final line of a run keeps the player-name footer, so a merged
    // block reads as one speech bubble signed once at the bottom.
    for (let i = 0; i < messages.length; i++) {
      const next = messages[i + 1];
      const isLastOfRun = !next || !next.classList.contains("coc7ko-grouped");

      messages[i].classList.toggle("coc7ko-group-end", isLastOfRun);
    }
  }

}

function scheduleRegroup() {
  clearTimeout(regroupTimer);
  regroupTimer = setTimeout(regroup, 40);
}

/* --- typing reserve ------------------------------------------------------ */

function relocateTypingIndicators(root) {
  const reserve = root.querySelector(".coc7ko-typing-reserve");
  if (!reserve) return;

  const selector = setting("typingSelector", DEFAULT_TYPING_SELECTOR);
  if (!selector) return;

  let candidates;
  try {
    candidates = root.querySelectorAll(selector);
  } catch (err) {
    console.warn(`${MODULE_ID} | Invalid typing indicator selector`, selector, err);
    return;
  }

  /*
   * Only ever move small, leaf-like notices. Moving a structural element
   * (the log, the input form, a control bar) would tear the sidebar apart.
   */
  const FORBIDDEN = [
    ".chat-log", "#chat-log", "ol.chat-log",
    "form", "#chat-form", ".chat-form", "#chat-controls", ".chat-input",
    ".coc7ko-typing-reserve",
    "#chat-notifications", ".chat-notifications",
    ".window-content", ".window-header", ".application", ".app"
  ].join(",");

  for (const node of candidates) {
    if (node.closest(".coc7ko-typing-reserve")) continue;
    if (node.matches(FORBIDDEN)) continue;
    if (node.querySelector(FORBIDDEN)) continue;
    if (node.contains(reserve)) continue;

    reserve.append(node);
  }
}

/* --- installation -------------------------------------------------------- */

function installChatUi() {
  cleanupOrphans();

  for (const root of chatRoots()) {
    const log = queryFirst(root, CHAT_LOG_SELECTORS);
    if (!log) continue;

    root.classList.add("coc7ko-chat-root");

    /*
     * A fixed-height strip directly above the input box. Third-party typing
     * indicators live inside it, so they can never displace the message list.
     */
    if (!root.querySelector(".coc7ko-typing-reserve")) {
      const reserve = document.createElement("div");
      reserve.classList.add("coc7ko-typing-reserve");

      const form = queryFirst(root, CHAT_INPUT_SELECTORS);
      if (form?.parentElement) form.parentElement.insertBefore(reserve, form);
      else log.parentElement.append(reserve);
    }

    relocateTypingIndicators(root);
  }

  // A re-rendered sidebar gets a fresh, empty reserve strip.
  renderTyping();
}

function scheduleInstall() {
  clearTimeout(installTimer);
  installTimer = setTimeout(() => {
    installChatUi();
    scheduleRegroup();
  }, 120);
}

/* --- style variables ----------------------------------------------------- */

function applyStyleVariables() {
  let style = document.getElementById("coc7ko-chat-style");
  if (!style) {
    style = document.createElement("style");
    style.id = "coc7ko-chat-style";
    document.head.append(style);
  }

  const bodyPreset = FONT_PRESETS[setting("chatBodyFont", "ridiBatang")] ?? FONT_PRESETS.ridiBatang;
  const headingPreset = FONT_PRESETS[setting("chatHeadingFont", "ridiBatang")] ?? FONT_PRESETS.ridiBatang;

  loadWebFonts([bodyPreset, headingPreset]);

  // A custom family always wins over the presets.
  const custom = String(setting("chatFontFamily", "")).trim();
  const family = custom || bodyPreset.stack;
  const headingFamily = custom || headingPreset.stack;
  const size = Number(setting("chatFontSize", 14)) || 14;
  const reserve = Number(setting("typingReserveHeight", 26)) || 0;

  const theme = setting("chatCardTheme", "light") === "dark" ? "dark" : "light";
  document.body.classList.toggle("coc7ko-chat-light", theme === "light");
  document.body.classList.toggle("coc7ko-chat-dark", theme === "dark");

  style.textContent = `
    :root {
      --coc7ko-chat-font: ${family};
      --coc7ko-chat-heading: ${headingFamily};
      --coc7ko-chat-font-size: ${size}px;
      --coc7ko-typing-reserve: ${reserve}px;
    }
  `;
}

/**
 * Injects the stylesheets for the chosen presets. Each is fetched once, and
 * a client with no internet access simply falls back to the local stack.
 */
function loadWebFonts(presets) {
  const wanted = new Set(presets.map(preset => preset?.href).filter(Boolean));

  for (const link of document.querySelectorAll("link[data-coc7ko-font]")) {
    if (wanted.has(link.href)) wanted.delete(link.href);
    else link.remove();
  }

  for (const href of wanted) {
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = href;
    link.crossOrigin = "anonymous";
    link.dataset.coc7koFont = "1";
    link.addEventListener("error", () => {
      console.warn(`${MODULE_ID} | Could not load web font`, href);
    });
    document.head.append(link);
  }
}

/* --- hooks --------------------------------------------------------------- */

Hooks.once("init", () => {
  const rerender = () => {
    applyStyleVariables();
    scheduleInstall();
  };

  game.settings.register(MODULE_ID, "chatGrouping", {
    name: "채팅 메시지 묶기",
    hint: "같은 화자가 연속으로 말하면 하나의 말풍선 블록으로 합칩니다.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: scheduleRegroup
  });

  game.settings.register(MODULE_ID, "chatGroupWindow", {
    name: "묶기 허용 간격(분)",
    hint: "이 시간 안에 이어진 같은 화자의 발언만 하나로 묶습니다.",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 1, max: 30, step: 1 },
    default: 5,
    onChange: scheduleRegroup
  });

  game.settings.register(MODULE_ID, "chatShowUser", {
    name: "발언자(플레이어) 이름 표시",
    hint: "캐릭터 이름 아래에 실제 플레이어 이름을 작게 표시합니다.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => ui.chat?.render()
  });

  game.settings.register(MODULE_ID, "chatAvatars", {
    name: "채팅 초상화 표시",
    hint: "발언자의 토큰/캐릭터 이미지를 채팅 카드 왼쪽에 표시합니다.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => ui.chat?.render()
  });

  game.settings.register(MODULE_ID, "chatCardTheme", {
    name: "채팅 카드 톤",
    hint: "밝은 카드는 첨부한 예시와 같은 모양입니다. 어두운 카드는 Foundry 기본 테마에 가깝습니다.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      light: "밝은 카드",
      dark: "어두운 카드"
    },
    default: "light",
    onChange: applyStyleVariables
  });

  game.settings.register(MODULE_ID, "chatHeadingFont", {
    name: "이름 / 판정줄 글꼴",
    hint: "캐릭터 이름과 판정 설명줄에 쓰는 글꼴입니다.",
    scope: "client",
    config: true,
    type: String,
    choices: FONT_CHOICES,
    default: "ridiBatang",
    onChange: applyStyleVariables
  });

  game.settings.register(MODULE_ID, "chatBodyFont", {
    name: "본문 글꼴",
    hint: "대사와 본문에 쓰는 글꼴입니다. 명조 계열을 고르면 소설 같은 분위기가 납니다.",
    scope: "client",
    config: true,
    type: String,
    choices: FONT_CHOICES,
    default: "ridiBatang",
    onChange: applyStyleVariables
  });

  game.settings.register(MODULE_ID, "chatFontFamily", {
    name: "채팅 글꼴 직접 지정(고급)",
    hint: "비워두면 위에서 고른 글꼴을 씁니다. CSS font-family 값을 그대로 넣으세요.",
    scope: "client",
    config: true,
    type: String,
    default: "",
    onChange: applyStyleVariables
  });

  game.settings.register(MODULE_ID, "chatFontSize", {
    name: "채팅 글자 크기(px)",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 11, max: 22, step: 1 },
    default: 14,
    onChange: applyStyleVariables
  });

  game.settings.register(MODULE_ID, "typingIndicator", {
    name: "입력 중 표시",
    hint: "누군가 채팅창에 글을 쓰는 동안 입력창 위에 '…님이 입력 중입니다'를 보여줍니다. 귓속말(/w)을 쓰는 중에는 표시하지 않습니다. Cautious Gamemaster's Pack의 같은 기능을 대신합니다.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true,
    onChange: () => {
      for (const timer of typingUsers.values()) clearTimeout(timer);
      typingUsers.clear();
      renderTyping();
    }
  });

  game.settings.register(MODULE_ID, "typingShowKeeper", {
    name: "키퍼의 입력 중 표시도 보이기",
    hint: "끄면 키퍼가 글을 쓰는 동안에는 플레이어에게 표시되지 않습니다. 키퍼가 무언가 준비하고 있다는 걸 미리 들키지 않기 위한 기본값입니다.",
    scope: "world",
    config: true,
    type: Boolean,
    default: false
  });

  game.settings.register(MODULE_ID, "typingReserveHeight", {
    name: "입력 표시 예약 높이(px)",
    hint: "'…님이 입력 중입니다'가 표시되는 줄의 높이입니다. 이 공간은 늘 비워두므로 표시가 나타나고 사라져도 채팅 카드가 움직이지 않습니다. 0이면 입력 중 표시도 보이지 않습니다.",
    scope: "client",
    config: true,
    type: Number,
    range: { min: 0, max: 60, step: 2 },
    default: 26,
    onChange: applyStyleVariables
  });

  game.settings.register(MODULE_ID, "typingSelector", {
    name: "입력 표시 선택자(고급)",
    hint: "예약 공간으로 옮길 타이핑 표시 요소의 CSS 선택자입니다. 비워두면 이동시키지 않습니다.",
    scope: "client",
    config: true,
    type: String,
    default: DEFAULT_TYPING_SELECTOR,
    onChange: scheduleInstall
  });
});

Hooks.once("ready", () => {
  /*
   * Escape hatch. If the chat layout ever breaks, `game.coc7koChat.reset()`
   * strips every element this module injected and leaves Foundry's own chat
   * untouched; `disable()` additionally turns the tabs off for good.
   */
  /*
   * Escape hatch. Strips every element this module injected and leaves
   * Foundry's own chat untouched.
   */
  game.coc7koChat = {
    reset() {
      document.querySelectorAll(".coc7ko-typing-reserve").forEach(node => node.remove());

      document.querySelectorAll(".coc7ko-chat-root").forEach(root => {
        root.classList.remove("coc7ko-chat-root");
        delete root.dataset.coc7koTab;
      });

      ui.chat?.render();
    },
    async safeMode() {
      await game.settings.set(MODULE_ID, "typingReserveHeight", 0);
      await game.settings.set(MODULE_ID, "typingSelector", "");
      this.reset();
      ui.notifications.warn("CoC7-KO | 안전 모드: 채팅 DOM 수정을 모두 껐습니다.");
    }
  };

  applyStyleVariables();
  installChatUi();
  scheduleRegroup();

  /*
   * Foundry and other modules re-render the sidebar at unpredictable times, so
   * a debounced observer is more reliable than chasing every render hook.
   * Mutations inside the message list and the reserved typing strip are
   * ignored: those fire constantly (every message, every FPS tick) and
   * re-running the installer on each one was pure churn.
   */
  const observer = new MutationObserver(records => {
    const relevant = records.some(record => {
      const target = record.target;
      if (!(target instanceof HTMLElement)) return true;
      return !target.closest(".chat-log, #chat-log, .coc7ko-typing-reserve");
    });

    if (relevant) scheduleInstall();
  });

  const target = document.getElementById("interface") ?? document.body;
  observer.observe(target, { childList: true, subtree: true });
});

// v13+ delivers an HTMLElement; v12 delivers jQuery.
Hooks.on("renderChatMessageHTML", (message, element) => {
  decorateMessage(element instanceof HTMLElement ? element : element?.[0], message);
  scheduleRegroup();
});

/*
 * v13 renamed this hook to renderChatMessageHTML and warns loudly when the
 * old one is used, so it is only registered on cores that still need it.
 */
if (Number(game.release?.generation ?? 13) < 13) {
  Hooks.on("renderChatMessage", (message, html) => {
    const element = html instanceof HTMLElement ? html : html?.[0];
    decorateMessage(element, message);
    scheduleRegroup();
  });
}

Hooks.on("renderChatLog", () => scheduleInstall());
Hooks.on("renderChatInput", () => scheduleInstall());
Hooks.on("collapseSidebar", () => scheduleInstall());
Hooks.on("changeSidebarTab", () => scheduleInstall());
Hooks.on("deleteChatMessage", () => scheduleRegroup());
Hooks.on("updateChatMessage", () => scheduleRegroup());

/* --- "…님이 입력 중입니다" --------------------------------------------------- *
 *
 * Replaces the one part of Cautious Gamemaster's Pack this table used. While
 * someone types in the chat box their client announces it over the module
 * socket; everyone else shows the names in the reserved strip above their own
 * input, which never pushes the message list around.
 *
 *  - Announcements are throttled (one every 2 s while typing), and a name
 *    disappears 3.5 s after its last announcement, or at once when the text
 *    is cleared, sent, or the box loses focus.
 *  - Whispers (/w, /whisper) are never announced: who is whispering is
 *    itself private.
 *  - The keeper's typing is hidden by default, so a long pause while the
 *    keeper writes does not tip the players off. A setting shows it.
 *  - Only the chat box counts. The notes and whisper panels, journals and
 *    other editors are ignored.
 * ------------------------------------------------------------------------ */

const TYPING_SOCKET = `module.${MODULE_ID}`;
const TYPING_SEND_EVERY_MS = 2000;
const TYPING_EXPIRES_MS = 3500;

const typingUsers = new Map();   // userId -> expiry timer
let amTyping = false;
let lastTypingSent = 0;

/** "A님이", "A, B님이", "여러 명이" — kept pure so it can be tested. */
function typingText(names) {
  if (!names.length) return "";
  if (names.length > 3) return "여러 명이 입력 중입니다";
  return `${names.join(", ")}님이 입력 중입니다`;
}

/*
 * Where the line lives: INSIDE the chat input form.
 *
 * Placement follows Cautious Gamemaster's Pack (MIT, cs96and/FoundryVTT-CGMP),
 * which appends its notice to `.chat-form` and has been working on this very
 * setup. Since v13 Foundry moves that form between the sidebar and the
 * floating spot at the bottom right when the sidebar is collapsed; a line
 * inside the form travels with it. The earlier attempts placed the line next
 * to the form, where it stayed behind in the hidden sidebar.
 *
 * The line keeps its height even when empty (the reserved height setting),
 * so its text appearing and disappearing never moves the chat log.
 */
const TYPING_FORM_SELECTOR = "#chat-form, .chat-form";

function typingLines() {
  const lines = [];
  for (const form of document.querySelectorAll(TYPING_FORM_SELECTOR)) {
    // Skip a form nested in another match; one line per input.
    if (form.parentElement?.closest(TYPING_FORM_SELECTOR)) continue;

    let line = form.querySelector(":scope > .coc7ko-typing-line");
    if (!line) {
      line = document.createElement("div");
      line.className = "coc7ko-typing-line";
      form.prepend(line);
    }
    lines.push(line);
  }
  return lines;
}

function renderTyping() {
  const names = [...typingUsers.keys()]
    .map(id => (id === "__coc7ko_test__" ? "테스트" : game.users.get(id)?.name))
    .filter(Boolean);
  const text = typingText(names);

  // Leftovers from 1.2.2 (lines placed beside the form).
  document.querySelectorAll(".coc7ko-typing-float").forEach(node => node.remove());

  document.body.classList.toggle("coc7ko-typing-builtin", typingEnabled());

  for (const line of typingLines()) {
    line.classList.toggle("active", !!text);
    line.innerHTML = text
      ? `<span class="dots"><i></i><i></i><i></i></span><span>${foundry.utils.escapeHTML(text)}</span>`
      : "";
  }
}

/** CGMP's own typing notice is on: stay out of its way. */
function cgmpTypingActive() {
  if (!game.modules.get("CautiousGamemastersPack")?.active) return false;
  try {
    return !!game.settings.get("CautiousGamemastersPack", "notifyTyping");
  } catch (_) {
    return false;
  }
}

function typingEnabled() {
  return !!setting("typingIndicator", true) && !cgmpTypingActive();
}

function sendTyping(typing) {
  if (!typingEnabled()) return;
  if (game.user.isGM && !setting("typingShowKeeper", false)) return;
  game.socket.emit(TYPING_SOCKET, { action: "typing", userId: game.user.id, typing });
}

function stopTyping() {
  if (!amTyping) return;
  amTyping = false;
  sendTyping(false);
}

/**
 * The chat input under an event target, or null for any other editor.
 * `#chat-message` is the chat box in v13/v14 (a textarea or a rich editor);
 * the broader check remains as a fallback.
 */
function chatField(target) {
  const direct = target?.closest?.("#chat-message");
  if (direct) return direct;

  const field = target?.closest?.("textarea, [contenteditable='true'], [contenteditable='']");
  if (!field) return null;
  if (!field.closest([...CHAT_ROOT_SELECTORS, "#chat-notifications", TYPING_FORM_SELECTOR].join(","))) return null;
  if (field.closest(".coc7ko-side-panel")) return null;
  return field;
}

function fieldText(field) {
  if (typeof field.value === "string") return field.value.trim();
  // A rich editor host also contains its toolbar; read the editable part only.
  const editable = field.matches?.("[contenteditable]") ? field : field.querySelector?.("[contenteditable]");
  return String((editable ?? field).innerText ?? (editable ?? field).textContent ?? "").trim();
}

function onChatInput(event) {
  const field = chatField(event.target);
  if (!field) return;

  const text = fieldText(field);

  // Nothing typed any more, or a whisper: say nothing (and retract).
  if (!text || /^\/(w|whisper)\b/i.test(text)) return stopTyping();

  const now = Date.now();
  if (!amTyping || now - lastTypingSent > TYPING_SEND_EVERY_MS) {
    amTyping = true;
    lastTypingSent = now;
    sendTyping(true);
  }
}

function onChatBlur(event) {
  if (chatField(event.target)) stopTyping();
}

function receiveTyping(payload) {
  if (payload?.action !== "typing") return;
  if (!payload.userId || payload.userId === game.user.id) return;
  if (!typingEnabled()) return;

  clearTimeout(typingUsers.get(payload.userId));

  if (payload.typing) {
    typingUsers.set(payload.userId, setTimeout(() => {
      typingUsers.delete(payload.userId);
      renderTyping();
    }, TYPING_EXPIRES_MS));
  } else {
    typingUsers.delete(payload.userId);
  }

  renderTyping();
}

Hooks.once("ready", () => {
  /*
   * Console helpers for checking the feature at the table:
   *   game.coc7koTyping.test()    shows a sample line here for 4 s — if this
   *                               appears, the display side works;
   *   game.coc7koTyping.status()  shows what this client knows.
   */
  game.coc7koTyping = {
    test() {
      const id = "__coc7ko_test__";
      clearTimeout(typingUsers.get(id));
      typingUsers.set(id, setTimeout(() => { typingUsers.delete(id); renderTyping(); }, 4000));
      renderTyping();
      return "입력창 위에 '테스트님이 입력 중입니다'가 4초간 보이면 표시 쪽은 정상입니다.";
    },
    status() {
      return {
        enabled: typingEnabled(),
        keeperShown: !!setting("typingShowKeeper", false),
        chatForms: typingLines().length,
        chatBoxFound: !!document.querySelector("#chat-message"),
        deferringToCGMP: cgmpTypingActive(),
        typingNow: [...typingUsers.keys()],
        socketDeclared: !!game.modules.get(MODULE_ID)?.socket
      };
    }
  };

  game.socket.on(TYPING_SOCKET, receiveTyping);
  document.addEventListener("input", onChatInput, true);
  document.addEventListener("keyup", onChatInput, true);
  document.addEventListener("focusout", onChatBlur, true);
});

Hooks.on("renderChatLog", () => setTimeout(renderTyping, 50));

// The chat input moves when the sidebar collapses or expands.
Hooks.on("collapseSidebar", () => setTimeout(renderTyping, 50));
Hooks.on("changeSidebarTab", () => setTimeout(renderTyping, 50));

// Sending a message ends "typing" at once, for the sender and for everyone.
Hooks.on("createChatMessage", message => {
  const authorId = message.author?.id ?? message.user?.id;
  if (authorId === game.user.id) stopTyping();

  if (typingUsers.has(authorId)) {
    clearTimeout(typingUsers.get(authorId));
    typingUsers.delete(authorId);
    renderTyping();
  }
});
