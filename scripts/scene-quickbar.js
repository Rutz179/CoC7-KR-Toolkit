/* ==========================================================================
 * CoC7-KO | Scene Quickbar  (v0.7.0)
 *
 * A small floating bar for the keeper holding bookmarked Scenes and the
 * Stage presets of the current Scene, so switching location during play
 * no longer requires a trip through the Scene Controls or the sidebar.
 *
 * The bar is draggable by its header and resizable from the bottom-right
 * grip; both are stored per client.
 * ========================================================================== */

const MODULE_ID = "coc7-ko";

const DEFAULT_PLACEMENT = {
  left: 90,
  top: 90,
  width: 320,
  height: 260
};

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, ch => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[ch]));
}

function getBookmarkedSceneIds() {
  try {
    const stored = game.settings.get(MODULE_ID, "quickbarScenes");
    return Array.isArray(stored) ? stored : [];
  } catch (_) {
    return [];
  }
}

/*
 * Until the keeper drags the bar somewhere, it sits centred at the top or the
 * bottom of the screen (their choice). Once moved, the stored position wins.
 */
function anchoredDefault() {
  const width = 460;
  const height = 250;
  const anchor = (() => {
    try { return game.settings.get(MODULE_ID, "quickbarAnchor"); } catch (_) { return "top"; }
  })();

  return {
    left: Math.max(0, Math.round((window.innerWidth - width) / 2)),
    top: anchor === "bottom"
      ? Math.max(0, window.innerHeight - height - 110)
      : 70,
    width,
    height
  };
}

function getPlacement() {
  let stored = {};
  try {
    stored = game.settings.get(MODULE_ID, "quickbarPlacement") ?? {};
  } catch (_) {}

  const hasStored = Number.isFinite(stored.left) && Number.isFinite(stored.top);
  return hasStored
    ? foundry.utils.mergeObject(anchoredDefault(), stored, { inplace: false })
    : anchoredDefault();
}

class Coc7KoQuickbar {
  constructor() {
    this.element = null;
    this._drag = null;
    this._onPointerMove = this._onPointerMove.bind(this);
    this._onPointerUp = this._onPointerUp.bind(this);
    this._saveTimer = null;
  }

  get open() {
    return !!this.element?.isConnected;
  }

  /* --- lifecycle -------------------------------------------------------- */

  toggle() {
    if (!game.user.isGM) {
      return ui.notifications.warn("CoC7-KO | 장면 퀵바는 키퍼 전용입니다.");
    }

    if (this.open) return this.close();
    return this.render();
  }

  close() {
    this.element?.remove();
    this.element = null;
    if (game.settings.get(MODULE_ID, "quickbarVisible")) {
      game.settings.set(MODULE_ID, "quickbarVisible", false);
    }
  }

  ensureElement() {
    if (this.element?.isConnected) return this.element;

    const el = document.createElement("section");
    el.id = "coc7ko-quickbar";
    el.classList.add("coc7ko-floating-panel");

    const placement = getPlacement();
    Object.assign(el.style, {
      left: `${placement.left}px`,
      top: `${placement.top}px`,
      width: `${placement.width}px`,
      height: `${placement.height}px`
    });

    document.body.append(el);
    el.addEventListener("pointerdown", this._onPointerDown.bind(this));
    el.addEventListener("click", this._onClick.bind(this));

    this.element = el;
    return el;
  }

  async render() {
    if (!game.user.isGM) return;

    const el = this.ensureElement();
    el.innerHTML = this._html();

    this._clampIntoView();
    if (!game.settings.get(MODULE_ID, "quickbarVisible")) {
      await game.settings.set(MODULE_ID, "quickbarVisible", true);
    }
  }

  refresh() {
    if (this.open) this.render();
  }

  /* --- markup ----------------------------------------------------------- */

