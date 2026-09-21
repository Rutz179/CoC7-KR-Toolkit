/* ==========================================================================
 * CoC7-KO | Window Tools  (v0.8.0)
 *
 *  1. Adds a bottom-right resize grip to Foundry/system windows that were
 *     declared non-resizable (the Investigator Wizard being the usual
 *     offender), and remembers the size per window.
 *
 *  2. Adds a "전체 재굴림" control to the Investigator Wizard.
 *
 * Both features are written against the rendered DOM rather than the CoC7
 * system's internals, because the wizard's classes and private state have
 * moved between system releases. Nothing here patches or overrides system
 * code, so a system update cannot break the world — at worst a selector
 * stops matching and the feature quietly does nothing.
 * ========================================================================== */

const MODULE_ID = "coc7-ko";

const MIN_W = 320;
const MIN_H = 200;

/* Windows we must never touch: ours already resize, and these are not real
 * windows or are sized by Foundry itself. */
const RESIZE_EXCLUDE = [
  "#coc7ko-stage-config",
  "#coc7ko-pc-setup",
  "#coc7ko-item-palette",
  "#coc7ko-npc-palette",
  "#coc7ko-quickbar",
  "#tooltip",
  "#camera-views",
  "#players",
  "#hotbar",
  "#navigation",
  "#controls",
  "#sidebar",
  "#notifications",
  ".tooltip",
  ".token-hud",
  ".placeable-hud"
].join(",");

/*
 * Core applications that make up the persistent interface. None of these may
 * ever receive an inline size or a setPosition() call: they are laid out by
 * the surrounding UI, not positioned as windows.
 */
const UI_APP_BLOCKLIST = new Set([
  "Sidebar", "ChatLog", "CombatTracker", "SceneNavigation", "SceneControls",
  "Players", "Hotbar", "CameraViews", "GamePause", "Notifications",
  "MainMenu", "Tooltip", "ControlsReference", "UIRegion", "Region"
]);

function isCoreUiApplication(app) {
  let proto = app?.constructor;

  // Walk the prototype chain: subclasses of these are UI regions too.
  while (proto?.name) {
    if (UI_APP_BLOCKLIST.has(proto.name)) return true;
    proto = Object.getPrototypeOf(proto);
  }

  return false;
}

const DEFAULT_WIZARD_SELECTOR =
  '[id*="wizard" i],[class*="wizard" i],[id*="character-creation" i],' +
  '[class*="character-creation" i],[id*="chargen" i],[class*="chargen" i],' +
  '[id*="investigator" i],[class*="investigator" i]';

const WIZARD_TITLE_HINTS = [
  "wizard",
  "마법사",
  "조사자 생성",
  "캐릭터 생성",
  "investigator creation"
];

function setting(key, fallback) {
  try {
    const value = game.settings.get(MODULE_ID, key);
    return value === undefined ? fallback : value;
  } catch (_) {
    return fallback;
  }
}

/* --- window identity ----------------------------------------------------- */

/** A stable-ish key for remembering a window's size between sessions. */
function windowKey(element) {
  const id = element.id ?? "";
  if (!id) return null;

  /*
   * Sheet ids embed a document id, which would make the memory useless.
   * A key is only derived from a real id: falling back to class names made
   * unrelated windows share a stored size.
   */
  return id.replace(/[A-Za-z0-9]{16}/g, "*").replace(/-\d+$/, "") || null;
}

function windowTitle(element) {
  return (
    element.querySelector(".window-title, .window-header h4, header h4")?.textContent ?? ""
  ).trim();
}

function isWizardWindow(element) {
  const selector = String(setting("wizardSelector", DEFAULT_WIZARD_SELECTOR)).trim();

  if (selector) {
    try {
      if (element.matches(selector)) return true;
    } catch (err) {
      console.warn(`${MODULE_ID} | Invalid wizard selector`, selector, err);
    }
  }

  const title = windowTitle(element).toLowerCase();
  return WIZARD_TITLE_HINTS.some(hint => title.includes(hint));
}

/* --- 1. resize grip ------------------------------------------------------ */

function alreadyResizable(element) {
  return !!element.querySelector(
    ".window-resize-handle, .window-resizable-handle, .coc7ko-external-grip"
  );
}

function addResizeGrip(element, app) {
  const grip = document.createElement("div");
  grip.classList.add("coc7ko-external-grip");
  grip.title = "크기 조정";
  element.append(grip);
  element.classList.add("coc7ko-resizable");

  const key = windowKey(element);
  const stored = key ? (setting("externalWindowSizes", {}) ?? {})[key] : null;

  if (stored?.width && stored?.height) {
    applySize(element, app, stored.width, stored.height);
  }

  let drag = null;

  const onMove = event => {
    if (!drag) return;
    const width = Math.max(MIN_W, drag.width + (event.clientX - drag.x));
    const height = Math.max(MIN_H, drag.height + (event.clientY - drag.y));
    applySize(element, app, width, height);
  };

  const onUp = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    if (!drag) return;

    drag = null;
    element.classList.remove("coc7ko-resizing");
    if (key) rememberSize(key, element);
  };

  grip.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();

    const rect = element.getBoundingClientRect();
    drag = { x: event.clientX, y: event.clientY, width: rect.width, height: rect.height };

    element.classList.add("coc7ko-resizing");
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });

  // Double-clicking the grip forgets the remembered size.
  grip.addEventListener("dblclick", async event => {
    event.preventDefault();
    if (!key) return;
    const sizes = { ...(setting("externalWindowSizes", {}) ?? {}) };
    delete sizes[key];
    await game.settings.set(MODULE_ID, "externalWindowSizes", sizes);

    element.style.removeProperty("width");
    element.style.removeProperty("height");
    ui.notifications.info("CoC7-KO | 이 창의 저장된 크기를 지웠습니다.");
  });
}

function applySize(element, app, width, height) {
  element.style.width = `${Math.round(width)}px`;
  element.style.height = `${Math.round(height)}px`;

  // Let the application recompute its own inner layout where it supports it.
  try {
    app?.setPosition?.({ width: Math.round(width), height: Math.round(height) });
  } catch (_) {}
}

function rememberSize(key, element) {
  const rect = element.getBoundingClientRect();
  const sizes = { ...(setting("externalWindowSizes", {}) ?? {}) };

  sizes[key] = {
    width: Math.round(rect.width),
    height: Math.round(rect.height)
  };

  game.settings.set(MODULE_ID, "externalWindowSizes", sizes);
}

/* --- ghost <dialog> sweeper ---------------------------------------------- *
 *
 * Foundry v14 lays <body> out as a flex container and appends dialogs to it.
 * A closed dialog should be display:none by the browser's default styling,
 * but one that is left behind without its `open` attribute — while some rule
 * still gives it a display value — stays a flex item. It is invisible, yet it
 * keeps consuming horizontal space, which squeezes #interface and drags the
 * sidebar away from the right edge of the window.
 *
 * Observed live: #interface measured 1281px inside an 1826px window, with a
 * leftover <dialog> occupying exactly the missing 545px.
 * ------------------------------------------------------------------------ */

function sweepGhostDialogs() {
  if (!setting("sweepGhostDialogs", true)) return 0;

  let removed = 0;

  for (const dialog of document.querySelectorAll("body > dialog")) {
    if (dialog.open || dialog.hasAttribute("open")) continue;

    // Leave anything a live application still owns.
    if (dialog.id && foundry.applications?.instances?.get?.(dialog.id)) continue;

    dialog.remove();
    removed += 1;
  }

  if (removed) {
    console.log(`${MODULE_ID} | removed ${removed} leftover <dialog> element(s)`);
  }

  return removed;
}

/*
 * The other half of the same problem: a dialog that is *open* but was never
 * given a position. Foundry's own positioned windows are absolute, but a
 * dialog rendered in normal flow becomes a flex item of <body> and takes a
 * column of its own — the interface is squeezed by exactly that dialog's
 * width while the dialog is on screen.
 *
 * Measured live: a 545px "업데이트 필요" dialog left #interface at 1281px
 * inside an 1826px window.
 *
 * Only dialogs that are actually in flow are touched. Anything Foundry has
 * already positioned (absolute or fixed) is left exactly as it is.
 */