  _html() {
    const activeSceneId = game.scenes?.active?.id ?? null;
    const viewedSceneId = canvas?.scene?.id ?? null;

    const bookmarks = getBookmarkedSceneIds()
      .map(id => game.scenes.get(id))
      .filter(Boolean);

    // Bookmarks are grouped by the scene's own sidebar folder.
    const groups = new Map();
    for (const scene of bookmarks) {
      const chain = scene.folder
        ? [...(scene.folder.ancestors ?? []).slice().reverse(), scene.folder].map(f => f.name).join(" / ")
        : "";
      if (!groups.has(chain)) groups.set(chain, []);
      groups.get(chain).push(scene);
    }

    const renderSceneChip = scene => `
        <button type="button"
                class="quickbar-chip scene-chip ${scene.id === activeSceneId ? "active" : ""} ${scene.id === viewedSceneId ? "viewed" : ""}"
                data-action="activateScene"
                data-scene-id="${scene.id}"
                title="${escapeHtml(scene.name)} — 클릭: 활성화 / 우클릭: 보기만">
          <i class="fa-solid ${scene.id === activeSceneId ? "fa-circle-play" : "fa-map"}"></i>
          <span>${escapeHtml(scene.name)}</span>
        </button>
      `;

    const sortedGroups = [...groups.entries()]
      .sort((a, b) => a[0].localeCompare(b[0], game.i18n.lang));

    const sceneButtons = bookmarks.length
      ? sortedGroups.map(([folder, scenes]) => `
          <div class="quickbar-group">
            ${folder ? `<div class="quickbar-group-label"><i class="fa-solid fa-folder"></i> ${escapeHtml(folder)}</div>` : ""}
            <div class="quickbar-row">${scenes.map(renderSceneChip).join("")}</div>
          </div>
        `).join("")
      : `<p class="hint">북마크된 장면이 없습니다. 위의 <i class="fa-solid fa-gear"></i> 로 추가하세요.</p>`;

    let presets = [];
    try {
      presets = game.coc7koStage?.getSceneData()?.presets ?? [];
    } catch (_) {}

    const presetButtons = presets.length
      ? presets.map(preset => `
        <button type="button"
                class="quickbar-chip preset-chip"
                data-action="applyPreset"
                data-preset-id="${escapeHtml(preset.id)}"
                title="${escapeHtml(preset.name)}">
          <i class="fa-solid fa-image"></i>
          <span>${escapeHtml(preset.name)}</span>
        </button>
      `).join("")
      : `<p class="hint">이 Scene에는 저장된 장소 프리셋이 없습니다.</p>`;

    return `
      <header class="panel-header" data-drag-handle>
        <i class="fa-solid fa-bookmark"></i>
        <span class="panel-title">장면 퀵바</span>
        <button type="button" class="panel-btn" data-action="close" title="닫기">
          <i class="fa-solid fa-xmark"></i>
        </button>
      </header>

      <div class="panel-body">
        <h4>장소 프리셋</h4>
        <div class="quickbar-row">${presetButtons}</div>

        <h4>도구</h4>
        <div class="quickbar-row">
          <button type="button" class="quickbar-chip" data-action="openItemPalette">
            <i class="fa-solid fa-box-open"></i><span>아이템</span>
          </button>
          <button type="button" class="quickbar-chip" data-action="openNpcPalette">
            <i class="fa-solid fa-masks-theater"></i><span>NPC</span>
          </button>
          <button type="button" class="quickbar-chip" data-action="openStageManager">
            <i class="fa-solid fa-clapperboard"></i><span>장면 조정</span>
          </button>
          <button type="button" class="quickbar-chip" data-action="toggleLayout">
            <i class="fa-solid fa-arrows-up-down-left-right"></i><span>배치</span>
          </button>
          <button type="button" class="quickbar-chip" data-action="releaseSpeakers" title="모든 화자 강조를 즉시 해제">
            <i class="fa-solid fa-comment-slash"></i><span>화자 해제</span>
          </button>
        </div>

        <h4>창</h4>
        <div class="quickbar-row">
          <button type="button" class="quickbar-chip" data-action="panelWhisper">
            <i class="fa-solid fa-user-secret"></i><span>귓속말</span>
          </button>
          <button type="button" class="quickbar-chip" data-action="panelNotes">
            <i class="fa-solid fa-book"></i><span>노트</span>
          </button>
          <button type="button" class="quickbar-chip" data-action="panelRolls">
            <i class="fa-solid fa-dice-d20"></i><span>판정</span>
          </button>
        </div>
      </div>

      <div class="panel-grip" data-resize-handle title="크기 조정"></div>
    `;
  }