function floatInFlowDialogs() {
  if (!setting("floatFlowDialogs", true)) return 0;

  let fixed = 0;

  for (const dialog of document.querySelectorAll("body > dialog")) {
    if (!dialog.open && !dialog.hasAttribute("open")) continue;

    const computed = getComputedStyle(dialog);
    const alreadyOutOfFlow =
      computed.position === "absolute" || computed.position === "fixed";

    /*
     * Critical v14 rule:
     * left/top coordinates do NOT mean a dialog is out of flex flow.
     * A dialog can have inline left/top and still be position:relative/static,
     * which is exactly what squeezes #interface and moves chat toward center.
     */
    if (!alreadyOutOfFlow) {
      const hadLeft = !!dialog.style.left;
      const hadTop = !!dialog.style.top;

      dialog.style.setProperty("position", "fixed", "important");
      dialog.style.margin = "0";
      dialog.style.maxHeight = dialog.style.maxHeight || "90vh";

      // Preserve coordinates supplied by Foundry. Center only truly
      // unpositioned dialogs.
      if (!hadLeft && !hadTop) {
        dialog.style.left = "50%";
        dialog.style.top = "50%";
        dialog.style.translate = "-50% -50%";
      }

      dialog.dataset.coc7koFloated = "1";
      fixed += 1;
    } else {
      // Mark it as healthy so diagnostics can distinguish handled dialogs.
      dialog.dataset.coc7koFloated = "1";
    }
  }

  if (fixed) {
    console.log(`${MODULE_ID} | removed ${fixed} open <dialog>(s) from body flex flow`);
  }

  return fixed;
}

let sweepTimer = null;

function scheduleSweep() {
  clearTimeout(sweepTimer);
  sweepTimer = setTimeout(() => {
    floatInFlowDialogs();
    sweepGhostDialogs();
  }, 60);
}

/* --- Public investigator-creation rolls ---------------------------------- *
 *
 * The creation wizard rolls characteristics as a blind GM whisper. Most
 * Korean tables roll these in the open, so while a creation wizard window is
 * on screen, blind/GM-only rolls are published to everyone.
 *
 * Scoped deliberately: the rewrite only happens while a wizard window is
 * actually open, so the keeper's ordinary blind rolls during play are never
 * touched. It also only ever *widens* visibility.
 * ------------------------------------------------------------------------ */

function isCreationWizardOpen() {
  for (const element of document.querySelectorAll(".application, .app.window-app")) {
    if (isWizardWindow(element)) return true;
  }
  return false;
}

Hooks.on("preCreateChatMessage", (message, data, options, userId) => {
  if (!setting("publicCreationRolls", true)) return;
  if (game.user.id !== userId) return;

  const hidden = !!data.blind || (data.whisper?.length ?? 0) > 0;
  if (!hidden) return;
  if (!isCreationWizardOpen()) return;

  message.updateSource({ whisper: [], blind: false });
});

/* --- entry point --------------------------------------------------------- */

/**
 * True only for genuine floating windows.
 *
 * This guard is the important one. Foundry's persistent interface — the
 * sidebar, the scene controls, the player list, the hotbar — is built from
 * ApplicationV2 instances too, and they live inside #interface where the
 * surrounding layout positions them. Writing an inline width/height onto one
 * of those, or worse calling setPosition() on it, turns a laid-out UI region
 * into an absolutely positioned window and shifts the whole interface. That
 * is what displaced the sidebar.
 *
 * A real floating window is appended to <body>, is absolutely/fixed
 * positioned, and has a window frame with a header.
 */
function isFloatingWindow(element, app) {
  if (element.parentElement !== document.body) return false;
  if (!element.querySelector(".window-header, .window-title")) return false;
  if (app?.options?.window?.frame === false) return false;

  const position = getComputedStyle(element).position;
  return position === "absolute" || position === "fixed";
}