  /* --- interaction ------------------------------------------------------ */

  async _onClick(event) {
    const button = event.target.closest("[data-action]");
    if (!button) return;

    event.preventDefault();
    const action = button.dataset.action;

    switch (action) {
      case "close":
        return this.close();

      case "configure":
        return this.openConfig();

      case "activateScene": {
        const scene = game.scenes.get(button.dataset.sceneId);
        if (!scene) return ui.notifications.error("CoC7-KO | Scene을 찾을 수 없습니다.");
        await scene.activate();
        return this.refresh();
      }

      case "applyPreset":
        await game.coc7koStage?.applyPreset(button.dataset.presetId);
        return;

      case "openItemPalette":
        return game.coc7koStage?.openItemPalette();

      case "openNpcPalette":
        return game.coc7koStage?.openNpcPalette();

      case "openStageManager":
        return game.coc7koStage?.openStageManager();

      case "toggleLayout":
        return game.coc7koStage?.toggleLayoutEditing();

      case "releaseSpeakers":
        return game.coc7koStage?.releaseSpeakers();

      case "panelWhisper":
        return game.coc7koPanels?.whisper();

      case "panelNotes":
        return game.coc7koPanels?.notes();

      case "panelRolls":
        return game.coc7koPanels?.rolls();
    }
  }

  _onPointerDown(event) {
    if (event.button !== 0) return;

    const resizeHandle = event.target.closest("[data-resize-handle]");
    const dragHandle = event.target.closest("[data-drag-handle]");

    if (!resizeHandle && !dragHandle) return;
    if (event.target.closest("[data-action]")) return;

    const rect = this.element.getBoundingClientRect();
    event.preventDefault();

    this._drag = {
      mode: resizeHandle ? "resize" : "move",
      startX: event.clientX,
      startY: event.clientY,
      startLeft: rect.left,
      startTop: rect.top,
      startWidth: rect.width,
      startHeight: rect.height
    };

    this.element.classList.add("dragging");
    window.addEventListener("pointermove", this._onPointerMove);
    window.addEventListener("pointerup", this._onPointerUp);
  }

  _onPointerMove(event) {
    const drag = this._drag;
    if (!drag) return;

    const dx = event.clientX - drag.startX;
    const dy = event.clientY - drag.startY;

    if (drag.mode === "resize") {
      this.element.style.width = `${Math.max(240, drag.startWidth + dx)}px`;
      this.element.style.height = `${Math.max(160, drag.startHeight + dy)}px`;
      return;
    }

    this.element.style.left = `${Math.max(0, drag.startLeft + dx)}px`;
    this.element.style.top = `${Math.max(0, drag.startTop + dy)}px`;
  }

  _onPointerUp() {
    window.removeEventListener("pointermove", this._onPointerMove);
    window.removeEventListener("pointerup", this._onPointerUp);
    if (!this._drag) return;

    this._drag = null;
    this.element?.classList.remove("dragging");
    this._clampIntoView();
    this._savePlacement();
  }

  _clampIntoView() {
    if (!this.element) return;
    const rect = this.element.getBoundingClientRect();

    const left = Math.clamp(rect.left, 0, Math.max(0, window.innerWidth - 80));
    const top = Math.clamp(rect.top, 0, Math.max(0, window.innerHeight - 60));

    this.element.style.left = `${Math.round(left)}px`;
    this.element.style.top = `${Math.round(top)}px`;
  }