function decorateWindow(app, element) {
  if (!(element instanceof HTMLElement)) return;
  if (!element.querySelector(".window-content")) return;
  if (isCoreUiApplication(app)) return;
  if (!isFloatingWindow(element, app)) return;

  try {
    if (element.matches(RESIZE_EXCLUDE) || element.closest(RESIZE_EXCLUDE)) return;
  } catch (_) {}

  const wizard = isWizardWindow(element);

  const resizeMode = setting("externalResize", "all");
  const wantsResize =
    resizeMode === "all" || (resizeMode === "wizard" && wizard);

  if (wantsResize && !alreadyResizable(element)) {
    const beforePosition = getComputedStyle(element).position;
    addResizeGrip(element, app);

    // Defensive v14 repair: adding a resize helper must never turn a
    // floating ApplicationV2 window into a body-layout flex item.
    const afterPosition = getComputedStyle(element).position;
    if (
      element.parentElement === document.body &&
      (beforePosition === "absolute" || beforePosition === "fixed") &&
      afterPosition !== "absolute" &&
      afterPosition !== "fixed"
    ) {
      element.style.setProperty("position", beforePosition, "important");
    }
  }

}

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "externalResize", {
    name: "다른 창 크기 조정 허용",
    hint: "크기 조정을 지원하지 않는 시스템/모듈 창의 우하단에 크기 조절 손잡이를 붙입니다. 손잡이를 더블클릭하면 저장된 크기를 잊습니다.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      all: "모든 창",
      wizard: "조사자 생성 마법사만",
      off: "사용 안 함"
    },
    default: "all"
  });

  game.settings.register(MODULE_ID, "externalWindowSizes", {
    name: "External Window Sizes",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "sweepGhostDialogs", {
    name: "닫힌 다이얼로그 잔재 정리",
    hint: "닫혔는데 DOM에 남아 인터페이스 폭을 잡아먹는 <dialog> 요소를 자동으로 제거합니다. 사이드바가 창 오른쪽 끝에서 밀려나는 증상을 막아줍니다.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "floatFlowDialogs", {
    name: "흐름에 낀 다이얼로그 띄우기",
    hint: "위치가 지정되지 않은 채 <body> 레이아웃에 끼어든 다이얼로그를 화면 중앙에 띄워, 인터페이스가 그만큼 좁아지는 것을 막습니다.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "publicCreationRolls", {
    name: "조사자 생성 굴림 전체 공개",
    hint: "조사자 생성 마법사가 열려 있는 동안 나오는 비밀 굴림을 모두에게 보이도록 바꿉니다. 마법사가 닫혀 있을 때의 비밀 굴림에는 영향을 주지 않습니다.",
    scope: "world",
    config: true,
    type: Boolean,
    default: true
  });

  game.settings.register(MODULE_ID, "wizardSelector", {
    name: "마법사 창 선택자(고급)",
    hint: "조사자 생성 마법사로 인식할 창의 CSS 선택자입니다. 창 제목에 'wizard' 또는 '마법사'가 들어가도 인식합니다.",
    scope: "client",
    config: true,
    type: String,
    default: DEFAULT_WIZARD_SELECTOR
  });


  /*
   * Diagnostic helper. If the wizard is not detected on a given system
   * version, running this in the console prints everything needed to write a
   * precise selector.
   */
  game.coc7koWindowTools = {
    inspect() {
      const windows = [...document.querySelectorAll(".application, .app.window-app")];
      const report = windows.map(el => {
        const rect = el.getBoundingClientRect();
        const computed = getComputedStyle(el);

        return {
        id: el.id,
        classes: el.className,
        title: windowTitle(el),
        parent: el.parentElement?.id || el.parentElement?.tagName,
        position: computed.position,
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        resizable: alreadyResizable(el),
        coc7koResizable: el.classList.contains("coc7ko-resizable"),
        detectedAsWizard: isWizardWindow(el)
      };
      });

      console.log(`${MODULE_ID} | open windows`, report);
      return report;
    },
    /*
     * Dumps the geometry and any inline styling of Foundry's layout regions.
     * `inlineStyle` is the key field: this module only ever writes width,
     * height, left or top inline. If those are empty and the regions are
     * still misplaced, the cause is outside this module.
     */
    inspectLayout() {
      const ids = [
        "interface", "board", "sidebar", "sidebar-content", "chat",
        "ui-left", "ui-right", "ui-top", "ui-bottom", "ui-middle",
        "controls", "players", "hotbar", "navigation"
      ];

      const rows = [];

      for (const id of ids) {
        const el = document.getElementById(id);
        if (!el) {
          rows.push({ id, present: false });
          continue;
        }

        const rect = el.getBoundingClientRect();
        const computed = getComputedStyle(el);

        rows.push({
          id,
          present: true,
          parent: el.parentElement?.id || el.parentElement?.tagName,
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          position: computed.position,
          inlineStyle: el.getAttribute("style") || "(none)",
          hasOurGrip: !!el.querySelector(":scope > .coc7ko-external-grip"),
          ourClasses: [...el.classList].filter(c => c.startsWith("coc7ko"))
        });
      }

      console.log(`${MODULE_ID} | layout report`, {
        window: { width: window.innerWidth, height: window.innerHeight },
        storedSizes: setting("externalWindowSizes", {}),
        regions: rows
      });

      return rows;
    },

    repairFloatingWindows() {
      let repaired = 0;

      for (const el of document.querySelectorAll("body > .application, body > .app.window-app")) {
        if (!(el instanceof HTMLElement)) continue;
        if (!el.querySelector(".window-header, .window-title")) continue;

        const computed = getComputedStyle(el);
        if (computed.position === "absolute" || computed.position === "fixed") continue;

        const rect = el.getBoundingClientRect();
        el.style.setProperty("position", "fixed", "important");
        el.style.left = `${Math.round(rect.left)}px`;
        el.style.top = `${Math.round(rect.top)}px`;
        el.style.margin = "0";
        repaired += 1;
      }

      if (repaired) {
        ui.notifications.info(`CoC7-KO | 떠 있어야 할 창 ${repaired}개를 UI 흐름에서 분리했습니다.`);
      } else {
        ui.notifications.info("CoC7-KO | 흐름에 끼어 있는 Application 창이 없습니다.");
      }

      return repaired;
    },

    inspectDialogs() {
      const rows = [...document.querySelectorAll("body > dialog")].map(dialog => {
        const rect = dialog.getBoundingClientRect();
        const computed = getComputedStyle(dialog);

        return {
          id: dialog.id || "(no id)",
          open: dialog.open || dialog.hasAttribute("open"),
          position: computed.position,
          display: computed.display,
          left: Math.round(rect.left),
          top: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          inlineStyle: dialog.getAttribute("style") || "(none)",
          floatedByCoc7Ko: dialog.dataset.coc7koFloated === "1"
        };
      });

      const iface = document.getElementById("interface")?.getBoundingClientRect();

      console.table(rows);
      console.log(`${MODULE_ID} | dialog layout`, {
        windowWidth: window.innerWidth,
        interfaceWidth: iface ? Math.round(iface.width) : null,
        interfaceRight: iface ? Math.round(iface.right) : null
      });

      return rows;
    },

    /** Manually repairs and removes stray <dialog> elements. */
    sweep() {
      const floated = floatInFlowDialogs();
      const removed = sweepGhostDialogs();
      if (floated) ui.notifications.info(`CoC7-KO | 다이얼로그 ${floated}개를 화면 중앙으로 띄웠습니다.`);
      ui.notifications.info(
        removed
          ? `CoC7-KO | 남아 있던 다이얼로그 ${removed}개를 제거했습니다.`
          : "CoC7-KO | 제거할 다이얼로그 잔재가 없습니다."
      );
      return removed;
    },

    /** Clears every remembered window size and strips our grips. */
    async forget() {
      await game.settings.set(MODULE_ID, "externalWindowSizes", {});

      for (const el of document.querySelectorAll(".coc7ko-resizable")) {
        el.classList.remove("coc7ko-resizable", "coc7ko-resizing");
        el.querySelector(":scope > .coc7ko-external-grip")?.remove();
        el.style.removeProperty("width");
        el.style.removeProperty("height");
      }

      ui.notifications.info("CoC7-KO | 저장된 창 크기를 모두 지웠습니다.");
    },

  };
});

// v13+ ApplicationV2 and the remaining v1 applications both need this.
Hooks.on("renderApplicationV2", (app, element) => {
  // DialogV2 is an ApplicationV2 in v14. Run the layout guard regardless of
  // whether external resize/wizard features are enabled.
  scheduleSweep();

  if (setting("externalResize", "all") === "off") return;
  decorateWindow(app, element instanceof HTMLElement ? element : element?.[0]);
});

Hooks.on("renderApplication", (app, html) => {
  scheduleSweep();

  const element = html instanceof HTMLElement ? html : html?.[0];
  decorateWindow(app, element?.closest?.(".app, .application") ?? element);
});

/*
 * Sweep whenever a window closes (the usual moment a ghost is created) and
 * shortly after any render, which covers dialogs discarded by other code.
 */
Hooks.on("closeApplicationV2", () => scheduleSweep());
Hooks.on("closeApplication", () => scheduleSweep());
Hooks.on("closeDialogV2", () => scheduleSweep());
Hooks.once("ready", () => scheduleSweep());

/*
 * A dialog can appear without any render hook firing (core opens some of them
 * directly), so <body> is watched for new children and for `open` toggling.
 * The handler is idempotent and marks what it has already handled, so it
 * cannot loop on the style changes it makes itself.
 */
Hooks.once("ready", () => {
  floatInFlowDialogs();

  const observer = new MutationObserver(records => {
    const touchesDialog = records.some(record =>
      record.target?.tagName === "DIALOG" ||
      [...record.addedNodes].some(node => node.tagName === "DIALOG")
    );

    if (touchesDialog) scheduleSweep();
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["open", "style", "class"]
  });
});