  _savePlacement() {
    if (!this.element) return;
    const rect = this.element.getBoundingClientRect();

    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => {
      game.settings.set(MODULE_ID, "quickbarPlacement", {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height)
      });
    }, 150);
  }

  /* --- bookmark configuration ------------------------------------------- */

  async openConfig() {
    const bookmarked = new Set(getBookmarkedSceneIds());

    const rows = game.scenes.contents
      .sort((a, b) => a.name.localeCompare(b.name, game.i18n.lang))
      .map(scene => `
        <label class="coc7ko-quickbar-config-row">
          <input type="checkbox" name="${scene.id}" ${bookmarked.has(scene.id) ? "checked" : ""}>
          <span>${escapeHtml(scene.name)}</span>
        </label>
      `).join("");

    await foundry.applications.api.DialogV2.wait({
      window: { title: "퀵바 북마크 편집", icon: "fa-solid fa-bookmark" },
      position: { width: 420 },
      content: `
        <div class="coc7ko-quickbar-config">
          <p class="hint">퀵바에 표시할 Scene을 선택하세요.</p>
          ${rows || `<p class="hint">월드에 Scene이 없습니다.</p>`}
        </div>
      `,
      buttons: [
        {
          action: "save",
          label: "저장",
          default: true,
          callback: (event, button, dialog) => {
            // The shape of the third argument has moved around between
            // Foundry releases, so resolve the form defensively.
            const root =
              dialog?.element ??
              (dialog instanceof HTMLElement ? dialog : null) ??
              button?.form ??
              button?.closest("dialog") ??
              document;

            const selected = [...root.querySelectorAll("input[type='checkbox']")]
              .filter(input => input.checked)
              .map(input => input.name);

            return game.settings.set(MODULE_ID, "quickbarScenes", selected);
          }
        },
        { action: "cancel", label: "취소" }
      ]
    });

    this.refresh();
  }
}

const quickbar = new Coc7KoQuickbar();

Hooks.once("init", () => {
  game.settings.register(MODULE_ID, "quickbarScenes", {
    name: "Quickbar Bookmarked Scenes",
    scope: "world",
    config: false,
    type: Array,
    default: [],
    onChange: () => quickbar.refresh()
  });

  game.settings.register(MODULE_ID, "quickbarPlacement", {
    name: "Quickbar Placement",
    scope: "client",
    config: false,
    type: Object,
    default: {}
  });

  game.settings.register(MODULE_ID, "quickbarVisible", {
    name: "장면 퀵바 표시",
    hint: "키퍼 화면에 장면 퀵바를 띄웁니다. 퀵바의 X 버튼이나 씬 컨트롤의 책갈피 아이콘으로도 켜고 끌 수 있습니다.",
    scope: "client",
    config: true,
    type: Boolean,
    default: true,
    // Guarded so render() -> set(true) -> onChange -> render() cannot loop.
    onChange: value => {
      if (value && !quickbar.open) quickbar.render();
      if (!value && quickbar.open) {
        quickbar.element.remove();
        quickbar.element = null;
      }
    }
  });

  game.settings.register(MODULE_ID, "quickbarAnchor", {
    name: "장면 퀵바 기본 위치",
    hint: "퀵바를 옮기기 전까지 놓일 기본 위치입니다. 바꾸면 저장된 위치를 지우고 새 기본 위치로 옮깁니다.",
    scope: "client",
    config: true,
    type: String,
    choices: {
      top: "화면 중앙 상단",
      bottom: "화면 중앙 하단"
    },
    default: "top",
    onChange: async () => {
      await game.settings.set(MODULE_ID, "quickbarPlacement", {});
      quickbar.element?.remove();
      quickbar.element = null;
      if (game.settings.get(MODULE_ID, "quickbarVisible")) quickbar.render();
    }
  });

  game.coc7koQuickbar = quickbar;
});

Hooks.once("ready", () => {
  if (!game.user.isGM) return;
  if (game.settings.get(MODULE_ID, "quickbarVisible")) quickbar.render();
});

// Keep the active-scene highlight and the preset list in sync.
Hooks.on("canvasReady", () => quickbar.refresh());
Hooks.on("updateScene", (scene, changed) => {
  if ("active" in changed || foundry.utils.hasProperty(changed, `flags.${MODULE_ID}.stage`)) {
    quickbar.refresh();
  }
});
